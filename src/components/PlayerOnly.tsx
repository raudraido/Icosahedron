import { useState } from "react";
import { useStore } from "../store";
import { useSync } from "../lib/sync";
import { CoverArt } from "./CoverArt";

// Jukebox player: open the app with ?player=1 on a screen that only plays
// (a tablet, a kiosk browser, a spare PC) and control it from any other device
// through the sync devices list. It shows what is playing and nothing else.
//
// Browsers only let a page start audio after the user has touched it once, so
// the first thing it asks for is one tap; after that remote "play" works.
export const isPlayerMode = () => new URLSearchParams(location.search).has("player");

export function PlayerOnly() {
  const [armed, setArmed] = useState(false);
  const track = useStore((s) => s.queue[s.currentIndex]);
  const playing = useStore((s) => s.playing);
  const queue = useStore((s) => s.queue);
  const index = useStore((s) => s.currentIndex);
  const upNext = queue.slice(index + 1, index + 6);
  const queueLength = queue.length;
  const status = useSync((s) => s.status);

  return (
    <div className="flex h-screen flex-col items-center justify-center text-center" style={{ background: "var(--main-bg)", color: "var(--text-primary)", gap: 16, padding: 24 }}>
      {track ? (
        <>
          <CoverArt coverId={track.cover_id ?? null} size={360} style={{ width: "min(70vw, 60vh)", height: "min(70vw, 60vh)", borderRadius: 12 }} />
          <div style={{ fontSize: 28, fontWeight: 600 }}>{track.title}</div>
          <div style={{ fontSize: 18, color: "var(--text-secondary)" }}>{track.artist}</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{playing ? "Playing" : "Paused"}</div>
        </>
      ) : (
        <div style={{ fontSize: 20, color: "var(--text-secondary)" }}>Jukebox ready. Send music here from another device.</div>
      )}
      {upNext.length > 0 && (
        <div style={{ width: "min(90vw, 480px)", textAlign: "left" }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>Up next ({queueLength - index - 1} in queue)</div>
          {upNext.map((t, i) => (
            <div key={`${t.id}-${i}`} style={{ fontSize: 14, padding: "2px 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {t.title} <span style={{ color: "var(--text-secondary)" }}>· {t.artist}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        {status === "online" ? "Connected" : status === "connecting" ? "Connecting…" : "Sync offline"}
      </div>
      {/* Only while the browser could still block audio: nothing playing yet and the page never touched. */}
      {!armed && !playing && !(navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive && (
        <button
          onClick={() => setArmed(true)}
          className="absolute inset-0"
          style={{ background: "color-mix(in srgb, var(--main-bg) 92%, transparent)", border: "none", color: "var(--accent)", fontSize: 24, cursor: "pointer" }}
        >Tap once to enable audio</button>
      )}
    </div>
  );
}
