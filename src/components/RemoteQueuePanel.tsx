import { useState } from "react";
import { X, GripVertical } from "lucide-react";
import { useSync, syncActions } from "../lib/sync";
import { useTarget } from "../lib/target";

// The queue panel while another device is the target: that device's queue. Click plays an item,
// the cross removes it, drag to reorder; everything is sent to the device.
function savedWidth(): number {
  try { const v = Number(localStorage.getItem("icosahedron_queue_panel_width")); if (v >= 200 && v <= 700) return v; } catch { /* ignore */ }
  return 320;
}

export function RemoteQueuePanel() {
  const targetId = useTarget((s) => s.targetId);
  const { states, devices } = useSync();
  const st = targetId ? states[targetId] : undefined;
  const queue = st?.queue ?? [];
  const name = devices.find((d) => d.deviceId === targetId)?.name ?? "device";
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  return (
    <div className="flex flex-col shrink-0" style={{ width: savedWidth(), borderLeft: "1px solid var(--border)", background: "var(--right-panel-bg, var(--main-bg))", minHeight: 0 }}>
      <div style={{ padding: "12px 12px 8px", color: "var(--text-primary)" }}>
        <div style={{ fontWeight: 600 }}>Queue</div>
        <div style={{ fontSize: 12, color: "var(--accent)" }}>{name}{queue.length ? ` · ${queue.length} tracks` : ""}</div>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        {!queue.length && <div style={{ padding: 12, fontSize: 13, color: "var(--text-secondary)" }}>Nothing queued on {name}. Play something and it starts there.</div>}
        {queue.map((t, i) => (
          <div
            key={`${t.id}-${i}`}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => { e.preventDefault(); setOver(i); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            onDrop={() => { if (drag !== null && drag !== i && targetId) syncActions.move(targetId, drag, i); setDrag(null); setOver(null); }}
            className="flex items-center"
            style={{
              gap: 6, padding: "6px 8px", cursor: "pointer",
              background: i === st?.index ? "var(--hover-bg)" : "transparent",
              borderTop: over === i && drag !== null && drag !== i ? "2px solid var(--accent)" : "2px solid transparent",
            }}
            onClick={() => targetId && syncActions.jump(targetId, i)}
          >
            <GripVertical size={14} style={{ color: "var(--text-secondary)", flexShrink: 0, cursor: "grab" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="truncate" style={{ fontSize: 13, color: i === st?.index ? "var(--accent)" : "var(--text-primary)", fontWeight: i === st?.index ? 600 : 400 }}>{t.title}</div>
              <div className="truncate" style={{ fontSize: 12, color: "var(--text-secondary)" }}>{t.artist}</div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); if (targetId) syncActions.removeAt(targetId, i); }}
              title="Remove from queue" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 4 }}
            ><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
