import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Browser build served by apps/server (the web engine). The Electron build is
// electron.vite.config.ts; both share src/ through the platform adapter.
const version: string = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")).version;

export default defineConfig({
  root: ".",
  base: "/",
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 19).replace("T", " ")),
    __APP_VERSION__: JSON.stringify(version), // shown in Settings > System > About
  },
  plugins: [tailwindcss(), react()],
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, "index.html") },
  },
});
