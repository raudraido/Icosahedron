import { AirplayClient, type AirplayEvent } from "icosahedron-audio-engine";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { CastStatusEvent, CastTrackMetadata } from "./castChromecast";
import type { DiscoveredCastDevice } from "./castDiscovery";

// AirPlay support wraps airplay2-rs through the native addon (see
// native/audio-engine/src/airplay.rs). One AirplayClient serves both
// discovery and the (single) active session — the native side caches the
// scanned devices, so connect() needs the same instance that scanned them.
//
// Unlike Chromecast/DLNA the receiver doesn't fetch a URL: the native side
// decodes and pushes PCM itself, so loadMedia() below first pulls the track
// from castProxy.ts into a temp file and hands that path over.

let native: AirplayClient | null = null;
let onNativeEvent: ((event: AirplayEvent) => void) | null = null;

function getNative(): AirplayClient {
  if (!native) {
    native = new AirplayClient((err: Error | null, event: AirplayEvent) => {
      if (!err) onNativeEvent?.(event);
    });
  }
  return native;
}

export async function scanAirplay(timeoutMs: number): Promise<DiscoveredCastDevice[]> {
  try {
    const devices = await getNative().discover(timeoutMs);
    return devices.map((d) => ({
      id: `airplay:${d.id}`,
      name: d.name,
      protocol: "airplay" as const,
      host: d.host,
      port: d.port,
      // mDNS already told us the address; an actual TCP probe (as the other
      // protocols do) happens implicitly on connect.
      reachable: true,
    }));
  } catch (err) {
    console.log(`[airplay] scan failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/flac": "flac",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
};

// castManager.ts's CastSession contract (see there) — AirPlay implements the
// same shape so the orchestrator treats all three protocols identically.
export class AirplayDevice {
  private tempDir = join(tmpdir(), "icosahedron-airplay");
  private tempFile: string | null = null;
  private loadCounter = 0;
  private connected = false;

  constructor(private deviceId: string, private onStatus: (event: CastStatusEvent) => void) {}

  async connect(): Promise<void> {
    const nativeClient = getNative();
    onNativeEvent = (ev) => this.handleNative(ev);
    await nativeClient.connect(this.deviceId.replace(/^airplay:/, ""));
    this.connected = true;
  }

  private handleNative(ev: AirplayEvent): void {
    switch (ev.kind) {
      case "status":
        this.onStatus({
          kind: "status",
          playing: ev.playing ?? false,
          currentTime: ev.currentTime ?? 0,
          duration: ev.duration ?? 0,
          volume: ev.volume ?? 1,
        });
        break;
      case "ended":
        this.onStatus({ kind: "ended" });
        break;
      case "disconnected":
        this.onStatus({ kind: "disconnected" });
        break;
      case "error":
        // Keepalive/stream hiccups are reported but not fatal on their own;
        // a dead session surfaces as "disconnected" from the native poller.
        console.error("[airplay]", ev.message);
        break;
    }
  }

  async loadMedia(url: string, contentType: string, _metadata: CastTrackMetadata, startPositionSecs: number): Promise<void> {
    const path = await this.download(url, contentType);
    await getNative().play(path, startPositionSecs);
  }

  private async download(url: string, contentType: string): Promise<string> {
    await mkdir(this.tempDir, { recursive: true });
    const previous = this.tempFile;
    const file = join(this.tempDir, `${process.pid}-${++this.loadCounter}.${EXT_BY_CONTENT_TYPE[contentType] ?? "mp3"}`);
    const resp = await fetch(url);
    if (!resp.ok || !resp.body) throw new Error(`Couldn't fetch track for AirPlay (HTTP ${resp.status})`);
    await pipeline(Readable.fromWeb(resp.body as never), createWriteStream(file));
    this.tempFile = file;
    // The native side has already switched to the new file by the time the
    // caller's play() returns, so the previous one is safe to drop afterwards.
    if (previous) void rm(previous, { force: true });
    return file;
  }

  pause(): void { void getNative().pause().catch(() => {}); }
  resume(): void { void getNative().resume().catch(() => {}); }
  stop(): void { void getNative().stop().catch(() => {}); }
  seek(seconds: number): void { void getNative().seek(seconds).catch(() => {}); }
  setVolume(volume: number): void { void getNative().setVolume(volume).catch(() => {}); }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    onNativeEvent = null;
    void getNative().disconnect().catch(() => {});
    if (this.tempFile) void rm(this.tempFile, { force: true });
    this.tempFile = null;
  }
}
