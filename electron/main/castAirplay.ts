import { AirplayClient, type AirplayEvent } from "icosahedron-audio-engine";
import { app } from "electron";
import { join } from "node:path";
import type { CastStatusEvent, CastTrackMetadata } from "./castChromecast";
import type { DiscoveredCastDevice } from "./castDiscovery";

// AirPlay support wraps airplay2-rs through the native addon (see
// native/audio-engine/src/airplay.rs). One AirplayClient serves both
// discovery and the (single) active session — the native side caches the
// scanned devices, so connect() needs the same instance that scanned them.
//
// Unlike Chromecast/DLNA the receiver doesn't fetch a URL: the native side
// decodes and pushes PCM itself. loadMedia() below hands it the castProxy.ts
// URL; the native side downloads the track in the background while it is
// already being decoded and streamed, so playback starts without waiting for
// the whole file.

let native: AirplayClient | null = null;
let onNativeEvent: ((event: AirplayEvent) => void) | null = null;

function getNative(): AirplayClient {
  if (!native) {
    native = new AirplayClient(
      (err: Error | null, event: AirplayEvent) => {
        if (!err) onNativeEvent?.(event);
      },
      // Where airplay2-rs keeps paired-device identities, so a PIN-paired
      // receiver (Apple TV) only asks once.
      join(app.getPath("userData"), "airplay-identities"),
    );
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

// castManager.ts's CastSession contract (see there) — AirPlay implements the
// same shape so the orchestrator treats all three protocols identically.
export class AirplayDevice {
  // castPlayTrack is fire-and-forget, so loads can overlap (skipping tracks
  // fast, or the artwork fetch still running): only the newest one may start.
  private loadGeneration = 0;
  private loadAbort: AbortController | null = null;
  private connected = false;

  constructor(
    private deviceId: string,
    private host: string,
    private port: number,
    private pin: string | undefined,
    private onStatus: (event: CastStatusEvent) => void,
  ) {}

  // Rejects with "PIN_REQUIRED" / "PIN_WRONG" (src/store/index.ts's
  // connectCast keys off these) when the receiver wants a PIN — in that case
  // it's first told to put a fresh code on its screen, so by the time the
  // renderer shows the PIN field there's something to type in.
  async connect(): Promise<void> {
    const nativeClient = getNative();
    onNativeEvent = (ev) => this.handleNative(ev);
    try {
      await nativeClient.connect(this.deviceId.replace(/^airplay:/, ""), this.pin);
    } catch (err) {
      onNativeEvent = null;
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("PIN_REQUIRED") || message.includes("PIN_WRONG")) await this.showPinOnDevice();
      throw err;
    }
    this.connected = true;
  }

  // Apple TV only displays its pairing PIN once asked to (POST /pair-pin-start,
  // see airplay2-rs's README). Best-effort — devices with a fixed PIN just
  // don't have the endpoint. Apple TV answers 403 to any request without an
  // AirPlay User-Agent (Node's default "node" UA included), so send one.
  private async showPinOnDevice(): Promise<void> {
    try {
      const resp = await fetch(`http://${this.host}:${this.port}/pair-pin-start`, {
        method: "POST",
        headers: { "User-Agent": "AirPlay/320.20" },
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) console.log(`[airplay] pair-pin-start returned HTTP ${resp.status}`);
    } catch (err) {
      console.log(`[airplay] pair-pin-start failed: ${err instanceof Error ? err.message : err}`);
    }
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

  async loadMedia(url: string, contentType: string, metadata: CastTrackMetadata, startPositionSecs: number): Promise<void> {
    const generation = this.supersedeLoads();
    const ctl = this.loadAbort!;
    try {
      // The cover loads alongside the track and is sent once it's there — a
      // slow cover fetch must never delay the music.
      const artworkPromise = this.fetchArtwork(metadata.artUrl, ctl.signal);
      // The native side downloads + streams the track and pushes title/artist
      // and the progress bar to the receiver's now-playing screen
      // (SET_PARAMETER), re-sending them on seek. The content type is only a
      // format hint for the decoder.
      await getNative().play(url, startPositionSecs, { title: metadata.title, artist: metadata.subtitle }, contentType);
      const artwork = await artworkPromise;
      if (artwork && generation === this.loadGeneration) {
        await getNative().setArtwork(artwork.bytes, artwork.contentType);
      }
    } catch (err) {
      // A superseded load is not an error — the newer track is what matters.
      if (generation !== this.loadGeneration) return;
      throw err;
    }
  }

  // Invalidates any in-flight load (new track, stop, disconnect) and returns
  // the new generation number.
  private supersedeLoads(): number {
    this.loadAbort?.abort();
    this.loadAbort = new AbortController();
    return ++this.loadGeneration;
  }

  // Receivers only decode JPEG/PNG artwork; anything else (or a failed fetch)
  // just means no cover on the TV, never a failed cast.
  private async fetchArtwork(artUrl: string | undefined, signal: AbortSignal): Promise<{ bytes: Buffer; contentType: string } | null> {
    if (!artUrl) return null;
    try {
      const resp = await fetch(artUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
      if (!resp.ok) return null;
      const contentType = (resp.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (contentType !== "image/jpeg" && contentType !== "image/png") return null;
      return { bytes: Buffer.from(await resp.arrayBuffer()), contentType };
    } catch (err) {
      console.log(`[airplay] artwork fetch failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  pause(): void { void getNative().pause().catch(() => {}); }
  resume(): void { void getNative().resume().catch(() => {}); }
  stop(): void {
    this.supersedeLoads(); // a load still downloading must not start playing after a stop
    void getNative().stop().catch(() => {});
  }
  seek(seconds: number): void { void getNative().seek(seconds).catch(() => {}); }
  setVolume(volume: number): void { void getNative().setVolume(volume).catch(() => {}); }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.supersedeLoads();
    onNativeEvent = null;
    void getNative().disconnect().catch(() => {});
  }
}
