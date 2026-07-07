import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { ScrollThumb } from "./ScrollThumb";

// Excel-style column filter popup for the Tracks tab's Artist/Album/Genre/
// Year columns — ports tracks_browser.py's ColumnFilterPopup. Sort rows +
// clear-filter row, a search box, and a checkbox checklist ("Select All" +
// per-value):
//  - No active filter: everything starts checked (no filter = show all).
//  - Reopening with an active filter: only the previously-selected values
//    start checked, but every value is still visible in the list (real
//    Excel semantics — unchecked options must stay pickable, not vanish
//    until you search for them by name).
//  - Typing a search auto-checks every match (narrowing = selecting, not
//    just hiding) — clicking OK with a live search text replaces the
//    filter with whatever's both visible and still checked, so manually
//    unchecking a match before hitting OK excludes it.
//  - "(Add current selection to filter)" appears once there's an active
//    filter, a live search, and at least one visible match not already in
//    that filter — checking it merges instead of replacing.

const MAX_ID_FILTER_VALUES = 10;

interface Props {
  x: number;
  y: number;
  allValues: string[];
  activeValues: Set<string>;
  isIdBased: boolean; // artist/album/genre → show the >10-selected server warning; year → no warning
  onApply: (values: Set<string>) => void;
  onSort: (dir: "asc" | "desc") => void;
  onClose: () => void;
}

