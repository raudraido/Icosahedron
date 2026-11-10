// Authenticated fetch against the web engine (apps/server): BPM store, Last.fm.
// Auth is a Subsonic token the engine replays against Navidrome; one is reused
// for a while since a token stays valid for its salt.
import { getEngineBase } from "./syncUrl";

export type EngineFetch = (path: string, init?: RequestInit) => Promise<Response | null>;

export function createEngine(getAuth: () => Promise<{ u: string; t: string; s: string }>): EngineFetch {
  let cache: { header: string; at: number } | null = null;
  const header = async () => {
    if (cache && Date.now() - cache.at < 8 * 60_000) return cache.header;
    const a = await getAuth();
    cache = { header: `Subsonic ${new URLSearchParams({ u: a.u, t: a.t, s: a.s })}`, at: Date.now() };
    return cache.header;
  };
  return async (path, init = {}) => {
    const root = getEngineBase();
    if (!root) return null;
    try {
      return await fetch(root + path, {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers as Record<string, string>), authorization: await header() },
        signal: AbortSignal.timeout(10000),
      });
    } catch { return null; } // engine offline — callers fall back to local behaviour
  };
}
