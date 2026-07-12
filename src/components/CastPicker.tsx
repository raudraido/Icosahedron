import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { CoverArt } from "./CoverArt";
import type { CastDevice, Track } from "../lib/api";

// Device picker for PlayerBar's cast button — ports the old app's
// _CastPopup/_DeviceRow (cast_manager.py) layout: now-playing header, a
// permanent "This device" row with a volume slider, then one row per
// discovered device (protocol icon + name + a slider that only shows for
// the currently-connected device + a checkbox). Clicking a row's checkbox
// toggles that device (connects if idle, disconnects if it's the active
// one) — same as the old app, and distinct from clicking the row itself, so
// dragging the slider can't accidentally toggle the connection.
const PANEL_BG = "var(--main-bg)";
const PANEL_SHADOW = "0 4px 16px color-mix(in srgb, var(--text-primary) 15%, transparent)";
const ICON_COL_WIDTH = 20;

interface Props {
  /** Anchor's *right* edge (not a top-left position like ContextMenu/
   *  ColumnFilterPopup/BpmMenu use) — the cast button sits in the window's
   *  bottom-right corner, so opening leftward from its right edge is the
   *  natural direction, rather than always needing the clamp below to
   *  invert a rightward-opening attempt that never fits. */
  x: number;
  /** Anchor's *bottom* edge, same reasoning — opens upward from here. */
  y: number;
  track: Track | null;
  /** "This device" row's own volume — independent of `castVolume` below. */
  volume: number;
  onVolumeChange: (v: number) => void;
  /** Connected device's own volume — independent of `volume` above; local
   *  and cast keep separate sliders, matching the old app. */
  castVolume: number;
  onCastVolumeChange: (v: number) => void;
  devices: CastDevice[];
  /** True while a background rescan is in flight — shown as "Scanning…"
   *  (no devices yet) or "Refreshing…" (below an already-populated list),
   *  matching the old app's _CastPopup.refresh(). */
  scanning: boolean;
  connectedDevice: CastDevice | null;
  connecting: boolean;
  /** Set when the last connect attempt failed (e.g. device unreachable) —
   *  shown inline instead of failing silently. */
  connectError: string | null;
  onConnect: (deviceId: string) => void;
  onDisconnect: () => void;
  /** Explicit rescan — opening the picker no longer scans automatically
   *  (see castManager.ts's discover()), so this is the only way to
   *  actually search for devices again once it's open. */
  onRescan: () => void;
  onClose: () => void;
}

