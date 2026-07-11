// Loading placeholders — mirrors the old app's SkeletonCard.qml / SkeletonTrackRow.qml
// shimmer language (ShimmerSweep.qml), themed via the --skeleton token so it matches
// whichever theme (DARK/CREAM) is active.

// Pill widths cycle the same way SkeletonCard.qml's pillWidths did, so a row of
// several skeleton cards doesn't look mechanically identical.
const PILL_WIDTHS = [0.72, 0.5, 0.6];

export function SkeletonCard({ pillCount = 3 }: { pillCount?: number }) {
  return (
    <div className="flex flex-col" style={{ pointerEvents: "none" }}>
      <div className="shimmer-sweep w-full aspect-square" style={{ borderRadius: 8 }} />
      <div className="flex flex-col" style={{ marginTop: 8, gap: 6 }}>
        {Array.from({ length: pillCount }, (_, i) => (
          <div
            key={i}
            className="shimmer-sweep"
            style={{
              width: `${PILL_WIDTHS[i % PILL_WIDTHS.length] * 100}%`,
              height: i === 0 ? 11 : 9,
              borderRadius: i === 0 ? 5 : 4,
              opacity: i === 0 ? 1 : 0.7,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// One shimmer cell per *actually visible* column (not a fixed guess) — the
// "track" column gets the cover+title/artist stack treatment, every other
// currently-visible column (album, genre, dur, plays, trackno, year, date,
// bpm, ...) gets a single centered pill sized to its own column width, so
// the skeleton row's shape always matches whatever columns the user has
// picked instead of silently leaving extra columns blank while loading.
export function SkeletonTrackRow({
  numColWidth = 28,
  columns,
}: {
  numColWidth?: number;
  columns: { id: string; width: number; centered?: boolean }[];
}) {
  return (
    // gap: 0 — matches TrackTable's real header/data row gap, so the
    // loading skeleton doesn't visibly jump to a tighter layout the instant
    // real data replaces it.
    <div style={{ height: 58, display: "flex", alignItems: "center", gap: 0, padding: "0 24px", pointerEvents: "none" }}>
      <div style={{ flex: `0 0 ${numColWidth}px` }} />
      {columns.map((col) =>
        col.id === "track" ? (
          <div key={col.id} className="flex items-center min-w-0" style={{ gap: 12, flex: 1 }}>
            <div className="shimmer-sweep shrink-0" style={{ width: 52, height: 52, borderRadius: 3 }} />
            <div className="flex flex-col" style={{ gap: 6, flex: 1, minWidth: 0 }}>
              <div className="shimmer-sweep" style={{ width: 170, maxWidth: "60%", height: 11, borderRadius: 5 }} />
              <div className="shimmer-sweep" style={{ width: 110, maxWidth: "40%", height: 9, borderRadius: 4, opacity: 0.7 }} />
            </div>
          </div>
        ) : (
          <div
            key={col.id}
            style={{ flex: `0 0 ${col.width}px`, minWidth: 0, display: "flex", justifyContent: col.centered ? "center" : "flex-start" }}
          >
            <div className="shimmer-sweep" style={{ width: "70%", height: 9, borderRadius: 4 }} />
          </div>
        ),
      )}
    </div>
  );
}
