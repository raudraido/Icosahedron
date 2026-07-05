import { useEffect, useState } from "react";
import { useStore } from "../store";

interface Props {
  coverId: string | null;
  size?: number;
  className?: string;
}

export function CoverArt({ coverId, size = 200, className = "" }: Props) {
  const coverUrl = useStore((s) => s.coverUrl);
  const src = coverUrl(coverId, size);
  const [errored, setErrored] = useState(false);

  // Reset error state when the underlying image identity changes — a virtualized
  // grid/row recycles the same component instance for a different item as the
  // user scrolls, so a stale error from a previous cover mustn't stick around.
  useEffect(() => setErrored(false), [src]);

  if (!src || errored) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ background: "var(--skeleton)" }}>
        <span className="select-none" style={{ fontSize: "var(--fs-title)", color: "var(--text-primary)", opacity: 0.3 }}>♪</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      className={`object-cover ${className}`}
      decoding="async"
      onError={() => setErrored(true)}
    />
  );
}
