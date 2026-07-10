import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { IconBtn } from "./IconBtn";

export interface SearchScopeOption {
  value: string;
  label: string;
}

/** Collapsible toolbar search box — expands from an icon button, with a clear ("x") button once text is entered, matching the old app's SearchBar.qml. */
export function SearchBox({
  open, onToggle, value, onChange, placeholder = "Search…",
  scope, scopeOptions, onScopeChange,
}: {
  open: boolean;
  onToggle: () => void;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Optional search-scope dropdown — a small down-arrow button inside the
   *  box (Tracks tab only; every other caller omits these and gets the
   *  plain box unchanged) opening a mutually-exclusive radio-style menu.
   *  `scopeOptions` are the narrower choices (e.g. Title/Artist/Album); an
   *  "All" option (value `"all"`) is always prepended, since Navidrome's
   *  own `title=` filter is already a combined title/artist/album match
   *  with no server-side way to narrow to just one field. */
  scope?: string;
  scopeOptions?: SearchScopeOption[];
  onScopeChange?: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasScope = scopeOptions !== undefined;
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (open) {
      ref.current?.focus();
    } else {
      onChange("");
      setMenuOpen(false);
      if (hasScope && scope !== "all") onScopeChange?.("all");
      // Without this, the (now invisible, width:0) input keeps focus after
      // collapsing — keystrokes keep landing in it instead of reaching
      // GlobalHotkeys' document-level listener, silently eating both
      // shortcuts and the "type anywhere to open Spotlight" trigger (which
      // bails whenever an <input> has focus, invisible or not).
      ref.current?.blur();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setMenuOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const clearRight = hasScope ? 26 : 6;
  const scopeActive = hasScope && scope !== "all";
  const allOptions: SearchScopeOption[] = hasScope ? [{ value: "all", label: "All" }, ...scopeOptions!] : [];
  // Reflects the active scope back into the placeholder itself (e.g. "Search
  // by Title…") so it's obvious what a narrowed search is actually matching
  // against, without needing to reopen the scope dropdown to check.
  const activeOption = scopeActive ? allOptions.find((o) => o.value === scope) : undefined;
  const effectivePlaceholder = activeOption ? `Search by ${activeOption.label}…` : placeholder;

  return (
    <>
      <div ref={containerRef} style={{ position: "relative", flexShrink: 0 }}>
        <input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onToggle()}
          placeholder={effectivePlaceholder}
          style={{
            width: open ? (hasScope ? 226 : 204) : 0,
            opacity: open ? 1 : 0,
            overflow: "hidden",
            padding: open ? `0 ${hasScope ? 44 : 26}px 0 10px` : 0,
            height: 30,
            boxSizing: "border-box",
            transition: "width 250ms cubic-bezier(0.77,0,0.175,1), opacity 200ms",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--text-primary)",
            fontSize: "var(--fs-secondary)",
            outline: "none",
          }}
        />
        {open && value && (
          <button
            onClick={() => onChange("")}
            style={{
              position: "absolute", right: clearRight, top: "50%", transform: "translateY(-50%)",
              width: 16, height: 16, border: "none", background: "transparent", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
            }}
          >
            <Icon src="img/sub_close.png" size={10} style={{ background: "var(--text-secondary)" }} />
          </button>
        )}
        {open && hasScope && (
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title="Search scope"
            style={{
              position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
              width: 16, height: 16, border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
              background: "transparent",
            }}
          >
            <Icon src="img/magfilter.png" size={16} style={{ background: scopeActive ? "var(--accent)" : "var(--text-secondary)" }} />
          </button>
        )}
        {open && hasScope && menuOpen && (
          <div
            className="flex flex-col"
            style={{
              position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 50, minWidth: 120,
              background: "var(--main-bg)", border: "1px solid var(--border)", borderRadius: 6, padding: 4, gap: 2,
              boxShadow: "0 4px 16px color-mix(in srgb, var(--text-primary) 15%, transparent)",
            }}
          >
            {allOptions.map((opt) => {
              const active = (scope ?? "all") === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => { onScopeChange?.(opt.value); setMenuOpen(false); }}
                  className="w-full text-left"
                  style={{
                    padding: "6px 8px", borderRadius: 4, border: "none", cursor: "pointer",
                    background: active ? "var(--hover-bg)" : "transparent",
                    color: active ? "var(--accent)" : "var(--text-primary)",
                    fontSize: "var(--fs-secondary)", fontWeight: active ? "var(--fw-emphasis)" : "var(--fw-secondary)",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <IconBtn src="img/search.png" active={open} title="Search" onClick={onToggle} />
    </>
  );
}
