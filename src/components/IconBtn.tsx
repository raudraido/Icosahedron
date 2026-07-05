import { useState } from "react";
import { Icon } from "./Icon";

/** Toolbar icon button — accent-tinted when active, subtle hover background otherwise.
 *  `spinning` continuously rotates the icon (matches the old app's SpinRefreshButton:
 *  linear, ~1.28s/rev, no fixed count — reuses the same keyframe as the radio-loading
 *  SpinnerRing). */
export function IconBtn({
  src, active, title, onClick, spinning = false,
}: { src: string; active?: boolean; title?: string; onClick: () => void; spinning?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 32, height: 32, borderRadius: 4, border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--accent)",
        background: active
          ? "color-mix(in srgb, var(--accent) 15%, transparent)"
          : hov ? "var(--hover-bg)" : "transparent",
        transition: "background 150ms",
        flexShrink: 0,
      }}
    >
      <Icon src={src} size={18} style={spinning ? { animation: "spinner-rotate 1280ms linear infinite" } : undefined} />
    </button>
  );
}
