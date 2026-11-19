import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.mjs";
import { createBpmStore } from "../src/bpm.mjs";
import { createBpmAnalyzer, createFailedStore } from "../src/bpm-analyzer.mjs";
import { isDrumAndBass, resolveDnbBpm } from "../src/bpm-octave.mjs";
import { memoryStore } from "../src/store.mjs";

const ADMIN = { authorization: "Subsonic u=root&t=good&s=x" };
const USER = { authorization: "Subsonic u=bob&t=good&s=x" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A fake analyser program: the "audio file" a fake Navidrome hands out is a line of text, `bpm=128`,
// `fail` or `slow=300 bpm=100`, and the program answers like the real one (JSON, exit code).
function fakeCli(dir, logFile) {
  const p = join(dir, "fake-bpm");
  writeFileSync(p, `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.length < 3) { console.log('{"error":"usage"}'); process.exit(2); }
const text = fs.readFileSync(process.argv[2], "utf8");
fs.appendFileSync(${JSON.stringify(logFile)}, text + "\\n");
const slow = /slow=(\\d+)/.exec(text);
setTimeout(() => {
  const m = /bpm=([\\d.]+)/.exec(text);
  if (/fail/.test(text) || !m) { console.log(JSON.stringify({ error: "no clear tempo" })); process.exit(1); }
  console.log(JSON.stringify({ bpm: Number(m[1]) }));
}, slow ? Number(slow[1]) : 0);
`);
  chmodSync(p, 0o755);
  return p;
}

// A fake Navidrome: search3 pages through `songs`, download answers with the song's text, and it records
// what it was asked and with which credentials.
async function fakeNavidrome(songs) {
  const seen = { downloads: [], headers: [], params: [] };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ "subsonic-response": { status: "ok", ...o } })); };
    seen.headers.push(req.headers); seen.params.push(Object.fromEntries(u.searchParams));
    if (u.pathname === "/rest/search3") {
      const off = Number(u.searchParams.get("songOffset")), n = Number(u.searchParams.get("songCount"));
      return send({ searchResult3: { song: songs.slice(off, off + n).map((s) => ({ id: s.id, genre: s.genre, suffix: "flac", size: 10 })) } });
    }
    if (u.pathname === "/rest/getScanStatus") return send({ scanStatus: { scanning: false, count: songs.length } });
    if (u.pathname === "/rest/download") {
      const id = u.searchParams.get("id");
      seen.downloads.push(id);
      const s = songs.find((x) => x.id === id);
      if (!s) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "content-type": "audio/flac" }); res.end(s.text); return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, r));
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => srv.close() };
}

async function boot(songs, { bpmStore = createBpmStore(), cliOverride } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bpma-"));
  const log = join(dir, "cli.log");
  writeFileSync(log, "");
  const nav = await fakeNavidrome(songs);
  const bpmAnalyzer = createBpmAnalyzer({ navidromeUrl: nav.url, bpmStore, cli: cliOverride ?? fakeCli(dir, log), dir, tmpRoot: join(dir, "tmp") });
  const app = createApp({
    navidromeUrl: nav.url, store: memoryStore(), bpmStore, bpmAnalyzer,
    verify: async (_u, a) => a.t === "good", isAdmin: async (_u, c) => c.u === "root",
  });
  await new Promise((r) => app.http.listen(0, r));
  const base = `http://127.0.0.1:${app.http.address().port}`;
  const call = (method, path, body, headers = ADMIN) => fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const status = async () => (await call("GET", "/bpm/analyze")).json();
  const finish = async () => { for (let i = 0; i < 200; i++) { const s = await status(); if (s.state === "idle" && s.finishedAt) return s; await sleep(25); } throw new Error("job did not finish"); };
  const cliRuns = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { base, call, status, finish, cliRuns, nav, bpmStore, dir, close: () => { app.close(); nav.close(); } };
}

const song = (id, text, genre = "Pop") => ({ id, text, genre });

test("only an administrator can start, watch and stop the analysis", async () => {
  const t = await boot([song("a", "bpm=100")]);
  assert.equal((await t.call("GET", "/bpm/analyze", null, {})).status, 401);
  for (const [m, p] of [["GET", "/bpm/analyze"], ["POST", "/bpm/analyze"], ["DELETE", "/bpm/analyze"], ["GET", "/bpm/analyze/failed"]]) {
    assert.equal((await t.call(m, p, m === "POST" ? {} : null, USER)).status, 403, `${m} ${p}`);
  }
  assert.equal(t.cliRuns().length, 0);
  t.close();
});

