// castv2-client ships no type definitions — minimal ambient declaration
// covering only the surface castChromecast.ts actually calls (see
// node_modules/castv2-client/lib/{senders/platform.js,senders/default-media-receiver.js,
// controllers/{media,receiver}.js} for the real (untyped) implementation).
declare module "castv2-client" {
  import { EventEmitter } from "node:events";

  export interface ReceiverVolume {
    level?: number;
    muted?: boolean;
  }

  export interface MediaMetadata {
    type?: number;
    metadataType?: number;
    title?: string;
    subtitle?: string;
    images?: { url: string }[];
  }

  export interface CastMedia {
    contentId: string;
    contentType: string;
    streamType: "BUFFERED" | "LIVE";
    metadata?: MediaMetadata;
  }

  export interface MediaStatus {
    mediaSessionId: number;
    playerState: "IDLE" | "PLAYING" | "PAUSED" | "BUFFERING";
    currentTime: number;
    volume: { level: number; muted: boolean };
    idleReason?: string;
    media?: { duration: number };
  }

  export interface LoadOptions {
    autoplay?: boolean;
    currentTime?: number;
  }

  export class DefaultMediaReceiver extends EventEmitter {
    static APP_ID: string;
    load(media: CastMedia, options: LoadOptions, callback: (err: Error | null, status: MediaStatus) => void): void;
    play(callback?: (err: Error | null, status: MediaStatus) => void): void;
    pause(callback?: (err: Error | null, status: MediaStatus) => void): void;
    stop(callback?: (err: Error | null, status: MediaStatus) => void): void;
    seek(currentTime: number, callback?: (err: Error | null, status: MediaStatus) => void): void;
    getStatus(callback: (err: Error | null, status: MediaStatus) => void): void;
    on(event: "status", listener: (status: MediaStatus) => void): this;
    on(event: "close", listener: () => void): this;
  }

  export class Client extends EventEmitter {
    connect(options: string | { host: string; port?: number }, callback: () => void): void;
    close(): void;
    launch<T>(app: { new (...args: unknown[]): T; APP_ID: string }, callback: (err: Error | null, player: T) => void): void;
    setVolume(volume: ReceiverVolume, callback: (err: Error | null, volume: ReceiverVolume) => void): void;
    getVolume(callback: (err: Error | null, volume: ReceiverVolume) => void): void;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "close", listener: () => void): this;
  }
}
