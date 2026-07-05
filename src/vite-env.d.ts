/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any>;
    onAudioEvent: (cb: (payload: import("./lib/api").AudioEventPayload) => void) => () => void;
  };
}
