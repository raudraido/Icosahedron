import { useRef, useState } from "react";
import { useStore } from "../store";
import { api } from "../lib/api";
import { CoverArt } from "./CoverArt";
import { Icon } from "./Icon";
import { TetrisWidget } from "./TetrisWidget";
import { PongWidget } from "./PongWidget";
import { SpaceInvadersWidget } from "./SpaceInvadersWidget";
import { BreakoutWidget } from "./BreakoutWidget";
import { XonixWidget } from "./XonixWidget";
import { ContextMenu } from "./ContextMenu";

type GameId = "tetris" | "pong" | "spaceInvaders" | "breakout" | "xonix";

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
export function NavArrow({ direction, disabled, onClick }: { direction: "left" | "right"; disabled: boolean; onClick: () => void }) {
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
  const expanded = useStore((s) => s.sidebarArtExpanded);
  const toggleSidebarArt = useStore((s) => s.toggleSidebarArt);
  const [closeHov, setCloseHov] = useState(false);
  const [logoHovered, setLogoHovered] = useState(false);
  const [searchHandoff, setSearchHandoff] = useState("");

  // Server switcher — click opens a menu (see render below); the active
  // server, its saved siblings, and the switch/navigate actions all come
  // straight from the same multi-server store used by Settings > Servers.
  const servers = useStore((s) => s.servers);
  const activeServerId = useStore((s) => s.activeServerId);
  const switchServer = useStore((s) => s.switchServer);
  const navigateTo = useStore((s) => s.navigateTo);
  const openSpotlight = useStore((s) => s.openSpotlight);
  const username = useStore((s) => s.username);
  const [serverMenuPos, setServerMenuPos] = useState<{ x: number; y: number } | null>(null);
  const activeServer = servers.find((s) => s.id === activeServerId);

  // Easter egg — ported from the old app's 7-rapid-clicks-on-Home-tab
  // Tetris trigger (window.py:1066-1082), retargeted to 3 clicks on the
  // logo instead. Same 600ms "must be rapid" reset window. Now opens a game
  // picker next to the logo rather than jumping straight to Tetris, since
  // there's more than one game to choose from.
  const [activeGame, setActiveGame] = useState<GameId | null>(null);
  const [gameMenuPos, setGameMenuPos] = useState<{ x: number; y: number } | null>(null);
  const logoClickCountRef = useRef(0);
  const logoClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleLogoClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    // A plain click always toggles the server menu immediately (no delay —
    // this is the primary, everyday gesture and should feel instant). The
    // rapid-triple-click game-picker egg below rides along on the same
    // click stream; overlapping both menus on an intentional triple-click
    // is a harmless, rare edge case next to keeping the common case snappy.
    setServerMenuPos((prev) => (prev ? null : { x: rect.left, y: rect.bottom + 6 }));

    logoClickCountRef.current += 1;
    if (logoClickTimerRef.current) clearTimeout(logoClickTimerRef.current);
    logoClickTimerRef.current = setTimeout(() => { logoClickCountRef.current = 0; }, 600);
    if (logoClickCountRef.current >= 3) {
      logoClickCountRef.current = 0;
      clearTimeout(logoClickTimerRef.current);
      setGameMenuPos({ x: rect.right + 8, y: rect.top });
    }
  }

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ width: 297, background: "var(--panel-bg)", borderRight: "1px solid var(--border)" }}
    >
      {/* Header: just the logo now — nav arrows moved to the tab bar's left
          corner (App.tsx) so the tab row itself stays centered on the whole
          window instead of the remaining space next to these buttons.
          Entire row is still drag region. */}
      <div
        className="flex items-center shrink-0"
        data-tauri-drag-region
        style={{ height: 62, gap: 4, borderBottom: "1px solid var(--border)", paddingRight: 8 }}
      >
        {/* Logo: shahedron2 base + shahedron1 alpha-masked with accent —
            scales up slightly on hover so it reads as clickable (triple-click
            opens the game picker, see handleLogoClick above). */}
        <div
          onClick={handleLogoClick}
          onMouseEnter={() => setLogoHovered(true)}
          onMouseLeave={() => setLogoHovered(false)}
          style={{
            position: "relative", width: 46, height: 46, marginLeft: 8, flexShrink: 0,
            cursor: "pointer",
            transform: `scale(${logoHovered ? 1.12 : 1})`,
            transition: "transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          <img
            src="img/shahedron2.png"
            alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
          />
          <div
            style={{
              position: "absolute", inset: 0,
              background: "var(--accent)",
              WebkitMaskImage: "url(img/shahedron1.png)",
              WebkitMaskSize: "100% 100%",
              WebkitMaskRepeat: "no-repeat",
              maskImage: "url(img/shahedron1.png)",
              maskSize: "100% 100%",
              maskRepeat: "no-repeat",
            }}
          />
        </div>

        {/* Search bar — a real input, but only ever holds the very first
            keystroke: onChange immediately hands off to Spotlight (pre-filled,
            same openSpotlight(initialChar) mechanism GlobalHotkeys.tsx uses
            for "type anywhere" already) and clears itself, so the rest of
            the query is typed into Spotlight's own input with live results
            building as you go — not typed blind into this box first. */}
        <div
          className="flex items-center"
          style={{
            flex: 1, marginLeft: 10, height: 34, gap: 8, padding: "0 12px",
            background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 8,
          }}
        >
          <Icon src="img/search.png" size={14} style={{ background: "var(--text-secondary)", flexShrink: 0 }} />
          <input
            value={searchHandoff}
            onChange={(e) => {
              const v = e.target.value;
              // Explicit state reset (not a hardcoded value="") — guarantees
              // this component re-renders and the input clears immediately,
              // rather than relying on openSpotlight() incidentally causing
              // one.
              setSearchHandoff("");
              if (v) openSpotlight(v);
            }}
            onClick={() => openSpotlight()}
            placeholder="Search…"
            className="w-full outline-none"
            style={{
              background: "transparent", border: "none", color: "var(--text-primary)",
              fontSize: "var(--fs-secondary)", cursor: "text",
            }}
          />
        </div>
      </div>

      <div className="flex flex-col flex-1" style={{ position: "relative" }}>
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

        {activeGame === "tetris" && <TetrisWidget onClose={() => setActiveGame(null)} />}
        {activeGame === "pong" && <PongWidget onClose={() => setActiveGame(null)} />}
        {activeGame === "spaceInvaders" && <SpaceInvadersWidget onClose={() => setActiveGame(null)} />}
        {activeGame === "breakout" && <BreakoutWidget onClose={() => setActiveGame(null)} />}
        {activeGame === "xonix" && <XonixWidget onClose={() => setActiveGame(null)} />}
      </div>

      {gameMenuPos && (
        <ContextMenu
          x={gameMenuPos.x}
          y={gameMenuPos.y}
          items={[
            { label: "Tetris", onClick: () => setActiveGame("tetris") },
            { label: "Pong", onClick: () => setActiveGame("pong") },
            { label: "Space Invaders", onClick: () => setActiveGame("spaceInvaders") },
            { label: "Breakout", onClick: () => setActiveGame("breakout") },
            { label: "Xonix", onClick: () => setActiveGame("xonix") },
          ]}
          onClose={() => setGameMenuPos(null)}
        />
      )}

      {serverMenuPos && (
        <ContextMenu
          x={serverMenuPos.x}
          y={serverMenuPos.y}
          items={[
            {
              label: activeServer?.name ?? username ?? "Not connected",
              icon: "img/navidrome.png",
              rawIcon: true,
              iconSize: 32,
              iconOffsetX: -6,
              submenu: [
                ...servers.map((s) => ({
                  label: s.name,
                  icon: "img/navidrome.png",
                  rawIcon: true,
                  color: s.id === activeServerId ? "var(--accent)" : undefined,
                  onClick: () => { if (s.id !== activeServerId) switchServer(s.id).catch(() => {}); },
                })),
                "separator" as const,
                {
                  label: "Manage Servers",
                  icon: "img/settings.png",
                  onClick: () => navigateTo({ tab: "settings", settingsTab: "servers" }),
                },
              ],
            },
            "separator",
            {
              label: "Settings",
              icon: "img/settings.png",
              onClick: () => navigateTo({ tab: "settings" }),
            },
            {
              label: "Quit",
              icon: "img/sub_close.png",
              onClick: () => api.quitApp(),
            },
          ]}
          onClose={() => setServerMenuPos(null)}
        />
      )}
    </div>
  );
}
