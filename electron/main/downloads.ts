import { app } from "electron";
import { createServer, type Server } from "node:http";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Downloads: songs, albums and playlists kept on this computer so they play without the server.
//
// The files live in <userData>/downloads with an index.json beside them (the track as the app knows it,
// so the Downloads screen works with no server at all). The audio engine only plays HTTP URLs, so a
// small server on 127.0.0.1 (a random port and a random token in the path, started when first needed)
// hands the files out with Range support; the engine plays them like any other stream.

export interface DownloadedTrack { id: string; format?: string | null; [k: string]: unknown }
// `cache`: a song that was only played (kept for the next time, removed oldest first over the limit), not downloaded on purpose.
// `at` is when it was downloaded, or for a cached song when it was last used.
interface Entry { track: DownloadedTrack; file: string; size: number; at: number; cache?: boolean }
export interface DownloadCollection {
  kind: "album" | "playlist";
  id: string;
  name: string;
  subtitle: string;
  cover_id: string | null;
  tracks: DownloadedTrack[]; // in order, so the page opens offline
}
interface Index { tracks: Record<string, Entry>; collections: DownloadCollection[]; cacheLimitMb?: number }
const DEFAULT_CACHE_MB = 1024;

const MIME: Record<string, string> = {
  mp3: "audio/mpeg", flac: "audio/flac", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac",
  ogg: "audio/ogg", opus: "audio/ogg", oga: "audio/ogg", wav: "audio/wav", wma: "audio/x-ms-wma", aiff: "audio/aiff",
};
const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/flac": "flac", "audio/x-flac": "flac", "audio/mp4": "m4a", "audio/aac": "aac",
  "audio/ogg": "ogg", "application/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav", "audio/opus": "opus",
};

let index: Index | null = null;
let server: Server | null = null;
let port = 0;
const token = randomBytes(12).toString("hex");

let queue: Array<{ track: DownloadedTrack; urlFor: () => string }> = [];
let current: string | null = null;
let working = false;
let aborting = false;

const dir = () => join(app.getPath("userData"), "downloads");
const indexPath = () => join(dir(), "index.json");

async function load(): Promise<Index> {
  if (index) return index;
  try {
    const raw = JSON.parse(await readFile(indexPath(), "utf-8")) as Partial<Index>;
    index = { tracks: raw.tracks ?? {}, collections: raw.collections ?? [], cacheLimitMb: raw.cacheLimitMb };
  } catch {
    index = { tracks: {}, collections: [] };
  }
  return index;
}

async function save(): Promise<void> {
  if (!index) return;
  await mkdir(dir(), { recursive: true });
  await writeFile(indexPath(), JSON.stringify(index), "utf-8");
}

function extOf(file: string): string {
  const i = file.lastIndexOf(".");
  return i < 0 ? "" : file.slice(i + 1).toLowerCase();
}

