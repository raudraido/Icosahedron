import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

// Shared right-click context menu primitive — mirrors the old app's
// ShadowContextMenu (player/widgets.py): a themed popup with optional
// hover-opened submenus (used for "Add to Playlist"), positioned at the
// click point and clamped to stay inside the window.
export interface MenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  icon?: string;
  /** Overrides the default text-secondary/accent coloring for both the label and
   *  its icon — matches the old app's `add_action(..., color=...)` (e.g. the pink
   *  Favorites row, `color='#E91E63'`). */
  color?: string;
  /** Renders `icon` as a plain <img> in its own original colors instead of
   *  the default mask-tinted-to-`color` treatment — for icons that are
   *  already a finished piece of art (e.g. a server/service logo) rather
   *  than a single-color glyph meant to match the theme. */
  rawIcon?: boolean;
  /** Overrides the default 14px icon size — e.g. a larger untinted logo. */
  iconSize?: number;
  /** Nudges the icon horizontally (px, usually negative) — a bigger rawIcon
   *  logo often has its own internal padding baked into the asset, which
   *  otherwise reads as misaligned against smaller glyph icons in rows
   *  below it despite both sharing the same box's left inset. */
  iconOffsetX?: number;
  /** Second, secondary-sized line under the label inside the same row —
   *  e.g. the logo menu's server entry showing which library is browsed. */
  subtitle?: string;
  /** Checklist-style row: reserves a leading slot that shows an accent ✓
   *  when true (mirrors Settings > Servers' LibraryPicker rows). Use with
   *  `keepOpen` so several rows can be toggled in one visit. */
  checked?: boolean;
  /** Run onClick without closing the menu — for toggle rows. */
  keepOpen?: boolean;
  submenu?: MenuEntry[];
}
export type MenuEntry = MenuItem | "separator";

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

const MENU_BG = "var(--main-bg)";
const MENU_SHADOW = "0 4px 16px color-mix(in srgb, var(--text-primary) 15%, transparent)";

// Since submenu popups are portaled to <body>, hovering a nested popup no
// longer counts as hovering its ancestor popups (no DOM containment) — each
// level would start its close timer the moment the pointer moved one level
// deeper. Rows chain their keep-alive/close through this context so entering
// any descendant popup cancels every ancestor's timer, and leaving one
// re-arms them.
const SubmenuChain = createContext<{ keepAlive: () => void; scheduleClose: () => void }>({
  keepAlive: () => {}, scheduleClose: () => {},
});

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, ready: false });

  useEffect(() => {
    function onDown(e: MouseEvent) {
      // Submenus are portaled to <body> (see MenuRow), so a click inside one
      // isn't inside `ref` — without the data-attribute check, toggling a
      // checklist row would count as an outside click and close the menu.
      const target = e.target as Element | null;
      if (target?.closest?.("[data-ctx-submenu]")) return;
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

  // Clamp to viewport once the menu's real size is known.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clampedX = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const clampedY = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    setPos({ x: clampedX, y: clampedY, ready: true });
  }, [x, y]);

  function select(item: MenuItem) {
    if (item.disabled || item.submenu) return;
    item.onClick?.();
    if (!item.keepOpen) onClose();
  }

  // Rendered via portal straight onto <body> — any scrollable ancestor with
  // `will-change: transform` (see .scroll-clean in index.css) becomes a
  // containing block for `position: fixed` descendants, which put this menu
  // at a wild offset (anchored to the scrolled container instead of the
  // viewport) whenever it opened from inside a scrolled page, e.g. the
  // Favorites tab's tracklist. A portal sidesteps the ancestor chain entirely.
  return createPortal(
    <div
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed", top: pos.y, left: pos.x, zIndex: 1000,
        visibility: pos.ready ? "visible" : "hidden",
        background: MENU_BG, border: "1px solid var(--border)",
        borderRadius: 8, padding: 4, minWidth: 200,
        boxShadow: MENU_SHADOW,
        display: "flex", flexDirection: "column", gap: 1,
      }}
    >
      {items.map((entry, i) =>
        entry === "separator"
          ? <div key={i} style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          : <MenuRow key={i} item={entry} onSelect={select} />
      )}
    </div>,
    document.body,
  );
}

