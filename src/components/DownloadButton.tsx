import { useState } from "react";
import { Track, DownloadCollectionInfo } from "../lib/api";
import { useDownloads } from "../lib/downloads";
import { Icon } from "./Icon";

/**
 * Download / Remove Download for the songs of an album or a playlist (desktop only: it is not drawn in the
 * browser). Lit when everything is downloaded; the songs are fetched into the folder in the background.
 */
export function DownloadButton({ tracks, collection, size = 20 }: { tracks: Track[]; collection?: DownloadCollectionInfo; size?: number }) {
  const supported = useDownloads((s) => s.supported);
  const ids = useDownloads((s) => s.ids);
  const collections = useDownloads((s) => s.collections);
  const pending = useDownloads((s) => s.pending);
  const download = useDownloads((s) => s.download);
  const removeCollection = useDownloads((s) => s.removeCollection);
  const removeTracks = useDownloads((s) => s.removeTracks);
  const [hover, setHover] = useState(false);
  if (!supported) return null;

  const kept = collection ? collections.some((c) => c.kind === collection.kind && c.id === collection.id) : tracks.length > 0 && tracks.every((t) => ids.has(t.id));
  const busy = pending > 0 && tracks.some((t) => !ids.has(t.id)) && kept;
  const title = busy ? "Downloading…" : kept ? "Remove Download" : "Download";

  return (
    <button
      onClick={() => {
        if (kept) void (collection ? removeCollection(collection.kind, collection.id) : removeTracks(tracks.map((t) => t.id)));
        else void download(tracks, collection ?? null);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      disabled={tracks.length === 0}
      style={{
        width: 40, height: 40, borderRadius: 8, border: "none", cursor: tracks.length ? "pointer" : "default",
        background: hover ? "var(--hover-bg)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 150ms", opacity: busy ? 0.6 : 1,
      }}
    >
      <Icon src="img/download.png" size={size} style={{ background: kept ? "var(--accent)" : "var(--text-secondary)" }} />
    </button>
  );
}
