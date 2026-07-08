import { create } from "zustand";
import { api, AudioEventPayload, Track, Album, Playlist, ServerProfile } from "../lib/api";
import type { QueueTab } from "../components/QueueBottomTabs";
import { queryClient } from "../lib/queryClient";

export type Tab =
  | "home" | "nowPlaying" | "albums" | "artists" | "tracks" | "playlists" | "starred"
  | "mixBuilder" | "visualizer" | "settings";

export type NavEntry = {
  tab: Tab; album?: Album; artistId?: string; artistQuery?: string; playlist?: Playlist;
  /** Cross-tab "open Tracks pre-filtered to this value" intent — set by a
   *  genre/year cell click elsewhere (e.g. a playlist's tracklist) and
   *  consumed once by Tracks.tsx on mount, the same way artistQuery is
   *  consumed once by Artists.tsx. */
  trackFilter?: { col: string; value: string };
  /** Cross-tab "open Tracks/Albums pre-filled with this free-text search"
   *  intent — set by Spotlight's "Show all N results" links (SpotlightSearch.tsx).
   *  Unlike trackFilter/artistQuery, consumers key their effect off the whole
   *  nav entry object (not just this string), so re-searching the exact same
   *  text from Spotlight a second time still re-applies it. */
  trackQuery?: string;
  albumQuery?: string;
  /** Cross-tab "open Settings directly on this sub-tab" intent — set by the
   *  left panel logo menu's "Manage Servers" entry, consumed once by
   *  Settings.tsx on mount the same way trackQuery/albumQuery are. */
  settingsTab?: string;
};

