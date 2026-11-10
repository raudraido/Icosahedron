// Syncs user preferences between devices through the web engine's hub.
//
// Only device-independent preferences travel (theme, EQ, Last.fm/lyrics/BPM
// toggles, what the left panel shows, orderings and sort choices). Layout
// that depends on the screen (panel widths, column widths), hotkeys, saved
// logins, the play queue and game scores stay per device.
//
// Mechanism: the preferences live in localStorage and the UI reads them once
// at startup, so an incoming change is written to localStorage and the page
// is reloaded to pick it up — right away when nothing is playing, otherwise a
// toast offers the reload so music is never cut off.
import { create } from "zustand";
import { useStore } from "../store";
import { keyEnabled, syncOptions, PREF_GROUPS } from "./syncOptions";

export const SYNC_KEYS: readonly string[] = [
  "icosahedron_theme", "icosahedron_custom_themes", "eq_settings",
  "icosahedron_scrobble_enabled", "icosahedron_bpm_detection_enabled",
  "icosahedron_lyrics_lrclib_enabled", "icosahedron_lyrics_netease_enabled", "icosahedron_lyrics_simpmusic_enabled",
  "icosahedron_lastfm_sidebar_visible", "icosahedron_left_panel_playlists_visible", "icosahedron_home_daily_mix_visible",
  "nav_tab_order", "home_row_order", "footer_show_remaining_time", "bandsintown_enabled",
  "artists_sort", "artists_sort_states", "albums_sort", "albums_sort_states",
];
const KEYSET = new Set(SYNC_KEYS);

export interface SettingsBlob { values: Record<string, string>; at: number }

export const useSettingsSync = create<{ pending: boolean }>(() => ({ pending: false }));

let send: ((blob: SettingsBlob) => void) | null = null;
let enabled = false; // only after the first reconcile, so boot-time writes aren't mistaken for user changes
let applying = false; // our own writes must not echo back
let timer: number | undefined;
let patched = false;
/** What the engine last held. The blob is replaced whole, so keys this player does not manage
 *  (another player's groups, keys it does not know) are sent back exactly as they were. */
let lastRemote: Record<string, string> = {};

const anyGroupOn = () => PREF_GROUPS.some((g) => syncOptions().prefs[g]);

/** The synced keys this player shares (the groups switched on in Settings > Sync Server). */
function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SYNC_KEYS) {
    if (!keyEnabled(k)) continue;
    try { const v = localStorage.getItem(k); if (v !== null) out[k] = v; } catch { /* storage unavailable */ }
  }
  return out;
}

/** Only the part of a remote blob that this player takes over. */
function enabledOf(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SYNC_KEYS) if (keyEnabled(k) && typeof values[k] === "string") out[k] = values[k];
  return out;
}

/** The whole blob to send: what the engine held for the keys we do not manage, plus our own. */
function fullValues(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(lastRemote)) if (!keyEnabled(k)) out[k] = v;
  return { ...out, ...snapshot() };
}

const same = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

function schedulePublish() {
  if (!enabled || applying || !anyGroupOn()) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    const values = fullValues();
    lastRemote = values;
    send?.({ values, at: Date.now() });
  }, 1000);
}

/** Watches writes to the synced keys; installed once. */
function patchStorage() {
  if (patched) return;
  patched = true;
  const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k: string, v: string) {
    set.call(this, k, v);
    if (this === localStorage && KEYSET.has(k) && keyEnabled(k)) schedulePublish();
  };
  Storage.prototype.removeItem = function (k: string) {
    remove.call(this, k);
    if (this === localStorage && KEYSET.has(k) && keyEnabled(k)) schedulePublish();
  };
}

function applyRemote(values: Record<string, string>) {
  applying = true;
  try {
    for (const k of SYNC_KEYS) {
      if (!keyEnabled(k)) continue; // a group this player does not share is left alone
      if (k in values && typeof values[k] === "string") localStorage.setItem(k, values[k]);
      else localStorage.removeItem(k);
    }
  } finally { applying = false; }
  // Auto-reload at most once a minute — if some code rewrote a key at startup
  // the two sides could otherwise chase each other forever.
  const last = Number(sessionStorage.getItem("ico.settingsReload") ?? 0);
  if (!useStore.getState().playing && Date.now() - last > 60_000) {
    sessionStorage.setItem("ico.settingsReload", String(Date.now()));
    location.reload();
  } else {
    useSettingsSync.setState({ pending: true });
  }
}

/** Called when the sync connection is up; `remote` is what the engine holds (or null). */
export function reconcileSettings(remote: SettingsBlob | null, sendFn: (b: SettingsBlob) => void) {
  send = sendFn;
  patchStorage();
  lastRemote = { ...(remote?.values ?? {}) };
  if (anyGroupOn()) {
    const local = snapshot();
    const rv = remote?.values;
    if (!rv || !Object.keys(rv).length) {
      // The engine has nothing yet: this device's preferences become the shared ones.
      if (Object.keys(local).length) { lastRemote = local; sendFn({ values: local, at: Date.now() }); }
    } else if (!same(local, enabledOf(rv))) {
      applyRemote(rv);
    }
  }
  enabled = true;
}

/** Another device changed its preferences. */
export function remoteSettingsChanged(remote: SettingsBlob | null) {
  const rv = remote?.values;
  if (rv) lastRemote = { ...rv };
  if (!rv || !anyGroupOn() || same(snapshot(), enabledOf(rv))) return;
  applyRemote(rv);
}

/** A preference group was switched on or off: when it was switched on, take over what the engine holds for it. */
export function settingsOptionsChanged() {
  if (!enabled || !anyGroupOn()) return;
  const rv = enabledOf(lastRemote);
  // The engine holds nothing for the groups now on: this player's values become the shared ones
  // (never wipe local values just because nobody has shared that group yet).
  if (!Object.keys(rv).length) { schedulePublish(); return; }
  if (!same(snapshot(), rv)) applyRemote(lastRemote);
}

/** The engine's stored preferences were wiped; keep sending only what we manage. */
export function remoteSettingsCleared() {
  lastRemote = {};
}

export function settingsDisconnected() {
  enabled = false;
  clearTimeout(timer);
}
