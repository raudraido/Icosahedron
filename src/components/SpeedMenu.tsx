import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useStore, SPEED_MIN, SPEED_MAX } from "../store";
import { platform } from "../platform";

// Playback speed: presets, a slider and Reset, opened from the button in the footer bar (local to this device).
const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const speedLabel = (v: number) => `${Number(v.toFixed(2))}×`;

export function SpeedMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const speed = useStore((s) => s.playbackSpeed);
  const set = useStore((s) => s.setPlaybackSpeed);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const chip = (active: boolean) => ({
    padding: "4px 9px", borderRadius: 6, cursor: "pointer", fontSize: "var(--fs-secondary)",
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, background: active ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-primary)",
  }) as const;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed", left: x, top: y - 8, transform: "translate(-50%, -100%)", zIndex: 2500, width: 280,
        background: "var(--main-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 14,
        boxShadow: "0 6px 20px color-mix(in srgb, black 30%, transparent)",
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
        <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-primary)", fontWeight: "var(--fw-emphasis)" }}>Speed {speedLabel(speed)}</span>
        <button onClick={() => set(1)} disabled={speed === 1} style={{ ...chip(false), opacity: speed === 1 ? 0.4 : 1 }}>Reset</button>
      </div>
      <input
        type="range" min={SPEED_MIN} max={SPEED_MAX} step={0.05} value={speed}
        onChange={(e) => set(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--accent)" }}
      />
      <div className="flex" style={{ gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {PRESETS.map((p) => <button key={p} onClick={() => set(p)} style={chip(Math.abs(speed - p) < 0.001)}>{speedLabel(p)}</button>)}
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)", lineHeight: 1.5, marginTop: 10 }}>
        {platform.kind === "electron"
          ? "On the desktop the pitch changes with the speed. Keyboard: Alt+Up / Alt+Down."
          : "The pitch stays the same. Keyboard: Alt+Up / Alt+Down."}
      </div>
    </div>,
    document.body,
  );
}