interface AppStore {
  // connection
  connected: boolean;
  serverUrl: string;
  username: string;
  connect: (url: string, user: string, pass: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;

  // Settings > Playback's "Scrobble" toggle — see the `scrobble()` module
  // function below for the actual gating; this is just the persisted flag.
  scrobbleEnabled: boolean;
  setScrobbleEnabled: (v: boolean) => void;

  // Settings > Playback's "Detect BPM" toggle — see loadBpmDetectionEnabled
  // below for exactly what this does and doesn't gate.
  bpmDetectionEnabled: boolean;
  setBpmDetectionEnabled: (v: boolean) => void;

  // Left panel's "Recently Played" list (LeftPanel.tsx) reads your Last.fm
  // play history directly — separate from Navidrome's own scrobbling above,
  // this is purely a read against Last.fm's public API.
  lastFmApiKey: string;
  lastFmUsername: string;
  setLastFmSettings: (apiKey: string, username: string) => void;
  /** Master switch (Settings > Integrations > Last.fm's "Enable Recent
   *  History via Last.fm") — gates whether the API key/username fields are
   *  even usable, and whether anything is ever fetched. */
  lastFmEnabled: boolean;
  setLastFmEnabled: (v: boolean) => void;
  /** Secondary, purely-visual switch (Settings > Appearance > Left Panel's
   *  "Show Recently Played") — hiding the list this way doesn't touch
   *  `lastFmEnabled`/credentials, but it has no effect (and the toggle
   *  renders disabled) while `lastFmEnabled` itself is off, since there's
   *  nothing to show either way in that case. */
  lastFmSidebarVisible: boolean;
  setLastFmSidebarVisible: (v: boolean) => void;

  // multi-server (Settings > Servers) — `servers` never carries passwords,
  // those stay main-process-side (electron/main/credentials.ts) and are only
  // ever referenced by profile id.
  servers: ServerProfile[];
  activeServerId: string | null;
  loadServers: () => Promise<void>;
  /** Tests + persists a new profile without touching the live connection —
   *  doesn't switch to it, just adds it to the list (mirrors "Add Server"
   *  saving without an implicit "Use"). Throws on a failed connection test. */
  addServer: (name: string, url: string, username: string, password: string) => Promise<void>;
  /** Switches the live connection to an already-saved profile: reconnects,
   *  clears the queue + every cached query (stale data from the old server
   *  shouldn't linger), and restores/seeds that server's own session. */
  switchServer: (id: string) => Promise<void>;
  removeServer: (id: string) => Promise<void>;

  // cover URL — synchronous, no IPC, computed once at connect
  coverUrl: (coverId: string | null, size?: number) => string;

  // On-device BPM detection results (native/audio-engine's QM-DSP analyzer),
  // keyed by track id — shared across the whole app (footer, TrackTable,
  // TrackInfoDialog) so a track detected once from the footer immediately
  // shows its real BPM everywhere else too, instead of just the ID3 tag.
  // Preloaded in full from disk at connect time; detection itself only ever
  // runs for the currently-playing track (see PlayerBar.tsx) — browsing a
  // list never triggers new analysis.
  bpmCache: Record<string, number>;
  setBpm: (trackId: string, bpm: number) => void;
  loadBpmCache: () => Promise<void>;

  // navigation + back/forward history
  activeTab: Tab;
  navHistory: NavEntry[];
  navPos: number;
  setTab: (tab: Tab) => void;
  pushNav: (extra?: Omit<NavEntry, "tab">) => void;
  navigateTo: (entry: NavEntry) => void;
  navBack: () => void;
  navFwd: () => void;

  // queue panel's bottom tab (Queue/Lyrics/Info) — promoted from local
  // component state so the Now Playing tab's "Lyrics" button can switch to
  // it, matching the old app's lyricsRequested signal (now_playing_info.py)
  queuePanelTab: QueueTab;
  setQueuePanelTab: (tab: QueueTab) => void;

  // Spotlight search overlay (components/SpotlightSearch.tsx) — ports the
  // old app's SpotlightSearch/show_search: summoned by Ctrl+F or by typing
  // any plain printable character while nothing else has focus (see
  // GlobalHotkeys.tsx), `spotlightInitial` is that first typed character so
  // it's seeded into the input instead of being lost.
  spotlightOpen: boolean;
  spotlightInitial: string;
  openSpotlight: (initialChar?: string) => void;
  closeSpotlight: () => void;

  // left-panel art expand/collapse — mirrors the footer's small thumbnail
  // shrinking to 0 in lockstep (both driven by this one flag), matching the
  // old app's window._toggle_sidebar_art
  sidebarArtExpanded: boolean;
  toggleSidebarArt: () => void;

  // player — playback itself lives entirely in the native gapless audio
  // engine (electron/main/audioEngine.ts); this state mirrors what it
  // reports via the onAudioEvent push channel (see handleAudioEvent below).
  queue: Track[];
  currentIndex: number;
  playing: boolean;
  shuffle: boolean;
  repeat: boolean;
  volume: number;
  currentTime: number;
  /** Unfloored `currentTime`, plus the `performance.now()` it was received
   *  at — lets high-frequency consumers (lyric sync) interpolate a smooth
   *  position between the native engine's throttled (~1.5s) progress ticks,
   *  instead of visibly lagging behind the audio. Mirrors the old app's QML
   *  positionClock, which extrapolated between its own decoder polls. */
  currentTimeRaw: number;
  currentTimeAnchorMs: number;
  duration: number;
  /** Gapless bookkeeping — the track (and its queue index at commit time)
   *  chosen when chain-preload fired ~30s before the current track's end.
   *  `track_switched` applies this exact committed choice rather than
   *  re-picking (shuffle/repeat pick fresh each time computeNextTrack runs,
   *  so re-picking at switch time could land on a different track than the
   *  one the native engine actually chained). */
  _committedNext: Track | null;
  _committedNextIndex: number | null;
  /** Track id chain-preload has already fired for, so the progress handler
   *  only fires it once per track rather than on every tick inside the 30s
   *  window. */
  _chainedForTrackId: string | null;

  playTrack: (track: Track, queue?: Track[]) => void;
  playPause: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  setCurrentTime: (secs: number) => void;
  setVolume: (v: number) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  clearQueue: () => void;

  // context-menu queue actions
  addTrackNext: (track: Track) => void;
  addTrackToQueue: (track: Track) => void;
  appendToQueue: (tracks: Track[]) => void;
  startRadio: (track: Track) => Promise<void>;
  /** Drag-reorder in the queue panel — moves the track with id `fromId` to
   *  land at `toIndex` (an insertion index into the *original*, pre-removal
   *  array — 0..queue.length, where queue.length means "at the very end").
   *  Re-syncs currentIndex by identity (finds the currently-playing track's
   *  new position) rather than index arithmetic, so it's correct regardless
   *  of drag direction. */
  reorderQueue: (fromId: string, toIndex: number) => void;
  /** True while startRadio's background similar/top-songs fetch is in flight — drives the
   *  queue panel's loading spinner (matches the old app's QueuePanel.set_radio_loading). */
  radioLoading: boolean;
  /** "Remove from Queue" — matches window.py's _queue_remove_at: re-syncs
   *  currentIndex by identity after the removal (correct even if tracks
   *  before the current one get removed), and if the removed track *was* the
   *  currently-playing one, stops playback entirely rather than picking
   *  a new current index. */
  removeFromQueue: (id: string) => void;

  // session persistence (queue/current track/position survive a restart) —
  // matches the old app's save_playlist/load_playlist (closeEvent-triggered)
  persistSession: () => void;
  restoreSession: () => Promise<void>;
  loadRandomTrack: () => Promise<void>;
}

// Namespaced per server — otherwise switching servers would restore (or
// clobber) another server's queue/position. `null` (no active server known
// yet, e.g. mid-migration) falls back to the original unnamespaced key so
// existing single-server installs don't lose their session on upgrade.
const LEGACY_SESSION_KEY = "icosahedron_session";
function sessionKey(serverId: string | null): string {
  return serverId ? `icosahedron_session_${serverId}` : LEGACY_SESSION_KEY;
}

// Default display name for a newly-saved server profile — matches the same
// derivation electron/main/credentials.ts uses for its legacy-format
// migration, just renderer-side for the normal Login/Add Server path.
function hostLabel(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

/** Picks the track (and its queue index) that should play after the current
 *  one: `repeat` replays the same track, `shuffle` picks a fresh random pick
 *  from the whole queue (matches the old app: not a pre-shuffled traversal,
 *  every advance re-rolls), otherwise the next sequential index (no
 *  wraparound at the end of a non-repeating, non-shuffling queue). Returns
 *  both the track and its index in one shot so callers never need a second,
 *  independent random roll just to recover the index. */
function computeNextTrack(
  queue: Track[], currentIndex: number, shuffle: boolean, repeat: boolean,
): { track: Track; index: number } | null {
  if (repeat) {
    const track = queue[currentIndex];
    return track ? { track, index: currentIndex } : null;
  }
  if (shuffle) {
    if (!queue.length) return null;
    const index = Math.floor(Math.random() * queue.length);
    return { track: queue[index], index };
  }
  const index = currentIndex + 1;
  const track = queue[index];
  return track ? { track, index } : null;
}

/** `currentTime` (+ its unfloored/anchored companions) patch for every place
 *  playback position is set, so lyric sync's interpolation always has a
 *  fresh, accurate anchor — see `currentTimeRaw` above. */
function positionPatch(secs: number) {
  return { currentTime: Math.floor(secs), currentTimeRaw: secs, currentTimeAnchorMs: performance.now() };
}

// Standard scrobble threshold (Last.fm's own rule — Navidrome's `scrobble`
// endpoint doesn't enforce this itself, callers are expected to). Only
// relevant to a manually-interrupted track (see playTrack below); a track
// that finishes naturally (track_switched/ended in handleAudioEvent) always
// counts regardless, since it played out in full.
function pastScrobbleThreshold(currentTime: number, duration: number): boolean {
  return duration > 0 && (currentTime >= duration * 0.5 || currentTime >= 240);
}

const LS_SCROBBLE_ENABLED_KEY = "icosahedron_scrobble_enabled";

// Defaults to on (matches the behavior every existing install already had
// before this toggle existed) — only ever off if the user explicitly
// disabled it once before.
function loadScrobbleEnabled(): boolean {
  try {
    return localStorage.getItem(LS_SCROBBLE_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

const LS_BPM_DETECTION_ENABLED_KEY = "icosahedron_bpm_detection_enabled";

// Defaults to on, same reasoning as loadScrobbleEnabled above. Only gates
// the *native on-device analysis* (PlayerBar.tsx's api.getBpm call on a
// cache miss) — a track's ID3 bpm tag or an already-cached/detected value
// still shows regardless, this just stops new analysis from running.
function loadBpmDetectionEnabled(): boolean {
  try {
    return localStorage.getItem(LS_BPM_DETECTION_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

// Every scrobble() call in this file goes through here instead of api.scrobble
// directly, so Settings' "Scrobble" toggle has exactly one place to gate —
// when off, this is a straight no-op and nothing ever reaches Navidrome
// (which is what actually relays on to Last.fm server-side, if configured
// there; see the "no way to detect that server-side" discussion this toggle
// came out of).
function scrobble(trackId: string, submission: boolean) {
  if (!useStore.getState().scrobbleEnabled) return;
  api.scrobble(trackId, submission).catch(() => {});
}

// Last.fm's read API (user.getrecenttracks, see lib/lastfm.ts) needs only a
// public API key + the target username — neither is a secret the way a
// Navidrome password is, so plain localStorage (not the OS-backed
// credential store) is enough, same tier as the scrobble-enabled flag above.
const LS_LASTFM_API_KEY = "icosahedron_lastfm_api_key";
const LS_LASTFM_USERNAME = "icosahedron_lastfm_username";
const LS_LASTFM_ENABLED_KEY = "icosahedron_lastfm_enabled";
const LS_LASTFM_SIDEBAR_VISIBLE_KEY = "icosahedron_lastfm_sidebar_visible";

// Defaults to on, same reasoning as loadScrobbleEnabled above — this toggle
// is being added after "Recently Played" already works for existing users,
// so defaulting to off would look like a regression the moment it ships.
// Turning it off doesn't touch the saved API key/username, so re-enabling
// later needs no reconfiguration.
function loadLastFmEnabled(): boolean {
  try {
    return localStorage.getItem(LS_LASTFM_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

function loadLastFmSidebarVisible(): boolean {
  try {
    return localStorage.getItem(LS_LASTFM_SIDEBAR_VISIBLE_KEY) !== "false";
  } catch {
    return true;
  }
}

// Named to match the store's own field names exactly (not "apiKey"/
// "username", the latter of which would collide with the Navidrome
// username field when spread into the store below).
function loadLastFmSettings(): { lastFmApiKey: string; lastFmUsername: string } {
  try {
    return {
      lastFmApiKey: localStorage.getItem(LS_LASTFM_API_KEY) ?? "",
      lastFmUsername: localStorage.getItem(LS_LASTFM_USERNAME) ?? "",
    };
  } catch {
    return { lastFmApiKey: "", lastFmUsername: "" };
  }
}

export const useStore = create<AppStore>((set, get) => ({
  connected: false,
  serverUrl: "",
  username: "",
  coverUrl: () => "",

  scrobbleEnabled: loadScrobbleEnabled(),
  setScrobbleEnabled: (v) => {
    try { localStorage.setItem(LS_SCROBBLE_ENABLED_KEY, String(v)); } catch { /* best-effort */ }
    set({ scrobbleEnabled: v });
  },

  bpmDetectionEnabled: loadBpmDetectionEnabled(),
  setBpmDetectionEnabled: (v) => {
    try { localStorage.setItem(LS_BPM_DETECTION_ENABLED_KEY, String(v)); } catch { /* best-effort */ }
    set({ bpmDetectionEnabled: v });
  },

  ...loadLastFmSettings(),
  setLastFmSettings: (apiKey, username) => {
    try {
      localStorage.setItem(LS_LASTFM_API_KEY, apiKey);
      localStorage.setItem(LS_LASTFM_USERNAME, username);
    } catch { /* best-effort */ }
    set({ lastFmApiKey: apiKey, lastFmUsername: username });
  },

  lastFmEnabled: loadLastFmEnabled(),
  setLastFmEnabled: (v) => {
    try { localStorage.setItem(LS_LASTFM_ENABLED_KEY, String(v)); } catch { /* best-effort */ }
    set({ lastFmEnabled: v });
  },

  lastFmSidebarVisible: loadLastFmSidebarVisible(),
  setLastFmSidebarVisible: (v) => {
    try { localStorage.setItem(LS_LASTFM_SIDEBAR_VISIBLE_KEY, String(v)); } catch { /* best-effort */ }
    set({ lastFmSidebarVisible: v });
  },

  bpmCache: {},
  setBpm: (trackId, bpm) => set((s) => ({ bpmCache: { ...s.bpmCache, [trackId]: bpm } })),
  loadBpmCache: async () => {
    try {
      const cache = await api.getBpmCacheAll();
      set({ bpmCache: cache });
    } catch { /* best-effort — tracklists just fall back to the ID3 tag */ }
  },

  queuePanelTab: "queue",
  setQueuePanelTab: (tab) => set({ queuePanelTab: tab }),

  spotlightOpen: false,
  spotlightInitial: "",
  openSpotlight: (initialChar = "") => set({ spotlightOpen: true, spotlightInitial: initialChar }),
  closeSpotlight: () => set({ spotlightOpen: false, spotlightInitial: "" }),

  // `remember` matches the old app's "Remember my credentials" checkbox
  // (login_dialog.py/main.py): url+username are non-secret, but the
  // password is only ever persisted through the OS-backed secret store
  // (electron/main/credentials.ts), never in localStorage — and only at
  // all if the user opts in. Since a saved profile is what Settings >
  // Servers switches between, "remember" now means "add this as a server
  // profile" — unchecking just connects for this session without adding one.
  connect: async (url, user, pass, remember) => {
    await api.connect(url, user, pass);
    let activeServerId: string | null = null;
    if (remember) {
      const profile = await api.saveServer({ name: hostLabel(url), url, username: user, password: pass });
      await api.setActiveServer(profile.id);
      activeServerId = profile.id;
      set((s) => ({ servers: [...s.servers.filter((x) => x.id !== profile.id), profile] }));
    }
    set({
      connected: true,
      serverUrl: url,
      username: user,
      activeServerId,
      activeTab: "home", navHistory: [{ tab: "home" }], navPos: 0,
      coverUrl: (coverId, size = 200) =>
        coverId ? `cover://localhost/${encodeURIComponent(coverId)}?size=${size}` : "",
    });
    try {
      await get().restoreSession();
    } catch { /* a failed session restore shouldn't be treated as a bad-credentials error */ }
    get().loadBpmCache();
  },

  servers: [],
  activeServerId: null,

  loadServers: async () => {
    try {
      const servers = await api.listServers();
      set({ servers });
    } catch { /* best-effort — Servers tab just shows an empty list */ }
  },

  // Tests + persists a profile without touching the live connection or
  // marking it active — matches "Add Server" saving to the list without an
  // implicit "Use" (switching is a separate, explicit action below).
  addServer: async (name, url, username, password) => {
    const ok = await api.testConnection(url, username, password);
    if (!ok) throw new Error("Couldn't connect with those credentials.");
    const profile = await api.saveServer({ name, url, username, password });
    set((s) => ({ servers: [...s.servers, profile] }));
  },

  // Reconnects to an already-saved profile, then discards anything tied to
  // the previous server: the queue/playback, every cached Navidrome query
  // (react-query — stale albums/artists/etc. from the old server shouldn't
  // leak into the new one's screens), and finally seeds/restores this
  // server's own session (namespaced by id, see sessionKey).
  switchServer: async (id) => {
    const result = await api.connectServer(id);
    if (!result) throw new Error("Couldn't connect to that server.");
    get().clearQueue();
    queryClient.clear();
    set({
      connected: true,
      serverUrl: result.url,
      username: result.username,
      activeServerId: id,
      activeTab: "home", navHistory: [{ tab: "home" }], navPos: 0,
      coverUrl: (coverId, size = 200) =>
        coverId ? `cover://localhost/${encodeURIComponent(coverId)}?size=${size}` : "",
    });
    try {
      await get().restoreSession();
    } catch { /* a failed session restore shouldn't block the switch itself */ }
    get().loadBpmCache();
  },

  removeServer: async (id) => {
    await api.deleteServer(id);
    localStorage.removeItem(sessionKey(id));
    set((s) => ({ servers: s.servers.filter((x) => x.id !== id) }));
  },

  // Stops playback and drops back to connected:false — App.tsx renders
  // <Login /> as soon as that flips, same gate the initial boot check uses.
  // This only signs the current user out; the server profile itself (and
  // its saved credentials) stays put in Settings > Servers / Login's saved-
  // servers list, just no longer marked active so next launch won't
  // auto-connect into it without the user picking it again.
  logout: async () => {
    const { activeServerId } = get();
    get().clearQueue();
    if (activeServerId) await api.setActiveServer(null);
    queryClient.clear();
    set({ connected: false, serverUrl: "", username: "", activeServerId: null });
  },

  activeTab: "home",
  navHistory: [{ tab: "home" }],
  navPos: 0,

  setTab: (tab) => {
    const { activeTab, navHistory, navPos } = get();
    if (tab === activeTab) return;
    // Truncate forward history, push new entry
    const newHistory = [...navHistory.slice(0, navPos + 1), { tab }];
    set({ activeTab: tab, navHistory: newHistory, navPos: newHistory.length - 1 });
  },

  pushNav: (extra) => {
    const { activeTab, navHistory, navPos } = get();
    const entry: NavEntry = { tab: activeTab, album: extra?.album, artistId: extra?.artistId, artistQuery: extra?.artistQuery, playlist: extra?.playlist };
    const newHistory = [...navHistory.slice(0, navPos + 1), entry];
    set({ navHistory: newHistory, navPos: newHistory.length - 1 });
  },

  navigateTo: (entry) => {
    const { navHistory, navPos } = get();
    const newHistory = [...navHistory.slice(0, navPos + 1), entry];
    set({ activeTab: entry.tab, navHistory: newHistory, navPos: newHistory.length - 1 });
  },

  navBack: () => {
    const { navHistory, navPos } = get();
    if (navPos <= 0) return;
    const newPos = navPos - 1;
    set({ navPos: newPos, activeTab: navHistory[newPos].tab });
  },

  navFwd: () => {
    const { navHistory, navPos } = get();
    if (navPos >= navHistory.length - 1) return;
    const newPos = navPos + 1;
    set({ navPos: newPos, activeTab: navHistory[newPos].tab });
  },

  sidebarArtExpanded: false,
  toggleSidebarArt: () => set((s) => ({ sidebarArtExpanded: !s.sidebarArtExpanded })),

  queue: [],
  currentIndex: -1,
  playing: false,
  shuffle: false,
  repeat: false,
  volume: 100,
  currentTime: 0,
  currentTimeRaw: 0,
  currentTimeAnchorMs: 0,
  duration: 0,
  _committedNext: null,
  _committedNextIndex: null,
  _chainedForTrackId: null,

  playTrack: (track, queue) => {
    const resolvedQueue = queue ?? [track];
    const idx = resolvedQueue.findIndex((t) => t.id === track.id);
    const { volume, queue: prevQueue, currentIndex: prevIndex, currentTime, duration } = get();

    // Submit the real "played" scrobble for whatever this replaces — a
    // manual switch never reaches handleAudioEvent's track_switched/ended
    // cases (those are gapless-engine-only signals), so without this, plays
    // interrupted by picking a new track (as opposed to letting one finish)
    // would never actually scrobble at all. Gated on the standard
    // half-the-track-or-4-minutes threshold so a 10-second skip doesn't
    // falsely count as a full play.
    const prevTrack = prevQueue[prevIndex];
    if (prevTrack && prevTrack.id !== track.id && pastScrobbleThreshold(currentTime, duration)) {
      scrobble(prevTrack.id, true);
    }

    // manual=true: bypasses the gapless pre-chain hit and starts immediately
    // (this is always a user-initiated action — auto-advance never calls
    // playTrack, see handleAudioEvent's "track_switched" case).
    api.audioPlay(track.stream_url, volume / 100, track.duration_secs, true, false).catch(() => {});
    scrobble(track.id, false);

    set({
      queue: resolvedQueue,
      currentIndex: idx,
      playing: true,
      ...positionPatch(0),
      duration: track.duration_secs || 0,
      _committedNext: null,
      _committedNextIndex: null,
      _chainedForTrackId: null,
    });
  },

  playPause: () => {
    const { playing } = get();
    if (playing) api.audioPause(); else api.audioResume();
    set({ playing: !playing });
  },

  stop: () => {
    api.audioStop();
    set({ playing: false, ...positionPatch(0) });
  },

  next: () => {
    const { queue, currentIndex, shuffle, repeat, playTrack } = get();
    const picked = computeNextTrack(queue, currentIndex, shuffle, repeat);
    if (picked) playTrack(picked.track, queue);
  },

  prev: () => {
    const { queue, currentIndex, currentTime, playTrack } = get();
    if (currentTime > 3) {
      api.audioSeek(0);
      set(positionPatch(0));
      return;
    }
    const prevTrack = queue[currentIndex - 1];
    if (prevTrack) playTrack(prevTrack, queue);
  },

  setCurrentTime: (secs) => {
    api.audioSeek(secs);
    set(positionPatch(secs));
  },

  setVolume: (v) => {
    const clamped = Math.max(0, Math.min(100, v));
    api.audioSetVolume(clamped / 100);
    set({ volume: clamped });
  },

  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
  toggleRepeat:  () => set((s) => ({ repeat:  !s.repeat  })),

  clearQueue: () => {
    api.audioStop();
    set({
      queue: [], currentIndex: -1, playing: false, ...positionPatch(0), duration: 0,
      _committedNext: null, _committedNextIndex: null, _chainedForTrackId: null,
    });
  },

  // Matches the old app's play_track_next: inserts right after the currently
  // playing track without interrupting playback; if nothing's queued yet,
  // falls back to just playing it (there's no "current" to insert after).
  addTrackNext: (track) => {
    const { queue, currentIndex, playTrack } = get();
    if (!queue.length) { playTrack(track, [track]); return; }
    const newQueue = [...queue];
    newQueue.splice(currentIndex + 1, 0, track);
    set({ queue: newQueue });
  },

  // Matches the old app's add_track_to_queue: always just appends, never
  // auto-plays even if the queue was empty.
  addTrackToQueue: (track) => {
    set((s) => ({ queue: [...s.queue, track] }));
  },

  appendToQueue: (tracks) => {
    if (!tracks.length) return;
    set((s) => ({ queue: [...s.queue, ...tracks] }));
  },

  reorderQueue: (fromId, toIndex) => {
    const { queue, currentIndex } = get();
    const currentTrackId = queue[currentIndex]?.id;
    const from = queue.findIndex((t) => t.id === fromId);
    if (from === -1) return;
    const next = [...queue];
    const [moved] = next.splice(from, 1);
    // toIndex was computed against the pre-removal array — once the source
    // item is spliced out, every index after it shifts down by one.
    const insertAt = Math.max(0, Math.min(next.length, from < toIndex ? toIndex - 1 : toIndex));
    next.splice(insertAt, 0, moved);
    const newCurrentIndex = currentTrackId ? next.findIndex((t) => t.id === currentTrackId) : currentIndex;
    set({ queue: next, currentIndex: newCurrentIndex });
  },

  removeFromQueue: (id) => {
    const { queue, currentIndex } = get();
    const currentTrackId = queue[currentIndex]?.id;
    const next = queue.filter((t) => t.id !== id);
    if (id === currentTrackId) {
      // The removed track was the one playing — stop rather than adopt a new one.
      api.audioStop();
      set({
        queue: next, currentIndex: -1, playing: false, ...positionPatch(0), duration: 0,
        _committedNext: null, _committedNextIndex: null, _chainedForTrackId: null,
      });
    } else {
      const newCurrentIndex = currentTrackId ? next.findIndex((t) => t.id === currentTrackId) : -1;
      set({ queue: next, currentIndex: newCurrentIndex });
    }
  },

  radioLoading: false,

  // Matches the old app's start_radio: clear queue, play the seed track alone,
  // then fill the queue with similar-artist songs + top songs in the
  // background (silently gives up on either if the server can't provide them).
  // set_radio_loading(True/False) around the worker becomes radioLoading here.
  startRadio: async (track) => {
    const { playTrack, appendToQueue } = get();
    playTrack(track, [track]);
    set({ radioLoading: true });

    try {
      const [similar, top] = await Promise.all([
        track.artist_id ? api.getSimilarSongs(track.artist_id, 50).catch(() => []) : Promise.resolve([]),
        track.artist ? api.getTopSongs(track.artist, 10).catch(() => []) : Promise.resolve([]),
      ]);

      const seen = new Set([track.id]);
      const pool = [...similar, ...top].filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      if (pool.length) appendToQueue(pool);
    } finally {
      set({ radioLoading: false });
    }
  },

  // Matches the old app's save_playlist/load_playlist (persistence.py): full
  // queue + current index + position, saved once on close and restored eagerly
  // on next launch — paused, not auto-played. Track stream_urls stay valid
  // indefinitely (Subsonic's salt/token auth isn't time-limited), so restored
  // tracks are usable as-is with no server round-trip. Unlike the old app,
  // shuffle/repeat/volume were never persisted there either — matching that,
  // not extending scope.
  persistSession: () => {
    const { queue, currentIndex, currentTime, activeServerId } = get();
    try {
      localStorage.setItem(sessionKey(activeServerId), JSON.stringify({ queue, currentIndex, positionSecs: currentTime }));
    } catch { /* ignore quota/serialization errors — losing the session is non-fatal */ }
  },

  restoreSession: async () => {
    let saved: { queue: Track[]; currentIndex: number; positionSecs: number } | null = null;
    try {
      const raw = localStorage.getItem(sessionKey(get().activeServerId));
      saved = raw ? JSON.parse(raw) : null;
    } catch { saved = null; }

    if (!saved || !saved.queue.length || saved.currentIndex < 0 || saved.currentIndex >= saved.queue.length) {
      // No prior session to restore — matches the old app's first-launch
      // behavior of seeding the queue with one random library track instead
      // of leaving the player looking empty/broken before anything's ever
      // been played.
      await get().loadRandomTrack();
      return;
    }

    const track = saved.queue[saved.currentIndex];
    const { volume } = get();

    set({
      queue: saved.queue, currentIndex: saved.currentIndex, playing: false,
      ...positionPatch(saved.positionSecs), duration: track.duration_secs || 0,
      _committedNext: null, _committedNextIndex: null, _chainedForTrackId: null,
    });

    // start_paused=true: the engine sits paused at position 0 until the
    // explicit seek below — avoids the audible blip a naive play-then-pause
    // would cause on a real device.
    await api.audioPlay(track.stream_url, volume / 100, track.duration_secs, true, true)
      .then(() => api.audioSeek(saved!.positionSecs))
      .catch(() => {});
  },

  // Seeds the queue with a single random library track, paused at position 0
  // — same "primed and ready, not auto-played" state restoreSession leaves a
  // restored session in, just from a random pick instead of prior history.
  loadRandomTrack: async () => {
    try {
      const [track] = await api.getRandomSongs(1);
      if (!track) return;
      const { volume } = get();
      set({
        queue: [track], currentIndex: 0, playing: false,
        ...positionPatch(0), duration: track.duration_secs || 0,
        _committedNext: null, _committedNextIndex: null, _chainedForTrackId: null,
      });
      await api.audioPlay(track.stream_url, volume / 100, track.duration_secs, true, true).catch(() => {});
    } catch { /* best-effort — an empty queue beats a boot-time error */ }
  },
}));

// ── Native audio engine event handling ──────────────────────────────────────
// The engine is the sole source of truth for playback; this just reconciles
// store state with what it reports. Registered once at module scope (there's
// exactly one BrowserWindow/renderer, matching the old app's single audio
// backend instance).
function handleAudioEvent(payload: AudioEventPayload) {
  const s = useStore.getState();
  switch (payload.kind) {
    case "progress": {
      const rawTime = payload.currentTime ?? 0;
      const duration = Math.floor(payload.duration ?? 0);
      const currentTime = Math.floor(rawTime);
      useStore.setState({ ...positionPatch(rawTime), duration });

      // ~30s-before-end gapless chain trigger (mirrors the old native
      // engine's own preload-at-track-start, just window-based instead of
      // duration-based since JS learns position via these ticks).
      const currentTrack = s.queue[s.currentIndex];
      const remaining = duration - currentTime;
      if (currentTrack && s._chainedForTrackId !== currentTrack.id && remaining > 0 && remaining <= 30) {
        const picked = computeNextTrack(s.queue, s.currentIndex, s.shuffle, s.repeat);
        useStore.setState({
          _chainedForTrackId: currentTrack.id,
          _committedNext: picked?.track ?? null,
          _committedNextIndex: picked?.index ?? null,
        });
        if (picked) {
          api.audioChainPreload(picked.track.stream_url, picked.track.duration_secs).catch(() => {});
        }
      }
      break;
    }
    case "playing": {
      useStore.setState({ duration: Math.floor(payload.duration ?? 0) });
      break;
    }
    case "track_switched": {
      // Sample-accurate gapless boundary — arrives with no preceding
      // playTrack()/audio_play call. Apply the committed choice from the
      // chain-preload trigger above, not a fresh pick (which could disagree
      // with what the engine actually chained under shuffle/repeat).
      const finishedTrack = s.queue[s.currentIndex];
      const committed = s._committedNext;
      const duration = Math.floor(payload.duration ?? 0);
      let newIndex = s.currentIndex;
      if (committed) {
        const atCommittedIndex = s._committedNextIndex != null ? s.queue[s._committedNextIndex] : undefined;
        newIndex = atCommittedIndex?.id === committed.id
          ? s._committedNextIndex!
          : s.queue.findIndex((t) => t.id === committed.id);
        if (newIndex === -1) newIndex = s.currentIndex;
      }
      useStore.setState({
        currentIndex: newIndex,
        ...positionPatch(0),
        duration,
        playing: true,
        _committedNext: null,
        _committedNextIndex: null,
        _chainedForTrackId: null,
      });
      // The track that just finished played out in full — always counts as
      // a real play, unlike playTrack's threshold-gated manual-switch case.
      if (finishedTrack) scrobble(finishedTrack.id, true);
      if (committed) scrobble(committed.id, false);
      break;
    }
    case "ended": {
      // Only reached at true queue exhaustion — chain commits happen ~30s
      // ahead, so there's nothing left to advance to. The track that just
      // ended played out in full, so it always counts as a real play.
      const finishedTrack = s.queue[s.currentIndex];
      if (finishedTrack) scrobble(finishedTrack.id, true);
      useStore.setState({ playing: false });
      break;
    }
    case "error": {
      console.error("[audio]", payload.message);
      useStore.setState({ playing: false });
      break;
    }
  }
}

window.electronAPI.onAudioEvent(handleAudioEvent);

// ── Window title ─────────────────────────────────────────────────────────
// Matches the old app's update_window_title (player/mixins/visuals.py):
// "(Playing|Paused) [i/total] Title — Artist" while a track is loaded, else
// "Icosahedron {version}". Electron syncs the title bar to `document.title`
// automatically (no page-title-updated override is installed in main), so
// setting it here is enough — no IPC round-trip needed.
let idleTitle = "Icosahedron";
api.getAppVersion().then((v) => { idleTitle = `Icosahedron ${v}`; updateWindowTitle(); }).catch(() => {});

let lastTitleKey = "";
function updateWindowTitle() {
  const { queue, currentIndex, playing } = useStore.getState();
  const track = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const key = track ? `${track.id}|${playing}|${currentIndex}|${queue.length}` : "idle";
  if (key === lastTitleKey) return;
  lastTitleKey = key;
  document.title = track
    ? `(${playing ? "Playing" : "Paused"}) [${currentIndex + 1}/${queue.length}] ${track.title} — ${track.artist}`
    : idleTitle;
}
useStore.subscribe(updateWindowTitle);
updateWindowTitle();

// Save the session once on the way out, matching the old app's single
// closeEvent()-triggered save rather than continuously autosaving.
window.addEventListener("beforeunload", () => useStore.getState().persistSession());

// One-time migration: earlier builds stored url/username/password as plain
// JSON under this key. Move it into the OS-backed store instead
// (electron/main/credentials.ts) and remove the plaintext copy, so it
// doesn't just sit there unused on disk forever — and so the user isn't
// forced to re-enter their password once just because the storage
// mechanism changed underneath them.
(async () => {
  try {
    const raw = localStorage.getItem("icosahedron_creds");
    if (!raw) return;
    const { url, user, pass } = JSON.parse(raw);
    if (url && user && pass) {
      const profile = await api.saveServer({ name: hostLabel(url), url, username: user, password: pass });
      await api.setActiveServer(profile.id);
    }
  } catch {
    // best-effort — worst case the user just has to log in again
  } finally {
    try { localStorage.removeItem("icosahedron_creds"); } catch { /* best-effort */ }
  }
})();

// Auto-reconnect on startup if a server profile was marked active (main
// process handles the whole thing — reads the encrypted file, decrypts,
// pings — the plaintext password never comes back over IPC here, matching
// main.py's "trust saved credentials and open immediately" step).
export async function tryAutoConnect() {
  await useStore.getState().loadServers();
  const [result, activeServerId] = await Promise.all([api.tryAutoConnectSaved(), api.getActiveServerId()]);
  if (!result) return;
  useStore.setState({
    connected: true,
    serverUrl: result.url,
    username: result.username,
    activeServerId,
    coverUrl: (coverId, size = 200) =>
      coverId ? `cover://localhost/${encodeURIComponent(coverId)}?size=${size}` : "",
  });
  try {
    await useStore.getState().restoreSession();
  } catch { /* a failed session restore shouldn't be treated as a bad-credentials error */ }
  useStore.getState().loadBpmCache();
}
