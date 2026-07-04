import { useEffect } from "react";
import { useStore } from "../store";

/** Full-window dimmed overlay showing album art large on click — click or press any key to dismiss. */
export function CoverZoomOverlay({ coverId, onClose }: { coverId: string; onClose: () => void }) {
  const coverUrl = useStore((s) => s.coverUrl);

  useEffect(() => {
    window.addEventListener("keydown", onClose);
    return () => window.removeEventListener("keydown", onClose);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.686)",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer",
      }}
    >
      <img
        src={coverUrl(coverId, 1000)}
        style={{
          maxWidth: "55vw", maxHeight: "65vh",
          objectFit: "contain",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      />
    </div>
  );
}
