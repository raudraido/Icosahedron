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
if (!window.electronAPI && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* not a secure context — just not installable */ });
  });
}
