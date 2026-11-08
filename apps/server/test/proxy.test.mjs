import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../src/server.mjs";
import { memoryStore } from "../src/store.mjs";

test("proxies /rest with range and POST bodies, hides other paths", async () => {
  const seen = [];
  const up = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url, range: req.headers.range, host: req.headers.host, body });
      res.writeHead(req.headers.range ? 206 : 200, { "content-type": "audio/mpeg", "content-range": "bytes 0-3/10" });
      res.end("abcd");
    });
  });
  await new Promise((r) => up.listen(0, r));
  const upUrl = `http://127.0.0.1:${up.address().port}`;
  const app = createApp({ navidromeUrl: upUrl, store: memoryStore(), verify: async () => true });
  await new Promise((r) => app.http.listen(0, r));
  const base = `http://127.0.0.1:${app.http.address().port}`;

  const r1 = await fetch(`${base}/rest/stream?id=1&u=a`, { headers: { range: "bytes=0-3" } });
  assert.equal(r1.status, 206);
  assert.equal(await r1.text(), "abcd");
  assert.equal(seen[0].url, "/rest/stream?id=1&u=a");
  assert.equal(seen[0].range, "bytes=0-3");
  assert.equal(seen[0].host, `127.0.0.1:${up.address().port}`);

  await fetch(`${base}/rest/updatePlaylist`, { method: "POST", body: "x=1" });
  assert.equal(seen[1].body, "x=1");

  const r3 = await fetch(`${base}/metrics`);
  assert.equal(r3.status, 404);
  assert.equal(seen.length, 2);
  app.close(); up.closeAllConnections(); up.close();
});
