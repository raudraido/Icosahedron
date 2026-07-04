/** Animated 3-bar "now playing" equalizer — used in the queue panel and the track table's leading # column. */
export function PlayingBars() {
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
