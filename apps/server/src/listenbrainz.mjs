import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";

// ListenBrainz lives in the engine for the same reason Last.fm does: one connection per user scrobbles
// from every device. Unlike Last.fm there is no developer key at all — each user pastes their own user
// token (listenbrainz.org/settings), so nothing here can be switched off for everybody at once.
// The token grants write access to the user's listens, so it is stored in /data/listenbrainz.json
// (mode 600), keyed by the Navidrome username that authenticated. LISTENBRAINZ_URL points the engine at
// a self-hosted ListenBrainz (or a compatible service) instead of listenbrainz.org.

export const DEFAULT_BASE_URL = "https://api.listenbrainz.org";

export class ListenBrainzApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createListenBrainz({ baseUrl = DEFAULT_BASE_URL, dir, fetchImpl = fetch } = {}) {
  const base = String(baseUrl).replace(/\/+$/, "");
  const file = dir ? join(dir, "listenbrainz.json") : null;
  let users = {};
  if (file) {
    mkdirSync(dir, { recursive: true });
    try { users = JSON.parse(readFileSync(file, "utf8")).users ?? {}; } catch { /* first run */ }
  }
  const save = () => {
    if (!file) return;
    writeFileSync(file + ".tmp", JSON.stringify({ users }), { mode: 0o600 });
    renameSync(file + ".tmp", file);
    try { chmodSync(file, 0o600); } catch { /* best effort */ }
  };

  async function call(path, { token, body } = {}) {
    const headers = {};
    if (token) headers.authorization = `Token ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const resp = await fetchImpl(base + path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new ListenBrainzApiError(resp.status, data?.error ?? `ListenBrainz error ${resp.status}`);
    return data;
  }

  const meta = (t) => {
    const info = { media_player: "Icosahedron", submission_client: "Icosahedron" };
    const ms = Math.round((Number(t.duration) || 0) * 1000);
    if (ms > 0) info.duration_ms = ms;
    return {
      artist_name: String(t.artist ?? ""), track_name: String(t.title ?? ""),
      ...(t.album ? { release_name: String(t.album) } : {}),
      additional_info: info,
    };
  };

  return {
    baseUrl: base,
    /**
     * The user's token is checked with ListenBrainz (and says whose it is) before it is stored.
     * Throws ListenBrainzApiError when it is not valid.
     */
    async connect(user, token) {
      const r = await call("/1/validate-token", { token });
      if (!r.valid || !r.user_name) throw new ListenBrainzApiError(401, "Invalid ListenBrainz token");
      users[user] = { token, username: String(r.user_name), historyEnabled: false, scrobbleEnabled: false };
      save();
      return { username: String(r.user_name) };
    },
    connection(user) {
      const s = users[user];
      return s ? { username: s.username, historyEnabled: s.historyEnabled, scrobbleEnabled: s.scrobbleEnabled } : null;
    },
    disconnect(user) { delete users[user]; save(); },
    setToggles(user, t) {
      const s = users[user];
      if (!s) return;
      if (typeof t?.historyEnabled === "boolean") s.historyEnabled = t.historyEnabled;
      if (typeof t?.scrobbleEnabled === "boolean") s.scrobbleEnabled = t.scrobbleEnabled;
      save();
    },
    async nowPlaying(user, track) {
      const s = users[user];
      if (!s) return;
      await call("/1/submit-listens", { token: s.token, body: { listen_type: "playing_now", payload: [{ track_metadata: meta(track) }] } });
    },
    async scrobble(user, track, timestamp) {
      const s = users[user];
      if (!s) return;
      await call("/1/submit-listens", { token: s.token, body: { listen_type: "single", payload: [{ listened_at: Math.floor(Number(timestamp)), track_metadata: meta(track) }] } });
    },
    /**
     * The user's own listening history, newest first, from ListenBrainz. `before` (unix seconds) continues
     * after the last row of the previous page; `nextBefore` is null when there is nothing older.
     */
    async history(user, { before, count = 50 } = {}) {
      const s = users[user];
      if (!s) return null;
      const n = Math.min(Math.max(Math.floor(Number(count)) || 50, 1), 100);
      const q = new URLSearchParams({ count: String(n) });
      if (before) q.set("max_ts", String(Math.floor(Number(before))));
      const { payload } = await call(`/1/user/${encodeURIComponent(s.username)}/listens?${q}`, { token: s.token });
      const listens = payload?.listens ?? [];
      const tracks = listens.map((l) => ({
        name: String(l.track_metadata?.track_name ?? ""),
        artist: String(l.track_metadata?.artist_name ?? ""),
        album: String(l.track_metadata?.release_name ?? ""),
        nowPlaying: false,
        playedAt: Number(l.listened_at) || null,
      }));
      const last = tracks.at(-1)?.playedAt ?? null;
      return { tracks, nextBefore: tracks.length >= n && last ? last : null };
    },
  };
}
