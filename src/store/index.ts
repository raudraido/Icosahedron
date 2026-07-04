import { create } from "zustand";
import { api, Track, Album } from "../lib/api";

export type Tab = "albums" | "artists" | "tracks" | "playlists" | "starred";

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
}

const STORAGE_KEY = "icosahedron_creds";

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
}));

// Auto-reconnect on startup if creds saved
export async function tryAutoConnect() {
  const creds = loadCreds();
  if (creds) {
    try {
      await useStore.getState().connect(creds.url, creds.user, creds.pass);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}
