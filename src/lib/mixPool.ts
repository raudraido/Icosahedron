// Loads the Mix Builder's candidate pool: up to POOL_CAP songs drawn on the server (random, with the genre
// and years filters), plus the songs of the seed artists and the songs that sound like them. The client
// then scores and samples them (mixBuilder.ts). Works the same in the desktop app and in the browser:
// everything goes through `api`.

import { api, type Track } from "./api";
import {
  artistSeeds, bpmActive, genreSeeds, idsInBpmRange, isLeftOut, joinBpm, normalizeBpmRange, passes, POOL_CAP, shuffle,
  type MixSettings, type PoolItem,
} from "./mixBuilder";

export interface PoolResult {
  items: PoolItem[];
  /** True when the server had more than the pool holds (the count then reads "3,000+"). */
  capped: boolean;
}

const BATCH = 500; // the most a Subsonic server answers per getRandomSongs call

type Stale = () => boolean;

/** Merges songs into the pool by id; a song that is explained by a seed (by/like) keeps that explanation. */
function addAll(map: Map<string, PoolItem>, tracks: Track[], tag?: { by?: string; like?: string }) {
  for (const t of tracks) {
    const old = map.get(t.id);
    if (!old) map.set(t.id, { track: t, ...tag });
    else if (tag && !old.by && (tag.by || !old.like)) map.set(t.id, { ...old, ...tag });
  }
}

/** Random songs, every one with the same chance: calls the server in parallel batches of 500 and drops the
 *  repeats, topping up while short (a small library simply gives what it has). */
export async function randomSongs(
  target: number, opts: { genre?: string; fromYear?: number; toYear?: number } | undefined, stale: Stale,
): Promise<Track[]> {
  const got = new Map<string, Track>();
  let dry = 0;
  for (let round = 0; round < 5 && got.size < target && dry < 2 && !stale(); round++) {
    const missing = target - got.size;
    // Repeats are expected (the same song can come up in two batches), so ask for a little more.
    const calls = Math.max(1, Math.ceil((missing * (round ? 1.3 : 1.1)) / BATCH));
    const batches = await Promise.all(Array.from({ length: calls }, () => api.getRandomSongs(BATCH, opts).catch(() => [] as Track[])));
    const before = got.size;
    for (const b of batches) for (const t of b) if (!got.has(t.id)) got.set(t.id, t);
    dry = got.size - before < Math.max(5, missing * 0.03) ? dry + 1 : 0;
  }
  return [...got.values()].slice(0, target);
}

/** The artist id for a seed that was typed by name only. */
async function artistId(name: string, id?: string): Promise<string | null> {
  if (id) return id;
  const r = await api.search(name, 1, 0, 0).catch(() => null);
  return r?.artists[0]?.id ?? null;
}

/** Songs per `id` list request (about 2.5 KB of query string) and how many run at once. */
export const BPM_ID_BATCH = 100;
const BPM_PARALLEL = 6;
/** The most ids looked at per search: 6,000 = 60 requests. A range with more songs than that is sampled at random. */
export const BPM_MAX_EXAMINED = 6000;

/**
 * The songs of a BPM range. The random draws of the other pools cannot be narrowed by BPM, so a narrow range
 * would leave a handful of songs; instead the BPM map says which ids are in the range, and exactly those songs
 * are loaded (Navidrome's `id` filter, in batches), then cut down by the other filters (years, genres, left out).
 * The ids are shuffled first, so a range with more songs than the budget gives a random sample of it.
 */
