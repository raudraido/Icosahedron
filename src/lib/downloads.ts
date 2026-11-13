import { create } from "zustand";
import { api, Track, DownloadCollection, DownloadCollectionInfo } from "./api";
import { platform } from "../platform";

// What is kept on this computer (desktop only; electron/main/downloads.ts holds the files). The screens ask
// this store whether a song is downloaded and tell it to download or remove; while something is still
// downloading it asks again every second and a half so the counts follow.

interface DownloadsStore {
  /** Only the desktop app keeps downloads. */
  supported: boolean;
  ids: Set<string>;
  collections: DownloadCollection[];
  bytes: number;
  pending: number;
  refresh: () => Promise<void>;
  has: (id: string) => boolean;
  hasCollection: (kind: string, id: string) => boolean;
  download: (tracks: Track[], collection?: DownloadCollectionInfo | null) => Promise<void>;
  removeTracks: (ids: string[]) => Promise<void>;
  removeCollection: (kind: string, id: string) => Promise<void>;
  removeAll: () => Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useDownloads = create<DownloadsStore>((set, get) => ({
  supported: platform.kind === "electron",
  ids: new Set(),
  collections: [],
  bytes: 0,
  pending: 0,

  refresh: async () => {
    if (!get().supported) return;
    try {
      const s = await api.downloadsState();
      set({ ids: new Set(s.ids), collections: s.collections, bytes: s.bytes, pending: s.pending });
      if (timer) { clearTimeout(timer); timer = null; }
      if (s.pending > 0) timer = setTimeout(() => { timer = null; void get().refresh(); }, 1500);
    } catch { /* no downloads module (a web build, an old main process): nothing to show */ }
  },

  has: (id) => get().ids.has(id),
  hasCollection: (kind, id) => get().collections.some((c) => c.kind === kind && c.id === id),

  download: async (tracks, collection = null) => {
    if (!tracks.length) return;
    await api.downloadsAdd(tracks, collection);
    await get().refresh();
  },
  removeTracks: async (ids) => {
    for (const id of ids) await api.downloadsRemoveTrack(id);
    await get().refresh();
  },
  removeCollection: async (kind, id) => {
    await api.downloadsRemoveCollection(kind, id);
    await get().refresh();
  },
  removeAll: async () => {
    await api.downloadsRemoveAll();
    await get().refresh();
  },
}));

/** "1.4 GB" */
export function formatBytes(n: number): string {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  return `${Math.round(n / 1048576)} MB`;
}
