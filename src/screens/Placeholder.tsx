// Generic "coming soon" screen for tabs that exist in the old app's nav bar
// but aren't built out here yet — matches the old app's own placeholder for
// its not-yet-built Visualizer tab (a small, faded, letter-spaced label;
// window.py's _coming_soon_lbl), reused for every not-yet-implemented tab
// rather than each getting a bespoke one-off.
export function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <span
        style={{
          color: "var(--text-primary)",
          opacity: 0.25,
          fontSize: "var(--fs-small)",
          letterSpacing: "1px",
          textTransform: "uppercase",
        }}
      >
        {label} — Coming Soon™
      </span>
    </div>
  );
}
