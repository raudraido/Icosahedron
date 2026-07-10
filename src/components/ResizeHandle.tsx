import { useState } from "react";

/** Thin drag-to-resize handle for the side panels (LeftPanel/QueuePanel) —
 *  invisible at rest, shows a vertical accent line on hover or while actively
 *  dragging (matches Feishin's ResizeHandle: near-zero visual footprint
 *  until the user is actually interacting with it). `placement` is which
 *  edge of the panel this sits on, so the line renders on the correct side
 *  of the hit-target and the cursor is always ew-resize either way. */
export function ResizeHandle({
  placement, onMouseDown, dragging,
}: { placement: "left" | "right"; onMouseDown: (e: React.MouseEvent) => void; dragging: boolean }) {
  const [hov, setHov] = useState(false);
  const active = hov || dragging;
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: "absolute", top: 0, bottom: 0,
        [placement]: -3,
        width: 7, cursor: "ew-resize", zIndex: 30,
      }}
    >
      <div
        style={{
          position: "absolute", top: 0, bottom: 0,
          [placement === "left" ? "right" : "left"]: 3,
          width: 2,
          background: "var(--accent)",
          opacity: active ? 0.8 : 0,
          transition: dragging ? "none" : "opacity 120ms",
        }}
      />
    </div>
  );
}
