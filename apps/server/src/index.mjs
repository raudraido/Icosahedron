import { createApp } from "./server.mjs";
import { fileStore } from "./store.mjs";
import { createBpmStore } from "./bpm.mjs";
import { createLastFm } from "./lastfm.mjs";
import { createQuickConnect } from "./quickconnect.mjs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const navidromeUrl = (process.env.NAVIDROME_URL ?? "").replace(/\/+$/, "");
if (!navidromeUrl) { console.error("NAVIDROME_URL is required"); process.exit(1); }
const port = Number(process.env.PORT ?? 8080);
const webDir = resolve(process.env.WEB_ROOT ?? "web");
const app = createApp({
  navidromeUrl,
  webRoot: existsSync(webDir) ? webDir : undefined,
  store: fileStore(process.env.DATA_DIR ?? "/data"),
  bpmStore: createBpmStore(process.env.DATA_DIR ?? "/data"),
  quickConnect: createQuickConnect({ enabled: ["1", "true", "yes"].includes(String(process.env.QUICK_CONNECT ?? "").toLowerCase()) }),
  lastfm: createLastFm({ apiKey: process.env.LASTFM_API_KEY, apiSecret: process.env.LASTFM_API_SECRET, dir: process.env.DATA_DIR ?? "/data" }),
});
app.http.listen(port, () => console.log(`icosahedron-server on :${port} → ${navidromeUrl}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { app.close(); process.exit(0); });
