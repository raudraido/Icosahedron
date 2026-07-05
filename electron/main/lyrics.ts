import { app } from "electron";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

// Lyrics provider aggregation + local .lrc cache + Bandsintown tour dates,
// ported from the old app's lyrics_panel.py / artist_info_panel.py. Runs in
// the main process (not the renderer) since none of LRCLib/NetEase/
// SimpMusic/Bandsintown send CORS headers permissive enough for a browser
// fetch() from the app's own origin — Node's fetch has no such restriction,
// matching how SubsonicClient already handles all other network calls here.

const UA = "Icosahedron/1.0";

export interface LyricsSearchResult {
  id: string;
  title: string;
  artist: string;
  source: "LRCLib" | "NetEase" | "SimpMusic";
  synced: boolean | null;
}

async function getJson(url: string, headers?: Record<string, string>): Promise<any | null> {
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA, ...headers } });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ── LRCLib ──────────────────────────────────────────────────────────────────

async function lrclibSearch(artist: string, title: string): Promise<LyricsSearchResult[]> {
  const url = `https://lrclib.net/api/search?${new URLSearchParams({ q: `${artist} ${title}` })}`;
  const results = await getJson(url);
  if (!Array.isArray(results)) return [];
  return results.map((r: any) => ({
    id: String(r.id), title: r.name ?? "", artist: r.artistName ?? "",
    source: "LRCLib" as const, synced: Boolean(r.syncedLyrics),
  }));
}

async function lrclibFetch(songId: string): Promise<string | null> {
  const j = await getJson(`https://lrclib.net/api/get/${songId}`);
  return j?.syncedLyrics || j?.plainLyrics || null;
}

async function lrclibDirect(artist: string, title: string, album: string, duration: number): Promise<string | null> {
  const params: Record<string, string> = { artist_name: artist, track_name: title };
  if (album) params.album_name = album;
  if (duration) params.duration = String(Math.round(duration));
  const j = await getJson(`https://lrclib.net/api/get?${new URLSearchParams(params)}`);
  return j?.syncedLyrics || j?.plainLyrics || null;
}

// ── NetEase ───────────────────────────────────────────────────────────────

async function neteaseSearch(artist: string, title: string): Promise<LyricsSearchResult[]> {
  const params = new URLSearchParams({ s: `${artist} ${title}`, type: "1", limit: "10", offset: "0" });
  const j = await getJson(`https://music.163.com/api/search/get?${params}`);
  const songs = j?.result?.songs;
  if (!Array.isArray(songs)) return [];
  return songs.map((s: any) => ({
    id: String(s.id), title: s.name ?? "",
    artist: Array.isArray(s.artists) ? s.artists.map((a: any) => a.name).join(", ") : "",
    source: "NetEase" as const, synced: null,
  }));
}

async function neteaseFetch(songId: string): Promise<string | null> {
  const params = new URLSearchParams({ id: songId, lv: "1", kv: "1", tv: "-1" });
  const j = await getJson(`https://music.163.com/api/song/lyric?${params}`, { Referer: "https://music.163.com/" });
  return j?.lrc?.lyric || j?.klyric?.lyric || null;
}

// ── SimpMusic ─────────────────────────────────────────────────────────────

async function simpmusicSearch(artist: string, title: string): Promise<LyricsSearchResult[]> {
  const params = new URLSearchParams({ q: title, artist });
  const j = await getJson(`https://api-lyrics.simpmusic.org/v1/search?${params}`);
  const items = j?.data;
  if (!Array.isArray(items)) return [];
  return items.map((r: any) => ({
    id: r.id ?? "", title: r.songTitle ?? "", artist: r.artistName ?? "",
    source: "SimpMusic" as const, synced: Boolean(r.syncedLyrics),
  }));
}

async function simpmusicFetch(songId: string): Promise<string | null> {
  const j = await getJson(`https://api-lyrics.simpmusic.org/v1/${songId}`);
  const items = j?.data;
  if (Array.isArray(items) && items.length) return items[0].syncedLyrics || items[0].plainLyric || null;
  return null;
}

const SEARCH_FNS: Record<string, (artist: string, title: string) => Promise<LyricsSearchResult[]>> = {
  LRCLib: lrclibSearch, NetEase: neteaseSearch, SimpMusic: simpmusicSearch,
};
const FETCH_FNS: Record<string, (id: string) => Promise<string | null>> = {
  LRCLib: lrclibFetch, NetEase: neteaseFetch, SimpMusic: simpmusicFetch,
};

export async function searchLyrics(artist: string, title: string, sources: string[]): Promise<LyricsSearchResult[]> {
  const lists = await Promise.all(sources.map((s) => SEARCH_FNS[s]?.(artist, title) ?? Promise.resolve([])));
  return lists.flat();
}

export async function fetchLyrics(source: string, id: string): Promise<string | null> {
  return FETCH_FNS[source]?.(id) ?? null;
}

export { lrclibDirect };

// ── Local .lrc cache ─────────────────────────────────────────────────────────
// Matches the old app's app_data/lyrics/<key>.lrc — keyed by track id.

function lyricsDir(): string {
  return join(app.getPath("userData"), "lyrics");
}

function lyricsPath(key: string): string {
  const safe = key.replace(/[^\w-]/g, "_");
  return join(lyricsDir(), `${safe}.lrc`);
}

export async function loadLocalLyrics(key: string): Promise<string | null> {
  try {
    return await readFile(lyricsPath(key), "utf-8");
  } catch {
    return null;
  }
}

export async function saveLocalLyrics(key: string, raw: string): Promise<void> {
  await mkdir(lyricsDir(), { recursive: true });
  await writeFile(lyricsPath(key), raw, "utf-8");
}

export async function removeLocalLyrics(key: string): Promise<void> {
  try {
    await unlink(lyricsPath(key));
  } catch {
    // already gone
  }
}

// ── Bandsintown tour dates ───────────────────────────────────────────────────

const BIT_APP_ID = "js_app_id";

export interface TourEvent {
  datetime: string;
  url: string;
  venue: { name: string; city: string; region: string; country: string };
}

export async function getBandsintownEvents(artistName: string): Promise<TourEvent[]> {
  const encoded = encodeURIComponent(artistName);
  const events = await getJson(
    `https://rest.bandsintown.com/artists/${encoded}/events?app_id=${BIT_APP_ID}`,
  );
  if (!Array.isArray(events)) return [];
  return events.map((e: any) => ({
    datetime: e.datetime ?? "",
    url: e.url ?? "",
    venue: {
      name: e.venue?.name ?? "", city: e.venue?.city ?? "",
      region: e.venue?.region ?? "", country: e.venue?.country ?? "",
    },
  }));
}
