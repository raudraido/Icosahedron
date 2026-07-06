import { create } from "zustand";
import { api, AudioEventPayload, Track, Album, Playlist } from "../lib/api";
import type { QueueTab } from "../components/QueueBottomTabs";

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
};

interface AppStore {
  // connection
  connected: boolean;
  serverUrl: string;
  username: string;
  connect: (url: string, user: string, pass: string, remember: boolean) => Promise<void>;

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
  restoreSession: () => void;
}

const SESSION_KEY = "icosahedron_session";

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

export const useStore = create<AppStore>((set, get) => ({
  connected: false,
  serverUrl: "",
  username: "",
  coverUrl: () => "",

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

  // `remember` matches the old app's "Remember my credentials" checkbox
  // (login_dialog.py/main.py): url+username are non-secret, but the
  // password is only ever persisted through the OS-backed secret store
  // (electron/main/credentials.ts), never in localStorage — and only at
  // all if the user opts in. Unchecking explicitly wipes any previously
  // saved credentials, same as the old app's keyring.delete_password branch.
  connect: async (url, user, pass, remember) => {
    await api.connect(url, user, pass);
    if (remember) {
      await api.saveCredentials(url, user, pass);
    } else {
      await api.clearCredentials();
    }
    set({
      connected: true,
      serverUrl: url,
      username: user,
      coverUrl: (coverId, size = 200) =>
        coverId ? `cover://localhost/${encodeURIComponent(coverId)}?size=${size}` : "",
    });
    get().loadBpmCache();
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
  duration: 0,
  _committedNext: null,
  _committedNextIndex: null,
  _chainedForTrackId: null,

  playTrack: (track, queue) => {
    const resolvedQueue = queue ?? [track];
    const idx = resolvedQueue.findIndex((t) => t.id === track.id);
    const { volume } = get();

    // manual=true: bypasses the gapless pre-chain hit and starts immediately
    // (this is always a user-initiated action — auto-advance never calls
    // playTrack, see handleAudioEvent's "track_switched" case).
    api.audioPlay(track.stream_url, volume / 100, track.duration_secs, true, false).catch(() => {});
    api.scrobble(track.id, false).catch(() => {});

    set({
      queue: resolvedQueue,
      currentIndex: idx,
      playing: true,
      currentTime: 0,
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
    set({ playing: false, currentTime: 0 });
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
      set({ currentTime: 0 });
      return;
    }
    const prevTrack = queue[currentIndex - 1];
    if (prevTrack) playTrack(prevTrack, queue);
  },

  setCurrentTime: (secs) => {
    api.audioSeek(secs);
    set({ currentTime: secs });
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
      queue: [], currentIndex: -1, playing: false, currentTime: 0, duration: 0,
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
        queue: next, currentIndex: -1, playing: false, currentTime: 0, duration: 0,
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
    const { queue, currentIndex, currentTime } = get();
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ queue, currentIndex, positionSecs: currentTime }));
    } catch { /* ignore quota/serialization errors — losing the session is non-fatal */ }
  },

  restoreSession: () => {
    let saved: { queue: Track[]; currentIndex: number; positionSecs: number } | null = null;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch { saved = null; }
    if (!saved || !saved.queue.length || saved.currentIndex < 0 || saved.currentIndex >= saved.queue.length) return;

    const track = saved.queue[saved.currentIndex];
    const { volume } = get();

    set({
      queue: saved.queue, currentIndex: saved.currentIndex, playing: false,
      currentTime: saved.positionSecs, duration: track.duration_secs || 0,
      _committedNext: null, _committedNextIndex: null, _chainedForTrackId: null,
    });

    // start_paused=true: the engine sits paused at position 0 until the
    // explicit seek below — avoids the audible blip a naive play-then-pause
    // would cause on a real device.
    api.audioPlay(track.stream_url, volume / 100, track.duration_secs, true, true)
      .then(() => api.audioSeek(saved!.positionSecs))
      .catch(() => {});
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
      const currentTime = Math.floor(payload.currentTime ?? 0);
      const duration = Math.floor(payload.duration ?? 0);
      useStore.setState({ currentTime, duration });

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
        currentTime: 0,
        duration,
        playing: true,
        _committedNext: null,
        _committedNextIndex: null,
        _chainedForTrackId: null,
      });
      if (committed) api.scrobble(committed.id, false).catch(() => {});
      break;
    }
    case "ended": {
      // Only reached at true queue exhaustion — chain commits happen ~30s
      // ahead, so there's nothing left to advance to.
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
    if (url && user && pass) await api.saveCredentials(url, user, pass);
  } catch {
    // best-effort — worst case the user just has to log in again
  } finally {
    try { localStorage.removeItem("icosahedron_creds"); } catch { /* best-effort */ }
  }
})();

// Auto-reconnect on startup if credentials were saved (main process handles
// the whole thing — reads the encrypted file, decrypts, pings — the
// plaintext password never comes back over IPC here, matching main.py's
// "trust saved credentials and open immediately" step).
export async function tryAutoConnect() {
  const result = await api.tryAutoConnectSaved();
  if (!result) return;
  useStore.setState({
    connected: true,
    serverUrl: result.url,
    username: result.username,
    coverUrl: (coverId, size = 200) =>
      coverId ? `cover://localhost/${encodeURIComponent(coverId)}?size=${size}` : "",
  });
  try {
    useStore.getState().restoreSession();
  } catch { /* a failed session restore shouldn't be treated as a bad-credentials error */ }
}
