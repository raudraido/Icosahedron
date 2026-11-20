// ListenBrainz, through the sync server (apps/server/src/listenbrainz.mjs): the server keeps the user's
// token and does the scrobbling, so every device shares one connection and nothing here is a secret.
// Unlike Last.fm there is no developer key in the app. Needs the sync server; without one every call
// rejects and the Settings section says so.
import { platform } from "../platform";
import { createEngine } from "../platform/engineApi";
import type { LastFmTrack } from "./lastfm";

export type ListenBrainzConnection = { username: string; historyEnabled: boolean; scrobbleEnabled: boolean };
export interface ListenBrainzTrackMeta { title: string; artist: string; album: string; duration: number }
/** One page of history; `next` is the `before` value for the following page, undefined at the end. */
export interface ListenPage { tracks: LastFmTrack[]; next: number | undefined }

const engine = createEngine(() => platform.invoke("sync_auth"));

async function call(method: string, path: string, body?: unknown) {
  const r = await engine("/listenbrainz" + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r) throw new Error("The sync server is not reachable. ListenBrainz needs it.");
  if (r.status === 401 && path !== "/connection") throw new Error("ListenBrainz no longer accepts the saved token. Connect again.");
  if (r.status === 401) throw new Error("ListenBrainz does not accept that token.");
  if (r.status === 400) throw new Error("That does not look like a ListenBrainz user token.");
  if (!r.ok) throw new Error(`ListenBrainz: HTTP ${r.status}`);
  return r.status === 204 ? undefined : r.json();
}

export const listenBrainz = {
  getConnection: (): Promise<ListenBrainzConnection | null> => call("GET", "/connection").catch(() => null),
  connect: (token: string): Promise<{ username: string }> => call("PUT", "/connection", { token: token.trim() }),
  disconnect: (): Promise<void> => call("DELETE", "/connection"),
  setHistoryEnabled: (value: boolean): Promise<void> => call("PUT", "/toggles", { historyEnabled: value }),
  setScrobbleEnabled: (value: boolean): Promise<void> => call("PUT", "/toggles", { scrobbleEnabled: value }),
  nowPlaying: (track: ListenBrainzTrackMeta): Promise<void> => call("POST", "/nowplaying", { track }),
  scrobble: (track: ListenBrainzTrackMeta, timestamp: number): Promise<void> => call("POST", "/scrobble", { track, timestamp }),
  async history(before?: number, count = 50): Promise<ListenPage> {
    const q = new URLSearchParams({ count: String(count) });
    if (before) q.set("before", String(before));
    const h = await call("GET", `/history?${q}`);
    return { tracks: h.tracks, next: h.nextBefore ?? undefined };
  },
};
