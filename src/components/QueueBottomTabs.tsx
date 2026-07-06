import { useState } from "react";
import { Icon } from "./Icon";

export type QueueTab = "queue" | "lyrics" | "info";

const TABS: { id: QueueTab; icon: string; label: string }[] = [
  { id: "queue", icon: "img/queue.png", label: "Queue" },
  { id: "lyrics", icon: "img/lyrics.png", label: "Lyrics" },
  { id: "info", icon: "img/info.png", label: "Info" },
];

// Matches queue_panel.py's _TabButton + bottom_bar exactly: 52px bar, 3 equal-
// width icon+label buttons, colors are the old app's own hardcoded grays (not
// theme tokens — same #555/#aaa pair the queue header's clear button already
// uses), accent only when the tab is active.
function TabButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  const color = active ? "var(--accent)" : hov ? "#aaaaaa" : "#555555";
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="flex-1 flex flex-col items-center justify-center"
      style={{ background: "transparent", border: "none", cursor: "pointer", gap: 2, paddingTop: 6, paddingBottom: 4 }}
    >
      <Icon src={icon} size={18} style={{ background: color }} />
      <span style={{ color, fontSize: 10, fontWeight: 700 }}>{label}</span>
    </button>
  );
}

export function QueueBottomTabs({ active, onChange }: { active: QueueTab; onChange: (tab: QueueTab) => void }) {
  return (
    <div
      className="flex shrink-0"
      style={{ height: 52, borderTop: "1px solid rgba(255,255,255,0.07)" }}
    >
      {TABS.map((t) => (
        <TabButton key={t.id} icon={t.icon} label={t.label} active={active === t.id} onClick={() => onChange(t.id)} />
      ))}
    </div>
  );
}
