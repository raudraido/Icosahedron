import { useRef, useState } from "react";
import { Icon } from "./Icon";

const HOLD_MS = 600;

/** Accent-ring play/pause button with a hover glow — used in the footer transport and every detail-view header.
 *  Pass `onHoldShuffle` to also support the grid cards' press+hold-to-shuffle
 *  gesture (PlayFilteredButton/AlbumCard/ArtistCard): a quick click still
 *  calls `onClick`, holding for 600ms instead calls `onHoldShuffle`. Omit it
 *  (e.g. the footer's plain play/pause transport button) to keep the exact
 *  original plain-click-only behavior. */
export function PlayRingButton({
  icon, onClick, onHoldShuffle, title, size = 58, iconSize = 16,
}: { icon: string; onClick: () => void; onHoldShuffle?: () => void; title?: string; size?: number; iconSize?: number }) {
  const [hovered, setHovered] = useState(false);
  const holdTimerRef = useRef<number | null>(null);
  const heldRef = useRef(false);

  function clearHoldTimer() {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function handleMouseDown() {
    if (!onHoldShuffle) return;
    heldRef.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      heldRef.current = true;
      holdTimerRef.current = null;
      onHoldShuffle();
    }, HOLD_MS);
  }
  function handleMouseUp() {
    if (!onHoldShuffle) return;
    const held = holdTimerRef.current === null && heldRef.current;
    clearHoldTimer();
    if (!held) onClick();
  }

  return (
    <button
      onClick={onHoldShuffle ? undefined : onClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      title={onHoldShuffle ? `${title} (hold to shuffle)` : title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); clearHoldTimer(); }}
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
