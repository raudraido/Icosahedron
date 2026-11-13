import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, Track, DownloadCollection } from "../lib/api";
import { useStore } from "../store";
import { useDownloads, formatBytes } from "../lib/downloads";
import { CoverArt } from "../components/CoverArt";
import { TrackTable } from "../components/TrackTable";

// Songs, albums and playlists kept on this computer (electron/main/downloads.ts). Everything here is read from the
// computer, so the screen works without the server: the songs play from the local files.

function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Pill({ label, onClick, accent }: { label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 32, padding: "0 14px", borderRadius: 16, cursor: "pointer", fontSize: "var(--fs-secondary)",
        border: accent ? "none" : "1px solid var(--border)",
        background: accent ? "var(--accent)" : "transparent",
        color: accent ? "var(--on-accent, #111)" : "var(--text-primary)",
      }}
    >
      {label}
    </button>
  );
}

function CollectionRow({ c }: { c: DownloadCollection }) {
  const playTrack = useStore((s) => s.playTrack);
  const removeCollection = useDownloads((s) => s.removeCollection);
  const ids = useDownloads((s) => s.ids);
  // The songs of this album or playlist that have arrived so far
  const here = c.tracks.filter((t) => ids.has(t.id));
  return (
    <div className="flex items-center" style={{ gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <CoverArt coverId={c.cover_id} size={56} className="rounded-md" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "var(--text-primary)", fontSize: "var(--fs-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
        <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>
          {c.kind === "album" ? "Album" : "Playlist"} · {here.length}{here.length < c.tracks.length ? ` of ${c.tracks.length}` : ""} songs{c.subtitle && c.kind === "album" ? ` · ${c.subtitle}` : ""}
        </div>
      </div>
      <Pill label="Play" accent onClick={() => here.length && playTrack(here[0], here as Track[])} />
      <Pill label="Shuffle" onClick={() => { const s = shuffled(here); if (s.length) playTrack(s[0], s as Track[]); }} />
      <Pill label="Remove" onClick={() => void removeCollection(c.kind, c.id)} />
    </div>
  );
}

export function Downloads() {
  const playTrack = useStore((s) => s.playTrack);
  const { supported, ids, collections, bytes, pending, refresh, removeAll } = useDownloads();
  useEffect(() => { void refresh(); }, [refresh]);

  const { data: tracks = [], isLoading } = useQuery({
    queryKey: ["downloads-tracks", ids.size],
    queryFn: () => api.downloadsTracks(),
    enabled: supported,
  });

  if (!supported) {
    return <div style={{ padding: 24, color: "var(--text-secondary)" }}>Downloads are kept by the desktop app. The browser does not keep music for later.</div>;
  }

  return (
    <div className="flex flex-col" style={{ height: "100%", minHeight: 0, padding: "12px 16px", gap: 12 }}>
      <div className="flex items-center" style={{ gap: 10, flexWrap: "wrap" }}>
        <div style={{ color: "var(--text-primary)", fontSize: "var(--fs-title)", fontWeight: 600 }}>Downloads</div>
        <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", flex: 1 }}>
          {ids.size} songs · {formatBytes(bytes)}{pending > 0 ? ` · downloading ${pending} more…` : ""}
        </div>
        <Pill label="Play" accent onClick={() => tracks.length && playTrack(tracks[0], tracks)} />
        <Pill label="Shuffle" onClick={() => { const s = shuffled(tracks); if (s.length) playTrack(s[0], s); }} />
        <Pill label="Remove all" onClick={() => { if (window.confirm("Remove every download from this computer?")) void removeAll(); }} />
      </div>

      {ids.size === 0 && pending === 0 && (
        <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>
          Nothing downloaded yet. Right-click a song, an album or a playlist and choose Download, or use the download button on an album page.
        </div>
      )}

      {collections.length > 0 && (
        <div style={{ flexShrink: 0, maxHeight: "38%", overflowY: "auto" }} className="scroll-overlay">
          <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", margin: "4px 0" }}>Albums and playlists</div>
          {collections.map((c) => <CollectionRow key={c.kind + c.id} c={c} />)}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <TrackTable tracks={tracks} loading={isLoading} viewKey="downloads" defaultSort={null} persistSort numColSource="position" />
      </div>
    </div>
  );
}
