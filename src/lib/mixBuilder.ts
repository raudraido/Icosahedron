// The Mix Builder's logic, with no React and no network so it can be tested on its own
// (src/lib/mixBuilder.test.ts): seeds, the dials, scoring candidates, picking the mix, its name.
// The screen (src/screens/MixBuilder.tsx) and the pool loader (src/lib/mixPool.ts) only call into this.
//
// Principle: say what you want, work on a ready proposal, keep or swap what you like.

import type { Track } from "./api";

// ── Sizes and limits ─────────────────────────────────────────────────────────────────────────────────
export const SIZES = [20, 30, 50, 100, 250, 500, 1000] as const;
export const DEFAULT_SIZE = 30;
/** The list shows this many rows; a bigger mix is picked in full but only its start is drawn. */
export const MAX_VISIBLE_ROWS = 30;
/** Candidates kept per search (the server draws them, the client scores and samples). */
export const POOL_CAP = 3000;
export const YEAR_MIN = 1950;

/** The nearest allowed size (a saved or typed value that is not a chip falls back to the closest chip). */
export function snapSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SIZE;
  let best: number = SIZES[0];
  for (const s of SIZES) if (Math.abs(s - n) < Math.abs(best - n)) best = s;
  return best;
}

/** Rows hidden below the visible list, for the "... and N more" line. */
export function hiddenCount(total: number, visible = MAX_VISIBLE_ROWS): number {
  return Math.max(0, total - visible);
}

// ── BPM (not in version 1) ───────────────────────────────────────────────────────────────────────────
/** Share of the library that has a BPM (0..1). Version 1 knows nothing about it and says 0.
 *  The server-side BPM analysis will fill this in (from the sync server's BPM store); once it is high enough
 *  (BPM_MIN_COVERAGE) the screen shows the BPM dial and Flow (a BPM curve for the mix), plugged in where
 *  MixBuilder.tsx marks "BPM EXTENSION POINT". Until then the UI says nothing about BPM. */
export function bpmCoverage(): number {
  return 0;
}
export const BPM_MIN_COVERAGE = 0.6;

// ── Seeds ────────────────────────────────────────────────────────────────────────────────────────────
// A seed is what the user starts with. A song becomes its artist; a genre is also a filter (the mix stays
// in that genre); a decade sets the years range.
export type MixSeed =
  | { kind: "artist"; value: string; id?: string }
  | { kind: "genre"; value: string }
  | { kind: "decade"; value: string; from: number; to: number };