test("a full job: analyses what has no BPM, genre-corrects drum & bass, lists failures, leaves existing values alone", async () => {
  const store = createBpmStore();
  store.set("have", 100, false);    // uploaded by the desktop
  store.set("fixed", 90, true);     // corrected by hand
  const songs = [
    song("have", "bpm=140"), song("fixed", "bpm=140"),
    song("new1", "bpm=128"), song("dnb", "bpm=87", "Drum & Bass"), song("hiphop", "bpm=95", "Rap • Hip-Hop • Drum & Bass"),
    song("broken", "fail"),
  ];
  const t = await boot(songs, { bpmStore: store });
  const r = await t.call("POST", "/bpm/analyze", { workers: 2 });
  assert.equal(r.status, 202);
  const s = await t.finish();
  assert.equal(store.get("have"), 100);
  assert.equal(store.get("fixed"), 90);
  assert.equal(store.get("new1"), 128);
  assert.equal(store.get("dnb"), 174);
  assert.equal(store.get("hiphop"), 95);
  assert.equal(store.get("broken"), undefined);
  assert.equal(s.analysed, 3);
  assert.equal(s.failed, 1);
  assert.equal(s.total, 4);          // the two with a value were never queued
  assert.equal(s.remaining, 0);
  assert.equal(s.libraryTotal, 6);
  assert.equal(s.withBpm, 5);
  // the songs that had a value were not even downloaded, and the analyser never saw them
  assert.deepEqual([...t.nav.seen.downloads].sort(), ["broken", "dnb", "hiphop", "new1"]);
  assert.equal(t.cliRuns().length, 4);
  assert.ok(!t.cliRuns().some((x) => x === "bpm=140"));
  const failed = await (await t.call("GET", "/bpm/analyze/failed")).json();
  assert.deepEqual(failed.map((f) => f.id), ["broken"]);
  assert.match(failed[0].reason, /no clear tempo/);
  assert.deepEqual(readdirSync(join(t.dir, "tmp")), []); // temp files are gone
  t.close();
});

test("a value that appears while the job runs is not overwritten", async () => {
  const t = await boot([song("race", "slow=400 bpm=100"), song("other", "bpm=120")]);
  await t.call("POST", "/bpm/analyze", { workers: 1 });
  await sleep(150); // "race" is being analysed now
  assert.equal((await t.call("PUT", "/bpm/race", { bpm: 77 }, USER)).status, 204); // another player uploads
  const s = await t.finish();
  assert.equal(t.bpmStore.get("race"), 77);
  assert.equal(t.bpmStore.get("other"), 120);
  assert.equal(s.skipped, 1);
  assert.equal(s.analysed, 1);
  t.close();
});

test("a manual value that appears mid-job also stays", async () => {
  const t = await boot([song("race", "slow=300 bpm=100")]);
  await t.call("POST", "/bpm/analyze", {});
  await sleep(100);
  await t.call("PUT", "/bpm/race", { bpm: 60, manual: true }, USER);
  await t.finish();
  assert.equal(t.bpmStore.get("race"), 60);
  t.close();
});

test("setIfAbsent never replaces", () => {
  const s = createBpmStore();
  assert.equal(s.setIfAbsent("a", 100), true);
  assert.equal(s.setIfAbsent("a", 120), false);
  assert.equal(s.get("a"), 100);
  s.set("m", 90, true);
  assert.equal(s.setIfAbsent("m", 120), false);
  assert.equal(s.get("m"), 90);
});

test("stop ends the job quickly and leaves the rest for a later start", async () => {
  const songs = Array.from({ length: 12 }, (_, i) => song(`s${i}`, "slow=250 bpm=110"));
  const t = await boot(songs);
  await t.call("POST", "/bpm/analyze", { workers: 2 });
  assert.equal((await t.call("POST", "/bpm/analyze", {})).status, 409); // one job at a time
  await sleep(120);
  assert.equal((await (await t.call("DELETE", "/bpm/analyze")).json()).stopped, true);
  const s = await t.finish();
  assert.equal(s.state, "idle");
  assert.ok(t.bpmStore.size() < 12);
  assert.equal(s.failed, 0); // interrupted songs are not "failed"
  assert.deepEqual(readdirSync(join(t.dir, "tmp")), []);
  // started again, it does what is left
  await t.call("POST", "/bpm/analyze", { workers: 4 });
  const s2 = await t.finish();
  assert.equal(t.bpmStore.size(), 12);
  assert.ok(s2.total <= 12);
  t.close();
});

