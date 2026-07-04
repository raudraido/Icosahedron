import { useState } from "react";
import { Icon } from "./Icon";

/** Accent-ring play/pause button with a hover glow — used in the footer transport and every detail-view header. */
export function PlayRingButton({
  icon, onClick, title, size = 58, iconSize = 16,
}: { icon: string; onClick: () => void; title?: string; size?: number; iconSize?: number }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex items-center justify-center shrink-0"
      style={{
        width: size, height: size, borderRadius: "50%",
        border: "2px solid var(--accent)", background: "transparent",
        color: "var(--accent)", cursor: "pointer",
        boxShadow: hovered ? "0 0 14px 3px color-mix(in srgb, var(--accent) 35%, transparent)" : "none",
        transition: "box-shadow 150ms",
      }}
    >
      <Icon src={icon} size={iconSize} />
    </button>
  );
}
