import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync, createWriteStream } from "node:fs";
import { setPriority, tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolveDnbBpm } from "./bpm-octave.mjs";
import { skipReason, skipGenresFromEnv } from "./bpm-prefilter.mjs";

// Library-wide BPM analysis, run by an administrator from Settings -> Sync Server.
//
// What it does, per song: fetch the original file from Navidrome (Subsonic `download`) into a temporary
// file, run the analyser program (native/bpm-cli: the same QM-DSP detection the desktop app uses) on it,
// delete the file, correct drum & bass tempo from the song's genre, store the result as a detected value.
//
// Guarantees (tests: test/bpm-analyzer.test.mjs):
//  - a song that already has a BPM, manual or detected, is never fetched and never analysed;
//  - the store is asked again right before writing, and the value is written only if the song still has
//    none (setIfAbsent), so a value another player uploads while the job runs is never replaced;
//  - songs that failed are remembered (bpm-failed.json) and are not tried again unless the administrator
//    asks (retryFailed);
//  - the credentials of a job live in memory for the job only; nothing is written to disk or logged.

const API_VERSION = "1.16.1";
const PAGE = 500;
const MAX_WORKERS = 8;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const ANALYSE_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_FILE_BYTES = 2 * 1024 ** 3;
const MAX_CONSECUTIVE_TRANSIENT = 25; // Navidrome gone: stop instead of walking through the whole library

/** A persisted list of songs with a reason: the failed songs (bpm-failed.json) and the skipped ones (bpm-skipped.json). */
export function createFailedStore(dir, name = "bpm-failed.json") {
  let map = {};
  let timer;
  const file = dir ? join(dir, name) : null;
  if (file) {
    mkdirSync(dir, { recursive: true });
    try { map = JSON.parse(readFileSync(file, "utf8")); } catch { /* first run */ }
  }
  const flush = () => {
    clearTimeout(timer);
    if (!file) return;
    writeFileSync(file + ".tmp", JSON.stringify(map));
    renameSync(file + ".tmp", file);
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(flush, 500); timer.unref?.(); }; // thousands of songs may be added in a row
  return {
    has: (id) => map[id] !== undefined,
    size: () => Object.keys(map).length,
    list: () => Object.entries(map).map(([id, v]) => ({ id, ...v })),
    add(id, entry) { map[id] = entry; later(); },
    remove(id) { if (map[id] !== undefined) { delete map[id]; later(); } },
    clear() { map = {}; flush(); },
    flush,
  };
}

class Transient extends Error {}   // not the song's fault (network, Navidrome busy): not remembered
class Stopped extends Error {}

/**
 * @param {object} o
 * @param {string} o.navidromeUrl
 * @param {{has:Function,size:Function,setIfAbsent:Function}} o.bpmStore
 * @param {string} [o.cli]        the analyser program (BPM_CLI), default `icosahedron-bpm` on the PATH
 * @param {string} [o.dir]        where the failed list is kept (DATA_DIR)
 * @param {string} [o.tmpRoot]    where songs are fetched to, deleted right after
 * @param {number} [o.niceness]   priority of the analyser program (higher is nicer), default 10
 */
