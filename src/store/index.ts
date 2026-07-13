import { create } from "zustand";
import { api, AudioEventPayload, Track, Album, Playlist, ServerProfile, CastDevice, CastPush } from "../lib/api";
import type { QueueTab } from "../components/QueueBottomTabs";
import { queryClient } from "../lib/queryClient";

export type Tab =
  | "home" | "nowPlaying" | "albums" | "artists" | "tracks" | "playlists" | "starred"
  | "mixBuilder" | "visualizer" | "settings";

export type NavEntry = {
  tab: Tab; album?: Album; artistId?: string; artistQuery?: string; playlist?: Playlist;
  /** Open Home showing this daily mix's tracklist (ForYou.tsx's MixDetail) —
   *  same pattern as `album`/`playlist` above, so the global back/forward
   *  buttons traverse in/out of a mix like any other detail view. */
  mix?: import("../screens/ForYou").Mix;
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
  /** Narrows trackQuery to a single field, same as Tracks.tsx's own search-
   *  scope dropdown — set by Spotlight so its per-category "Show all" link
   *  doesn't widen back out to a loose all-field match. */
  trackQueryScope?: "title" | "artist" | "album";
  albumQuery?: string;
  /** Narrows albumQuery to album name only (not also artist) — same reason
   *  as trackQueryScope above. */
  albumQueryNameOnly?: boolean;
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

  // Settings > Integrations' "Lyrics" section — one toggle per external
  // lookup LyricsPanel.tsx's autoFetch() falls back to (see
  // loadLyricsSourceEnabled below). The server (Navidrome/OpenSubsonic) and
  // local disk cache aren't gated here — those aren't third-party services,
  // same reasoning IntegrationsTab's own doc comment gives for what belongs
  // in this tab at all.
  lyricsLrclibEnabled: boolean;
  setLyricsLrclibEnabled: (v: boolean) => void;
  lyricsNeteaseEnabled: boolean;
  setLyricsNeteaseEnabled: (v: boolean) => void;
  lyricsSimpmusicEnabled: boolean;
  setLyricsSimpmusicEnabled: (v: boolean) => void;

  // Client-side Last.fm integration (Settings > Integrations) — connecting
  // is a one-time browser-approval handshake (see LastFmSection in
  // Settings.tsx). Scoped **per Navidrome server profile**, not global to
  // the app install — a household sharing one install across several
  // Navidrome logins gets one independent Last.fm account per profile.
  // `lastfmConnected`/`lastfmConnectedUsername`/`lastFmEnabled`/
  // `lastfmScrobbleEnabled` all mirror main-process state keyed by
  // `activeServerId` (the session key itself never reaches the renderer;
  // see electron/main/lastfmSession.ts) — (re)hydrated in tryAutoConnect,
  // connect, and switchServer below, whenever the active profile changes.
  lastfmConnected: boolean;
  lastfmConnectedUsername: string | null;
  /** Sets connection + both toggle fields at once, from whatever
   *  electron/main/lastfmSession.ts reports for the current profile —
   *  `null` (disconnected) clears the toggles too, since they're
   *  meaningless without an account behind them. */
  setLastfmConnection: (conn: { username: string; historyEnabled: boolean; scrobbleEnabled: boolean } | null) => void;
  // Last.fm's own API key isn't a secret (sent in the clear on every
  // request) — hydrated alongside the connection state above, used by
  // LeftPanel.tsx's "Recently Played" list, which only needs a public
  // key + a username, no session/signing.
  lastfmPublicApiKey: string;

  /** Left panel's "Recently Played" list (Settings > Integrations >
   *  Last.fm's "Recently Played" toggle) — only togglable once connected;
   *  reads `lastfmConnectedUsername`'s history via Last.fm's public API. */
  lastFmEnabled: boolean;
  setLastFmEnabled: (v: boolean) => void;
  /** Secondary, purely-visual switch (Settings > Appearance > Left Panel's
   *  "Show Recently Played") — hiding the list this way doesn't touch
   *  `lastFmEnabled`, but it has no effect (and the toggle renders disabled)
   *  while `lastFmEnabled` itself is off, since there's nothing to show
   *  either way in that case. Deliberately still a plain global localStorage
   *  flag, not per-server like the fields above — purely visual, no account
   *  behind it, no reason to reset when switching profiles. */
  lastFmSidebarVisible: boolean;
  setLastFmSidebarVisible: (v: boolean) => void;

  /** Settings > Appearance > Left Panel's "Show Playlists" toggle — same
   *  purely-visual, no-account, global (not per-server) flag as
   *  lastFmSidebarVisible above, just with no connection gate since
   *  playlists need nothing beyond the active server itself. */
  leftPanelPlaylistsVisible: boolean;
  setLeftPanelPlaylistsVisible: (v: boolean) => void;

  // "Scrobble to Last.fm" (Settings > Integrations) — independent of both
  // the read-only fields above and the Navidrome-relayed `scrobble` module
  // function further down; also only togglable once connected.
  lastfmScrobbleEnabled: boolean;
  setLastfmScrobbleEnabled: (v: boolean) => void;

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
  /** Persist which libraries (music folders) a saved server browses —
   *  empty = all libraries. Changing it on the active server flushes every
   *  cached query so the whole app refetches within the new selection. */
  setServerLibrary: (id: string, folderIds: string[], folderNames: string[]) => Promise<void>;

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

  // Share dialog (components/ShareDialog.tsx) — every "Share" context-menu
  // entry and the album header's share button open this instead of creating
  // the share directly, so expiry/download options can be picked first.
  shareTarget: { id: string; type: "song" | "album" | "playlist"; name: string } | null;
  openShareDialog: (target: { id: string; type: "song" | "album" | "playlist"; name: string }) => void;
  closeShareDialog: () => void;

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
  /** True once stop() has torn down the native sink entirely (as opposed to
   *  merely pausing it) — playPause() needs this to know a plain resume()
   *  call would be a no-op and it must restart playback via playTrack instead. */
  _stopped: boolean;

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

  // server-side queue sync (QueuePanel's upload/download icons) — distinct
  // from the local-only persistSession/restoreSession above: this round-trips
  // through the Subsonic server (savePlayQueue/getPlayQueue) so the queue can
  // be picked up from a different device/session, not just this app restarting.
  /** True while either save or restore is in flight — disables both icons so
   *  a save and a restore can't race each other over `queue`/`currentIndex`. */
  queueSyncBusy: boolean;
  saveQueueToServer: () => Promise<void>;
  restoreQueueFromServer: () => Promise<void>;

  // Casting (Chromecast/DLNA, PlayerBar's cast button + CastPicker.tsx) —
  // "send a URL, the receiver plays it" model (electron/main/castManager.ts).
  // Local playback keeps running unchanged while connected — this is a
  // second, independent output alongside it, not a takeover (matches the old
  // app's own parallel-pipelines design). While castConnected, playTrack/
  // playPause/stop/setCurrentTime additionally relay to the receiver on top
  // of their normal local-engine call; volume stays fully independent per
  // output (see castVolume/setCastVolume below) since "This device" and each
  // cast device get their own slider in CastPicker, same as the old app.
  castDevices: CastDevice[];
  /** True while castManager.ts's background rescan is in flight — lets
   *  CastPicker.tsx show "Scanning…"/"Refreshing…" instead of leaving an
   *  empty or stale-looking list with no feedback. */
  castScanning: boolean;
  castConnecting: boolean;
  /** Set when connectCast's api.castConnect() rejects (e.g. the device is
   *  unreachable) — cleared at the start of the next attempt. Surfaced in
   *  CastPicker.tsx so a failure is visible instead of silently doing
   *  nothing, which otherwise reads as "the app didn't hear my click". */
  castConnectError: string | null;
  castConnected: boolean;
  castDevice: CastDevice | null;
  /** The connected device's own volume (0-100) — independent of `volume`
   *  above, which stays local-only. */
  castVolume: number;
  setCastVolume: (v: number) => void;
  discoverCastDevices: () => Promise<void>;
  /** Explicit, user-triggered rescan (CastPicker.tsx's refresh button) —
   *  the only thing that actually sends a network scan; discoverCastDevices
   *  above just reads the cache now (see castManager.ts's discover()). */
  rescanCastDevices: () => Promise<void>;
  connectCast: (deviceId: string) => Promise<void>;
  disconnectCast: () => Promise<void>;
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

const LS_LYRICS_LRCLIB_ENABLED_KEY = "icosahedron_lyrics_lrclib_enabled";
const LS_LYRICS_NETEASE_ENABLED_KEY = "icosahedron_lyrics_netease_enabled";
const LS_LYRICS_SIMPMUSIC_ENABLED_KEY = "icosahedron_lyrics_simpmusic_enabled";

// Defaults to on for all three, same reasoning as loadScrobbleEnabled above
// — matches the auto-fetch behavior every existing install already had
// before these toggles existed.
function loadLyricsSourceEnabled(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}

// Last.fm connection/toggle state (electron/main/lastfmSession.ts) is keyed
// by Navidrome server profile id — this resolves which key applies right
// now, falling back to DEFAULT_KEY (must match lastfmSession.ts's own
// constant) when there's no saved profile at all, e.g. a "connect without
// remembering" session with no stable id to key persistent storage by.
export const LASTFM_DEFAULT_SERVER_KEY = "default";
export function activeLastfmKey(): string {
  return useStore.getState().activeServerId ?? LASTFM_DEFAULT_SERVER_KEY;
}

// Every scrobble() call in this file goes through here instead of api.scrobble
// directly, so Settings' "Scrobble" toggle has exactly one place to gate —
// when off, nothing reaches Navidrome (which is what actually relays on to
// Last.fm server-side, if configured there; see the "no way to detect that
// server-side" discussion this toggle came out of). Independently, when
// "Scrobble to Last.fm" is connected+enabled, the same call also submits
// directly to Last.fm — the two destinations don't gate each other, so a
// user with no server-side Last.fm relay still gets scrobbles this way.
//
// Deferred a full tick via setTimeout(...,0) — scrobbling is fire-and-forget
// bookkeeping that must never be able to add latency to the actual
// playback-start path (api.audioPlay / playTrack's own `playing` flip),
// even in principle. Everything inside only ever reads state and fires
// off already-async IPC calls, so this was never truly blocking, but
// "click play -> audio starts" must not share so much as a synchronous
// call stack with it regardless.
function scrobble(track: Track, submission: boolean) {
  setTimeout(() => {
    if (useStore.getState().scrobbleEnabled) {
      api.scrobble(track.id, submission).catch(() => {});
    }
    const { lastfmScrobbleEnabled, lastfmConnected } = useStore.getState();
    if (lastfmScrobbleEnabled && lastfmConnected) {
      const meta = { title: track.title, artist: track.artist, album: track.album ?? "", duration: track.duration_secs };
      const serverId = activeLastfmKey();
      // The left panel's "Recently Played" list (LeftPanel.tsx) otherwise only
      // learns about this via its own 30s poll — we already know the instant
      // Last.fm's data changed (we're the ones changing it), so invalidate
      // right away instead of leaving the sidebar to catch up on its own.
      const refreshRecentlyPlayed = () => queryClient.invalidateQueries({ queryKey: ["lastfm-recent-tracks"] });
      if (submission) {
        api.lastfmScrobble(meta, Math.floor(Date.now() / 1000), serverId).then(refreshRecentlyPlayed).catch(() => {});
      } else {
        // No cache-poking here (an earlier attempt tried optimistically
        // writing into the "lastfm-recent-tracks" query cache directly) — the
        // pre-existing 30s refetchInterval on that query runs on its own
        // independent timer, unaffected by a manual setQueryData call, and can
        // clobber an optimistic write with still-lagging server data at any
        // point in its own cycle. LeftPanel.tsx instead derives the "now
        // playing" row straight from local playback state whenever this app
        // itself is the one reporting to Last.fm — zero network dependency,
        // so there's no race to lose. This call still needs to happen so
        // Last.fm's own record (and any other device reading it) is accurate.
        api.lastfmNowPlaying(meta, serverId).catch(() => {});
      }
    }
  }, 0);
}

// Purely visual (Settings > Appearance > Left Panel's "Show Recently
// Played") — deliberately still a plain global flag, not scoped per server
// like the connection/toggle state above: no account behind it, no reason
// to reset when switching profiles.
const LS_LASTFM_SIDEBAR_VISIBLE_KEY = "icosahedron_lastfm_sidebar_visible";

function loadLastFmSidebarVisible(): boolean {
  try {
    return localStorage.getItem(LS_LASTFM_SIDEBAR_VISIBLE_KEY) === "true";
  } catch {
    return false;
  }
}

const LS_LEFT_PANEL_PLAYLISTS_VISIBLE_KEY = "icosahedron_left_panel_playlists_visible";

function loadLeftPanelPlaylistsVisible(): boolean {
  try {
    const raw = localStorage.getItem(LS_LEFT_PANEL_PLAYLISTS_VISIBLE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

// A <input type="range"> fires onChange on essentially every pixel of
// movement during a drag — setCastVolume below used to send a fresh SOAP
// SetVolume call (over its own brand-new TCP connection, DLNA's
// Connection: close) for every single one of those, which turned one
// volume-slider drag into a burst of 20-30+ back-to-back requests. That's
// exactly the kind of load that's already wedged a real receiver's fragile
// embedded HTTP server (see castDlna.ts's own comments) — trailing-debounce
// it so a continuous drag sends nothing at all until movement actually
// pauses, then exactly one call with the final value; local UI state still
// updates on every event for an instantly-responsive slider.
let castVolumeSendTimer: ReturnType<typeof setTimeout> | null = null;
const CAST_VOLUME_DEBOUNCE_MS = 200;

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

  lyricsLrclibEnabled: loadLyricsSourceEnabled(LS_LYRICS_LRCLIB_ENABLED_KEY),
  setLyricsLrclibEnabled: (v) => {
    try { localStorage.setItem(LS_LYRICS_LRCLIB_ENABLED_KEY, String(v)); } catch { /* best-effort */ }
    set({ lyricsLrclibEnabled: v });
  },
  lyricsNeteaseEnabled: loadLyricsSourceEnabled(LS_LYRICS_NETEASE_ENABLED_KEY),
  setLyricsNeteaseEnabled: (v) => {
    try { localStorage.setItem(LS_LYRICS_NETEASE_ENABLED_KEY, String(v)); } catch { /* best-effort */ }
    set({ lyricsNeteaseEnabled: v });
  },
  lyricsSimpmusicEnabled: loadLyricsSourceEnabled(LS_LYRICS_SIMPMUSIC_ENABLED_KEY),
  setLyricsSimpmusicEnabled: (v) => {
    try { localStorage.setItem(LS_LYRICS_SIMPMUSIC_ENABLED_KEY, String(v)); } catch { /* best-effort */ }
    set({ lyricsSimpmusicEnabled: v });
  },

  // Real initial values come from tryAutoConnect()/connect()/switchServer()
  // hydrating the *current* server profile's Last.fm state asynchronously
  // (can't read main-process storage synchronously at store-creation time)
  // — these are just the pre-hydration defaults. Disconnecting sets this to
  // null too, via setLastfmConnection, which switches off both toggles
  // below at the same time — both require a connection to do anything, so
  // leaving them "on" with no account behind them would be a stale,
  // confusing state.
  lastfmConnected: false,
  lastfmConnectedUsername: null,
  setLastfmConnection: (conn) => set({
    lastfmConnected: conn != null,
    lastfmConnectedUsername: conn?.username ?? null,
    lastFmEnabled: conn?.historyEnabled ?? false,
    lastfmScrobbleEnabled: conn?.scrobbleEnabled ?? false,
  }),
  lastfmPublicApiKey: "",

  lastFmEnabled: false,
  setLastFmEnabled: (v) => {
    api.lastfmSetHistoryEnabled(activeLastfmKey(), v).catch(() => {});
    set({ lastFmEnabled: v });
  },

  lastFmSidebarVisible: loadLastFmSidebarVisible(),
  setLastFmSidebarVisible: (v) => {
    try { localStorage.setItem(LS_LASTFM_SIDEBAR_VISIBLE_KEY, String(v)); } catch { /* best-effort */ }
    set({ lastFmSidebarVisible: v });
  },

  leftPanelPlaylistsVisible: loadLeftPanelPlaylistsVisible(),
  setLeftPanelPlaylistsVisible: (v) => {
    try { localStorage.setItem(LS_LEFT_PANEL_PLAYLISTS_VISIBLE_KEY, String(v)); } catch { /* best-effort */ }
    set({ leftPanelPlaylistsVisible: v });
  },

  lastfmScrobbleEnabled: false,
  setLastfmScrobbleEnabled: (v) => {
    api.lastfmSetScrobbleEnabled(activeLastfmKey(), v).catch(() => {});
    set({ lastfmScrobbleEnabled: v });
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

  shareTarget: null,
  openShareDialog: (target) => set({ shareTarget: target }),
  closeShareDialog: () => set({ shareTarget: null }),

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
    api.lastfmGetConnection(activeServerId ?? LASTFM_DEFAULT_SERVER_KEY)
      .then((conn) => get().setLastfmConnection(conn)).catch(() => {});
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
    // Last.fm is scoped per server profile — the newly-active profile's own
    // connection/toggle state (or none at all) replaces whatever the
    // previous profile had, exactly like everything else this function
    // already resets on switch.
    api.lastfmGetConnection(id).then((conn) => get().setLastfmConnection(conn)).catch(() => {});
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

  setServerLibrary: async (id, folderIds, folderNames) => {
    await api.setServerLibrary(id, folderIds, folderNames);
    set((s) => ({
      servers: s.servers.map((x) => x.id === id ? { ...x, musicFolderIds: folderIds, musicFolderNames: folderNames } : x),
    }));
    // Active server: the main-process client already switched folders —
    // every cached list is now from the wrong library, so refetch it all.
    if (get().activeServerId === id) queryClient.clear();
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
  // True once stop() has torn down the native sink entirely (as opposed to
  // merely pausing it) — playPause() needs this to know a plain resume()
  // call would be a no-op and it must restart playback via playTrack instead.
  _stopped: false,
  queueSyncBusy: false,
  castDevices: [],
  castScanning: false,
  castConnecting: false,
  castConnectError: null,
  castConnected: false,
  castDevice: null,
  castVolume: 100,

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
      scrobble(prevTrack, true);
    }

    // manual=true: bypasses the gapless pre-chain hit and starts immediately
    // (this is always a user-initiated action — auto-advance never calls
    // playTrack, see handleAudioEvent's "track_switched" case, which has its
    // own matching cast-relay call since it can't reach this one). Local
    // playback always gets this call — casting is a second, independent
    // output alongside it (not a takeover), so a connected cast session
    // additionally gets the same track relayed, never instead of local.
    api.audioPlay(track.stream_url, volume / 100, track.duration_secs, true, false).catch(() => {});
    if (get().castConnected) {
      api.castPlayTrack({
        trackId: track.id, title: track.title, artist: track.artist,
        coverId: track.cover_id, format: track.format, positionSecs: 0,
      }).catch(() => {});
    }
    scrobble(track, false);

    set({
      queue: resolvedQueue,
      currentIndex: idx,
      playing: true,
      ...positionPatch(0),
      duration: track.duration_secs || 0,
      _committedNext: null,
      _committedNextIndex: null,
      _chainedForTrackId: null,
      _stopped: false,
    });
  },

  playPause: () => {
    const { playing, castConnected, _stopped, queue, currentIndex, playTrack } = get();
    // stop() tears down the native sink entirely — resume() is a no-op
    // against a torn-down sink, so a plain pause/resume toggle here would
    // silently do nothing after Stop. Restart properly instead.
    if (!playing && _stopped) {
      const track = queue[currentIndex];
      if (track) playTrack(track, queue);
      return;
    }
    if (playing) api.audioPause(); else api.audioResume();
    if (castConnected) { if (playing) api.castPause(); else api.castResume(); }
    set({ playing: !playing });
  },

  stop: () => {
    api.audioStop();
    if (get().castConnected) api.castStop();
    set({ playing: false, _stopped: true, ...positionPatch(0) });
  },

  next: () => {
    const { queue, currentIndex, shuffle, repeat, playTrack } = get();
    const picked = computeNextTrack(queue, currentIndex, shuffle, repeat);
    if (picked) playTrack(picked.track, queue);
  },

  prev: () => {
    const { queue, currentIndex, currentTime, castConnected, playTrack } = get();
    if (currentTime > 3) {
      api.audioSeek(0);
      if (castConnected) api.castSeek(0);
      set(positionPatch(0));
      return;
    }
    const prevTrack = queue[currentIndex - 1];
    if (prevTrack) playTrack(prevTrack, queue);
  },

  setCurrentTime: (secs) => {
    api.audioSeek(secs);
    if (get().castConnected) api.castSeek(secs);
    set(positionPatch(secs));
  },

  // Local-only — the connected cast device (if any) has its own independent
  // volume, setCastVolume below, same as "This device" vs. each device
  // getting its own slider in CastPicker.tsx.
  setVolume: (v) => {
    const clamped = Math.max(0, Math.min(100, v));
    api.audioSetVolume(clamped / 100);
    set({ volume: clamped });
  },

  setCastVolume: (v) => {
    const clamped = Math.max(0, Math.min(100, v));
    set({ castVolume: clamped });
    if (castVolumeSendTimer) clearTimeout(castVolumeSendTimer);
    castVolumeSendTimer = setTimeout(() => {
      castVolumeSendTimer = null;
      api.castSetVolume(clamped / 100);
    }, CAST_VOLUME_DEBOUNCE_MS);
  },

  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
  toggleRepeat:  () => set((s) => ({ repeat:  !s.repeat  })),

  clearQueue: () => {
    api.audioStop();
    set({
      queue: [], currentIndex: -1, playing: false, ...positionPatch(0), duration: 0,
      _committedNext: null, _committedNextIndex: null, _chainedForTrackId: null, _stopped: true,
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
        _committedNext: null, _committedNextIndex: null, _chainedForTrackId: null, _stopped: true,
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

  saveQueueToServer: async () => {
    const { queue, currentIndex, currentTime } = get();
    if (!queue.length) return;
    set({ queueSyncBusy: true });
    try {
      await api.savePlayQueue(queue.map((t) => t.id), queue[currentIndex]?.id ?? null, currentTime);
    } finally {
      set({ queueSyncBusy: false });
    }
  },

  // Same "primed and ready, paused" landing state as restoreSession/
  // loadRandomTrack above — start_paused=true then seek, so the engine never
  // audibly blips through position 0 before jumping to the saved position.
  restoreQueueFromServer: async () => {
    set({ queueSyncBusy: true });
    try {
      const saved = await api.getPlayQueue();
      if (!saved || !saved.tracks.length) return;
      const idx = saved.currentIndex >= 0 && saved.currentIndex < saved.tracks.length ? saved.currentIndex : 0;
      const track = saved.tracks[idx];
      const { volume } = get();
      set({
        queue: saved.tracks, currentIndex: idx, playing: false,
        ...positionPatch(saved.positionSecs), duration: track.duration_secs || 0,
        _committedNext: null, _committedNextIndex: null, _chainedForTrackId: null,
      });
      await api.audioPlay(track.stream_url, volume / 100, track.duration_secs, true, true)
        .then(() => api.audioSeek(saved.positionSecs))
        .catch(() => {});
    } finally {
      set({ queueSyncBusy: false });
    }
  },

  discoverCastDevices: async () => {
    const devices = await api.castDiscover().catch(() => []);
    set({ castDevices: devices });
  },

  // Fire-and-forget — the actual result arrives via the existing
  // onCastDevices push (above) once the scan resolves, same as it already
  // did for the old auto-rescan-on-open behavior, just user-triggered now.
  rescanCastDevices: async () => {
    await api.castRescan().catch(() => {});
  },

  // castConnected/castDevice flip once handleCastEvent sees the "connected"
  // push from castManager.ts (below) — not set optimistically here, so the
  // store never claims a session exists that the main process didn't
  // actually confirm.
  connectCast: async (deviceId) => {
    set({ castConnecting: true, castConnectError: null });
    try {
      await api.castConnect(deviceId);
      const { queue, currentIndex, currentTime } = get();
      const track = queue[currentIndex];
      if (track) {
        await api.castPlayTrack({
          trackId: track.id, title: track.title, artist: track.artist,
          coverId: track.cover_id, format: track.format, positionSecs: currentTime,
        }).catch(() => {});
      }
    } catch (err) {
      // api.castConnect's rejection used to propagate uncaught out of this
      // action (CastPicker's onConnect={connectCast} has no .catch of its
      // own) — silent from the user's POV, which just reads as the picker
      // not responding to the click at all.
      set({ castConnectError: err instanceof Error ? err.message : "Couldn't connect to that device" });
    } finally {
      set({ castConnecting: false });
    }
  },

  disconnectCast: async () => {
    await api.castDisconnect().catch(() => {});
    // Doesn't touch `playing` — local playback runs independently of the
    // cast session now, so disconnecting has no effect on it either way.
    set({ castConnected: false, castDevice: null, castConnectError: null });
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
      if (finishedTrack) scrobble(finishedTrack, true);
      if (committed) scrobble(committed, false);
      // Gapless auto-advance never goes through playTrack (this event *is*
      // the advance — local has already started the new track by the time
      // this fires), so it needs its own cast-relay call to keep a
      // connected device following along. No gapless equivalent exists on
      // the cast side (loadMedia is a discrete "load and play" call, not a
      // preloaded chain), so there's an inherent brief gap here that local
      // playback doesn't have — same limitation the old app's single-
      // track-at-a-time relay design already accepted.
      if (s.castConnected) {
        const newTrack = s.queue[newIndex];
        if (newTrack) {
          api.castPlayTrack({
            trackId: newTrack.id, title: newTrack.title, artist: newTrack.artist,
            coverId: newTrack.cover_id, format: newTrack.format, positionSecs: 0,
          }).catch(() => {});
        }
      }
      break;
    }
    case "ended": {
      // Only reached at true queue exhaustion — chain commits happen ~30s
      // ahead, so there's nothing left to advance to. The track that just
      // ended played out in full, so it always counts as a real play.
      const finishedTrack = s.queue[s.currentIndex];
      if (finishedTrack) scrobble(finishedTrack, true);
      if (s.castConnected) api.castStop();
      // The sink played out its source fully — same "resume() is a no-op"
      // situation stop() leaves behind, so playPause() must restart via
      // playTrack rather than resume.
      useStore.setState({ playing: false, _stopped: true });
      break;
    }
    case "error": {
      console.error("[audio]", payload.message);
      useStore.setState({ playing: false, _stopped: true });
      break;
    }
  }
}

window.electronAPI.onAudioEvent(handleAudioEvent);

// Reconciles the single active cast session's state, pushed from
// castManager.ts — structured like handleAudioEvent above (module-scope,
// reads/writes via useStore directly, since it runs outside any
// component/action context). `playing`/`currentTime`/`duration` stay
// local-engine-authoritative throughout (see handleAudioEvent above) — cast
// is a second, independent output, not a takeover, so its own reported
// transport state only ever updates castVolume here, never the shared
// playback-position fields local's own scrubber/play-pause icon reflect.
function handleCastEvent(payload: CastPush) {
  switch (payload.kind) {
    case "connected":
      useStore.setState({ castConnected: true, castDevice: payload.device });
      break;
    case "status":
      useStore.setState({ castVolume: Math.round(payload.volume * 100) });
      break;
    case "ended":
      // Deliberately a no-op — local's own track_switched/ended handling
      // (handleAudioEvent above) already drives queue advancement and
      // relays the next track to cast itself. Reacting to the *device's*
      // end-of-track here too would double-advance the queue whenever the
      // two happen to finish within the same tick of each other.
      break;
    case "disconnected":
    case "error":
      if (payload.kind === "error") console.error("[cast]", payload.message);
      // Doesn't touch `playing` — local keeps running unaffected by the
      // cast session dropping.
      useStore.setState({ castConnected: false, castDevice: null });
      break;
  }
}

window.electronAPI.onCastStatus(handleCastEvent);

// Live-refreshes the picker's device list when castManager.ts's background
// rescan (triggered by discoverCastDevices finding its cache stale) resolves
// — the picker itself doesn't need to be open/polling for this.
window.electronAPI.onCastDevices((devices) => useStore.setState({ castDevices: devices }));
window.electronAPI.onCastScanning((scanning) => useStore.setState({ castScanning: scanning }));

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
  api.lastfmPublicApiKey().then((key) => useStore.setState({ lastfmPublicApiKey: key })).catch(() => {});
  // Last.fm is scoped per server profile (electron/main/lastfmSession.ts) —
  // hydrate as soon as the active profile id is known, independent of
  // tryAutoConnectSaved's slower network ping to Navidrome below (that one
  // might fail or find nothing; Last.fm's own state shouldn't wait on it).
  const activeServerIdPromise = api.getActiveServerId();
  activeServerIdPromise.then((activeServerId) =>
    api.lastfmGetConnection(activeServerId ?? LASTFM_DEFAULT_SERVER_KEY)
  ).then((conn) => useStore.getState().setLastfmConnection(conn)).catch(() => {});
  const [result, activeServerId] = await Promise.all([api.tryAutoConnectSaved(), activeServerIdPromise]);
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
