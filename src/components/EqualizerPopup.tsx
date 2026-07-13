import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store";

// 10-band graphic EQ popup, anchored above the footer's eq button. Sliders
// drive the store's eq state, which pushes straight into the native engine's
// EqSource (live, mid-playback) and persists to localStorage — see the
// store's pushEq. Bands are the ISO octave centers matching the engine's
// BAND_FREQS; band range ±12 dB, preamp -12…+6 dB.

const BAND_LABELS = ["31", "62", "125", "250", "500", "1K", "2K", "4K", "8K", "16K"];

function fmtDb(db: number): string {
  return `${db > 0 ? "+" : ""}${db.toFixed(1).replace(/\.0$/, "")}`;
}

function BandSlider({ label, value, disabled, onChange, min = -12, max = 12 }: {
  label: string; value: number; disabled: boolean; onChange: (db: number) => void; min?: number; max?: number;
}) {
  return (
    <div className="flex flex-col items-center" style={{ gap: 4, width: 34, opacity: disabled ? 0.4 : 1 }}>
      <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>{fmtDb(value)}</span>
      {/* Rotated horizontal range — Chromium's vertical-range support via
          writing-mode is inconsistent across the Electron versions this app
          has shipped on; a rotated track behaves identically everywhere. */}
      <div style={{ height: 120, width: 20, position: "relative" }}>
        <input
          type="range"
          min={min} max={max} step={0.5}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(0)}
          style={{
            width: 120, height: 20,
            position: "absolute", top: 50, left: -50,
            transform: "rotate(-90deg)",
            cursor: disabled ? "default" : "pointer",
          }}
        />
      </div>
      <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>{label}</span>
    </div>
  );
}

export function EqualizerPopup({ anchor, onClose }: { anchor: { x: number; y: number }; onClose: () => void }) {
  const enabled = useStore((s) => s.eqEnabled);
  const preampDb = useStore((s) => s.eqPreampDb);
  const bandsDb = useStore((s) => s.eqBandsDb);
  const setEqEnabled = useStore((s) => s.setEqEnabled);
  const setEqPreamp = useStore((s) => s.setEqPreamp);
  const setEqBand = useStore((s) => s.setEqBand);
  const resetEq = useStore((s) => s.resetEq);
  const ref = useRef<HTMLDivElement>(null);

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

  const width = 10 * 34 + 10 * 6 + 90 + 32; // bands + gaps + preamp column + padding
  const left = Math.max(8, Math.min(anchor.x - width / 2, window.innerWidth - width - 8));

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed", left, bottom: window.innerHeight - anchor.y + 8, zIndex: 1000,
        background: "var(--main-bg)", border: "1px solid var(--border)", borderRadius: 10,
        padding: 16, boxShadow: "0 8px 24px color-mix(in srgb, black 30%, transparent)",
      }}
    >
      <div className="flex items-center" style={{ gap: 10, marginBottom: 12 }}>
        <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-primary)", fontWeight: "var(--fw-emphasis)" }}>Equalizer</span>
        {/* Enable toggle — same pill switch look as the playlist public/private toggle */}
        <button
          onClick={() => setEqEnabled(!enabled)}
          title={enabled ? "Disable equalizer" : "Enable equalizer"}
          style={{
            width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer", padding: 2,
            background: enabled ? "var(--accent)" : "var(--hover-bg)",
            display: "flex", alignItems: "center", justifyContent: enabled ? "flex-end" : "flex-start",
            transition: "background 150ms",
          }}
        >
          <span style={{ width: 16, height: 16, borderRadius: "50%", background: "var(--main-bg)", display: "block" }} />
        </button>
        <button
          onClick={resetEq}
          style={{
            marginLeft: "auto", background: "transparent", border: "1px solid var(--border)", borderRadius: 4,
            padding: "3px 10px", cursor: "pointer", color: "var(--text-secondary)", fontSize: "var(--fs-secondary)",
          }}
        >
          Reset
        </button>
      </div>

      <div className="flex" style={{ gap: 6, alignItems: "flex-end" }}>
        {/* Preamp: -12…+6 dB master pre-gain, set apart from the bands */}
        <div style={{ paddingRight: 12, marginRight: 6, borderRight: "1px solid var(--border)" }}>
          <BandSlider label="Preamp" value={preampDb} disabled={!enabled} onChange={setEqPreamp} min={-12} max={6} />
        </div>
        {BAND_LABELS.map((label, i) => (
          <BandSlider key={label} label={label} value={bandsDb[i] ?? 0} disabled={!enabled} onChange={(db) => setEqBand(i, db)} />
        ))}
      </div>
    </div>,
    document.body,
  );
}
