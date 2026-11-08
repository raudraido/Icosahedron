// Where the web engine (apps/server) lives. In the browser build it is the page's
// own origin; the desktop app has it configured by the user (DevicePicker).
const LS_URL = "ico.syncUrl";

/** http(s) base URL of the web engine, no trailing slash — or null when none is set. */
export function getEngineBase(): string | null {
  if (typeof window === "undefined") return null;
  if (!window.electronAPI) return location.origin;
  try {
    const v = localStorage.getItem(LS_URL);
    return v ? v.replace(/^ws/, "http").replace(/\/sync\/?$/, "").replace(/\/+$/, "") : null;
  } catch { return null; }
}

/** WebSocket URL of the sync endpoint, or null. */
export function getSyncUrl(): string | null {
  const b = getEngineBase();
  return b ? b.replace(/^http/, "ws") + "/sync" : null;
}

export function saveEngineUrl(url: string): void {
  try { url ? localStorage.setItem(LS_URL, url) : localStorage.removeItem(LS_URL); } catch { /* ignore */ }
}
