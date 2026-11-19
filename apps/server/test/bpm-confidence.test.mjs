import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.mjs";
import { createBpmStore } from "../src/bpm.mjs";
import { createBpmAnalyzer } from "../src/bpm-analyzer.mjs";
import { skipReason, skipGenresFromEnv, DEFAULT_SKIP_GENRES } from "../src/bpm-prefilter.mjs";
import { memoryStore } from "../src/store.mjs";

// Confidence, the prefilters, the minimum confidence, the report and the re-check
// (the guarantees of the first version are in bpm-analyzer.test.mjs).

const ADMIN = { authorization: "Subsonic u=root&t=good&s=x" };
const USER = { authorization: "Subsonic u=bob&t=good&s=x" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The "audio file" a fake Navidrome hands out is a line of text: `bpm=128 conf=0.9`, optionally `slow=300`.
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
  if (!m) { console.log(JSON.stringify({ error: "no clear tempo" })); process.exit(1); }
  const c = /conf=([\\d.]+)/.exec(text);
  console.log(JSON.stringify({ bpm: Number(m[1]), ...(c ? { confidence: Number(c[1]), duration_secs: 200 } : {}) }));
}, slow ? Number(slow[1]) : 0);
`);
  chmodSync(p, 0o755);
  return p;
}

async function fakeNavidrome(songs) {
  const seen = { downloads: [] };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ "subsonic-response": { status: "ok", ...o } })); };
    if (u.pathname === "/rest/search3") {
      const off = Number(u.searchParams.get("songOffset")), n = Number(u.searchParams.get("songCount"));
      return send({ searchResult3: { song: songs.slice(off, off + n).map((s) => ({ id: s.id, genre: s.genre, suffix: "flac", size: 10, duration: s.duration })) } });
    }
    if (u.pathname === "/rest/getSong") {
      const s = songs.find((x) => x.id === u.searchParams.get("id"));
      return s ? send({ song: { id: s.id, title: `Title ${s.id}`, artist: "Artist", genre: s.genre } }) : send({});
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

async function boot(songs, { bpmStore = createBpmStore() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bpmc-"));
  const log = join(dir, "cli.log");
  writeFileSync(log, "");
  const nav = await fakeNavidrome(songs);
  const bpmAnalyzer = createBpmAnalyzer({ navidromeUrl: nav.url, bpmStore, cli: fakeCli(dir, log), dir, tmpRoot: join(dir, "tmp") });
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
  return { base, call, status, finish, cliRuns, nav, bpmStore, close: () => { app.close(); nav.close(); } };
}

const song = (id, text, genre = "Pop", duration = 200) => ({ id, text, genre, duration });

test("the prefilter: short songs and no-beat genres are not even downloaded, and are remembered as skipped, not failed", async () => {
  const store = createBpmStore();
  store.set("shortHave", 100, false);
  const songs = [
    song("short", "bpm=120", "Pop", 45), song("amb", "bpm=90", "Ambient"), song("dark", "bpm=90", "Dark Ambient; Drone"),
    song("ost", "bpm=90", "Soundtrack"), song("amb-techno", "bpm=130", "Ambient; Techno"), song("ambhouse", "bpm=124", "Ambient House"),
    song("nodur", "bpm=100", "Pop", 0), song("ok", "bpm=110", "Pop", 61), song("shortHave", "bpm=1", "Pop", 10),
  ];
  const t = await boot(songs, { bpmStore: store });
  await t.call("POST", "/bpm/analyze", {});
  const s = await t.finish();
  assert.deepEqual([...t.nav.seen.downloads].sort(), ["amb-techno", "ambhouse", "nodur", "ok"]);
  assert.equal(s.prefiltered, 4);
  assert.equal(s.failed, 0);
  assert.equal(s.skippedTotal, 4);
  assert.equal(store.get("shortHave"), 100); // a song with a value is never touched, skip rule or not
  const list = await (await t.call("GET", "/bpm/analyze/skipped")).json();
  assert.deepEqual(list.map((x) => x.id).sort(), ["amb", "dark", "ost", "short"]);
  assert.match(list.find((x) => x.id === "short").reason, /shorter than 60/);
  assert.match(list.find((x) => x.id === "amb").reason, /genre: ambient/);
  // not retried on the next start
  await t.call("POST", "/bpm/analyze", {});
  const s2 = await t.finish();
  assert.equal(s2.total, 0);
  assert.equal(t.nav.seen.downloads.length, 4);
  // unless the administrator includes them
  await t.call("POST", "/bpm/analyze", { includeSkipped: true });
  const s3 = await t.finish();
  assert.equal(s3.total, 4);
  assert.equal(store.get("amb"), 90);
  assert.equal(store.get("shortHave"), 100);
  assert.equal((await t.status()).skippedTotal, 0);
  t.close();
});

test("the skip rule: names, multi-genre tags, a rhythmic genre next to ambient, the env list", () => {
  for (const g of ["Ambient", "Dark Ambient", "Drone", "Film Score", "Video Game Soundtrack", "Spoken Word", "Audiobook", "Podcast", "Field Recordings", "Sound Effects", "Intro", "Ambient • Electronic"]) assert.ok(skipReason({ genre: g, duration: 200 }), g);
  for (const g of ["Pop", "House", "", "Ambient; Techno", "Ambient House", "Soundtrack / Hip-Hop", "Rock", "Ambient • Drum & Bass"]) assert.equal(skipReason({ genre: g, duration: 200 }), null, g);
  assert.match(skipReason({ genre: "Pop", duration: 59 }), /shorter/);
  assert.equal(skipReason({ genre: "Pop", duration: 60 }), null);
  assert.equal(skipReason({ genre: "Pop", duration: 0 }), null); // an unknown length is not a reason
  assert.deepEqual(skipGenresFromEnv("lounge, chill out"), ["lounge", "chill out"]);
  assert.equal(skipReason({ genre: "Lounge", duration: 200 }, skipGenresFromEnv("lounge")), "genre: lounge");
  assert.equal(skipReason({ genre: "Ambient", duration: 200 }, skipGenresFromEnv("lounge")), null);
  assert.deepEqual(skipGenresFromEnv(""), DEFAULT_SKIP_GENRES);
});

test("new detections are stored with their confidence; the minimum hides unreliable ones from players, not manual ones", async () => {
  const store = createBpmStore();
  store.set("man", 90, true);
  store.set("old", 100, false); // no confidence (an older value)
  const t = await boot([song("good", "bpm=128 conf=0.9"), song("weak", "bpm=77 conf=0.1"), song("man", "bpm=1")], { bpmStore: store });
  await t.call("POST", "/bpm/analyze", {});
  await t.finish();
  assert.deepEqual(store.entry("good"), { bpm: 128, manual: false, confidence: 0.9 });
  assert.equal(store.get("weak"), 77); // minimum 0 hides nothing
  assert.equal((await t.call("PUT", "/bpm/analyze/min-confidence", { minConfidence: 0.5 }, USER)).status, 403);
  assert.equal((await t.call("PUT", "/bpm/analyze/min-confidence", { minConfidence: 2 })).status, 422);
  assert.equal((await t.call("PUT", "/bpm/analyze/min-confidence", { minConfidence: 0.5 })).status, 200);
  assert.deepEqual(await (await fetch(`${t.base}/bpm`, { headers: USER })).json(), { man: 90, old: 100, good: 128 });
  assert.equal((await fetch(`${t.base}/bpm/weak`, { headers: USER })).status, 404);
  assert.equal(store.entry("weak").bpm, 77); // still stored for review
  const s = await t.status();
  assert.equal(s.withBpm, 3);
  assert.equal(s.unreliable, 1);
  assert.equal(s.withConfidence, 2);
  assert.equal(s.unscored, 1);
  assert.equal(s.minConfidence, 0.5);
  // an unreliable value is not measured again either
  const before = t.cliRuns().length;
  await t.call("POST", "/bpm/analyze", {});
  await t.finish();
  assert.equal(t.cliRuns().length, before);
  t.close();
});

test("the minimum confidence goes through the settings callback, and bpm.json from before confidence still loads", () => {
  const dir = mkdtempSync(join(tmpdir(), "bpmc-"));
  writeFileSync(join(dir, "bpm.json"), JSON.stringify({ a: { bpm: 100, manual: false }, b: { bpm: 90, manual: true } }));
  let saved;
  const s = createBpmStore(dir, { minConfidence: 0.3, onMinConfidence: (v) => { saved = v; } });
  assert.deepEqual(s.all(), { a: 100, b: 90 });
  assert.equal(s.minConfidence, 0.3);
  assert.equal(s.setMinConfidence(0.6), true);
  assert.equal(saved, 0.6);
  assert.equal(s.setMinConfidence(-1), false);
  assert.equal(s.setMinConfidence("x"), false);
});

test("a player's PUT and the bulk upload keep working and carry no confidence", async () => {
  const t = await boot([]);
  await t.call("PUT", "/bpm/x", { bpm: 120 }, USER);
  await t.call("POST", "/bpm", { y: 130 }, USER);
  assert.deepEqual(t.bpmStore.entry("x"), { bpm: 120, manual: false });
  assert.deepEqual(await (await fetch(`${t.base}/bpm`, { headers: USER })).json(), { x: 120, y: 130 });
  t.close();
});

test("the report: counts, a 10-bin histogram and the lowest-confidence songs with their titles", async () => {
  const store = createBpmStore();
  store.set("m", 90, true);
  store.set("old", 100, false);
  const songs = [song("a", "bpm=100 conf=0.05"), song("b", "bpm=100 conf=0.95"), song("c", "bpm=100 conf=0.15"), song("d", "bpm=100 conf=1"), song("amb", "bpm=1", "Ambient")];
  const t = await boot(songs, { bpmStore: store });
  await t.call("POST", "/bpm/analyze", {});
  await t.finish();
  await t.call("PUT", "/bpm/analyze/min-confidence", { minConfidence: 0.1 });
  assert.equal((await t.call("GET", "/bpm/analyze/report", null, USER)).status, 403);
  const r = await (await t.call("GET", "/bpm/analyze/report?limit=2")).json();
  assert.deepEqual(r.histogram, [1, 1, 0, 0, 0, 0, 0, 0, 0, 2]);
  assert.deepEqual(r.counts, { stored: 6, manual: 1, withConfidence: 4, withoutConfidence: 1, skipped: 1, failed: 0, belowThreshold: 1 });
  assert.equal(r.minConfidence, 0.1);
  assert.deepEqual(r.lowest.map((x) => [x.id, x.bpm, x.confidence, x.title]), [["a", 100, 0.05, "Title a"], ["c", 100, 0.15, "Title c"]]);
  t.close();
});

test("re-check replaces only detected values that have no confidence; manual and scored values stay; it is off by default", async () => {
  const store = createBpmStore();
  store.set("old1", 87, false);            // detected before confidence existed
  store.set("old2", 60, false);
  store.set("man", 90, true);              // corrected by hand
  store.set("scored", 100, false, 0.9);    // already has a confidence
  const songs = [song("old1", "bpm=128 conf=0.9"), song("old2", "bpm=87 conf=0.2", "Drum & Bass"), song("man", "bpm=140 conf=0.9"), song("scored", "bpm=140 conf=0.9"), song("new", "bpm=110 conf=0.8")];
  const t = await boot(songs, { bpmStore: store });
  await t.call("POST", "/bpm/analyze", {}); // a normal start touches nothing that has a value
  await t.finish();
  assert.equal(store.get("old1"), 87);
  assert.deepEqual(t.nav.seen.downloads, ["new"]);
  assert.equal((await t.status()).unscored, 2);
  await t.call("POST", "/bpm/analyze", { recheck: true });
  const s = await t.finish();
  assert.deepEqual(store.entry("old1"), { bpm: 128, manual: false, confidence: 0.9 });
  assert.deepEqual(store.entry("old2"), { bpm: 174, manual: false, confidence: 0.2 }); // the drum & bass rule applies here too
  assert.deepEqual(store.entry("man"), { bpm: 90, manual: true });
  assert.deepEqual(store.entry("scored"), { bpm: 100, manual: false, confidence: 0.9 });
  assert.equal(s.rechecked, 2);
  assert.equal(s.total, 2);
  assert.deepEqual([...t.nav.seen.downloads].sort(), ["new", "old1", "old2"]); // man and scored were never fetched
  t.close();
});

test("re-check: a value that changes while the job runs still wins", async () => {
  const store = createBpmStore();
  store.set("p", 87, false);
  store.set("q", 87, false);
  const t = await boot([song("p", "slow=400 bpm=128 conf=0.9"), song("q", "slow=400 bpm=128 conf=0.9")], { bpmStore: store });
  await t.call("POST", "/bpm/analyze", { recheck: true, workers: 2 });
  await sleep(150);
  await t.call("PUT", "/bpm/p", { bpm: 66, manual: true }, USER); // corrected by hand meanwhile
  await t.call("PUT", "/bpm/q", { bpm: 99 }, USER);               // another player uploads a different detected value
  const s = await t.finish();
  assert.deepEqual(store.entry("p"), { bpm: 66, manual: true });
  assert.deepEqual(store.entry("q"), { bpm: 99, manual: false });
  assert.equal(s.rechecked, 0);
  assert.equal(s.skipped, 2);
  t.close();
});
