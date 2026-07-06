import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// BPM cache — matches the old app's app_data/bpm_cache.json: a flat
// track_id -> bpm dict, loaded once and kept in memory, persisted on every
// write. No content-hash/mtime invalidation (same as the old app) — a track
// id is assumed stable for a given file; manual corrections just overwrite
// the entry rather than triggering a re-detect.

function cachePath(): string {
  return join(app.getPath("userData"), "bpm_cache.json");
}

let cache: Record<string, number> | null = null;

async function load(): Promise<Record<string, number>> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(cachePath(), "utf-8"));
  } catch {
    cache = {};
  }
  return cache!;
}

export async function getCachedBpm(trackId: string): Promise<number | null> {
  const c = await load();
  return c[trackId] ?? null;
}

/** Whole cache, for the renderer to preload at connect time so tracklists
 *  everywhere can show a previously-detected BPM without re-triggering
 *  detection just from being scrolled into view (detection is playback-
 *  triggered only — see PlayerBar.tsx). */
export async function getAllCachedBpm(): Promise<Record<string, number>> {
  return { ...(await load()) };
}

export async function setCachedBpm(trackId: string, bpm: number): Promise<void> {
  const c = await load();
  c[trackId] = bpm;
  const path = cachePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(c), "utf-8");
}
