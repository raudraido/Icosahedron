// What THIS player keeps in sync (Settings > Sync Server). Per player, stored on
// the player itself: a phone can share its queue and nothing else while the
// desktop shares everything. See docs/sync-settings.md.
import { create } from "zustand";

export const PREF_GROUPS = ["appearance", "equalizer", "layout", "scrobbling"] as const;
export type PrefGroup = (typeof PREF_GROUPS)[number];

export interface SyncOptions {
  /** Publish the queue and position, appear in the device picker, accept remote control. */
  playback: boolean;
  /** Which shared preferences are sent and received. */
  prefs: Record<PrefGroup, boolean>;
  /** Read and upload BPM through the engine. */
  bpm: boolean;
  /** Use the engine's Last.fm connection (desktop). */
  lastfm: boolean;
}

const LS_KEY = "ico.syncOptions";

const DEFAULTS: SyncOptions = {
  playback: true,
  prefs: { appearance: true, equalizer: true, layout: true, scrobbling: true },
  bpm: true,
  lastfm: true,
};

function load(): SyncOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? "null");
    if (raw && typeof raw === "object") {
      return {
        playback: raw.playback !== false,
        bpm: raw.bpm !== false,
        lastfm: raw.lastfm !== false,
        prefs: Object.fromEntries(PREF_GROUPS.map((g) => [g, raw.prefs?.[g] !== false])) as Record<PrefGroup, boolean>,
      };
    }
  } catch { /* storage unavailable or corrupt: defaults */ }
  return structuredClone(DEFAULTS);
}

export const useSyncOptions = create<SyncOptions>(() => load());

export const syncOptions = (): SyncOptions => useSyncOptions.getState();

function save(): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(syncOptions())); } catch { /* ignore */ }
}

export function setSyncOption(key: "playback" | "bpm" | "lastfm", value: boolean): void {
  useSyncOptions.setState({ [key]: value });
  save();
}

export function setPrefGroup(group: PrefGroup, value: boolean): void {
  useSyncOptions.setState((s) => ({ prefs: { ...s.prefs, [group]: value } }));
  save();
}

/** Which preference group a synced localStorage key belongs to. */
export const KEY_GROUP: Record<string, PrefGroup> = {
  icosahedron_theme: "appearance", icosahedron_custom_themes: "appearance",
  eq_settings: "equalizer",
  icosahedron_lastfm_sidebar_visible: "layout", icosahedron_left_panel_playlists_visible: "layout",
  icosahedron_home_daily_mix_visible: "layout", nav_tab_order: "layout", home_row_order: "layout",
  footer_show_remaining_time: "layout", artists_sort: "layout", artists_sort_states: "layout",
  albums_sort: "layout", albums_sort_states: "layout",
  icosahedron_scrobble_enabled: "scrobbling", icosahedron_bpm_detection_enabled: "scrobbling",
  icosahedron_lyrics_lrclib_enabled: "scrobbling", icosahedron_lyrics_netease_enabled: "scrobbling",
  icosahedron_lyrics_simpmusic_enabled: "scrobbling", bandsintown_enabled: "scrobbling",
};

/** Whether this player sends and receives the given synced key. */
export function keyEnabled(key: string): boolean {
  const g = KEY_GROUP[key];
  return g ? syncOptions().prefs[g] : false;
}
