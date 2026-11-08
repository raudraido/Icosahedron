// Keeps BPM in the web engine so every player sees the same values. The
// engine only stores; detection stays on players that can do it (the desktop
// app's native analyzer). A player that can't detect (browser) just reads.
import type { Platform } from "./index";
import { createEngine } from "./engineApi";

export function withEngineBpm(base: Platform): Platform {
  const engine = createEngine(() => base.invoke("sync_auth"));
  const put = (id: string, bpm: number, manual: boolean) =>
    engine(`/bpm/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ bpm, manual }) });

  return {
    ...base,
    invoke: async (cmd, args) => {
      switch (cmd) {
        case "get_bpm": {
          const id = String((args as any)?.trackId);
          const r = await engine(`/bpm/${encodeURIComponent(id)}`);
          if (r?.ok) return (await r.json()).bpm;
          const bpm = await base.invoke<number>(cmd, args); // detect/cache locally; throws where unsupported
          void put(id, bpm, false);
          return bpm as any;
        }
        case "set_bpm_override": {
          const res = await base.invoke(cmd, args);
          void put(String((args as any).trackId), (args as any).bpm, true);
          return res;
        }
        case "get_bpm_cache_all": {
          const local = await base.invoke<Record<string, number>>(cmd, args);
          const r = await engine("/bpm");
          if (!r?.ok) return local as any;
          const remote = (await r.json()) as Record<string, number>;
          const missing = Object.fromEntries(Object.entries(local).filter(([k]) => !(k in remote)));
          if (Object.keys(missing).length) void engine("/bpm", { method: "POST", body: JSON.stringify(missing) });
          return { ...local, ...remote } as any;
        }
        default:
          return base.invoke(cmd, args);
      }
    },
  };
}