export function createBpmAnalyzer({ navidromeUrl, bpmStore, cli = process.env.BPM_CLI || "icosahedron-bpm", dir, tmpRoot = tmpdir(), niceness = 10, fetchImpl = fetch, failed = createFailedStore(dir), skipped = createFailedStore(dir, "bpm-skipped.json"), skipGenres = skipGenresFromEnv() }) {
  let job = null; // the running job, or the last one (kept for its numbers)
  let libraryTotal = null;
  let scanCache = { at: 0, count: null };

  /** How a call to Navidrome is authenticated: the trusted header (secure sign-in) or the admin's own token. */
  function authFor(cred) {
    if (cred.remoteUser) return { headers: { "Remote-User": cred.u }, params: { u: cred.u } };
    return { headers: {}, params: { u: cred.u, t: cred.t, s: cred.s } };
  }
  function subsonicUrl(auth, method, extra = {}) {
    const q = new URLSearchParams({ v: API_VERSION, c: "IcosahedronHub", f: "json", ...auth.params, ...extra });
    return `${navidromeUrl}/rest/${method}?${q}`;
  }
  async function subsonicJson(auth, method, extra, signal) {
    let res;
    try {
      res = await fetchImpl(subsonicUrl(auth, method, extra), { headers: auth.headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    } catch (e) { if (signal?.aborted) throw new Stopped(); throw new Transient(`Navidrome not reachable (${e.message})`); }
    if (!res.ok) throw new Transient(`Navidrome answered ${res.status}`);
    const body = (await res.json().catch(() => null))?.["subsonic-response"];
    if (body?.status !== "ok") throw new Transient(`Navidrome refused: ${body?.error?.message ?? "no answer"}`);
    return body;
  }

  const genreOf = (s) => (Array.isArray(s.genres) && s.genres.length ? s.genres.map((g) => g.name).join(" • ") : s.genre) ?? "";
  const toSong = (s) => ({ id: String(s.id), genre: genreOf(s), suffix: /^[a-z0-9]{1,5}$/i.test(s.suffix ?? "") ? s.suffix.toLowerCase() : "bin", size: Number(s.size) || 0, duration: Number(s.duration) || 0 });

  /** Every song of the library: search3 with an empty query lists all of them, page by page. */
  async function* listSongs(auth, signal) {
    let offset = 0, any = false;
    for (;;) {
      const b = await subsonicJson(auth, "search3", { query: "", artistCount: 0, albumCount: 0, songCount: PAGE, songOffset: offset }, signal);
      const songs = b.searchResult3?.song ?? [];
      if (songs.length) any = true;
      for (const s of songs) yield toSong(s);
      if (songs.length < PAGE) break;
      offset += PAGE;
    }
    if (any) return;
    // A Navidrome that answers an empty search with nothing: walk albums instead (slower, but complete).
    for (let off = 0; ; off += PAGE) {
      const b = await subsonicJson(auth, "getAlbumList2", { type: "alphabeticalByName", size: PAGE, offset: off }, signal);
      const albums = b.albumList2?.album ?? [];
      for (const a of albums) {
        const d = await subsonicJson(auth, "getAlbum", { id: a.id }, signal);
        for (const s of d.album?.song ?? []) yield toSong(s);
      }
      if (albums.length < PAGE) break;
    }
  }

  async function scanCount(auth) {
    if (Date.now() - scanCache.at < 60_000) return scanCache.count;
    let count = null;
    try { count = Number((await subsonicJson(auth, "getScanStatus", {})).scanStatus?.count) || null; } catch { /* unknown */ }
    scanCache = { at: Date.now(), count };
    return count;
  }

  async function fetchSong(auth, song, file, signal) {
    let res;
    try {
      res = await fetchImpl(subsonicUrl(auth, "download", { id: song.id }), { headers: auth.headers, signal: AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]) });
    } catch (e) { if (signal.aborted) throw new Stopped(); throw new Transient(`download failed (${e.message})`); }
    if (res.status === 404 || res.status === 410) throw new Error("the file is missing on the server");
    if (!res.ok) throw new Transient(`download answered ${res.status}`);
    if ((res.headers.get("content-type") ?? "").includes("json")) { // Subsonic reports errors as 200 + JSON
      const b = (await res.json().catch(() => null))?.["subsonic-response"];
      if (b?.error?.code === 70) throw new Error("the song is gone from the library");
      throw new Transient(`Navidrome refused the download: ${b?.error?.message ?? "unknown"}`);
    }
    if (Number(res.headers.get("content-length")) > MAX_FILE_BYTES) throw new Error("the file is too large");
    try { await pipeline(Readable.fromWeb(res.body), createWriteStream(file)); }
    catch (e) { if (signal.aborted) throw new Stopped(); throw new Transient(`download failed (${e.message})`); }
  }

  /** Runs the analyser on a file: the BPM, or an Error with the reason (the program's own message). */
  function runCli(file, signal) {
    return new Promise((resolve, reject) => {
      let out = "", done = false;
      const child = spawn(cli, [file], { stdio: ["ignore", "pipe", "ignore"] });
      const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener("abort", onAbort); fn(v); };
      const onAbort = () => { child.kill("SIGKILL"); finish(reject, new Stopped()); };
      const timer = setTimeout(() => { child.kill("SIGKILL"); finish(reject, new Error("analysis took too long")); }, ANALYSE_TIMEOUT_MS);
      signal.addEventListener("abort", onAbort, { once: true });
      if (child.pid) try { setPriority(child.pid, niceness); } catch { /* not allowed or gone: runs at normal priority */ }
      child.stdout.on("data", (c) => { if (out.length < 4096) out += c; });
      child.on("error", (e) => finish(reject, e.code === "ENOENT" ? new Transient("the analyser program is missing") : new Transient(`cannot start the analyser (${e.code})`)));
      child.on("close", (code) => {
        let j = null; try { j = JSON.parse(out.trim().split("\n").pop() ?? ""); } catch { /* not JSON */ }
        if (code === 0 && typeof j?.bpm === "number") return finish(resolve, { bpm: j.bpm, confidence: typeof j.confidence === "number" ? j.confidence : undefined, duration: typeof j.duration_secs === "number" ? j.duration_secs : undefined });
        finish(reject, new Error(typeof j?.error === "string" ? j.error : `the analyser failed (exit ${code})`));
      });
    });
  }

  async function processSong(auth, song, j) {
    // 1st check: right before any work. A song with a value costs nothing and is never fetched. The only
    // songs that have a value and are still worked on are the re-check ones, and only while the value is
    // still the detected, confidence-less one that was queued.
    if (song.recheck) {
      const cur = bpmStore.entry(song.id);
      if (!cur || cur.manual || cur.confidence !== undefined || cur.bpm !== song.expect) { j.skipped++; return; }
    } else if (bpmStore.has(song.id)) { j.skipped++; return; }
    const file = join(j.tmp, `${j.nextFile++}.${song.suffix}`);
    try {
      await fetchSong(auth, song, file, j.abort.signal);
      const r = await runCli(file, j.abort.signal);
      const bpm = resolveDnbBpm(r.bpm, song.genre);
      // 2nd check: the value is written only if the song still has none (the store checks and writes in one
      // step); a re-check song only if its value is still the one that was queued.
      const written = song.recheck ? bpmStore.replaceUnscored(song.id, song.expect, bpm, r.confidence) : bpmStore.setIfAbsent(song.id, bpm, r.confidence);
      if (written) { j.analysed++; if (song.recheck) j.rechecked++; }
      else if (bpmStore.has(song.id)) j.skipped++; // somebody else's value appeared meanwhile: theirs stays
      else throw new Error(`the result ${bpm} is outside the usual range`);
      j.transientRun = 0;
      failed.remove(song.id);
      skipped.remove(song.id);
    } catch (e) {
      if (e instanceof Stopped) throw e;
      if (e instanceof Transient) {
        j.errors++; j.lastError = e.message;
        if (++j.transientRun >= MAX_CONSECUTIVE_TRANSIENT) { j.lastError = `Stopped: ${e.message}`; j.abort.abort(); }
        return;
      }
      j.transientRun = 0;
      j.failed++;
      failed.add(song.id, { reason: String(e.message ?? e).slice(0, 200), at: Date.now(), genre: song.genre || undefined });
    } finally {
      try { rmSync(file, { force: true }); } catch { /* temp dir is removed at the end anyway */ }
    }
  }

  async function run(j, auth, { retryFailed, recheck, includeSkipped }) {
    try {
      const todo = [];
      let seen = 0;
      if (retryFailed) failed.clear();
      for await (const s of listSongs(auth, j.abort.signal)) {
        seen++;
        const have = bpmStore.entry(s.id);
        if (have) { // a value exists: never measured again, except a detected value without confidence when the administrator asked for a re-check
          if (recheck && !have.manual && have.confidence === undefined && !failed.has(s.id)) todo.push({ ...s, recheck: true, expect: have.bpm });
          continue;
        }
        if (failed.has(s.id)) continue;
        if (!includeSkipped) {
          if (skipped.has(s.id)) continue;
          const reason = skipReason(s, skipGenres); // before any download
          if (reason) { skipped.add(s.id, { reason, at: Date.now(), genre: s.genre || undefined }); j.prefiltered++; continue; }
        }
        todo.push(s);
      }
      libraryTotal = seen;
      j.total = todo.length;
      j.phase = "analysing";
      let next = 0;
      const worker = async () => {
        while (!j.abort.signal.aborted && next < todo.length) await processSong(auth, todo[next++], j);
      };
      await Promise.all(Array.from({ length: j.workers }, () => worker().catch((e) => { if (!(e instanceof Stopped)) throw e; })));
    } catch (e) {
      if (!(e instanceof Stopped)) j.lastError = e.message ?? String(e);
    } finally {
      try { rmSync(j.tmp, { recursive: true, force: true }); } catch { /* ignore */ }
      failed.flush(); skipped.flush();
      j.state = "idle"; j.phase = null; j.finishedAt = Date.now();
      j.auth = null; // the credentials go with the job
    }
  }

  return {
    /** @returns {Promise<{ok:true}|{ok:false,code:string}>} */
    async start({ cred, workers = 4, retryFailed = false, recheck = false, includeSkipped = false }) {
      if (job && job.state !== "idle") return { ok: false, code: "already_running" };
      const w = Math.max(1, Math.min(MAX_WORKERS, Math.floor(Number(workers)) || 4));
      mkdirSync(tmpRoot, { recursive: true });
      const probe = await new Promise((r) => { const c = spawn(cli, [], { stdio: "ignore" }); c.on("error", (e) => r(e.code)); c.on("close", () => r(null)); });
      if (probe === "ENOENT") return { ok: false, code: "analyser_missing" };
      const auth = authFor(cred);
      job = { state: "running", phase: "listing", workers: w, total: 0, analysed: 0, failed: 0, skipped: 0, prefiltered: 0, rechecked: 0, recheck, includeSkipped, errors: 0, transientRun: 0, nextFile: 0, startedAt: Date.now(), finishedAt: null, lastError: null, abort: new AbortController(), tmp: mkdtempSync(join(tmpRoot, "bpm-")), auth };
      const j = job;
      void run(j, auth, { retryFailed, recheck, includeSkipped });
      return { ok: true };
    },
    stop() {
      if (!job || job.state !== "running") return false;
      job.state = "stopping";
      job.abort.abort();
      return true;
    },
    async status(cred) {
      const j = job;
      const done = j ? j.analysed + j.failed + j.skipped : 0;
      const remaining = j && j.state !== "idle" ? Math.max(0, j.total - done) : 0;
      const elapsed = j ? ((j.finishedAt ?? Date.now()) - j.startedAt) / 1000 : 0;
      const worked = j ? j.analysed + j.failed : 0;
      const eta = j && j.state === "running" && j.phase === "analysing" && worked >= 5 && elapsed > 0 ? Math.round((remaining / (worked / elapsed))) : null;
      let total = libraryTotal;
      if (total === null && cred) total = await scanCount(authFor(cred));
      return {
        state: j?.state ?? "idle",
        phase: j?.phase ?? null,
        analysed: j?.analysed ?? 0,
        failed: j?.failed ?? 0,
        skipped: j?.skipped ?? 0,
        errors: j?.errors ?? 0,
        total: j?.total ?? 0,
        remaining,
        etaSeconds: eta,
        startedAt: j?.startedAt ?? null,
        finishedAt: j?.finishedAt ?? null,
        workers: j?.workers ?? 0,
        lastError: j?.lastError ?? null,
        prefiltered: j?.prefiltered ?? 0,
        rechecked: j?.rechecked ?? 0,
        withBpm: bpmStore.size(),
        ...(({ withConfidence, unscored, unreliable }) => ({ withConfidence, unscored, unreliable }))(bpmStore.stats()),
        minConfidence: bpmStore.minConfidence,
        skippedTotal: skipped.size(),
        libraryTotal: total,
        failedTotal: failed.size(),
      };
    },
    failed: () => failed.list(),
    skipped: () => skipped.list(),
    /**
     * For an administrator to review: counts, a histogram of the confidence (10 bins, 0-0.1 ... 0.9-1) and the
     * `limit` detected songs with the lowest confidence, with title, artist and genre when Navidrome answers.
     */
    async report(cred, limit = 50) {
      const n = Math.max(1, Math.min(500, Math.floor(Number(limit)) || 50));
      const st = bpmStore.stats();
      const entries = bpmStore.entries();
      const histogram = Array(10).fill(0);
      const scored = [];
      for (const [id, e] of entries) {
        if (e.manual || typeof e.confidence !== "number") continue;
        histogram[Math.min(9, Math.floor(e.confidence * 10))]++;
        scored.push({ id, bpm: e.bpm, confidence: e.confidence });
      }
      scored.sort((a, b) => a.confidence - b.confidence);
      const lowest = scored.slice(0, n);
      if (cred) {
        const auth = authFor(cred);
        let next = 0;
        const worker = async () => {
          while (next < lowest.length) {
            const row = lowest[next++];
            try {
              const s = (await subsonicJson(auth, "getSong", { id: row.id })).song;
              if (s) Object.assign(row, { title: s.title, artist: s.artist, album: s.album, genre: s.genre, duration: s.duration });
            } catch { /* the song may be gone, or Navidrome busy: the row keeps its id */ }
          }
        };
        await Promise.all(Array.from({ length: 6 }, worker));
      }
      return {
        counts: { stored: st.total, manual: st.manual, withConfidence: st.withConfidence, withoutConfidence: st.unscored, skipped: skipped.size(), failed: failed.size(), belowThreshold: st.unreliable },
        minConfidence: bpmStore.minConfidence,
        histogram,
        lowest,
      };
    },
  };
}
