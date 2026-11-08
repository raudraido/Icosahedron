// Platform adapter — the single seam between the shared React UI and whatever
// host it runs in (Electron today; browser/PWA and Capacitor mobile next).
// UI and store code must go through `platform`, never `window.electronAPI`.
import type {
  AudioEventPayload,
  CastDevice,
  CastPush,
  UpdateDownloadProgress,
} from "../lib/api";

export type PlatformKind = "electron" | "web" | "mobile";
export type Unsubscribe = () => void;

export interface Platform {
  kind: PlatformKind;
  /** Command channel to the host backend (Subsonic client, audio, cast, …). */
  invoke<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** True under native Wayland Electron, where Chromium's EyeDropper crashes. */
  isWaylandLinux: boolean;
  onAudioEvent(cb: (payload: AudioEventPayload) => void): Unsubscribe;
  onUpdateDownloadProgress(cb: (payload: UpdateDownloadProgress) => void): Unsubscribe;
  onUpdateInstallerLaunching(cb: () => void): Unsubscribe;
  onCastDevices(cb: (payload: CastDevice[]) => void): Unsubscribe;
  onCastStatus(cb: (payload: CastPush) => void): Unsubscribe;
  onCastScanning(cb: (scanning: boolean) => void): Unsubscribe;
}

const noop: Unsubscribe = () => {};

function electronPlatform(api: NonNullable<Window["electronAPI"]>): Platform {
  return {
    kind: "electron",
    invoke: (cmd, args) => api.invoke(cmd, args),
    isWaylandLinux: !!api.isWaylandLinux,
    onAudioEvent: api.onAudioEvent,
    onUpdateDownloadProgress: api.onUpdateDownloadProgress,
    onUpdateInstallerLaunching: api.onUpdateInstallerLaunching,
    onCastDevices: api.onCastDevices,
    onCastStatus: api.onCastStatus,
    onCastScanning: api.onCastScanning,
  };
}

// Placeholder until the web adapter lands (stage 3): every command rejects and
// no events fire, so the UI loads but nothing talks to a backend yet.
function unsupportedPlatform(): Platform {
  return {
    kind: "web",
    invoke: (cmd) => Promise.reject(new Error(`Command "${cmd}" is not supported on this platform yet`)),
    isWaylandLinux: false,
    onAudioEvent: () => noop,
    onUpdateDownloadProgress: () => noop,
    onUpdateInstallerLaunching: () => noop,
    onCastDevices: () => noop,
    onCastStatus: () => noop,
    onCastScanning: () => noop,
  };
}

export const platform: Platform =
  typeof window !== "undefined" && window.electronAPI
    ? electronPlatform(window.electronAPI)
    : unsupportedPlatform();