export function ColumnFilterPopup({ x, y, allValues, activeValues, isIdBased, onApply, onSort, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, ready: false });
  const hasActiveFilter = activeValues.size > 0;

  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(() => new Set(hasActiveFilter ? activeValues : allValues));
  const [addToFilter, setAddToFilter] = useState(false);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      // The funnel icon that opened this popup lives in TrackTable's header,
      // not inside this portaled popup — without this check, mousedown (which
      // fires before the icon's own click) would close the popup here first,
      // and then that same click's toggle-close logic would reopen it from
      // stale state, so a second click on an already-open column's icon
      // never actually closed anything.
      if (target.closest("[data-filter-trigger]")) return;
      if (ref.current && !ref.current.contains(target)) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clampedX = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const clampedY = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    setPos({ x: clampedX, y: clampedY, ready: true });
  }, [x, y]);

  // Auto-check every live search match — narrowing the list also selects
  // it, matching _filter_list's pre-check-visible-results behavior.
  useEffect(() => {
    const q = search.trim().toLowerCase();
    if (!q) return;
    setChecked((prev) => {
      const next = new Set(prev);
      for (const v of allValues) if (v.toLowerCase().includes(q)) next.add(v);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const q = search.trim().toLowerCase();
  const visible = q
    ? allValues.filter((v) => v.toLowerCase().includes(q))
    : allValues;
  const hasNewMatch = visible.some((v) => !activeValues.has(v));
  const showAddToFilter = hasActiveFilter && q.length > 0 && hasNewMatch;
  const allChecked = checked.size === allValues.length;

  const showWarning = isIdBased && checked.size > MAX_ID_FILTER_VALUES && checked.size !== allValues.length;

  function toggleValue(v: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  }

  function toggleSelectAll() {
    setChecked(allChecked ? new Set() : new Set(allValues));
  }

  function apply() {
    if (addToFilter) {
      onApply(new Set([...activeValues, ...visible.filter((v) => checked.has(v))]));
    } else if (q) {
      onApply(new Set(visible.filter((v) => checked.has(v))));
    } else if (allChecked) {
      onApply(new Set()); // everything selected == no filter
    } else {
      onApply(new Set(checked));
    }
    onClose();
  }

  function clearFilter() {
    onApply(new Set());
    onClose();
  }

  function sort(dir: "asc" | "desc") {
    onSort(dir);
    onClose();
  }

  // Portal straight onto <body> — see ContextMenu.tsx's comment: a scrolled
  // ancestor with `will-change: transform` (.scroll-clean) otherwise becomes
  // the containing block for this `position: fixed` popup instead of the
  // viewport, e.g. when opened from the Favorites tab's whole-page scroll.
  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed", top: pos.y, left: pos.x, zIndex: 1000, width: 240,
        visibility: pos.ready ? "visible" : "hidden",
        background: "var(--main-bg)", border: "1px solid var(--border)", borderRadius: 6,
        boxShadow: "0 4px 16px color-mix(in srgb, var(--text-primary) 15%, transparent)",
        padding: 8, display: "flex", flexDirection: "column", gap: 4,
        fontSize: "var(--fs-secondary)",
      }}
    >
      <ActionRow icon="img/filter_up.png" label="Sort ascending" onClick={() => sort("asc")} />
      <ActionRow icon="img/filter_down.png" label="Sort descending" onClick={() => sort("desc")} />
      <ActionRow
        icon="img/filter_off-2.png"
        label="Clear filter"
        onClick={clearFilter}
        enabled={hasActiveFilter}
        color={hasActiveFilter ? "#ff4444" : undefined}
      />

      <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />

      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
        placeholder="Search…"
        className="outline-none"
        style={{
          background: "var(--card-bg)", color: "var(--text-secondary)", border: "1px solid var(--border)",
          borderRadius: 4, padding: "4px 8px", fontSize: "var(--fs-secondary)",
        }}
      />

      <div style={{ height: 200, position: "relative" }}>
        <div ref={listRef} className="scroll-clean" style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <CheckRow label="(Select All)" bold checked={allChecked} onToggle={toggleSelectAll} />
          {showAddToFilter && (
            <CheckRow
              label="(Add current selection to filter)"
              bold
              checked={addToFilter}
              onToggle={() => setAddToFilter((v) => !v)}
            />
          )}
          {visible.map((v) => (
            <CheckRow key={v} label={v} checked={checked.has(v)} onToggle={() => toggleValue(v)} />
          ))}
        </div>
        <ScrollThumb scrollRef={listRef} />
      </div>

      {showWarning && (
        <p style={{ color: "#f0a030", fontSize: 11, padding: "2px 4px", margin: 0 }}>
          ⚠ Server supports up to {MAX_ID_FILTER_VALUES} values ({checked.size} selected — results may be incomplete).
        </p>
      )}

      <div className="flex justify-end" style={{ gap: 6, marginTop: 4 }}>
        <button
          onClick={onClose}
          style={{ background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 12px", cursor: "pointer", fontSize: "calc(var(--fs-secondary) - 1px)" }}
        >
          Cancel
        </button>
        <button
          onClick={apply}
          style={{ background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 12px", cursor: "pointer", fontSize: "calc(var(--fs-secondary) - 1px)" }}
        >
          OK
        </button>
      </div>
    </div>,
    document.body,
  );
}

function ActionRow({ icon, label, onClick, enabled = true, color }: { icon: string; label: string; onClick: () => void; enabled?: boolean; color?: string }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={enabled ? onClick : undefined}
      onMouseEnter={() => enabled && setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="flex items-center"
      style={{
        gap: 6, padding: 4, borderRadius: 4, cursor: enabled ? "pointer" : "default",
        background: hov ? "var(--hover-bg)" : "transparent", opacity: enabled ? 1 : 0.4,
      }}
    >
      <Icon src={icon} size={14} style={{ background: color ?? "var(--accent)" }} />
      <span style={{ color: color ?? "var(--text-secondary)" }}>{label}</span>
    </div>
  );
}

function CheckRow({ label, checked, onToggle, bold = false }: { label: string; checked: boolean; onToggle: () => void; bold?: boolean }) {
  return (
    <label
      className="flex items-center"
      style={{ gap: 6, padding: "3px 6px", borderRadius: 3, cursor: "pointer", color: "var(--text-secondary)", fontWeight: bold ? 700 : 400 }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} style={{ accentColor: "var(--accent)" }} />
      <span className="truncate">{label}</span>
    </label>
  );
}
