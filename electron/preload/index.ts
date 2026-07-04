import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (cmd: string, args?: Record<string, unknown>) => ipcRenderer.invoke(cmd, args),
});