export function CastPicker({
  x, y, track, volume, onVolumeChange, castVolume, onCastVolumeChange,
  devices, scanning, connectedDevice, connecting, connectError, onConnect, onDisconnect, onRescan, onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, ready: false });

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("[data-cast-trigger]")) return;
      if (ref.current && !ref.current.contains(target)) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Opens upward-and-leftward from the button's top-right corner (the
  // natural direction for a bottom-right-corner trigger) before falling
  // back to the same clamp-into-viewport ContextMenu.tsx/BpmMenu.tsx use —
  // that clamp is still here as a safety net (e.g. a very short window),
  // but shouldn't normally need to do anything now. Shared with the resize
  // handler below so both compute a position the exact same way.
  const reposition = useCallback((anchorX: number, anchorY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const naturalLeft = anchorX - rect.width;
    const naturalTop = anchorY - rect.height;
    const clampedX = Math.max(12, Math.min(naturalLeft, window.innerWidth - rect.width - 12));
    const clampedY = Math.max(12, Math.min(naturalTop, window.innerHeight - rect.height - 12));
    setPos({ x: clampedX, y: clampedY, ready: true });
  }, []);

  useLayoutEffect(() => {
    reposition(x, y);
  }, [x, y, reposition]);

  // The trigger button lives in the window's bottom-right corner, so
  // resizing the window moves it — without this, the already-open popup
  // stays pinned to the screen coordinate it opened at and visibly drifts
  // away from the button. Re-reads the button's own live rect (same -4
  // offset PlayerBar.tsx's click handler uses) rather than relying on the
  // x/y props, which only ever reflect the position at open time.
  useEffect(() => {
    function onResize() {
      const trigger = document.querySelector<HTMLElement>("[data-cast-trigger]");
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      reposition(rect.right, rect.top - 4);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [reposition]);

  function toggle(device: CastDevice) {
    if (connectedDevice?.id === device.id) onDisconnect();
    else onConnect(device.id);
  }

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed", top: pos.y, left: pos.x, zIndex: 1000,
        visibility: pos.ready ? "visible" : "hidden",
        background: PANEL_BG, border: "1px solid var(--border)",
        borderRadius: 10, boxShadow: PANEL_SHADOW,
        width: 300,
        // Position is already clamped into the viewport above, but that
        // alone doesn't stop a long device list from growing taller than
        // the window — cap + scroll it too, same as ContextMenu.tsx's
        // submenu (maxHeight: min(..., calc(100vh - 16px))).
        maxHeight: "calc(100vh - 24px)", overflowY: "auto", overflowX: "hidden",
      }}
    >
      {/* Now-playing header */}
      <div className="flex items-center" style={{ gap: 12, padding: "12px 14px" }}>
        <CoverArt coverId={track?.cover_id ?? null} size={50} className="rounded shrink-0" style={{ width: 50, height: 50 }} />
        <div className="min-w-0 flex-1">
          <p className="truncate" style={{ fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)", color: "var(--text-primary)" }}>
            {track ? track.title : "Nothing playing"}
          </p>
          {track && (
            <p className="truncate" style={{ fontSize: "var(--fs-small)", color: "var(--text-secondary)" }}>
              {track.album ? `${track.artist}  —  ${track.album}` : track.artist}
            </p>
          )}
        </div>
        <RefreshButton onClick={onRescan} spinning={scanning} />
      </div>
      <div style={{ height: 1, background: "var(--border)" }} />

      {/* "This device" — permanent, no toggle, always shows its own slider */}
      <Row>
        <span style={{ width: ICON_COL_WIDTH, flexShrink: 0 }} />
        <span style={{ flex: 1, color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>This device</span>
        <VolumeSlider value={volume} onChange={onVolumeChange} />
      </Row>
      <div style={{ height: 1, background: "var(--border)" }} />

      {connectError && (
        <div
          className="truncate"
          title={connectError}
          style={{ padding: "8px 14px", fontSize: "var(--fs-small)", color: "var(--error)" }}
        >
          Couldn't connect: {connectError}
        </div>
      )}

      {/* Devices */}
      {devices.length === 0 && (
        <div style={{ padding: "10px 14px", fontSize: "var(--fs-secondary)", color: "var(--text-secondary)", opacity: 0.6 }}>
          {scanning ? "Scanning…" : "No devices found"}
        </div>
      )}
      {devices.map((d) => {
        const isConnected = connectedDevice?.id === d.id;
        return (
          <Row key={d.id} title={d.reachable ? undefined : "Not reachable from this network"}>
            <Icon
              src={d.protocol === "dlna" ? "img/dlna.png" : "img/cast.png"}
              size={ICON_COL_WIDTH}
              style={{ background: "var(--accent)", flexShrink: 0, opacity: d.reachable ? 1 : 0.4 }}
            />
            <span
              className="truncate"
              style={{ flex: 1, color: "var(--text-primary)", fontSize: "var(--fs-secondary)", opacity: d.reachable ? 1 : 0.4 }}
            >
              {d.name}
            </span>
            {isConnected && <VolumeSlider value={castVolume} onChange={onCastVolumeChange} />}
            <CheckBox checked={isConnected} disabled={connecting || !d.reachable} onClick={() => toggle(d)} />
          </Row>
        );
      })}
      {devices.length > 0 && scanning && (
        <div style={{ padding: "6px 14px 8px", fontSize: "var(--fs-small)", color: "var(--text-secondary)", opacity: 0.6 }}>
          Refreshing…
        </div>
      )}
    </div>,
    document.body,
  );
}

function Row({ children, title }: { children: React.ReactNode; title?: string }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="flex items-center"
      title={title}
      style={{ position: "relative", gap: 10, padding: "0 14px", height: 44 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children}
      {hover && (
        <div
          className="absolute rounded-lg"
          style={{ inset: "1px 8px", zIndex: -1, background: "var(--hover-bg)", pointerEvents: "none" }}
        />
      )}
    </div>
  );
}

function RefreshButton({ onClick, spinning }: { onClick: () => void; spinning: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={spinning}
      title="Refresh devices"
      className="flex items-center justify-center shrink-0"
      style={{
        width: 26, height: 26, borderRadius: 6, cursor: spinning ? "default" : "pointer",
        background: "transparent", border: "none", color: "var(--text-secondary)",
        opacity: spinning ? 0.5 : 1,
      }}
    >
      <Icon
        src="img/refresh.png"
        size={15}
        style={{ background: "var(--text-secondary)", animation: spinning ? "spinner-rotate 800ms linear infinite" : undefined }}
      />
    </button>
  );
}

function VolumeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="range" min={0} max={100} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      onClick={(e) => e.stopPropagation()}
      className="cursor-pointer shrink-0"
      style={{ width: 100, height: 4, accentColor: "var(--accent)" }}
    />
  );
}

function CheckBox({ checked, disabled, onClick }: { checked: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center shrink-0"
      style={{
        width: 18, height: 18, borderRadius: 4, cursor: disabled ? "default" : "pointer",
        border: checked ? "none" : "1px solid var(--border)",
        background: checked ? "transparent" : "color-mix(in srgb, var(--text-primary) 8%, transparent)",
        color: "var(--accent)", fontSize: 13, fontWeight: "var(--fw-emphasis)", lineHeight: 1,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {checked ? "✓" : ""}
    </button>
  );
}
