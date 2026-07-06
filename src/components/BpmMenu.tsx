import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Footer BPM correction menu — ratio shortcuts (Half/2:3/3:4/4:3/3:2/Double,
// close the menu on click) plus an embedded stepper row (ported from the old
// app's `add_stepper_row`: a read-only numeric field, value only moves via
// the chevron buttons in `step` increments, each step applies immediately
// and the menu stays open so repeated stepping doesn't require reopening).
const RATIOS: [string, number][] = [
  ["Half", 0.5], ["2:3", 2 / 3], ["3:4", 0.75], ["4:3", 4 / 3], ["3:2", 1.5], ["Double", 2],
];
const STEP = 0.1;
const MIN = 20.0;
const MAX = 400.0;

const MENU_BG = "var(--main-bg)";
const MENU_SHADOW = "0 4px 16px color-mix(in srgb, var(--text-primary) 15%, transparent)";

export function BpmMenu({ x, y, bpm, onApply, onClose }: {
  x: number; y: number; bpm: number; onApply: (bpm: number) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, ready: false });
  const [value, setValue] = useState(Math.round(bpm * 10) / 10);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clampedX = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const clampedY = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    setPos({ x: clampedX, y: clampedY, ready: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  function pickRatio(factor: number) {
    onApply(Math.round(bpm * factor * 10) / 10);
    onClose();
  }

  function step(delta: number) {
    const next = Math.round(Math.min(MAX, Math.max(MIN, value + delta)) * 10) / 10;
    setValue(next);
    onApply(next);
  }

  // Portal straight onto <body> — see ContextMenu.tsx's comment: a scrolled
  // ancestor with `will-change: transform` (.scroll-clean) otherwise becomes
  // the containing block for this `position: fixed` popup instead of the
  // viewport.
  return createPortal(
    <div
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed", top: pos.y, left: pos.x, zIndex: 1000,
        visibility: pos.ready ? "visible" : "hidden",
        background: MENU_BG, border: "1px solid var(--border)",
        borderRadius: 8, padding: "8px 4px", minWidth: 200,
        boxShadow: MENU_SHADOW,
        display: "flex", flexDirection: "column", gap: 1,
      }}
    >
      {RATIOS.map(([label, factor]) => (
        <RatioRow key={label} label={label} value={bpm * factor} onClick={() => pickRatio(factor)} />
      ))}
      <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
      <div className="flex items-center" style={{ gap: 8, padding: "5px 12px" }}>
        <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-primary)" }}>Custom</span>
        <div className="flex items-center" style={{ marginLeft: "auto", gap: 6 }}>
          <span className="tabular-nums" style={{ color: "var(--text-primary)", fontSize: "var(--fs-primary)", minWidth: 48, textAlign: "right" }}>
            {value.toFixed(1)}
          </span>
          <div className="flex flex-col" style={{ gap: 1 }}>
            <Chevron dir="up" disabled={value >= MAX} onClick={() => step(STEP)} />
            <Chevron dir="down" disabled={value <= MIN} onClick={() => step(-STEP)} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RatioRow({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", width: "100%",
        padding: "5px 20px 5px 12px", textAlign: "left", boxSizing: "border-box",
        background: hover ? "var(--hover-bg)" : "transparent",
        border: "none", borderRadius: 4, cursor: "pointer",
        color: "var(--text-secondary)", fontSize: "var(--fs-primary)",
      }}
    >
      <span style={{ flex: 1 }}>{label}</span>
      <span className="tabular-nums" style={{ opacity: 0.7 }}>{value.toFixed(1)}</span>
    </button>
  );
}

function Chevron({ dir, disabled, onClick }: { dir: "up" | "down"; disabled: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 16, height: 11, display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent", border: "none", padding: 0, lineHeight: 1,
        cursor: disabled ? "default" : "pointer",
        color: disabled ? "#444444" : hover ? "var(--accent)" : "var(--text-secondary)",
        fontSize: 9,
      }}
    >
      {dir === "up" ? "▲" : "▼"}
    </button>
  );
}
