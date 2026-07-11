import { Client, DefaultMediaReceiver, type CastMedia, type MediaStatus } from "castv2-client";

export type CastStatusEvent =
  | { kind: "status"; playing: boolean; currentTime: number; duration: number; volume: number }
  | { kind: "ended" }
  | { kind: "disconnected" }
  | { kind: "error"; message: string };

export interface CastTrackMetadata {
  title: string;
  subtitle?: string;
  artUrl?: string;
}

// Thin wrapper around castv2-client's Client + DefaultMediaReceiver — one
// instance per active cast session (castManager.ts owns at most one at a
// time). onStatus mirrors AudioEngineClient's callback-push shape so
// castManager.ts can treat this and (later) the DLNA device identically.
export class ChromecastDevice {
  private client = new Client();
  private player: DefaultMediaReceiver | null = null;

  constructor(private host: string, private onStatus: (event: CastStatusEvent) => void) {
    this.client.on("error", (err) => this.onStatus({ kind: "error", message: err.message }));
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.once("error", reject);
      this.client.connect(this.host, () => {
        this.client.launch(DefaultMediaReceiver, (err, player) => {
          if (err) { reject(err); return; }
          this.player = player;
          player.on("status", (status) => this.emitStatus(status));
          player.on("close", () => this.onStatus({ kind: "disconnected" }));
          resolve();
        });
      });
    });
  }

  private emitStatus(status: MediaStatus): void {
    // FINISHED (ran off the end) vs. other IDLE reasons (CANCELLED/
    // INTERRUPTED/ERROR from an explicit stop/disconnect/load-replace) —
    // only FINISHED should drive queue auto-advance.
    if (status.playerState === "IDLE" && status.idleReason === "FINISHED") {
      this.onStatus({ kind: "ended" });
      return;
    }
    this.onStatus({
      kind: "status",
      playing: status.playerState === "PLAYING" || status.playerState === "BUFFERING",
      currentTime: status.currentTime,
      duration: status.media?.duration ?? 0,
      volume: status.volume?.level ?? 1,
    });
  }

  loadMedia(url: string, contentType: string, metadata: CastTrackMetadata, startPositionSecs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.player) { reject(new Error("not connected")); return; }
      const media: CastMedia = {
        contentId: url,
        contentType,
        streamType: "BUFFERED",
        metadata: {
          type: 0,
          metadataType: 0,
          title: metadata.title,
          subtitle: metadata.subtitle,
          images: metadata.artUrl ? [{ url: metadata.artUrl }] : undefined,
        },
      };
      this.player!.load(media, { autoplay: true, currentTime: startPositionSecs }, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  pause(): void { this.player?.pause(); }
  resume(): void { this.player?.play(); }
  stop(): void { this.player?.stop(); }
  seek(seconds: number): void { this.player?.seek(seconds); }
  setVolume(volume: number): void { this.client.setVolume({ level: Math.max(0, Math.min(1, volume)) }, () => {}); }

  disconnect(): void { this.client.close(); }
}
