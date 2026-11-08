import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Browser build served by apps/server (the web engine). The Electron build is
// electron.vite.config.ts; both share src/ through the platform adapter.
export default defineConfig({
  root: ".",
  base: "/",
  plugins: [tailwindcss(), react()],
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, "index.html") },
  },
});
