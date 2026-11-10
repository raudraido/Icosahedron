// Desktop only: use the web engine's Last.fm connection when there is one, so a
// single connection (made once, key and secret held by the engine) serves every
// player. The desktop keeps working on its own Last.fm session when no engine is
// set, the engine is unreachable or has no Last.fm configured, and an existing
// local session keeps scrobbling until the engine holds a connection. Exactly one
// side scrobbles a given play, so nothing is counted twice.
import type { Platform } from "./index";
import { createEngine } from "./engineApi";
import { getEngineBase } from "./syncUrl";
import { syncOptions } from "../lib/syncOptions";

type Conn = { username: string; historyEnabled: boolean; scrobbleEnabled: boolean } | null;
type EngineState = { configured: boolean; apiKey: string; conn: Conn };

const TTL_MS = 30_000;

export function withEngineLastFm(base: Platform): Platform {
  const engine = createEngine(() => base.invoke("sync_auth"));
  let cache: { at: number; value: EngineState | null } | null = null;

  const forget = () => { cache = null; };

  /** The engine's Last.fm state, or null when there is no engine, it is down or it has none. */
  async function state(): Promise<EngineState | null> {
    if (!getEngineBase()) return null;
    if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
    let value: EngineState | null = null;
    const cfg = await engine("/lastfm/config");
    if (cfg?.ok) {
      const c = await cfg.json().catch(() => null);
      if (c?.configured) {
        const r = await engine("/lastfm/connection");
        const conn: Conn = r?.ok ? await r.json().catch(() => null) : null;
        value = { configured: true, apiKey: String(c.apiKey ?? ""), conn: conn ?? null };
      }
    }
    cache = { at: Date.now(), value };
    return value;
  }

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await engine(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r) throw new Error("sync server unavailable");
    if (!r.ok) throw new Error(`Last.fm: HTTP ${r.status}`);
    forget();
    return r.status === 204 ? undefined : r.json();
  };

  return {
    ...base,
    invoke: async (cmd, args) => {
      if (!cmd.startsWith("lastfm_") || !syncOptions().lastfm) return base.invoke(cmd, args);
      const st = await state();
      const viaEngine = !!st?.conn; // the engine holds the connection: it does the scrobbling
      switch (cmd) {
        case "lastfm_connect_start": {
          if (!st) break; // no usable engine: the local flow
          const { token, authUrl } = await call("POST", "/lastfm/token");
          window.open(authUrl, "_blank", "noopener");
          return { token } as any;
        }
        case "lastfm_connect_poll":
          if (!st) break;
          return call("POST", "/lastfm/session", { token: (args as any).token });
        case "lastfm_get_connection":
          return (st?.conn ?? (await base.invoke(cmd, args))) as any;
        case "lastfm_public_api_key":
          return (st?.apiKey || (await base.invoke(cmd, args))) as any;
        case "lastfm_disconnect":
          if (viaEngine) return call("DELETE", "/lastfm/connection");
          break;
        case "lastfm_set_history_enabled":
          if (viaEngine) return call("PUT", "/lastfm/toggles", { historyEnabled: (args as any).value });
          break;
        case "lastfm_set_scrobble_enabled":
          if (viaEngine) return call("PUT", "/lastfm/toggles", { scrobbleEnabled: (args as any).value });
          break;
        case "lastfm_now_playing":
          if (viaEngine) return call("POST", "/lastfm/nowplaying", { track: (args as any).track }).catch(() => undefined);
          break;
        case "lastfm_scrobble":
          if (viaEngine) {
            return call("POST", "/lastfm/scrobble", { track: (args as any).track, timestamp: (args as any).timestamp }).catch(() => undefined);
          }
          break;
      }
      return base.invoke(cmd, args);
    },
  };
}
