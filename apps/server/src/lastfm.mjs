import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";

// Last.fm lives in the engine, not in the players: the API secret must not
// reach a browser, and one connection per user then scrobbles from every
// device. Sessions are keyed by the Navidrome username that authenticated.
// The session key is stored in /data/lastfm.json (mode 600) — it grants write
// access to the user's Last.fm account, so protect that volume.

const BASE_URL = "https://ws.audioscrobbler.com/2.0/";

export class LastFmApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function createLastFm({ apiKey, apiSecret, dir, fetchImpl = fetch }) {
  const configured = Boolean(apiKey && apiSecret);
  const file = dir ? join(dir, "lastfm.json") : null;
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

  const sign = (params) => {
    const base = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join("");
    return createHash("md5").update(base + apiSecret, "utf8").digest("hex");
  };

  async function call(method, params, { signed, post }) {
    const all = { method, api_key: apiKey, ...params };
    if (signed) all.api_sig = sign(all);
    all.format = "json";
    const resp = post
      ? await fetchImpl(BASE_URL, { method: "POST", body: new URLSearchParams(all) })
      : await fetchImpl(`${BASE_URL}?${new URLSearchParams(all)}`);
    const data = await resp.json();
    if (data.error) throw new LastFmApiError(data.error, data.message ?? `Last.fm error ${data.error}`);
    return data;
  }

  const meta = (t) => ({
    track: String(t.title ?? ""), artist: String(t.artist ?? ""), album: String(t.album ?? ""),
    duration: String(Math.round(Number(t.duration) || 0)),
  });

  return {
    configured, apiKey,
    async startAuth() {
      const { token } = await call("auth.getToken", {}, { signed: false, post: false });
      return { token, authUrl: `https://www.last.fm/api/auth/?api_key=${apiKey}&token=${token}` };
    },
    /** @returns {{connected:false}|{connected:true,username:string}} — error 14 = user hasn't approved yet */
    async finishAuth(user, token) {
      try {
        const { session } = await call("auth.getSession", { token }, { signed: true, post: false });
        users[user] = { sessionKey: session.key, username: session.name, historyEnabled: false, scrobbleEnabled: false };
        save();
        return { connected: true, username: session.name };
      } catch (e) {
        if (e instanceof LastFmApiError && e.code === 14) return { connected: false };
        throw e;
      }
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
      await call("track.updateNowPlaying", { ...meta(track), sk: s.sessionKey }, { signed: true, post: true });
    },
    async scrobble(user, track, timestamp) {
      const s = users[user];
      if (!s) return;
      await call("track.scrobble", { ...meta(track), timestamp: String(Math.floor(Number(timestamp))), sk: s.sessionKey }, { signed: true, post: true });
    },
  };
}
