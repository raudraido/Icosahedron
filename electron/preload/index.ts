import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (cmd: string, args?: Record<string, unknown>) => ipcRenderer.invoke(cmd, args),
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
});
