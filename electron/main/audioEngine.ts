import { BrowserWindow } from "electron";
import { AudioEngine } from "icosahedron-audio-engine";

export interface AudioEventPayload {
  kind: "progress" | "playing" | "track_switched" | "ended" | "error";
  currentTime?: number;
  duration?: number;
  buffering?: boolean;
  message?: string;
}

// Wraps the native gapless engine (native/audio-engine — a napi-rs port of
// psysonic's rodio/Symphonia audio crate) — mirrors SubsonicClient's
// plain-class-over-ipcMain.handle pattern. Unlike SubsonicClient, this is
// constructed eagerly alongside the window (not lazily on connect) since it
// needs `webContents` to push progress/track-switch events to the renderer —
// the app's first main→renderer push channel (everything else is
// renderer-initiated `invoke`).
export class AudioEngineClient {
  private engine: AudioEngine;

  constructor(win: BrowserWindow) {
    this.engine = new AudioEngine((err: Error | null, payload: AudioEventPayload) => {
      if (err) return;
      if (win.isDestroyed()) return;
      win.webContents.send("audio_event", payload);
    });
  }

  play(url: string, volume: number, durationHint: number, manual: boolean, startPaused: boolean): Promise<void> {
    return this.engine.play(url, volume, durationHint, manual, startPaused);
  }

  chainPreload(url: string, durationHint: number): Promise<void> {
    return this.engine.chainPreload(url, durationHint);
  }

  pause(): void {
    this.engine.pause();
  }

  resume(): void {
    this.engine.resume();
  }

  stop(): void {
    this.engine.stop();
  }

  seek(seconds: number): void {
    this.engine.seek(seconds);
  }

  setVolume(volume: number): void {
    this.engine.setVolume(volume);
  }

  /** 10-band EQ + preamp (dB) — applies live to current and future sources. */
  setEq(enabled: boolean, preampDb: number, bandsDb: number[]): void {
    this.engine.setEq(enabled, preampDb, bandsDb);
  }

  analyzeBpm(url: string): Promise<number> {
    return this.engine.analyzeBpm(url);
  }
}
