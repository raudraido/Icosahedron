import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import { IconBtn } from "./IconBtn";

/** Collapsible toolbar search box — expands from an icon button, with a clear ("x") button once text is entered, matching the old app's SearchBar.qml. */
export function SearchBox({
  open, onToggle, value, onChange, placeholder = "Search…",
}: {
  open: boolean;
  onToggle: () => void;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) ref.current?.focus();
    else onChange("");
  }, [open]);

  return (
    <>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onToggle()}
          placeholder={placeholder}
          style={{
            width: open ? 204 : 0,
            opacity: open ? 1 : 0,
            overflow: "hidden",
            padding: open ? "0 26px 0 10px" : 0,
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
              position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
              width: 16, height: 16, border: "none", background: "transparent", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
            }}
          >
            <Icon src="/img/sub_close.png" size={10} style={{ background: "var(--text-secondary)" }} />
          </button>
        )}
      </div>
      <IconBtn src="/img/search.png" active={open} title="Search" onClick={onToggle} />
    </>
  );
}