export async function songsInBpmRange(
  s: MixSettings, map: Record<string, number>, stale: Stale, want = POOL_CAP,
): Promise<Track[]> {
  const range = normalizeBpmRange(s.bpm);
  if (!range) return [];
  const ids = shuffle(idsInBpmRange(map, range)).slice(0, BPM_MAX_EXAMINED);
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += BPM_ID_BATCH) batches.push(ids.slice(i, i + BPM_ID_BATCH));
  const out: Track[] = [];
  for (let i = 0; i < batches.length && out.length < want && !stale(); i += BPM_PARALLEL) {
    const got = await Promise.all(
      batches.slice(i, i + BPM_PARALLEL).map((b) => api.getTracksNativePage("title", "ASC", 0, b.length, undefined, { ids: b }).then((r) => r.tracks).catch(() => [] as Track[])),
    );
    for (const tracks of got) {
      // Join first: the filter reads the BPM, and Navidrome's own copy of it is usually empty.
      for (const it of joinBpm(tracks.map((track) => ({ track })), map)) if (passes(it.track, s)) out.push(it.track);
    }
  }
  return out.slice(0, want);
}

/** `bpmMap`: id -> BPM of the whole library. With a narrow BPM range the background songs come from it. */
export async function loadPool(s: MixSettings, stale: Stale, bpmMap?: Record<string, number>): Promise<PoolResult> {
  const map = new Map<string, PoolItem>();

  // "Play random": the whole library, every song the same chance, no filters and no taste.
  if (s.pure) {
    // Left-out songs are dropped after the draw, so draw a little more to still end with `size`.
    const drawn = await randomSongs(Math.ceil(s.size * 1.15) + 20, undefined, stale);
    addAll(map, drawn.filter((t) => !isLeftOut(t, s)).slice(0, s.size));
    return { items: [...map.values()], capped: false };
  }

  const artists = artistSeeds(s).slice(0, 6);
  const genres = genreSeeds(s);
  const years = s.years ? { fromYear: s.years[0], toYear: s.years[1] } : {};

  const tasks: Promise<void>[] = [];

  // The seed artists: their own songs, their best known songs, and what sounds like them.
  for (const a of artists) {
    tasks.push((async () => {
      const id = await artistId(a.value, a.id);
      const [own, top, similar] = await Promise.all([
        id ? api.getTracksNativePage("title", "ASC", 0, 200, undefined, { artistIds: [id] }).then((r) => r.tracks).catch(() => [] as Track[]) : [],
        api.getTopSongs(a.value, 20).catch(() => [] as Track[]),
        id ? api.getSimilarSongs(id, 60).catch(() => [] as Track[]) : [],
      ]);
      const ownName = (t: Track) => t.artist.toLowerCase() === a.value.toLowerCase();
      addAll(map, own, { by: a.value });
      addAll(map, top.filter(ownName), { by: a.value });
      addAll(map, top.filter((t) => !ownName(t)), { like: a.value });
      addAll(map, similar, { like: a.value });
    })());
  }

  // The background: songs from the whole library (or the chosen genres) inside the years range, so the
  // mix can be filled and a dial change has something to work on. Favourites come from the starred list.
  if (s.favOnly) {
    tasks.push(api.getStarred().then((r) => addAll(map, r.tracks)).catch(() => {}));
  } else if (bpmActive(s) && bpmMap) {
    tasks.push(songsInBpmRange(s, bpmMap, stale, artists.length ? 1000 : POOL_CAP).then((t) => addAll(map, t)));
  } else {
    const target = artists.length ? 1000 : POOL_CAP;
    if (genres.length) {
      const each = Math.max(BATCH, Math.ceil(target / genres.length));
      for (const g of genres) tasks.push(randomSongs(each, { genre: g.value, ...years }, stale).then((t) => addAll(map, t)));
    } else {
      tasks.push(randomSongs(target, years, stale).then((t) => addAll(map, t)));
    }
  }
  await Promise.all(tasks);

  const all = [...map.values()];
  // Seed songs first, so the cap never throws away what the user asked for.
  all.sort((a, b) => Number(!!b.by) - Number(!!a.by) || Number(!!b.like) - Number(!!a.like));
  return { items: all.slice(0, POOL_CAP), capped: all.length >= POOL_CAP };
}
