import { useEffect, useState } from "react";
import { useStore } from "../store";

interface Props {
  coverId: string | null;
  size?: number;
  className?: string;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 800;

export function CoverArt({ coverId, size = 200, className = "" }: Props) {
  const coverUrl = useStore((s) => s.coverUrl);
  const src = coverUrl(coverId, size);
  const [errored, setErrored] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Reset error/retry state when the underlying image identity changes — a
  // virtualized grid/row recycles the same component instance for a
  // different item as the user scrolls, so a stale error from a previous
  // cover mustn't stick around.
  useEffect(() => { setErrored(false); setAttempt(0); }, [src]);

  // A failed load is often transient (the main process's cover:// handler
  // aborts in-flight fetches for covers scrolled out of view — see
  // coverProtocol.ts — which can surface as a load error here for a cover
  // that's perfectly fetchable a moment later) rather than a truly missing
  // cover. Retry a few times with backoff before giving up: bumping `attempt`
  // both remounts the <img> (via `key`, forcing a genuine new request rather
  // than a no-op — React skips the DOM update entirely if the src attribute
  // string is unchanged) and clears `errored` so it gets a real second look
  // instead of being stuck showing the placeholder forever.
  useEffect(() => {
    if (!errored || attempt >= MAX_RETRIES) return;
    const timer = setTimeout(() => {
      setAttempt((a) => a + 1);
      setErrored(false);
    }, RETRY_BASE_MS * (attempt + 1));
    return () => clearTimeout(timer);
  }, [errored, attempt]);

  if (!src || errored) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ background: "var(--skeleton)" }}>
        <span className="select-none" style={{ fontSize: "var(--fs-title)", color: "var(--text-primary)", opacity: 0.3 }}>♪</span>
      </div>
    );
  }

  return (
    <img
      key={attempt}
      src={src}
      className={`object-cover ${className}`}
      decoding="async"
      onError={() => setErrored(true)}
    />
  );
}
