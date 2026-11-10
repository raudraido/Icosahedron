import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApp } from "../src/server.mjs";
import { memoryStore } from "../src/store.mjs";

test("/config.json tells the apps the engine's version and protocol", async () => {
  const app = createApp({ navidromeUrl: "http://nav", store: memoryStore() });
  await new Promise((r) => app.http.listen(0, r));
  const res = await fetch(`http://127.0.0.1:${app.http.address().port}/config.json`);
  const cfg = await res.json();
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(cfg.version, pkg.version);
  assert.equal(cfg.protocol, 2);
  assert.equal(cfg.navidromeUrl, "http://nav");
  app.close();
});
