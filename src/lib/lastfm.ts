// Last.fm's read API (user.getrecenttracks) — public, keyed only by an API
// key + the target username, no OAuth/session/signing needed (that
// complexity only applies to *write* calls like submitting scrobbles,
// which this app doesn't do — Navidrome's own server-side Last.fm relay,
// see Settings > Playback's "Scrobble" toggle, already covers that).
const BASE_URL = "https://ws.audioscrobbler.com/2.0/";

export interface LastFmTrack {
  name: string;
  artist: string;
  album: string;
  /** true for the one "currently scrobbling" entry Last.fm returns first —
   *  that entry has no timestamp (it hasn't been scrobbled yet, just
   *  reported as now-playing), unlike every other row. */
  nowPlaying: boolean;
  /** Unix seconds, null only for the nowPlaying entry. */
  playedAt: number | null;
}

interface RawTrack {
  name: string;
  artist?: { "#text"?: string };
  album?: { "#text"?: string };
  date?: { uts?: string };
  "@attr"?: { nowplaying?: string };
}

export interface LastFmPage {
  tracks: LastFmTrack[];
  page: number;
  totalPages: number;
}

// `page` is Last.fm's own 1-indexed pagination — used for the left panel's
// lazy-load-on-scroll ("Recently Played" fetches page 1 up front, then page
// 2, 3, … as the user scrolls near the bottom, see LeftPanel.tsx's
// useInfiniteQuery). totalPages comes straight back from Last.fm so the
// caller knows when to stop asking for more without guessing from a
// short/empty page alone.
export async function getRecentTracks(apiKey: string, username: string, page = 1, limit = 50): Promise<LastFmPage> {
  const url = `${BASE_URL}?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=${limit}&page=${page}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Last.fm request failed: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(data.message ?? `Last.fm error ${data.error}`);

  const raw = data.recenttracks?.track;
  const list: RawTrack[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const attr = data.recenttracks?.["@attr"];

  return {
    tracks: list.map((t) => ({
      name: t.name,
      artist: t.artist?.["#text"] ?? "",
      album: t.album?.["#text"] ?? "",
      nowPlaying: t["@attr"]?.nowplaying === "true",
      playedAt: t.date?.uts ? Number(t.date.uts) : null,
    })),
    page: Number(attr?.page ?? page),
    totalPages: Number(attr?.totalPages ?? page),
  };
}

// Deliberately terse (1-2 chars where possible) — this renders right-aligned
// on the same line as the artist name in a fairly narrow sidebar, not as
// its own row, so every extra character directly competes with the artist
// name for space before truncating.
export function formatRelativeTime(unixSeconds: number): string {
  const diffSecs = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (diffSecs < 60) return "now";
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
