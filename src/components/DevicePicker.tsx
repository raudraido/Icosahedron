import { useEffect, useRef, useState } from "react";
import { Laptop, Monitor, Smartphone, Play, Pause, SkipBack, SkipForward, MonitorSpeaker } from "lucide-react";
import { useSync, syncActions, setSyncUrl, type SyncDevice } from "../lib/sync";

// "Devices" popover for PlayerBar — the sync server's view of this user's
// players: who is online, who is playing, remote controls for the active one,
// and "Play here" to pull playback over (continue on another device).
const KIND_ICON: Record<SyncDevice["kind"], typeof Laptop> = { electron: Monitor, web: Laptop, mobile: Smartphone };

export function DevicePicker() {
  const [open, setOpen] = useState(false);
  const { status, devices, activeDeviceId, deviceId, remote, syncUrl } = useSync();
  const [urlDraft, setUrlDraft] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const online = status === "online";
  const elsewhere = online && activeDeviceId && activeDeviceId !== deviceId;
  const track = remote?.queue?.[remote.index];
  const active = devices.find((d) => d.deviceId === activeDeviceId);

  const ctrl = (cmd: string) => activeDeviceId && syncActions.command(activeDeviceId, cmd);
  const btn = { width: 32, height: 32, borderRadius: 16, border: "none", background: "transparent", cursor: "pointer", color: "var(--text-primary)" } as const;

  return (
    <div ref={ref} style={{ position: "relative" }} className="shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        title={online ? (elsewhere ? `Playing on ${active?.name}` : "Devices") : "Devices (sync offline)"}
        className="flex items-center justify-center"
        style={{ width: 40, height: 40, borderRadius: 20, background: "transparent", border: "none", cursor: "pointer", color: elsewhere ? "var(--accent)" : "var(--text-secondary)", opacity: online || !syncUrl ? 1 : 0.5 }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <MonitorSpeaker size={22} />
      </button>

      {open && (
        <div
          style={{ position: "absolute", right: 0, bottom: 48, width: 300, background: "var(--main-bg)", borderRadius: 8, padding: 12, zIndex: 50, color: "var(--text-primary)", boxShadow: "0 4px 16px color-mix(in srgb, var(--text-primary) 15%, transparent)" }}
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

              {elsewhere && track && (
                <div style={{ marginBottom: 10, padding: 8, borderRadius: 6, background: "var(--hover-bg)" }}>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Playing on {active?.name}</div>
                  <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.title}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.artist}</div>
                  <div className="flex items-center justify-center" style={{ gap: 4, marginTop: 4 }}>
                    <button style={btn} onClick={() => ctrl("prev")} title="Previous"><SkipBack size={16} /></button>
                    <button style={btn} onClick={() => ctrl("toggle")} title="Play / pause">{remote?.playing ? <Pause size={18} /> : <Play size={18} />}</button>
                    <button style={btn} onClick={() => ctrl("next")} title="Next"><SkipForward size={16} /></button>
                  </div>
                </div>
              )}

              {devices.map((d) => {
                const Ic = KIND_ICON[d.kind] ?? Laptop;
                const isMe = d.deviceId === deviceId;
                const isActive = d.deviceId === activeDeviceId;
                return (
                  <div key={d.deviceId} className="flex items-center" style={{ gap: 8, padding: "6px 0" }}>
                    <Ic size={18} style={{ color: isActive ? "var(--accent)" : "var(--text-secondary)" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: isActive ? "var(--accent)" : "inherit" }}>
                        {d.name}{isMe ? " (this device)" : ""}
                      </div>
                      {isActive && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{remote?.playing ? "Playing" : "Active"}</div>}
                    </div>
                    {!isActive && remote?.queue?.length ? (
                      <button
                        onClick={() => syncActions.transfer(d.deviceId)}
                        style={{ fontSize: 12, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--text-secondary)", background: "transparent", color: "inherit", cursor: "pointer" }}
                      >{isMe ? "Play here" : "Send"}</button>
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
