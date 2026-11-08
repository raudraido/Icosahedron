import { useCallback, useEffect, useRef, useState } from "react";
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
const PANEL_WIDTH = 300;

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
  /** `pin` only for AirPlay devices that asked for one (see `pinDeviceId`). */
  onConnect: (deviceId: string, pin?: string) => void;
  /** AirPlay device currently showing a PIN on its own screen — its row gets
   *  an inline PIN field below it. */
  pinDeviceId: string | null;
  onCancelPin: () => void;
  onDisconnect: () => void;
  /** Explicit rescan — opening the picker no longer scans automatically
   *  (see castManager.ts's discover()), so this is the only way to
   *  actually search for devices again once it's open. */
  onRescan: () => void;
  onClose: () => void;
}

export function CastPicker({
  x, y, track, volume, onVolumeChange, castVolume, onCastVolumeChange,
  devices, scanning, connectedDevice, connecting, connectError, onConnect, pinDeviceId, onCancelPin, onDisconnect, onRescan, onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

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

  // Anchored by the panel's *bottom* edge (CSS `bottom`), not its top: the
  // device list fills in after opening (discovery is async), so the panel
  // grows while open. A top-anchored panel would grow downward over the
  // trigger and past the window edge; a bottom-anchored one grows upward
  // and the trigger button stays put. Width is fixed (PANEL_WIDTH), so no
  // measuring is needed. Shared with the resize handler below.
  const reposition = useCallback((anchorX: number, anchorY: number) => {
    setPos({ x: anchorX, y: anchorY });
  }, []);

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
        position: "fixed", zIndex: 1000,
        left: Math.max(12, Math.min(pos.x - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 12)),
        bottom: Math.max(12, window.innerHeight - pos.y),
        background: PANEL_BG, border: "1px solid var(--border)",
        borderRadius: 10, boxShadow: PANEL_SHADOW,
        width: PANEL_WIDTH,
        // The panel grows upward from its bottom anchor, so cap it at the
        // space above the anchor and scroll the list beyond that.
        maxHeight: Math.max(120, pos.y - 12), overflowY: "auto", overflowX: "hidden",
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
          <div key={d.id}>
          <Row title={d.reachable ? undefined : "Not reachable from this network"}>
            <Icon
              src={d.protocol === "dlna" ? "img/dlna.png" : d.protocol === "airplay" ? "img/airplay.png" : "img/cast.png"}
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
          {pinDeviceId === d.id && !isConnected && (
            <PinEntry busy={connecting} onSubmit={(pin) => onConnect(d.id, pin)} onCancel={onCancelPin} />
          )}
          </div>
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

// Inline PIN field under an AirPlay device's row — the receiver (e.g. an
// Apple TV) is already displaying the 4-digit code by the time this shows.
function PinEntry({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit: (pin: string) => void; onCancel: () => void }) {
  const [pin, setPin] = useState("");
  const ready = pin.length >= 4 && !busy;
  return (
    <div className="flex items-center" style={{ gap: 8, padding: "0 14px 10px", paddingLeft: 14 + ICON_COL_WIDTH + 10 }}>
      <input
        autoFocus
        inputMode="numeric"
        maxLength={8}
        placeholder="PIN shown on device"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && ready) onSubmit(pin);
          if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
        }}
        style={{
          flex: 1, minWidth: 0, height: 28, padding: "0 8px", borderRadius: 6,
          border: "1px solid var(--border)", background: "transparent",
          color: "var(--text-primary)", fontSize: "var(--fs-secondary)", outline: "none",
        }}
      />
      <button
        onClick={() => onSubmit(pin)}
        disabled={!ready}
        style={{
          height: 28, padding: "0 10px", borderRadius: 6, border: "none",
          cursor: ready ? "pointer" : "default", opacity: ready ? 1 : 0.5,
          background: "var(--accent)", color: "var(--main-bg)", fontSize: "var(--fs-small)",
        }}
      >
        Pair
      </button>
    </div>
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