function MenuRow({ item, onSelect }: { item: MenuItem; onSelect: (item: MenuItem) => void }) {
  const [hover, setHover] = useState(false);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  // The submenu is portaled to <body> with fixed coordinates (rather than
  // absolutely positioned inside this row) because a nested submenu's parent
  // container scrolls (`overflow-y: auto`) — an in-flow popup gets clipped by
  // that ancestor, which is exactly what broke third-level submenus. Portaled,
  // it can't be a DOM descendant of the row anymore, so hover-open state is
  // kept alive by a short close timer that either side (row or popup) cancels
  // on mouseenter instead of relying on one contiguous hover area.
  const [submenuPos, setSubmenuPos] = useState<{ left: number; top: number; ready: boolean }>({ left: 0, top: 0, ready: false });
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parentChain = useContext(SubmenuChain);

  function openSubmenu() {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    parentChain.keepAlive();
    setSubmenuOpen(true);
  }
  function scheduleSubmenuClose() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setSubmenuOpen(false);
      setSubmenuPos((p) => ({ ...p, ready: false }));
    }, 120);
    parentChain.scheduleClose();
  }
  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  useLayoutEffect(() => {
    if (!submenuOpen) return;
    const wrapperEl = wrapperRef.current;
    const submenuEl = submenuRef.current;
    if (!wrapperEl || !submenuEl) return;
    const wrapperRect = wrapperEl.getBoundingClientRect();
    const submenuRect = submenuEl.getBoundingClientRect();

    // Same flip/clamp rules as the old anchor-based version (and the old
    // app's add_submenu _show()): open right with a 4px upward overlap, flip
    // left past the window edge, shift up just enough to stay on-screen.
    const overflowsRight = wrapperRect.right + submenuRect.width > window.innerWidth - 8;
    const left = overflowsRight ? Math.max(8, wrapperRect.left - submenuRect.width) : wrapperRect.right;
    const naturalTop = wrapperRect.top - 4;
    const bottomOverflow = naturalTop + submenuRect.height - (window.innerHeight - 8);
    const top = Math.max(8, bottomOverflow > 0 ? naturalTop - bottomOverflow : naturalTop);

    setSubmenuPos({ left, top, ready: true });
  }, [submenuOpen]);

  return (
    <div
      ref={wrapperRef}
      style={{ position: "relative" }}
      onMouseEnter={() => { setHover(true); openSubmenu(); }}
      onMouseLeave={() => { setHover(false); scheduleSubmenuClose(); }}
    >
      <button
        onClick={() => onSelect(item)}
        disabled={item.disabled}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          padding: "5px 20px 5px 12px", textAlign: "left", boxSizing: "border-box",
          background: hover && !item.disabled ? "var(--hover-bg)" : "transparent",
          border: "none", borderRadius: 4, cursor: item.disabled ? "default" : "pointer",
          color: item.color ?? "var(--text-secondary)", opacity: item.disabled ? 0.4 : 1,
          fontSize: "var(--fs-primary)", fontWeight: "var(--fw-primary)",
        }}
      >
        {item.checked !== undefined && (
          <span style={{ width: 14, flexShrink: 0, color: "var(--accent)", fontWeight: "var(--fw-emphasis)" }}>{item.checked ? "✓" : ""}</span>
        )}
        {item.icon && (
          item.rawIcon
            ? <img src={item.icon} alt="" style={{ width: item.iconSize ?? 14, height: item.iconSize ?? 14, objectFit: "contain", flexShrink: 0, marginLeft: item.iconOffsetX ?? 0 }} />
            : <Icon src={item.icon} size={item.iconSize ?? 14} style={{ background: item.color ?? "var(--accent)" }} />
        )}
        {item.subtitle ? (
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
            <span className="truncate">{item.label}</span>
            <span className="truncate" style={{ fontSize: "var(--fs-secondary)", opacity: 0.7 }}>{item.subtitle}</span>
          </span>
        ) : (
          <span style={{ flex: 1 }}>{item.label}</span>
        )}
        {item.submenu && <span style={{ opacity: 0.5 }}>›</span>}
      </button>

      {item.submenu && submenuOpen && createPortal(
        <div
          ref={submenuRef}
          className="scroll-overlay"
          data-ctx-submenu
          onMouseEnter={openSubmenu}
          onMouseLeave={scheduleSubmenuClose}
          style={{
            position: "fixed",
            left: submenuPos.left,
            top: submenuPos.top,
            zIndex: 1001,
            visibility: submenuPos.ready ? "visible" : "hidden",
            background: MENU_BG, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 4px",
            minWidth: 200, maxHeight: "min(480px, calc(100vh - 16px))", overflowY: "auto",
            boxShadow: MENU_SHADOW, whiteSpace: "nowrap",
            display: "flex", flexDirection: "column", gap: 1,
          }}
        >
          {/* Recursive MenuRow (not a simplified leaf row) so submenu items can
              themselves carry checkmarks, subtitles, and deeper submenus — e.g.
              the logo menu's active server → library checklist. */}
          <SubmenuChain.Provider value={{ keepAlive: openSubmenu, scheduleClose: scheduleSubmenuClose }}>
            {item.submenu.map((sub, j) =>
              sub === "separator"
                ? <div key={j} style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                : <MenuRow key={j} item={sub} onSelect={onSelect} />
            )}
          </SubmenuChain.Provider>
        </div>,
        document.body,
      )}
    </div>
  );
}

