import { useEffect, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Volume2 } from "lucide-react";
import { useSync, syncActions, remotePosition } from "../lib/sync";
import { useTarget } from "../lib/target";
import { CoverArt } from "./CoverArt";
import { DevicePicker } from "./DevicePicker";

// The bottom bar while another device is the target (docs/connect.md): it shows and controls THAT
// device's playback. The device button stays, highlighted, so switching back is one click.
const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

export function RemotePlayerBar() {
  const targetId = useTarget((s) => s.targetId);
  const { states, devices } = useSync();
  const st = targetId ? states[targetId] : undefined;
  const track = st?.queue?.[st.index];
  const device = devices.find((d) => d.deviceId === targetId);
  const name = device?.name ?? "device";
  const [, tick] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const [volume, setVolume] = useState(100);

  // The position moves on by itself between the other player's reports.
  useEffect(() => {
    const i = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(i);
  }, []);

  const duration = track?.duration_secs ?? 0;
  const pos = scrub ?? remotePosition(targetId);
  const ctrl = (cmd: string, args?: unknown) => targetId && syncActions.command(targetId, cmd, args);
  const iconBtn = (on?: boolean) => ({
    width: 36, height: 36, borderRadius: 18, border: "none", background: "transparent", cursor: track ? "pointer" : "default",
    color: on ? "var(--accent)" : "var(--text-primary)", opacity: track ? 1 : 0.4,
  } as const);
  const disabled = !track;

  return (
    <div
      className="flex items-center shrink-0"
      style={{ height: 132, background: "var(--footer-bg)", borderTop: "1px solid var(--border)", paddingLeft: 8, paddingRight: 12, gap: 16 }}
    >
      {/* left: cover and what plays there */}
      <div className="flex items-center shrink-0" style={{ gap: 12, width: "max(220px, 24%)", minWidth: 0 }}>
        <CoverArt coverId={track?.cover_id ?? null} size={84} className="w-[84px] h-[84px] rounded shrink-0" />
        <div style={{ minWidth: 0 }}>
          <div className="truncate" style={{ color: "var(--text-primary)", fontWeight: 600 }}>{track?.title ?? `Nothing playing on ${name}`}</div>
          <div className="truncate" style={{ color: "var(--text-secondary)", fontSize: 13 }}>{track?.artist ?? ""}</div>
          <div className="truncate" style={{ color: "var(--accent)", fontSize: 12, marginTop: 2 }}>Playing on {name}</div>
        </div>
      </div>

      {/* centre: transport and seek */}
      <div className="flex flex-col items-center flex-1" style={{ minWidth: 0, gap: 6 }}>
        <div className="flex items-center" style={{ gap: 6 }}>
          <button style={iconBtn(!!st?.shuffle)} disabled={disabled} title="Shuffle" onClick={() => targetId && syncActions.shuffle(targetId, !st?.shuffle)}><Shuffle size={18} /></button>
          <button style={iconBtn()} disabled={disabled} title="Previous" onClick={() => ctrl("prev")}><SkipBack size={20} /></button>
          <button style={iconBtn()} disabled={disabled} title="Play / pause" onClick={() => ctrl("toggle")}>{st?.playing ? <Pause size={26} /> : <Play size={26} />}</button>
          <button style={iconBtn()} disabled={disabled} title="Next" onClick={() => ctrl("next")}><SkipForward size={20} /></button>
          <button style={iconBtn(!!st?.repeat)} disabled={disabled} title="Repeat" onClick={() => targetId && syncActions.repeat(targetId, !st?.repeat)}><Repeat size={18} /></button>
        </div>
        <div className="flex items-center w-full" style={{ gap: 10, maxWidth: 720 }}>
          <span style={{ width: 40, textAlign: "right", fontSize: 12, color: "var(--text-secondary)" }}>{fmt(pos)}</span>
          <input
            type="range" min={0} max={Math.max(duration, 1)} step={0.5} value={Math.min(pos, Math.max(duration, 1))}
            disabled={disabled}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={() => { if (scrub !== null && targetId) { syncActions.seekOn(targetId, scrub); setScrub(null); } }}
            onKeyUp={() => { if (scrub !== null && targetId) { syncActions.seekOn(targetId, scrub); setScrub(null); } }}
            style={{ flex: 1, accentColor: "var(--accent)" }}
            aria-label="Playback position"
          />
          <span style={{ width: 40, fontSize: 12, color: "var(--text-secondary)" }}>-{fmt(Math.max(0, duration - pos))}</span>
        </div>
      </div>

      {/* right: volume (the phone has none) and the devices button */}
      <div className="flex items-center shrink-0" style={{ gap: 8 }}>
        {device && device.kind !== "mobile" && (
          <>
            <Volume2 size={18} style={{ color: "var(--text-secondary)" }} />
            <input
              type="range" min={0} max={100} value={volume} style={{ width: 90, accentColor: "var(--accent)" }} aria-label="Volume of the other device"
              onChange={(e) => { const v = Number(e.target.value); setVolume(v); ctrl("volume", { volume: v }); }}
            />
          </>
        )}
        <DevicePicker />
      </div>
    </div>
  );
}
