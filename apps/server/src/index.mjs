import { createApp } from "./server.mjs";
import { fileStore } from "./store.mjs";
import { createBpmStore } from "./bpm.mjs";
import { createLastFm } from "./lastfm.mjs";
import { createQuickConnect } from "./quickconnect.mjs";
import { fileSettings } from "./settings.mjs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const navidromeUrl = (process.env.NAVIDROME_URL ?? "").replace(/\/+$/, "");
if (!navidromeUrl) { console.error("NAVIDROME_URL is required"); process.exit(1); }
const port = Number(process.env.PORT ?? 8080);
const webDir = resolve(process.env.WEB_ROOT ?? "web");
const settings = fileSettings(process.env.DATA_DIR ?? "/data");
const qcFlag = String(process.env.QUICK_CONNECT ?? "").trim().toLowerCase();
const qcEnv = ["1", "true", "yes"].includes(qcFlag) ? true : ["0", "false", "no"].includes(qcFlag) ? false : null;
const app = createApp({
  navidromeUrl,
  webRoot: existsSync(webDir) ? webDir : undefined,
  store: fileStore(process.env.DATA_DIR ?? "/data"),
  bpmStore: createBpmStore(process.env.DATA_DIR ?? "/data"),
  quickConnect: createQuickConnect({
    // QUICK_CONNECT in the environment decides and locks the switch; without it an administrator switches it in Settings.
    enabled: qcEnv !== null ? qcEnv : settings.get("quickConnect") === true,
    locked: qcEnv !== null,
    onChange: (on) => settings.set("quickConnect", on),
  }),
  lastfm: createLastFm({ apiKey: process.env.LASTFM_API_KEY, apiSecret: process.env.LASTFM_API_SECRET, dir: process.env.DATA_DIR ?? "/data" }),
});
app.http.listen(port, () => console.log(`icosahedron-server on :${port} → ${navidromeUrl}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { app.close(); process.exit(0); });
