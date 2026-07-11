import { useState } from "react";
import { Icon } from "./Icon";

export type QueueTab = "queue" | "lyrics" | "info";

const TABS: { id: QueueTab; icon: string; label: string }[] = [
  { id: "queue", icon: "img/queue.png", label: "Queue" },
  { id: "lyrics", icon: "img/lyrics.png", label: "Lyrics" },
  { id: "info", icon: "img/info.png", label: "Info" },
];

// Matches queue_panel.py's _TabButton + bottom_bar exactly: 52px bar, 3 equal-
// width icon+label buttons, accent only when the tab is active — colors now
// follow the same var(--text-secondary) + var(--hover-bg) convention as
// TrackTable.tsx's PageBtn / QueuePanel.tsx's QueueToolbarBtn, so this stays
// theme-aware instead of the old app's hardcoded #555/#aaa grays.
function TabButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  const color = active ? "var(--accent)" : "var(--text-secondary)";
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="flex-1 flex flex-col items-center justify-center"
      style={{
        background: hov && !active ? "var(--hover-bg)" : "transparent",
        border: "none", cursor: "pointer", gap: 2, paddingTop: 6, paddingBottom: 4,
        transition: "background 150ms",
      }}
    >
      <Icon src={icon} size={18} style={{ background: color }} />
      <span style={{ color, fontSize: 10, fontWeight: "var(--fw-emphasis)" }}>{label}</span>
    </button>
  );
}

export function QueueBottomTabs({ active, onChange }: { active: QueueTab; onChange: (tab: QueueTab) => void }) {
  return (
    <div
      className="flex shrink-0"
      style={{ height: 52, borderTop: "1px solid var(--border)" }}
    >
      {TABS.map((t) => (
        <TabButton key={t.id} icon={t.icon} label={t.label} active={active === t.id} onClick={() => onChange(t.id)} />
      ))}
    </div>
  );
}
