import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initSync } from "./lib/sync";
import { initMediaSession } from "./lib/mediaSession";

initSync();
initMediaSession();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Installable PWA: the service worker is for the browser build only (Electron
// loads file:// and has no use for it). Needs HTTPS, or localhost.
//
// ?nosw=1 switches it off on this device (remembered; ?nosw=0 turns it back
// on): it removes any registered worker and its caches. Diagnostic switch —
// iOS Safari runs the worker while other iOS browsers can't, and the lock
// screen only misbehaves in Safari.
function serviceWorkerOff(): boolean {
  try {
    const q = new URLSearchParams(location.search).get("nosw");
    if (q === "1") localStorage.setItem("ico.nosw", "1");
    if (q === "0") localStorage.removeItem("ico.nosw");
    return localStorage.getItem("ico.nosw") === "1";
  } catch { return false; }
}

if (!window.electronAPI && "serviceWorker" in navigator) {
  if (serviceWorkerOff()) {
    void navigator.serviceWorker.getRegistrations().then(async (regs) => {
      await Promise.all(regs.map((r) => r.unregister()));
      for (const k of await caches.keys()) await caches.delete(k);
      // A page already controlled by the worker keeps being controlled until reloaded.
      if (regs.length && navigator.serviceWorker.controller) location.reload();
    });
  } else {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* not a secure context — just not installable */ });
    });
  }
}