// ── The local server ──
function ensureServer(): Promise<void> {
  if (server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server = createServer(async (req, res) => {
      try {
        const m = /^\/dl\/([0-9a-f]+)\/(.+)$/.exec((req.url ?? "").split("?")[0]);
        if (!m || m[1] !== token) { res.statusCode = 403; res.end(); return; }
        const id = decodeURIComponent(m[2]).replace(/\.[A-Za-z0-9]+$/, "");
        const entry = (await load()).tracks[id];
        if (!entry) { res.statusCode = 404; res.end(); return; }
        const path = join(dir(), entry.file);
        const size = (await stat(path)).size;
        const type = MIME[extOf(entry.file)] ?? "application/octet-stream";
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
        if (range) {
          let start = range[1] === "" ? size - Number(range[2]) : Number(range[1]);
          let end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
          if (!(start >= 0 && start <= end && start < size)) { res.statusCode = 416; res.setHeader("Content-Range", `bytes */${size}`); res.end(); return; }
          res.writeHead(206, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}` });
          if (req.method === "HEAD") { res.end(); return; }
          createReadStream(path, { start, end }).pipe(res);
        } else {
          res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": size });
          if (req.method === "HEAD") { res.end(); return; }
          createReadStream(path).pipe(res);
        }
      } catch {
        res.statusCode = 500;
        res.end();
      }
    });
    server.once("error", (e) => { server = null; reject(e); });
    server.listen(0, "127.0.0.1", () => {
      port = (server!.address() as { port: number }).port;
      resolve();
    });
  });
}

/** An http address on this computer for a downloaded song, or null when it is not downloaded. */
export async function localUrl(id: string): Promise<string | null> {
  const entry = (await load()).tracks[id];
  if (!entry) return null;
  try { await stat(join(dir(), entry.file)); } catch { return null; }
  if (entry.cache) entry.at = Date.now(); // used: the last one to go
  await ensureServer();
  return `http://127.0.0.1:${port}/dl/${token}/${encodeURIComponent(id)}.${extOf(entry.file) || "bin"}`;
}

// ── Downloading ──
async function fetchOne(track: DownloadedTrack, url: string, cache = false): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type.includes("json") || type.startsWith("text/")) throw new Error("the server did not send audio");
  const ext = (track.format && MIME[String(track.format).toLowerCase()] ? String(track.format).toLowerCase() : "") || EXT_BY_MIME[type] || "mp3";
  const file = `${track.id.replace(/[^A-Za-z0-9_-]/g, "_")}.${ext}`;
  await mkdir(dir(), { recursive: true });
  const tmp = join(dir(), file + ".part");
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  if (aborting) { await rm(tmp, { force: true }); return; }
  await rename(tmp, join(dir(), file));
  const size = (await stat(join(dir(), file))).size;
  const data = await load();
  data.tracks[track.id] = { track, file, size, at: Date.now(), ...(cache ? { cache: true } : {}) };
  await save();
}

async function work(): Promise<void> {
  if (working) return;
  working = true;
  aborting = false;
  try {
    while (queue.length && !aborting) {
      const next = queue.shift()!;
      current = next.track.id;
      try { await fetchOne(next.track, next.urlFor()); } catch { /* left out: the next try may work */ }
      current = null;
    }
  } finally {
    working = false;
    current = null;
  }
}

/** Starts downloading songs (and remembers the album or playlist they belong to). */
export async function add(tracks: DownloadedTrack[], collection: Omit<DownloadCollection, "tracks"> | null, urlFor: (id: string) => string): Promise<void> {
  const data = await load();
  if (collection) {
    data.collections = data.collections.filter((c) => !(c.kind === collection.kind && c.id === collection.id));
    data.collections.push({ ...collection, tracks });
    await save();
  }
  for (const t of tracks) {
    const have = data.tracks[t.id];
    if (have?.cache) { // already on disk from playing it: keep it for good, no new download
      data.tracks[t.id] = { track: t, file: have.file, size: have.size, at: Date.now() };
      await save();
      continue;
    }
    if (have || queue.some((q) => q.track.id === t.id) || current === t.id) continue;
    queue.push({ track: t, urlFor: () => urlFor(t.id) });
  }
  void work();
}

async function dropTrack(id: string): Promise<void> {
  const data = await load();
  const entry = data.tracks[id];
  queue = queue.filter((q) => q.track.id !== id);
  if (!entry) return;
  delete data.tracks[id];
  await rm(join(dir(), entry.file), { force: true });
}

export async function removeTrack(id: string): Promise<void> {
  await dropTrack(id);
  await save();
}

/** Removes an album or playlist; songs that another kept one also holds stay. */
export async function removeCollection(kind: string, id: string): Promise<void> {
  const data = await load();
  const c = data.collections.find((x) => x.kind === kind && x.id === id);
  if (!c) return;
  data.collections = data.collections.filter((x) => x !== c);
  const others = new Set(data.collections.flatMap((x) => x.tracks.map((t) => t.id)));
  for (const t of c.tracks) if (!others.has(t.id)) await dropTrack(t.id);
  await save();
}

export async function removeAll(): Promise<void> {
  const data = await load();
  aborting = true;
  queue = [];
  for (const [id, e] of Object.entries(data.tracks)) if (!e.cache) await dropTrack(id);
  data.collections = [];
  await save();
}

export interface DownloadsState {
  ids: string[];
  collections: DownloadCollection[];
  bytes: number;
  pending: number;
  current: string | null;
  cacheBytes: number;
  cacheSongs: number;
  cacheLimitMb: number;
}

export async function state(): Promise<DownloadsState> {
  const data = await load();
  const all = Object.values(data.tracks);
  const entries = all.filter((e) => !e.cache);
  const cached = all.filter((e) => e.cache);
  return {
    ids: entries.map((e) => e.track.id),
    collections: data.collections,
    bytes: entries.reduce((n, e) => n + e.size, 0),
    pending: queue.length + (current ? 1 : 0),
    current,
    cacheBytes: cached.reduce((n, e) => n + e.size, 0),
    cacheSongs: cached.length,
    cacheLimitMb: data.cacheLimitMb ?? DEFAULT_CACHE_MB,
  };
}

/** The downloaded songs, oldest first. */
export async function tracks(): Promise<DownloadedTrack[]> {
  return Object.values((await load()).tracks).filter((e) => !e.cache).sort((a, b) => a.at - b.at).map((e) => e.track);
}

// ── The cache: songs that were played ──
const caching = new Set<string>();

async function evict(): Promise<void> {
  const data = await load();
  const limit = (data.cacheLimitMb ?? DEFAULT_CACHE_MB) * 1024 * 1024;
  const cached = Object.values(data.tracks).filter((e) => e.cache).sort((a, b) => a.at - b.at);
  let total = cached.reduce((n, e) => n + e.size, 0);
  for (const e of cached) {
    if (total <= limit) break;
    total -= e.size;
    await dropTrack(e.track.id);
  }
  await save();
}

/** Keeps a played song for the next time (in the background; the song itself streams as usual). */
export async function cacheSong(id: string, urlFor: () => string): Promise<void> {
  const data = await load();
  if ((data.cacheLimitMb ?? DEFAULT_CACHE_MB) <= 0) return;
  if (data.tracks[id] || caching.has(id) || current === id || queue.some((q) => q.track.id === id)) return;
  caching.add(id);
  try {
    await fetchOne({ id }, urlFor(), true);
    await evict();
  } catch { /* offline or refused: nothing to keep */ } finally {
    caching.delete(id);
  }
}

export async function setCacheLimit(mb: number): Promise<void> {
  (await load()).cacheLimitMb = Math.max(0, Math.round(mb));
  await evict();
}

export async function clearCache(): Promise<void> {
  const data = await load();
  for (const [id, e] of Object.entries(data.tracks)) if (e.cache) await dropTrack(id);
  await save();
}
