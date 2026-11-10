import React from "react";

// Building blocks shared by the settings screens (Settings.tsx, SyncSettings.tsx).

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-primary)", fontWeight: "var(--fw-emphasis)", letterSpacing: 1, textTransform: "uppercase" }}>
        {title}
      </span>
      {children}
    </div>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center" style={{ gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ width: 140, flexShrink: 0, color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{label}</span>
      <span className="truncate" style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)" }}>{value || "—"}</span>
    </div>
  );
}

export function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative", width: 38, height: 22, borderRadius: 11, padding: 2, cursor: disabled ? "default" : "pointer",
        border: "1px solid var(--border)",
        background: checked ? "var(--accent)" : "var(--hover-bg)",
        opacity: disabled ? 0.5 : 1,
        transition: "background 150ms",
      }}
    >
      <div
        style={{
          width: 16, height: 16, borderRadius: "50%", background: "#fff",
          transform: `translateX(${checked ? 16 : 0}px)`,
          transition: "transform 150ms",
        }}
      />
    </button>
  );
}

export function ToggleRow({ label, description, checked, onChange, disabled, divider = true }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; divider?: boolean }) {
  // The switch centers against just the label row (not the label+description
  // block as a whole) — see UI_MANIFEST.md's "ToggleRow: description text
  // must fit on one line" entry: centering against the combined block used
  // to put the switch at a different vertical spot on any row whose
  // description happened to wrap to 2 lines, reported as the toggle looking
  // "funky". Nesting the switch in its own row with only the label keeps it
  // pinned to the label's line regardless of how long the description is or
  // how many lines it wraps to.
  return (
    <div className="flex flex-col" style={{ gap: 4, padding: "8px 0", borderBottom: divider ? "1px solid var(--border)" : "none", opacity: disabled ? 0.5 : 1 }}>
      <div className="flex items-center justify-between" style={{ gap: 12 }}>
        <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)" }}>{label}</span>
        <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} />
      </div>
      {description && <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>{description}</span>}
    </div>
  );
}
