import { useState } from "react";
import { ChevronDown, ListMusic, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { useStore } from "../store";
import { fmtDuration } from "../lib/api";
import { DevicePicker } from "../components/DevicePicker";

// Full-screen player for phones, opened from the mini player: big cover, seek
// bar, transport controls, and the queue one tap away.
export function MobilePlayer({ onClose }: { onClose: () => void }) {
  const queue = useStore((s) => s.queue);
  const index = useStore((s) => s.currentIndex);
  const playing = useStore((s) => s.playing);
  const time = useStore((s) => s.currentTime);
  const duration = useStore((s) => s.duration);
  const shuffle = useStore((s) => s.shuffle);
  const repeat = useStore((s) => s.repeat);
  const coverUrl = useStore((s) => s.coverUrl);
  const { playPause, next, prev, setCurrentTime, toggleShuffle, toggleRepeat, playTrack } = useStore.getState();
  const [showQueue, setShowQueue] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const track = queue[index];

  const shown = drag ?? time;
  const icon = (on: boolean) => ({ color: on ? "var(--accent)" : "var(--text-secondary)" });
  const btn = { background: "transparent", border: "none", cursor: "pointer", padding: 10, display: "flex", color: "var(--text-primary)" } as const;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 8000, display: "flex", flexDirection: "column",
        background: "var(--main-bg)", color: "var(--text-primary)",
        paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", padding: "8px 8px 0", gap: 8 }}>
        <button style={btn} onClick={onClose} aria-label="Close"><ChevronDown size={28} /></button>
        <div style={{ flex: 1, textAlign: "center", fontSize: 13, color: "var(--text-secondary)" }}>Now Playing</div>
        <DevicePicker />
      </div>

      {showQueue ? (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
          {queue.map((t, i) => (
            <button
              key={`${t.id}-${i}`}
              onClick={() => playTrack(t, queue)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "10px 8px",
                border: "none", borderRadius: 8, cursor: "pointer", color: "inherit",
                background: i === index ? "color-mix(in srgb, var(--accent) 17%, transparent)" : "transparent",
              }}
            >
              <span style={{ width: 26, textAlign: "right", color: "var(--text-secondary)", fontSize: 12 }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: i === index ? "var(--accent)" : "inherit" }}>{t.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.artist}</div>
              </span>
            </button>
          ))}
          {!queue.length && <div style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)" }}>Queue is empty</div>}
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px", minHeight: 0 }}>
          <div
            style={{
              width: "min(86vw, 44vh)", aspectRatio: "1 / 1", borderRadius: 12, overflow: "hidden",
              background: "var(--card-bg)", boxShadow: "0 10px 30px rgba(0,0,0,.45)",
            }}
          >
            {track?.cover_id && (
              <img src={coverUrl(track.cover_id, 600)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            )}
          </div>
          <div style={{ width: "100%", maxWidth: 420, marginTop: 22 }}>
            <div style={{ fontSize: 20, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track?.title ?? "Nothing playing"}</div>
            <div style={{ fontSize: 15, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track?.artist ?? ""}</div>
          </div>
        </div>
      )}

      <div style={{ padding: "8px 24px 0", width: "100%", maxWidth: 468, alignSelf: "center", boxSizing: "border-box" }}>
        <input
          type="range" min={0} max={Math.max(1, duration)} step={1} value={Math.min(shown, Math.max(1, duration))}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={() => { if (drag != null) { setCurrentTime(drag); setDrag(null); } }}
          onKeyUp={() => { if (drag != null) { setCurrentTime(drag); setDrag(null); } }}
          style={{ width: "100%", accentColor: "var(--accent)", height: 28 }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-secondary)" }}>
          <span>{fmtDuration(shown)}</span><span>{fmtDuration(duration)}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 20px 14px", width: "100%", maxWidth: 468, alignSelf: "center", boxSizing: "border-box" }}>
        <button style={{ ...btn, ...icon(shuffle) }} onClick={toggleShuffle} aria-label="Shuffle"><Shuffle size={22} /></button>
        <button style={btn} onClick={prev} aria-label="Previous"><SkipBack size={30} fill="currentColor" /></button>
        <button
          onClick={playPause} aria-label={playing ? "Pause" : "Play"}
          style={{ width: 68, height: 68, borderRadius: 34, border: "none", cursor: "pointer", background: "var(--accent)", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {playing ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" style={{ marginLeft: 3 }} />}
        </button>
        <button style={btn} onClick={next} aria-label="Next"><SkipForward size={30} fill="currentColor" /></button>
        <button style={{ ...btn, ...icon(repeat) }} onClick={toggleRepeat} aria-label="Repeat"><Repeat size={22} /></button>
      </div>

      <div style={{ display: "flex", justifyContent: "center", paddingBottom: 10 }}>
        <button style={{ ...btn, ...icon(showQueue), gap: 6, fontSize: 14 }} onClick={() => setShowQueue((v) => !v)}>
          <ListMusic size={20} /> Queue
        </button>
      </div>
    </div>
  );
}
