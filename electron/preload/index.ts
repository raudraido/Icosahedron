import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (cmd: string, args?: Record<string, unknown>) => ipcRenderer.invoke(cmd, args),
  // Static boot-time fact, read directly here rather than round-tripped
  // through ipcMain like everything else — preload runs in a full Node
  // context (contextIsolation only walls off the renderer's main world), so
  // process.platform/env are already available with no IPC needed. Settings.tsx's
  // ColorDial uses this to hide the "pick from screen" EyeDropper button:
  // Chromium's EyeDropper implementation crashes the whole renderer under
  // the native Wayland Ozone backend electron/main/index.ts forces on
  // Wayland sessions (XWayland, which Electron uses everywhere else on
  // Linux, doesn't hit this — the EyeDropper works fine there).
  isWaylandLinux: process.platform === "linux" && process.env["XDG_SESSION_TYPE"] === "wayland",
  // First main→renderer push channel in the app (everything else is
  // renderer-initiated `invoke`) — carries native audio-engine progress/
  // playing/track_switched/ended/error events. Returns an unsubscribe fn.
  onAudioEvent: (cb: (payload: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on("audio_event", listener);
    return () => ipcRenderer.removeListener("audio_event", listener);
  },
  // Second main→renderer push channel — byte-level progress while
  // downloadAndInstallUpdate (electron/main/updater.ts) streams the
  // installer/AppImage, since that single invoke() call only resolves once
  // (or never, if the app quits itself first — see UpdateBanner.tsx).
  onUpdateDownloadProgress: (cb: (payload: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on("update_download_progress", listener);
    return () => ipcRenderer.removeListener("update_download_progress", listener);
  },
  // Fired once the installer/AppImage has been handed off to the OS shell,
  // shortly before this app quits — see updater.ts's downloadAndInstallUpdate
  // for why the app doesn't just quit silently at that point.
  onUpdateInstallerLaunching: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("update_installer_launching", listener);
    return () => ipcRenderer.removeListener("update_installer_launching", listener);
  },
  // Pushed after a background rescan (see castManager.ts's discover()/
  // rescan()) resolves — the picker opens to an instantly-cached list and
  // live-updates via this channel if that cache was stale.
  onCastDevices: (cb: (payload: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on("cast_devices", listener);
    return () => ipcRenderer.removeListener("cast_devices", listener);
  },
  // Connected/status/ended/disconnected/error events for the single active
  // cast session — see castManager.ts's CastPush union.
  onCastStatus: (cb: (payload: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on("cast_status", listener);
    return () => ipcRenderer.removeListener("cast_status", listener);
  },
  // True while castManager.ts's rescan() is in flight — CastPicker.tsx shows
  // "Scanning…"/"Refreshing…" while this is true instead of leaving the
  // user staring at an empty or stale-looking list with no feedback.
  onCastScanning: (cb: (scanning: boolean) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, scanning: boolean) => cb(scanning);
    ipcRenderer.on("cast_scanning", listener);
    return () => ipcRenderer.removeListener("cast_scanning", listener);
  },
});
