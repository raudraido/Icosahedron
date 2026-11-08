// Platform adapter — the single seam between the shared React UI and whatever
// host it runs in (Electron today; browser/PWA and Capacitor mobile next).
// UI and store code must go through `platform`, never `window.electronAPI`.
import { createWebPlatform } from "./web";
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
  /** URL the UI puts in <img>/background-image for a Subsonic cover id. */
  coverUrl(coverId: string | null, size?: number): string;
  isWaylandLinux: boolean;
  onAudioEvent(cb: (payload: AudioEventPayload) => void): Unsubscribe;
  onUpdateDownloadProgress(cb: (payload: UpdateDownloadProgress) => void): Unsubscribe;
  onUpdateInstallerLaunching(cb: () => void): Unsubscribe;
  onCastDevices(cb: (payload: CastDevice[]) => void): Unsubscribe;
  onCastStatus(cb: (payload: CastPush) => void): Unsubscribe;
  onCastScanning(cb: (scanning: boolean) => void): Unsubscribe;
}


function electronPlatform(api: NonNullable<Window["electronAPI"]>): Platform {
  return {
    kind: "electron",
    invoke: (cmd, args) => api.invoke(cmd, args),
    coverUrl: (coverId, size = 200) => (coverId ? `cover://localhost/${encodeURIComponent(coverId)}?size=${size}` : ""),
    isWaylandLinux: !!api.isWaylandLinux,
    onAudioEvent: api.onAudioEvent,
    onUpdateDownloadProgress: api.onUpdateDownloadProgress,
    onUpdateInstallerLaunching: api.onUpdateInstallerLaunching,
    onCastDevices: api.onCastDevices,
    onCastStatus: api.onCastStatus,
    onCastScanning: api.onCastScanning,
  };
}

export const platform: Platform =
  typeof window !== "undefined" && window.electronAPI
    ? electronPlatform(window.electronAPI)
    : createWebPlatform();
