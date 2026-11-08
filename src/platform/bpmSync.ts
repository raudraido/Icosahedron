// Keeps BPM in the web engine so every player sees the same values. The
// engine only stores; detection stays on players that can do it (the desktop
// app's native analyzer). A player that can't detect (browser) just reads.
import type { Platform } from "./index";
import { getEngineBase } from "./syncUrl";

let authCache: { header: string; at: number } | null = null;

async function authHeader(base: Platform): Promise<string> {
  // A Subsonic token stays valid for its salt, so one is reused for a while.
  if (authCache && Date.now() - authCache.at < 8 * 60_000) return authCache.header;
  const a = await base.invoke<{ u: string; t: string; s: string }>("sync_auth");
  const header = `Subsonic ${new URLSearchParams({ u: a.u, t: a.t, s: a.s })}`;
  authCache = { header, at: Date.now() };
  return header;
}

async function engine(base: Platform, path: string, init: RequestInit = {}): Promise<Response | null> {
  const root = getEngineBase();
  if (!root) return null;
  try {
    return await fetch(root + path, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), authorization: await authHeader(base), "content-type": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  } catch { return null; } // engine offline — local behaviour continues
}

const put = (base: Platform, id: string, bpm: number, manual: boolean) =>
  engine(base, `/bpm/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ bpm, manual }) });

export function withEngineBpm(base: Platform): Platform {
  return {
    ...base,
    invoke: async (cmd, args) => {
      switch (cmd) {
        case "get_bpm": {
          const id = String((args as any)?.trackId);
          const r = await engine(base, `/bpm/${encodeURIComponent(id)}`);
          if (r?.ok) return (await r.json()).bpm;
          const bpm = await base.invoke<number>(cmd, args); // detect/cache locally; throws where unsupported
          void put(base, id, bpm, false);
          return bpm as any;
        }
        case "set_bpm_override": {
          const res = await base.invoke(cmd, args);
          void put(base, String((args as any).trackId), (args as any).bpm, true);
          return res;
        }
        case "get_bpm_cache_all": {
          const local = await base.invoke<Record<string, number>>(cmd, args);
          const r = await engine(base, "/bpm");
          if (!r?.ok) return local as any;
          const remote = (await r.json()) as Record<string, number>;
          const missing = Object.fromEntries(Object.entries(local).filter(([k]) => !(k in remote)));
          if (Object.keys(missing).length) void engine(base, "/bpm", { method: "POST", body: JSON.stringify(missing) });
          return { ...local, ...remote } as any;
        }
        default:
          return base.invoke(cmd, args);
      }
    },
  };
}
