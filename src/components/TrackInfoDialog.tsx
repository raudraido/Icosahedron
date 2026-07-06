import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Track, fmtDuration, api } from "../lib/api";
import { Icon } from "./Icon";
import { ArtistTokens } from "./ArtistTokens";
import { AlbumLink } from "./AlbumLink";

interface Props {
  track: Track;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ width: 110, flexShrink: 0, color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{label}</span>
      <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

// Album artist / Artists: clickable, bold + accent (matches the old app's link
// styling). Reuses ArtistTokens for the multi-artist split/navigate logic —
// same component TrackTable/Albums use for artist names elsewhere. Album
// artist has no known id, so it always goes through ArtistTokens' by-name
// search fallback (same path multi-artist tokens already use).
function ArtistRow({ label, name, artistId, onNavigate }: { label: string; name: string | null | undefined; artistId: string | null; onNavigate: () => void }) {
  if (!name) return null;
  return (
    <div className="flex" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ width: 110, flexShrink: 0, color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{label}</span>
      <div style={{ fontWeight: 700 }}>
        <ArtistTokens name={name} artistId={artistId} fontSize="var(--fs-secondary)" alwaysAccent onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function AlbumRow({ name, albumId, onNavigate }: { name: string | null | undefined; albumId: string | null; onNavigate: () => void }) {
  if (!name) return null;
  return (
    <div className="flex" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ width: 110, flexShrink: 0, color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>Album</span>
      <div style={{ fontWeight: 700, wordBreak: "break-word" }}>
        <AlbumLink name={name} albumId={albumId} alwaysAccent onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function BoolRow({ label, value }: { label: string; value: boolean | undefined }) {
  if (value === undefined) return null;
  return (
    <div className="flex items-center" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ width: 110, flexShrink: 0, color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{label}</span>
      <Icon src={value ? "img/yes.png" : "img/no.png"} size={14} style={{ background: value ? "#4caf50" : "#f44336" }} />
    </div>
  );
}

function PathRow({ path }: { path: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!path) return null;

  function handleCopy() {
    navigator.clipboard.writeText(path!);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>Path</span>
      <div className="flex items-center" style={{ gap: 6, marginTop: 4 }}>
        <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)", wordBreak: "break-all", flex: 1 }}>{path}</span>
        <button
          onClick={handleCopy}
          title={copied ? "Copied!" : "Copy path"}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 }}
        >
          <Icon src={copied ? "img/yes.png" : "img/copy-path.png"} size={14} style={{ background: copied ? "#4caf50" : "var(--accent)" }} />
        </button>
      </div>
    </div>
  );
}

function fmtSize(bytes: number | null): string | null {
  if (!bytes) return null;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function TrackInfoDialog({ track, onClose }: Props) {
  const { data: full } = useQuery({
    queryKey: ["track-info", track.id],
    queryFn: () => api.getTrackInfo(track.id),
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "color-mix(in srgb, black 40%, transparent)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--main-bg)", border: "1px solid var(--border)", borderRadius: 10,
          width: 420, maxHeight: "80vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 32px color-mix(in srgb, black 30%, transparent)",
        }}
      >
        <div className="flex items-center" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ flex: 1, color: "var(--text-primary)", fontSize: "var(--fs-heading)", fontWeight: 700 }}>{track.title}</h3>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}
          >
            <Icon src="img/sub_close.png" size={16} style={{ background: "var(--text-secondary)" }} />
          </button>
        </div>

        <div className="scroll-clean" style={{ padding: "4px 20px 20px", overflowY: "auto" }}>
          <Row label="Title" value={track.title} />
          <PathRow path={full?.path} />
          <ArtistRow label="Album artist" name={full?.album_artist} artistId={null} onNavigate={onClose} />
          <ArtistRow label="Artists" name={track.artist} artistId={track.artist_id} onNavigate={onClose} />
          <AlbumRow name={track.album} albumId={track.album_id} onNavigate={onClose} />
          <Row label="Disc" value={track.disc_number} />
          <Row label="Track" value={track.track_number} />
          <Row label="Release year" value={track.year} />
          <Row label="Genres" value={track.genre} />
          <Row label="Duration" value={fmtDuration(track.duration_secs)} />
          <BoolRow label="Is compilation" value={full?.is_compilation} />
          <Row label="Codec" value={full?.codec} />
          <Row label="BPM ID3Tag" value={track.bpm} />
          {/* No on-device BPM analysis in this build (the old app's "BPM Detected" comes
              from a live audio-engine DSP pass during playback, not server data) — always "—". */}
          <Row label="BPM Detected" value="—" />
          <Row label="Bitrate" value={track.bitrate ? `${track.bitrate} kbps` : null} />
          <Row label="Sample rate" value={full?.sample_rate} />
          <Row label="Bit depth" value={full?.bit_depth} />
          <Row label="Channels" value={full?.channel_count} />
          <Row label="Size" value={fmtSize(full?.size_bytes ?? null)} />
          <BoolRow label="Favorite" value={track.starred} />
          <Row label="Play count" value={track.play_count} />
          <Row label="Modified" value={track.created} />
          <Row label="Id" value={track.id} />
        </div>
      </div>
    </div>
  );
}
