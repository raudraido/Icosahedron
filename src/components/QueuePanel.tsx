import { useStore } from "../store";
import { fmtDuration } from "../lib/api";

function PlayingBars() {
  return (
    <div className="flex items-end gap-[3px]" style={{ height: 16 }}>
      {[300, 420, 340].map((dur, i) => (
        <div
          key={i}
          style={{
            width: 3,
            height: 4,
            borderRadius: 1.5,
            background: "var(--accent)",
            animation: `queueBar ${dur}ms ease-in-out infinite alternate`,
            animationDelay: `${i * 80}ms`,
          }}
        />
      ))}
    </div>
  );
}

export function QueuePanel() {
  const queue        = useStore((s) => s.queue);
  const currentIndex = useStore((s) => s.currentIndex);
  const playing      = useStore((s) => s.playing);
  const playTrack    = useStore((s) => s.playTrack);
  const clearQueue   = useStore((s) => s.clearQueue);

  const totalSecs = queue.reduce((acc, t) => acc + t.duration_secs, 0);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const totalFmt = h > 0
    ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
    : `${m}:${String(s).padStart(2,"0")}`;

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ width: 360, background: "var(--panel-bg)", borderLeft: "1px solid var(--border)" }}
    >
      <div
        className="flex items-center px-4 shrink-0 gap-2"
        style={{ height: 62, borderBottom: "1px solid var(--border)" }}
      >
        <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-small)", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.5 }}>
          Queue
        </span>
        {queue.length > 0 && (
          <>
            <span style={{ fontSize: "var(--fs-small)", color: "var(--text-primary)", opacity: 0.4 }}>
              {currentIndex + 1}/{queue.length}
            </span>
            <span style={{ fontSize: "var(--fs-small)", color: "var(--text-primary)", opacity: 0.35 }}>
              {totalFmt}
            </span>
          </>
        )}
        <div className="flex-1" />
        {queue.length > 0 && (
          <button
            onClick={clearQueue}
            style={{ opacity: 0.35, lineHeight: 1 }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.35")}
          >
            <img src="/img/trash.png" alt="Clear" style={{ width: 14, height: 14, filter: "saturate(0) brightness(0.3)" }} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-overlay">
        {queue.length === 0 && (
          <p className="p-4" style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)", opacity: 0.3 }}>
            Nothing queued
          </p>
        )}

        {queue.map((t, i) => {
          const isCurrent = i === currentIndex;
          const isPast    = currentIndex >= 0 && i < currentIndex;

          return (
            <button
              key={`${t.id}-${i}`}
              onDoubleClick={() => playTrack(t, queue)}
              className="w-full flex items-center text-left relative transition-colors"
              style={{ height: 53 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {isCurrent && (
                <div
                  className="absolute rounded-lg"
                  style={{ inset: "1px 8px", background: `color-mix(in srgb, var(--accent) 15%, transparent)`, pointerEvents: "none" }}
                />
              )}

              {/* Index / bars */}
              <div className="flex items-center justify-center shrink-0" style={{ width: 38, marginLeft: 6 }}>
                {isCurrent && playing ? (
                  <PlayingBars />
                ) : (
                  <span
                    style={{
                      fontSize: "var(--fs-small)",
                      color: isCurrent ? "var(--accent)" : "var(--text-primary)",
                      opacity: isPast ? 0.4 : (isCurrent ? 1 : 0.5),
                      fontWeight: isCurrent ? 700 : 400,
                    }}
                  >
                    {i + 1}
                  </span>
                )}
              </div>

              {/* Title + artist */}
              <div className="flex-1 min-w-0 px-2">
                <p className="truncate" style={{ fontSize: "var(--fs-primary)", color: isCurrent ? "var(--accent)" : "var(--text-primary)", opacity: isPast ? 0.4 : 1, fontWeight: isCurrent ? 700 : 400 }}>
                  {t.title}
                </p>
                <p className="truncate" style={{ fontSize: "var(--fs-secondary)", color: isCurrent ? "var(--accent)" : "var(--text-primary)", opacity: isPast ? 0.4 : 0.8 }}>
                  {t.artist}
                </p>
              </div>

              {/* Duration */}
              <span
                className="shrink-0 tabular-nums pr-3"
                style={{ fontSize: "var(--fs-secondary)", color: isCurrent ? "var(--accent)" : "var(--text-primary)", opacity: isPast ? 0.3 : 0.5 }}
              >
                {fmtDuration(t.duration_secs)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
