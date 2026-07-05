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

export function SkeletonTrackRow({ numColWidth = 28 }: { numColWidth?: number }) {
  return (
    <div style={{ height: 58, display: "flex", alignItems: "center", gap: 12, padding: "0 24px", pointerEvents: "none" }}>
      <div style={{ flex: `0 0 ${numColWidth}px` }} />
      <div className="shimmer-sweep shrink-0" style={{ width: 52, height: 52, borderRadius: 3 }} />
      <div className="flex flex-col" style={{ gap: 6, flex: 1, minWidth: 0 }}>
        <div className="shimmer-sweep" style={{ width: 170, maxWidth: "60%", height: 11, borderRadius: 5 }} />
        <div className="shimmer-sweep" style={{ width: 110, maxWidth: "40%", height: 9, borderRadius: 4, opacity: 0.7 }} />
      </div>
      <div className="shimmer-sweep shrink-0" style={{ width: 70, height: 9, borderRadius: 4 }} />
      <div className="shimmer-sweep shrink-0" style={{ width: 44, height: 9, borderRadius: 4 }} />
    </div>
  );
}
