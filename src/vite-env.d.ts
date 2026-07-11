/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any>;
    onAudioEvent: (cb: (payload: import("./lib/api").AudioEventPayload) => void) => () => void;
    onUpdateDownloadProgress: (cb: (payload: import("./lib/api").UpdateDownloadProgress) => void) => () => void;
    onUpdateInstallerLaunching: (cb: () => void) => () => void;
    onCastDevices: (cb: (payload: import("./lib/api").CastDevice[]) => void) => () => void;
    onCastStatus: (cb: (payload: import("./lib/api").CastPush) => void) => () => void;
    onCastScanning: (cb: (scanning: boolean) => void) => () => void;
  };
}
