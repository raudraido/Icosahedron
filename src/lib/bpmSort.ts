// Sorting songs by BPM. The BPM the app shows is the detected one (the HUB's shared BPM store, loaded into the
// store's bpmCache), but Navidrome sorts by the file's own BPM tag, which most files do not have. The Tracks tab
// therefore sorts by BPM itself, from the detected values: songs without a BPM come last in either direction.
import type { Track } from "./api";

type Dir = "asc" | "desc";

/** Ids of the songs that have a BPM, ordered by it (ties by id, so the order is stable between pages). */
export function idsByBpm(cache: Record<string, number>, dir: Dir): string[] {
  const sign = dir === "asc" ? 1 : -1;
  return Object.keys(cache)
    .filter((id) => cache[id] > 0)
    .sort((a, b) => sign * (cache[a] - cache[b]) || (a < b ? -1 : a > b ? 1 : 0));
}

/** The tracks ordered by detected BPM (the tag as a fallback); those without any BPM stay at the end, in their order. */
export function sortTracksByBpm(tracks: Track[], dir: Dir, cache: Record<string, number>): Track[] {
  const sign = dir === "asc" ? 1 : -1;
  const bpmOf = (t: Track) => cache[t.id] ?? t.bpm ?? 0;
  const known = tracks.filter((t) => bpmOf(t) > 0);
  const unknown = tracks.filter((t) => !(bpmOf(t) > 0));
  known.sort((a, b) => sign * (bpmOf(a) - bpmOf(b)));
  return [...known, ...unknown];
}

/** `tracks` in the order of `ids` (ids that were not found are skipped). */
export function orderLike(tracks: Track[], ids: readonly string[]): Track[] {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is Track => !!t);
}

export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