test("failed songs are not retried unless asked", async () => {
  const t = await boot([song("bad", "fail"), song("ok", "bpm=100")]);
  await t.call("POST", "/bpm/analyze", {});
  await t.finish();
  assert.equal(t.cliRuns().length, 2);
  await t.call("POST", "/bpm/analyze", {});
  const s = await t.finish();
  assert.equal(t.cliRuns().length, 2, "the failed song was not tried again");
  assert.equal(s.total, 0);
  assert.equal(s.failedTotal, 1);
  await t.call("POST", "/bpm/analyze", { retryFailed: true });
  await t.finish();
  assert.equal(t.cliRuns().length, 3, "retryFailed tries it again");
  t.close();
});

test("the failed list survives a restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "bpmf-"));
  createFailedStore(dir).add("x", { reason: "no clear tempo", at: 1 });
  assert.equal(createFailedStore(dir).has("x"), true);
  assert.ok(existsSync(join(dir, "bpm-failed.json")));
});

test("the administrator's token goes to Navidrome for the job only, and is never written to disk", async () => {
  const t = await boot([song("a", "bpm=100")]);
  await t.call("POST", "/bpm/analyze", {});
  await t.finish();
  const dl = t.nav.seen.params.filter((p) => p.id === "a");
  assert.equal(dl.length, 1);
  assert.deepEqual([dl[0].u, dl[0].t, dl[0].s], ["root", "good", "x"]);
  for (const f of readdirSync(t.dir)) if (f.endsWith(".json")) assert.ok(!readFileSync(join(t.dir, f), "utf8").includes("good"));
  t.close();
});

test("with secure sign-in the analysis asks Navidrome as the account through the trusted header, with no token", async () => {
  const store = createBpmStore();
  const dir = mkdtempSync(join(tmpdir(), "bpms-"));
  const log = join(dir, "log"); writeFileSync(log, "");
  const nav = await fakeNavidrome([song("a", "bpm=100")]);
  const an = createBpmAnalyzer({ navidromeUrl: nav.url, bpmStore: store, cli: fakeCli(dir, log), tmpRoot: join(dir, "tmp") });
  assert.deepEqual(await an.start({ cred: { u: "root", remoteUser: true } }), { ok: true });
  for (let i = 0; i < 100 && (await an.status()).state !== "idle"; i++) await sleep(25);
  assert.equal(store.get("a"), 100);
  assert.ok(nav.seen.headers.length > 0);
  for (const h of nav.seen.headers) assert.equal(h["remote-user"], "root");
  for (const p of nav.seen.params) { assert.equal(p.t, undefined); assert.equal(p.s, undefined); }
  nav.close();
});

test("a missing analyser program is reported and nothing starts", async () => {
  const t = await boot([song("a", "bpm=100")], { cliOverride: "/nonexistent/icosahedron-bpm" });
  const r = await t.call("POST", "/bpm/analyze", {});
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "analyser_missing");
  assert.equal((await t.status()).state, "idle");
  t.close();
});

test("workers are limited to 1-8", async () => {
  const t = await boot([song("a", "bpm=100")]);
  await t.call("POST", "/bpm/analyze", { workers: 99 });
  assert.equal((await t.status()).workers, 8);
  await t.finish();
  await t.call("POST", "/bpm/analyze", { workers: 0, retryFailed: true });
  assert.equal((await t.status()).workers, 4);
  await t.finish();
  t.close();
});

test("drum & bass correction: the desktop's rules", () => {
  for (const g of ["Drum & Bass", "Drum and Bass", "Drum'n'Bass", "DnB", "dnb", "Liquid Funk; Drum and Bass", "Neurofunk", "Jungle", "Drum & Bass • Electronic"]) assert.equal(isDrumAndBass(g), true, g);
  for (const g of ["Pop", "House", "", null, undefined, "Rap • Hip-Hop • Electronic • Drum & Bass", "Drum & Bass; Reggae", "Dancehall / Jungle"]) assert.equal(isDrumAndBass(g), false, String(g));
  assert.equal(resolveDnbBpm(87, "Drum & Bass"), 174);       // half
  assert.equal(resolveDnbBpm(116, "Drum & Bass"), 174);      // two thirds
  assert.equal(resolveDnbBpm(80, "DnB"), 160);
  assert.equal(resolveDnbBpm(174, "Drum & Bass"), 174);      // already right
  assert.equal(resolveDnbBpm(70, "Drum & Bass"), 70);        // would not land in 160-185
  assert.equal(resolveDnbBpm(100, "Drum & Bass"), 100);      // 200 is outside 160-185
  assert.equal(resolveDnbBpm(87, "Pop"), 87);                // other genres untouched
  assert.equal(resolveDnbBpm(95, "Rap • Hip-Hop • Drum & Bass"), 95);
  assert.equal(resolveDnbBpm(87, null), 87);
  assert.equal(resolveDnbBpm(0, "Drum & Bass"), 0);
});
