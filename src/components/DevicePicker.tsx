import { useEffect, useRef, useState } from "react";
import { Laptop, Monitor, Smartphone, MonitorSpeaker, Check, Tv } from "lucide-react";
import { useSync, syncActions, setSyncUrl, type SyncDevice } from "../lib/sync";
import { useTarget } from "../lib/target";
import { useStore } from "../store";

// "Devices" popover in the player bar: every device of the account and what it plays. Clicking one
// makes it the device the controls act on (the bar and the queue then show it, docs/connect.md);
// it only controls. *Send* moves this device's music to it, *Play here* brings its music here.
const KIND_ICON: Record<SyncDevice["kind"], typeof Laptop> = { electron: Monitor, web: Laptop, mobile: Smartphone, tv: Tv };

const smallBtn = {
  fontSize: 12, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--text-secondary)",
  background: "transparent", color: "inherit", cursor: "pointer", flexShrink: 0,
} as const;

export function DevicePicker() {
  const [open, setOpen] = useState(false);
  const { status, devices, deviceId, states, syncUrl } = useSync();
  const targetId = useTarget((s) => s.targetId);
  const localTrack = useStore((s) => s.queue[s.currentIndex]);
  const localPlaying = useStore((s) => s.playing);
  const [urlDraft, setUrlDraft] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const online = status === "online";
  const remoteTarget = online ? targetId : null;
  const targetName = devices.find((d) => d.deviceId === remoteTarget)?.name;

  return (
    <div ref={ref} style={{ position: "relative" }} className="shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        title={online ? (remoteTarget ? `Controlling ${targetName}` : "Devices") : "Devices (sync offline)"}
        className="flex flex-col items-center justify-center"
        style={{ width: 52, height: 44, borderRadius: 10, background: "transparent", border: "none", cursor: "pointer", color: remoteTarget ? "var(--accent)" : "var(--text-secondary)", opacity: online || !syncUrl ? 1 : 0.5, gap: 1 }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <MonitorSpeaker size={22} />
        {remoteTarget && targetName && <span className="truncate" style={{ fontSize: 9, fontWeight: 600, maxWidth: 48 }}>{targetName}</span>}
      </button>

      {open && (
        <div
          style={{ position: "absolute", right: 0, bottom: 52, width: 320, background: "var(--main-bg)", borderRadius: 8, padding: 12, zIndex: 50, color: "var(--text-primary)", boxShadow: "0 4px 16px color-mix(in srgb, var(--text-primary) 15%, transparent)" }}
        >
          {!syncUrl ? (
            <form onSubmit={(e) => { e.preventDefault(); setSyncUrl(urlDraft.trim()); }} className="flex flex-col gap-2">
              <div style={{ fontWeight: 600 }}>Sync server</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Address of your Icosahedron web engine, e.g. https://music.example.com</div>
              <input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="https://…" style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--text-secondary)", background: "transparent", color: "inherit" }} />
              <button type="submit" style={{ padding: 6, borderRadius: 6, border: "none", background: "var(--accent)", color: "white", cursor: "pointer" }}>Connect</button>
            </form>
          ) : (
            <>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                Devices {!online && <span style={{ fontWeight: 400, fontSize: 12, color: "var(--text-secondary)" }}>· {status === "connecting" ? "connecting…" : "offline"}</span>}
              </div>

              {devices.map((d) => {
                const Ic = KIND_ICON[d.kind] ?? Laptop;
                const isMe = d.deviceId === deviceId;
                const selected = (remoteTarget ?? deviceId) === d.deviceId;
                const remote = isMe ? undefined : states[d.deviceId];
                const track = isMe ? localTrack : remote?.queue?.[remote.index];
                const playing = isMe ? localPlaying : !!remote?.playing;
                return (
                  <div key={d.deviceId} className="flex items-center" style={{ gap: 8, padding: "6px 0" }}>
                    <button
                      onClick={() => syncActions.setTarget(isMe ? null : d.deviceId)}
                      className="flex items-center"
                      style={{ gap: 8, flex: 1, minWidth: 0, background: "transparent", border: "none", cursor: "pointer", textAlign: "left", color: "inherit", padding: 0 }}
                    >
                      <Ic size={18} style={{ color: playing ? "var(--accent)" : "var(--text-secondary)", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="truncate" style={{ color: selected ? "var(--accent)" : "inherit" }}>{d.name}{isMe ? " (this device)" : ""}</div>
                        <div className="truncate" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                          {track ? `${playing ? "Playing" : "Paused"}: ${track.title}` : "Idle"}
                        </div>
                      </div>
                      {selected && <Check size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                    </button>
                    {isMe && remoteTarget && states[remoteTarget]?.queue?.length ? (
                      <button style={smallBtn} onClick={() => { syncActions.transfer(deviceId, remoteTarget); syncActions.setTarget(null); }}>Play here</button>
                    ) : null}
                    {!isMe && localTrack ? (
                      <button style={smallBtn} onClick={() => { syncActions.transfer(d.deviceId, deviceId); syncActions.setTarget(d.deviceId); }}>Send</button>
                    ) : null}
                  </div>
                );
              })}
              {online && devices.length <= 1 && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>No other devices online.</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
