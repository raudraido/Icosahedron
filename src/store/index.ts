import { create } from "zustand";
import { api, Track, Album } from "../lib/api";

export type Tab =
  | "home" | "nowPlaying" | "albums" | "artists" | "tracks" | "playlists" | "starred"
  | "mixBuilder" | "visualizer";

export type NavEntry = { tab: Tab; album?: Album; artistId?: string; artistQuery?: string };

interface AppStore {
  // connection
  connected: boolean;
  serverUrl: string;
  username: string;
  connect: (url: string, user: string, pass: string) => Promise<void>;

  // cover URL — synchronous, no IPC, computed once at connect
  coverUrl: (coverId: string | null, size?: number) => string;

  // navigation + back/forward history
  activeTab: Tab;
  navHistory: NavEntry[];
  navPos: number;
  setTab: (tab: Tab) => void;
  pushNav: (extra?: Omit<NavEntry, "tab">) => void;
  navigateTo: (entry: NavEntry) => void;
  navBack: () => void;
  navFwd: () => void;

  // left-panel art expand/collapse — mirrors the footer's small thumbnail
  // shrinking to 0 in lockstep (both driven by this one flag), matching the
  // old app's window._toggle_sidebar_art
  sidebarArtExpanded: boolean;
  toggleSidebarArt: () => void;

  // player
  queue: Track[];
  currentIndex: number;
  playing: boolean;
  shuffle: boolean;
  repeat: boolean;
  volume: number;
  _audio: HTMLAudioElement | null;
  currentTime: number;
  duration: number;

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

const STORAGE_KEY = "icosahedron_creds";
const SESSION_KEY = "icosahedron_session";

function loadCreds(): { url: string; user: string; pass: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const useStore = create<AppStore>((set, get) => ({
  connected: false,
  serverUrl: "",
  username: "",
  coverUrl: () => "",

  connect: async (url, user, pass) => {
    await api.connect(url, user, pass);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, user, pass }));
    set({
      connected: true,
      serverUrl: url,
      username: user,
      coverUrl: (coverId, size = 200) =>
        coverId ? `cover://localhost/${encodeURIComponent(coverId)}?size=${size}` : "",
    });
  },

  activeTab: "albums",
  navHistory: [{ tab: "albums" }],
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
    const entry: NavEntry = { tab: activeTab, album: extra?.album, artistId: extra?.artistId, artistQuery: extra?.artistQuery };
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
  _audio: null,
  currentTime: 0,
  duration: 0,

  playTrack: (track, queue) => {
    const resolvedQueue = queue ?? [track];
    const idx = resolvedQueue.findIndex((t) => t.id === track.id);

    get()._audio?.pause();
    const audio = new Audio(track.stream_url);

    audio.addEventListener("timeupdate", () =>
      set({ currentTime: Math.floor(audio.currentTime) })
    );
    audio.addEventListener("loadedmetadata", () =>
      set({ duration: Math.floor(audio.duration) })
    );
    audio.addEventListener("ended", () => get().next());

    audio.play();
    api.scrobble(track.id, false).catch(() => {});

    set({
      queue: resolvedQueue,
      currentIndex: idx,
      playing: true,
      _audio: audio,
      currentTime: 0,
      duration: 0,
    });
  },

  playPause: () => {
    const { _audio, playing } = get();
    if (!_audio) return;
    playing ? _audio.pause() : _audio.play();
    set({ playing: !playing });
  },

  stop: () => {
    const { _audio } = get();
    if (!_audio) return;
    _audio.pause();
    _audio.currentTime = 0;
    set({ playing: false, currentTime: 0 });
  },

  next: () => {
    const { queue, currentIndex, shuffle, repeat, playTrack } = get();
    if (repeat) {
      const cur = queue[currentIndex];
      if (cur) playTrack(cur, queue);
      return;
    }
    if (shuffle) {
      const next = queue[Math.floor(Math.random() * queue.length)];
      if (next) playTrack(next, queue);
      return;
    }
    const next = queue[currentIndex + 1];
    if (next) playTrack(next, queue);
  },

  prev: () => {
    const { queue, currentIndex, currentTime, _audio, playTrack } = get();
    if (currentTime > 3) {
      _audio!.currentTime = 0;
      return;
    }
    const prev = queue[currentIndex - 1];
    if (prev) playTrack(prev, queue);
  },

  setCurrentTime: (secs) => {
    const { _audio } = get();
    if (_audio) _audio.currentTime = secs;
  },

  setVolume: (v) => {
    const { _audio } = get();
    const clamped = Math.max(0, Math.min(100, v));
    if (_audio) _audio.volume = clamped / 100;
    set({ volume: clamped });
  },

  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
  toggleRepeat:  () => set((s) => ({ repeat:  !s.repeat  })),

  clearQueue: () => {
    get()._audio?.pause();
    set({ queue: [], currentIndex: -1, playing: false, _audio: null, currentTime: 0, duration: 0 });
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
    const { queue, currentIndex, _audio } = get();
    const currentTrackId = queue[currentIndex]?.id;
    const next = queue.filter((t) => t.id !== id);
    if (id === currentTrackId) {
      // The removed track was the one playing — stop rather than adopt a new one.
      _audio?.pause();
      set({ queue: next, currentIndex: -1, playing: false, _audio: null, currentTime: 0, duration: 0 });
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
    const audio = new Audio(track.stream_url);
    audio.addEventListener("timeupdate", () => set({ currentTime: Math.floor(audio.currentTime) }));
    audio.addEventListener("loadedmetadata", () => {
      set({ duration: Math.floor(audio.duration) });
      audio.currentTime = saved!.positionSecs;
    });
    audio.addEventListener("ended", () => get().next());

    set({
      queue: saved.queue, currentIndex: saved.currentIndex, playing: false,
      _audio: audio, currentTime: saved.positionSecs, duration: 0,
    });
  },
}));

// Save the session once on the way out, matching the old app's single
// closeEvent()-triggered save rather than continuously autosaving.
window.addEventListener("beforeunload", () => useStore.getState().persistSession());

// Auto-reconnect on startup if creds saved
export async function tryAutoConnect() {
  const creds = loadCreds();
  if (creds) {
    try {
      await useStore.getState().connect(creds.url, creds.user, creds.pass);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    try {
      useStore.getState().restoreSession();
    } catch { /* a failed session restore shouldn't be treated as a bad-credentials error */ }
  }
}
