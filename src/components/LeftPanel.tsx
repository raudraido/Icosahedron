import { useStore } from "../store";
import { CoverArt } from "./CoverArt";

/** 30×30 chevron arrow button matching the old ArrowButton widget */
function NavArrow({ direction, disabled, onClick }: { direction: "left" | "right"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 30, height: 30, flexShrink: 0,
        background: "transparent", border: "none", cursor: disabled ? "default" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 12, opacity: disabled ? 0.25 : 0.7,
        transition: "background 150ms, opacity 150ms",
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = "var(--hover-bg)"; e.currentTarget.style.opacity = "1"; } }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.opacity = disabled ? "0.25" : "0.7"; }}
    >
      {/* Chevron drawn in SVG — matches paintEvent drawLine approach */}
      <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
        {direction === "left" ? (
          <polyline points="7,2 3,7 7,12" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <polyline points="3,2 7,7 3,12" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}

export function LeftPanel() {
  const queue   = useStore((s) => s.queue);
  const idx     = useStore((s) => s.currentIndex);
  const track   = queue[idx] ?? null;
  const navBack = useStore((s) => s.navBack);
  const navFwd  = useStore((s) => s.navFwd);
  const canBack = useStore((s) => s.navHistory.length > 0 && s.navPos > 0);
  const canFwd  = useStore((s) => s.navPos < s.navHistory.length - 1);

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ width: 297, background: "var(--panel-bg)", borderRight: "1px solid var(--border)" }}
    >
      {/* Header: logo left, nav arrows + window controls right — entire row is drag region */}
      <div
        className="flex items-center shrink-0"
        data-tauri-drag-region
        style={{ height: 62, borderBottom: "1px solid var(--border)", paddingRight: 4 }}
      >
        {/* Logo: shahedron2 base + shahedron1 alpha-masked with accent */}
        <div style={{ position: "relative", width: 46, height: 46, marginLeft: 8, flexShrink: 0 }}>
          <img
            src="/img/shahedron2.png"
            alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
          />
          <div
            style={{
              position: "absolute", inset: 0,
              background: "var(--accent)",
              WebkitMaskImage: "url(/img/shahedron1.png)",
              WebkitMaskSize: "100% 100%",
              WebkitMaskRepeat: "no-repeat",
              maskImage: "url(/img/shahedron1.png)",
              maskSize: "100% 100%",
              maskRepeat: "no-repeat",
            }}
          />
        </div>

        <div style={{ flex: 1 }} />

        <NavArrow direction="left"  disabled={!canBack} onClick={navBack} />
        <NavArrow direction="right" disabled={!canFwd}  onClick={navFwd} />
      </div>

      <div className="flex-1" />

      {track?.cover_id && (
        <div className="p-2 shrink-0">
          <CoverArt coverId={track.cover_id} size={200} className="w-full aspect-square rounded-lg" />
        </div>
      )}
    </div>
  );
}