/** "90s", "1990s", "'90s", "90's", "00s", "2010s" -> a decade. Anything else -> null. */
export function parseDecade(text: string): { from: number; to: number; label: string } | null {
  const m = text.trim().toLowerCase().replace(/[’'`]/g, "").match(/^(\d{2}|\d{4})s$/);
  if (!m) return null;
  let year: number;
  if (m[1].length === 4) year = Number(m[1]);
  else { const n = Number(m[1]); year = n < 30 ? 2000 + n : 1900 + n; }
  if (year % 10 !== 0 || year < 1900 || year > 2090) return null;
  return { from: year, to: year + 9, label: `${year}s` };
}

export interface SeedSuggestion {
  seed: MixSeed;
  /** What the row says in front of the name: "artist", "genre", "decade", "song". */
  label: string;
  /** The text shown (a song shows "title · artist"). */
  text: string;
}

/** Suggestions for what was typed, the parts that need no server: a decade and the library's genres.
 *  The caller adds artists and songs from a search. */
export function localSuggestions(query: string, genres: { name: string }[], limit = 3): SeedSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: SeedSuggestion[] = [];
  const dec = parseDecade(q);
  if (dec) out.push({ seed: { kind: "decade", value: dec.label, from: dec.from, to: dec.to }, label: "decade", text: dec.label });
  for (const g of genres) {
    if (out.length >= limit + (dec ? 1 : 0)) break;
    if (g.name.toLowerCase().includes(q)) out.push({ seed: { kind: "genre", value: g.name }, label: "genre", text: g.name });
  }
  return out;
}

// ── Settings: everything the dials and seeds say ─────────────────────────────────────────────────────
export interface MixSettings {
  seeds: MixSeed[];
  /** Years range from the dial; null = the whole library. */
  years: [number, number] | null;
  favOnly: boolean;
  unplayedOnly: boolean;
  /** 0 = songs I play, 100 = songs I have not. */
  discover: number;
  size: number;
  /** "Play random": every song the same chance, taste plays no part. */
  pure: boolean;
  /** A label for the way it started ("lucky", "Because I played X"), used for the name. */
  title?: string;
}

export function defaultSettings(): MixSettings {
  return { seeds: [], years: null, favOnly: false, unplayedOnly: false, discover: 40, size: DEFAULT_SIZE, pure: false };
}

/** True once the user has asked for anything (a quick start, a seed or a dial). Until then the screen waits. */
export function isStarted(s: MixSettings): boolean {
  return s.pure || s.seeds.length > 0 || s.years !== null || s.favOnly || s.unplayedOnly || s.title !== undefined;
}

export function sameSeed(a: MixSeed, b: MixSeed): boolean {
  return a.kind === b.kind && a.value.toLowerCase() === b.value.toLowerCase();
}

export function addSeed(s: MixSettings, seed: MixSeed): MixSettings {
  if (s.seeds.some((x) => sameSeed(x, seed))) return s;
  let years = s.years;
  if (seed.kind === "decade") {
    // Decades widen each other (90s + 00s = 1990-2009); the dial shows the result.
    years = s.years && s.seeds.some((x) => x.kind === "decade") ? [Math.min(s.years[0], seed.from), Math.max(s.years[1], seed.to)] : [seed.from, seed.to];
  }
  return { ...s, seeds: [...s.seeds, seed], years, pure: false };
}

export function removeSeed(s: MixSettings, index: number): MixSettings {
  const gone = s.seeds[index];
  if (!gone) return s;
  const seeds = s.seeds.filter((_, i) => i !== index);
  let years = s.years;
  if (gone.kind === "decade") {
    const left = seeds.filter((x): x is Extract<MixSeed, { kind: "decade" }> => x.kind === "decade");
    years = left.length ? [Math.min(...left.map((d) => d.from)), Math.max(...left.map((d) => d.to))] : null;
  }
  return { ...s, seeds, years };
}

/** Moving the years dial by hand: the decade chips no longer describe it, so they go. */
export function setYears(s: MixSettings, years: [number, number] | null): MixSettings {
  return { ...s, years, seeds: s.seeds.filter((x) => x.kind !== "decade") };
}

export function toggleGenre(s: MixSettings, name: string): MixSettings {
  const i = s.seeds.findIndex((x) => x.kind === "genre" && x.value.toLowerCase() === name.toLowerCase());
  return i >= 0 ? removeSeed(s, i) : addSeed(s, { kind: "genre", value: name });
}

export const artistSeeds = (s: MixSettings) => s.seeds.filter((x): x is Extract<MixSeed, { kind: "artist" }> => x.kind === "artist");
export const genreSeeds = (s: MixSettings) => s.seeds.filter((x): x is Extract<MixSeed, { kind: "genre" }> => x.kind === "genre");

/** The part of the settings that decides what to FETCH. The dials that only re-weigh (familiar/new, size)
 *  are not in it, so moving them does not call the server. */
export function poolKey(s: MixSettings, genreFilter = true): string {
  return JSON.stringify([
    s.pure, s.pure ? s.size : 0,
    s.seeds.map((x) => [x.kind, x.value.toLowerCase(), x.kind === "artist" ? x.id ?? "" : ""]),
    s.years, s.favOnly, genreFilter,
  ]);
}

// ── Candidates ───────────────────────────────────────────────────────────────────────────────────────
/** A song in the pool, with how it got there. */
export interface PoolItem {
  track: Track;
  /** Seed artist whose own song this is. */
  by?: string;
  /** Seed artist this song sounds like (similar-songs lists). */
  like?: string;
}

export interface MixItem {
  track: Track;
  /** The reason line's first part ("like X"), if a seed explains the song. */
  why: string[];
  locked: boolean;
}

/** Does the song fit the filters (years, genre seeds, favourites, not played yet)? */
export function passes(t: Track, s: MixSettings): boolean {
  if (s.pure) return true;
  if (s.years) {
    if (t.year === null || t.year === undefined || t.year < s.years[0] || t.year > s.years[1]) return false;
  }
  const genres = genreSeeds(s);
  if (genres.length) {
    const g = (t.genre ?? "").toLowerCase();
    // Navidrome joins several genres into one string ("Techno; House"): any of them may match.
    if (!genres.some((x) => g.split(/[;/,]/).some((part) => part.trim() === x.value.toLowerCase()) || g === x.value.toLowerCase())) return false;
  }
  if (s.favOnly && !t.starred) return false;
  if (s.unplayedOnly && t.play_count > 0) return false;
  return true;
}

export type Rand = () => number;

export function mulberry32(seed: number): Rand {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rand: Rand = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** How well a candidate fits: seed hits, a little chance, favourites, and the familiar/new dial. */
export function scoreItem(item: PoolItem, s: MixSettings, rand: Rand = Math.random): { score: number; why: string[] } {
  const t = item.track;
  if (s.pure) return { score: rand(), why: [] };
  const why: string[] = [];
  let score = 0;
  if (item.by) { score += 3; why.push(`by ${item.by}`); }
  else if (item.like) { score += 1.5; why.push(`like ${item.like}`); }
  if (genreSeeds(s).length) score += 2; // it passed the genre filter
  const fam = (100 - s.discover) / 100;
  const pop = Math.min(t.play_count, 80) / 80; // 0..1, how much it was played
  score += rand() * 1.4 + (t.starred ? 0.5 : 0) + fam * pop * 1.3 - (1 - fam) * pop * 1.3 + (s.discover > 60 && t.play_count === 0 ? 0.9 : 0);
  return { score, why };
}

/** No artist more than this many times (a short mix wants variety; a long one has room). */
export function artistCap(size: number): number {
  return size <= 60 ? 2 : Math.ceil(size / 25);
}

/**
 * Picks `size` songs: the kept (locked) ones stay, the rest are the best scoring that pass the filters,
 * at most `artistCap` per artist (relaxed if the pool is too small to fill the mix), then shuffled among
 * themselves so the order is not simply by score. Returns the picked list and how many songs matched.
 */
export function buildMix(
  pool: PoolItem[], s: MixSettings, locked: MixItem[] = [], rand: Rand = Math.random,
): { mix: MixItem[]; matches: number } {
  const used = new Set(locked.map((m) => m.track.id));
  const seen = new Set<string>();
  const scored: { item: PoolItem; score: number; why: string[] }[] = [];
  for (const item of pool) {
    if (seen.has(item.track.id)) continue;
    seen.add(item.track.id);
    if (!passes(item.track, s)) continue;
    if (used.has(item.track.id)) continue;
    const sc = scoreItem(item, s, rand);
    scored.push({ item, score: sc.score, why: sc.why });
  }
  const matches = scored.length + locked.length;
  scored.sort((a, b) => b.score - a.score);

  const want = Math.max(0, s.size - locked.length);
  const cap = artistCap(s.size);
  const perArtist = new Map<string, number>();
  const bump = (name: string) => perArtist.set(name, (perArtist.get(name) ?? 0) + 1);
  locked.forEach((m) => bump(m.track.artist));
  const picked: typeof scored = [];
  const left: typeof scored = [];
  for (const c of scored) {
    if (!s.pure && (perArtist.get(c.item.track.artist) ?? 0) >= cap) { left.push(c); continue; }
    if (picked.length >= want) { left.push(c); continue; }
    bump(c.item.track.artist);
    picked.push(c);
  }
  // A small pool: better a mix with a third song of an artist than a short one.
  for (let i = 0; i < left.length && picked.length < want; i++) picked.push(left[i]);

  const fresh: MixItem[] = shuffle(picked, rand).map((c) => ({ track: c.item.track, why: c.why, locked: false }));
  // The kept songs keep their place at the top, in the order they had.
  return { mix: [...locked.map((m) => ({ ...m, locked: true })), ...fresh], matches };
}

/** The next best song for a swap: passes the filters, not in the mix already. */
export function swapCandidate(pool: PoolItem[], s: MixSettings, mix: MixItem[], rand: Rand = Math.random): MixItem | null {
  const inMix = new Set(mix.map((m) => m.track.id));
  let best: { item: PoolItem; score: number; why: string[] } | null = null;
  for (const item of pool) {
    if (inMix.has(item.track.id) || !passes(item.track, s)) continue;
    const sc = scoreItem(item, s, rand);
    if (!best || sc.score > best.score) best = { item, score: sc.score, why: sc.why };
  }
  return best ? { track: best.item.track, why: best.why, locked: false } : null;
}

/** How many songs of the pool fit the filters (the "N songs match" line). */
export function countMatches(pool: PoolItem[], s: MixSettings): number {
  const seen = new Set<string>();
  let n = 0;
  for (const p of pool) {
    if (seen.has(p.track.id)) continue;
    seen.add(p.track.id);
    if (passes(p.track, s)) n++;
  }
  return n;
}

// ── Text ─────────────────────────────────────────────────────────────────────────────────────────────
/** The grey line under a song: "like X · Techno · 2021 · not played yet". */
export function reasonLine(m: MixItem): string {
  const t = m.track;
  const bits: string[] = [];
  if (m.why[0]) bits.push(m.why[0]);
  if (t.genre) bits.push(t.genre);
  if (t.year) bits.push(String(t.year));
  if (t.play_count === 0) bits.push("not played yet");
  else if (t.starred) bits.push("favourite");
  return bits.join(" · ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "19 Nov" (the same everywhere, no locale). */
export function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** A name for "Save as playlist" made from what the mix was asked for. */
export function autoName(s: MixSettings, now: Date = new Date()): string {
  const parts: string[] = [];
  if (s.pure) return `${s.size.toLocaleString("en-US")} random songs · ${shortDate(now)}`;
  const artists = artistSeeds(s).map((x) => x.value);
  const genres = genreSeeds(s).map((x) => x.value);
  if (s.title) parts.push(s.title);
  else if (artists.length) parts.push(artists.slice(0, 2).join(" & "));
  if (genres.length) parts.push(genres.slice(0, 2).join(" & "));
  if (s.years) parts.push(s.years[0] === s.years[1] ? String(s.years[0]) : `${s.years[0]}–${s.years[1]}`);
  if (s.favOnly) parts.push("favourites");
  if (s.unplayedOnly) parts.push("new to me");
  const name = parts.join(" · ");
  return (name ? `${name.length > 60 ? name.slice(0, 59) + "…" : name} · ` : "Mix · ") + shortDate(now);
}

export function totalSeconds(mix: { track: Track }[]): number {
  return mix.reduce((a, m) => a + (m.track.duration_secs || 0), 0);
}

/** "1:23:45" or "3:07". */
export function fmtLength(secs: number): string {
  const s = Math.round(secs);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(x)}` : `${m}:${two(x)}`;
}

// ── Quick starts ─────────────────────────────────────────────────────────────────────────────────────
// Presets that work without BPM: genres by name, years, and the familiar/new dial.
export type PresetId = "workout" | "focus" | "party" | "throwback" | "fresh";

const PRESET_GENRES: Record<"workout" | "focus" | "party", string[]> = {
  workout: ["techno", "drum", "dance", "electro", "hip", "rock", "metal", "house"],
  focus: ["ambient", "classical", "instrumental", "chill", "jazz", "downtempo", "lo-fi", "piano", "electronic"],
  party: ["house", "pop", "dance", "disco", "funk", "latin", "hip", "r&b"],
};

/** The library's own genres that fit a word list ("hip" finds "Hip-Hop"), the most songs first, at most `max`. */
export function matchGenres(words: string[], genres: { name: string; songCount: number }[], max = 4): string[] {
  const ranked = [...genres].sort((a, b) => b.songCount - a.songCount);
  const out: string[] = [];
  for (const g of ranked) {
    const n = g.name.toLowerCase();
    if (words.some((w) => n.includes(w))) out.push(g.name);
    if (out.length >= max) break;
  }
  return out;
}

export function presetSettings(
  id: PresetId, genres: { name: string; songCount: number }[], thisYear = new Date().getFullYear(),
): MixSettings {
  const base = defaultSettings();
  switch (id) {
    case "workout":
    case "focus":
    case "party": {
      const names = matchGenres(PRESET_GENRES[id], genres, id === "focus" ? 3 : 4);
      const labels = { workout: "Workout", focus: "Focus", party: "Party" };
      const size = { workout: 45, focus: 40, party: 60 }[id];
      const discover = { workout: 40, focus: 55, party: 30 }[id];
      let s: MixSettings = { ...base, size: snapSize(size), discover, title: labels[id] };
      for (const g of names) s = addSeed(s, { kind: "genre", value: g });
      return s;
    }
    case "throwback":
      return { ...base, size: 50, discover: 20, years: [YEAR_MIN, thisYear - 15], title: "Throwback" };
    case "fresh":
      return { ...base, size: snapSize(40), discover: 85, years: [thisYear - 1, thisYear], unplayedOnly: true, title: "Fresh finds" };
  }
}

/** The most played artists, in order, from a list of albums ("frequent"): one entry per artist. */
export function topArtists(albums: { artist: string; artist_id: string | null }[], max = 3): { name: string; id: string }[] {
  const out: { name: string; id: string }[] = [];
  for (const a of albums) {
    if (!a.artist_id || !a.artist || out.some((x) => x.id === a.artist_id)) continue;
    out.push({ name: a.artist, id: a.artist_id });
    if (out.length >= max) break;
  }
  return out;
}
