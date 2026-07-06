import { useState } from "react";
import { useStore } from "../store";
import { CoverArt } from "./CoverArt";
import { Icon } from "./Icon";

// Matches left_panel.qml's artTargetSize = leftPanel.width() - 16 (8px margin
// each side) — our left panel is a fixed 297px, so this is a constant rather
// than something that needs measuring.
const ART_SIZE = 297 - 8 * 2;

// 30×30 button matching the old app's ArrowButton (player/widgets.py:1988):
// chevron is 6px wide × 12px tall with a 2px stroke (drawn via QPainter.drawLine
// there; an SVG polyline gets the same result), always full opacity — enabled
// is the accent color (re-tinted via set_color(masterColor) in the old app,
// not the theme's plain text color), disabled swaps to a fixed #333 rather
// than fading via opacity. Hover fills the whole 30×30 box (12px radius,
// matching the button's own border-radius) with the theme's hover color.
function NavArrow({ direction, disabled, onClick }: { direction: "left" | "right"; disabled: boolean; onClick: () => void }) {
  const color = disabled ? "#333333" : "var(--accent)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 30, height: 30, flexShrink: 0,
        background: "transparent", border: "none", cursor: disabled ? "default" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 12,
        transition: "background 150ms",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "var(--hover-bg)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {/* Chevron drawn in SVG — matches paintEvent drawLine approach */}
      <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
        {direction === "left" ? (
          <polyline points="7,1 1,7 7,13" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <polyline points="1,1 7,7 1,13" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
  const expanded = useStore((s) => s.sidebarArtExpanded);
  const toggleSidebarArt = useStore((s) => s.toggleSidebarArt);
  const [closeHov, setCloseHov] = useState(false);

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ width: 297, background: "var(--panel-bg)", borderRight: "1px solid var(--border)" }}
    >
      {/* Header: logo left, nav arrows + window controls right — entire row is drag region */}
      <div
        className="flex items-center shrink-0"
        data-tauri-drag-region
        style={{ height: 62, gap: 4, borderBottom: "1px solid var(--border)", paddingRight: 8 }}
      >
        {/* Logo: shahedron2 base + shahedron1 alpha-masked with accent */}
        <div style={{ position: "relative", width: 46, height: 46, marginLeft: 8, flexShrink: 0 }}>
          <img
            src="img/shahedron2.png"
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

      {/* Art section — collapsed (height 0) by default, expands upward when the
          footer thumbnail's expand button is clicked. Matches left_panel.qml's
          artSection: same 250ms InOutCubic on height, driven by the same shared
          toggle as the footer thumbnail's width animation, so they move in lockstep
          as a handoff (no cross-fade between the two). */}
      <div style={{ padding: 8, flexShrink: 0 }}>
        <div
          style={{
            position: "relative", width: ART_SIZE,
            height: expanded ? ART_SIZE : 0,
            overflow: "hidden", borderRadius: 5, background: "#121212",
            transition: "height 250ms cubic-bezier(0.65, 0, 0.35, 1)",
          }}
        >
          {track?.cover_id ? (
            <CoverArt coverId={track.cover_id} size={ART_SIZE} className="w-full h-full" />
          ) : (
            <div className="flex items-center justify-center w-full h-full" style={{ fontSize: Math.max(20, ART_SIZE * 0.3), color: "#333333" }}>
              💿
            </div>
          )}

          {expanded && (
            <button
              onClick={() => { setCloseHov(false); toggleSidebarArt(); }}
              onMouseEnter={() => setCloseHov(true)}
              onMouseLeave={() => setCloseHov(false)}
              title="Collapse"
              style={{
                position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 12,
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                border: `2px solid color-mix(in srgb, var(--accent) ${closeHov ? 100 : 30}%, transparent)`,
                background: `color-mix(in srgb, var(--accent) ${closeHov ? 40 : 10}%, transparent)`,
                opacity: closeHov ? 1 : 0,
                transition: "opacity 180ms",
              }}
            >
              <Icon src="img/expand.png" size={16} style={{ background: closeHov ? "#ffffff" : "#515151" }} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
