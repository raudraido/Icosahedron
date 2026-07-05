import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  submenu?: MenuItem[];
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

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, ready: false });

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
    onClose();
  }

  return (
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
    </div>
  );
}

function MenuRow({ item, onSelect }: { item: MenuItem; onSelect: (item: MenuItem) => void }) {
  const [hover, setHover] = useState(false);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  // Defaults match the old app's add_submenu _show(): opens to the right,
  // 4px overlap upward. Corrected before paint once the submenu's real size
  // is known — mirrors the top-level ContextMenu's own measure-then-clamp.
  // `anchor` is the CSS property to set (not the visual side the submenu ends
  // up on): `left: 100%` anchors off the wrapper's left edge, which opens the
  // submenu to the RIGHT; `right: 100%` anchors off the right edge, which
  // opens it to the LEFT. Flipping to the left means setting anchor "right".
  const [submenuPos, setSubmenuPos] = useState<{ anchor: "left" | "right"; top: number; ready: boolean }>({ anchor: "left", top: -4, ready: false });

  useLayoutEffect(() => {
    if (!submenuOpen) return;
    const wrapperEl = wrapperRef.current;
    const submenuEl = submenuRef.current;
    if (!wrapperEl || !submenuEl) return;
    const wrapperRect = wrapperEl.getBoundingClientRect();
    const submenuRect = submenuEl.getBoundingClientRect();

    // Matches add_submenu's `if x + sub.width() > wr.right() + buf: x = tr_left - sub.width()`
    // — flip to the left of the trigger if opening right would run past the window edge.
    const overflowsRight = wrapperRect.right + submenuRect.width > window.innerWidth - 8;
    // Matches `if y + sub.height() > wr.bottom() + buf: y = wr.bottom() + buf - sub.height()`
    // — shift up just enough to keep the bottom edge on-screen, same -4 default otherwise.
    const naturalTop = -4;
    const bottomOverflow = (wrapperRect.top + naturalTop + submenuRect.height) - (window.innerHeight - 8);
    const top = bottomOverflow > 0 ? naturalTop - bottomOverflow : naturalTop;

    setSubmenuPos({ anchor: overflowsRight ? "right" : "left", top, ready: true });
  }, [submenuOpen]);

  return (
    <div
      ref={wrapperRef}
      style={{ position: "relative" }}
      onMouseEnter={() => { setHover(true); setSubmenuOpen(true); }}
      onMouseLeave={() => { setHover(false); setSubmenuOpen(false); setSubmenuPos((p) => ({ ...p, ready: false })); }}
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
          fontSize: "var(--fs-primary)", fontWeight: 400,
        }}
      >
        {item.icon && <Icon src={item.icon} size={14} style={{ background: item.color ?? "var(--accent)" }} />}
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.submenu && <span style={{ opacity: 0.5 }}>›</span>}
      </button>

      {item.submenu && submenuOpen && (
        <div
          ref={submenuRef}
          className="scroll-clean"
          style={{
            position: "absolute",
            [submenuPos.anchor]: "100%",
            top: submenuPos.top,
            visibility: submenuPos.ready ? "visible" : "hidden",
            background: MENU_BG, border: "1px solid var(--border)", borderRadius: 8, padding: 4,
            minWidth: 200, maxHeight: 320, overflowY: "auto",
            boxShadow: MENU_SHADOW, whiteSpace: "nowrap",
            display: "flex", flexDirection: "column", gap: 1,
          }}
        >
          {item.submenu.map((sub, j) => (
            <SubmenuRow key={j} item={sub} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function SubmenuRow({ item, onSelect }: { item: MenuItem; onSelect: (item: MenuItem) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={() => onSelect(item)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={item.disabled}
      style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "5px 20px 5px 12px", textAlign: "left",
        background: hover && !item.disabled ? "var(--hover-bg)" : "transparent",
        border: "none", borderRadius: 4, cursor: item.disabled ? "default" : "pointer",
        color: item.color ?? "var(--text-secondary)", opacity: item.disabled ? 0.4 : 1,
        fontSize: "var(--fs-primary)", fontWeight: 400,
      }}
    >
      {item.icon && <Icon src={item.icon} size={14} style={{ background: item.color ?? "var(--accent)" }} />}
      {item.label}
    </button>
  );
}
