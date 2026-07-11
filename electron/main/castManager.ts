import type { BrowserWindow } from "electron";
import type { SubsonicClient } from "./subsonic";
import { scanCastDevices, type DiscoveredCastDevice } from "./castDiscovery";
import { ChromecastDevice, type CastStatusEvent, type CastTrackMetadata } from "./castChromecast";
import { DlnaDevice } from "./castDlna";
import { CastProxyServer } from "./castProxy";
import { contentTypeForFormat } from "./castDidl";

// Structural contract both device wrappers satisfy — lets this file treat
// an active Chromecast or DLNA session identically everywhere below.
interface CastSession {
  connect(): Promise<void>;
  loadMedia(url: string, contentType: string, metadata: CastTrackMetadata, startPositionSecs: number): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  disconnect(): void;
}

export interface CastDevice {
  id: string;
  name: string;
  protocol: "chromecast" | "dlna";
  /** False when a real TCP probe to the device couldn't connect — see
   *  castDiscovery.ts's probeReachable(). connect() still rejects these
   *  server-side (defense in depth), but CastPicker.tsx greys them out and
   *  disables the click so the user gets that signal upfront. */
  reachable: boolean;
}

export interface CastTrackInput {
  trackId: string;
  title: string;
  artist: string;
  coverId: string | null;
  format: string | null;
  positionSecs: number;
}

// castChromecast.ts's CastStatusEvent only covers what a device itself can
// report — "connected" only exists at this orchestration layer, once
// connect() has actually resolved.
export type CastPush = CastStatusEvent | { kind: "connected"; device: CastDevice };

function toPublicDevice(d: DiscoveredCastDevice): CastDevice {
  return { id: d.id, name: d.name, protocol: d.protocol, reachable: d.reachable };
}

// Orchestrator — the only cast-related class electron/main/index.ts talks
// to. Owns the discovered-device cache, the single active session (at most
// one device connected at a time), the shared HTTP proxy, and pushes
// cast_devices/cast_status to the renderer (guarded on win.isDestroyed(),
// matching AudioEngineClient's own push pattern).
export class CastManager {
  private proxy: CastProxyServer;
  private deviceCache = new Map<string, DiscoveredCastDevice>();
  private scanning = false;
  private session: CastSession | null = null;
  private connectedDevice: CastDevice | null = null;

  constructor(
    private win: BrowserWindow,
    getClient: () => SubsonicClient | null,
  ) {
    this.proxy = new CastProxyServer(getClient);
  }

  private send(payload: CastPush | CastDevice[]): void {
    if (this.win.isDestroyed()) return;
    this.win.webContents.send(Array.isArray(payload) ? "cast_devices" : "cast_status", payload);
  }

  private sendScanning(scanning: boolean): void {
    if (this.win.isDestroyed()) return;
    this.win.webContents.send("cast_scanning", scanning);
  }

  // Returns the cache instantly so the picker opens without a visible
  // delay, but always kicks a fresh background scan too (pushing
  // cast_devices once it resolves) — opening the picker is a deliberate,
  // infrequent user action, not a hot loop worth gating behind a staleness
  // timer. A previous 30s-staleness gate here silently skipped rescanning
  // on a quick reopen, which just reads as "the app can't find my device"
  // with zero feedback about why — not worth the network traffic it saves.
  async discover(): Promise<CastDevice[]> {
    const cached = [...this.deviceCache.values()].map(toPublicDevice);
    this.rescan();
    return cached;
  }

  private rescan(): void {
    if (this.scanning) return;
    this.scanning = true;
    this.sendScanning(true);
    scanCastDevices()
      .then((devices) => {
        this.deviceCache.clear();
        for (const d of devices) this.deviceCache.set(d.id, d);
        this.send(devices.map(toPublicDevice));
      })
      .catch(() => { /* best-effort — picker just keeps showing the stale cache */ })
      .finally(() => { this.scanning = false; this.sendScanning(false); });
  }

  async connect(deviceId: string): Promise<void> {
    const device = this.deviceCache.get(deviceId);
    if (!device) throw new Error("Unknown cast device — try rescanning");
    // CastPicker.tsx already disables the click for these — this is defense
    // in depth against a stale device list, giving a clear message instead
    // of letting it fail several seconds later with a raw EHOSTUNREACH.
    if (!device.reachable) throw new Error("Not reachable from this network");
    await this.disconnect();

    await this.proxy.start();

    let session: CastSession;
    if (device.protocol === "chromecast") {
      session = new ChromecastDevice(device.host, (event) => this.handleStatus(event));
    } else {
      if (!device.avTransportControlUrl) throw new Error("Missing DLNA control URL — try rescanning");
      session = new DlnaDevice(device.avTransportControlUrl, device.renderingControlControlUrl ?? null, (event) => this.handleStatus(event));
    }

    try {
      await session.connect();
    } catch (err) {
      // Without this, a failed attempt (e.g. EHOSTUNREACH for a device on
      // an unreachable subnet) leaves its socket/error-listener behind —
      // each retry piles up another one, eventually tripping Node's
      // MaxListenersExceededWarning on the underlying castv2 socket.
      session.disconnect();
      this.proxy.stop();
      throw err;
    }
    // Local playback is left running unchanged — cast is a second,
    // independent output alongside it, not a takeover. src/store/index.ts
    // relays play/pause/seek/track-change to both once castConnected, and
    // connectCast() (store action) separately catches this new session up
    // to whatever's already playing locally.
    this.session = session;
    this.connectedDevice = toPublicDevice(device);
    this.send({ kind: "connected", device: this.connectedDevice });
  }

  async disconnect(): Promise<void> {
    if (!this.session) return;
    this.session.stop();
    this.session.disconnect();
    this.session = null;
    this.connectedDevice = null;
    this.proxy.stop();
  }

  private handleStatus(event: CastStatusEvent): void {
    if (event.kind === "disconnected" || event.kind === "error") {
      // Without this, DlnaDevice's poll setInterval (a Node timer, kept
      // alive by the event loop regardless of whether anything still
      // references the object) would keep firing forever against a device
      // we've already given up on — session.disconnect() is what actually
      // clears it (Chromecast's socket close() here is a harmless no-op on
      // an already-closing connection).
      this.session?.disconnect();
      this.session = null;
      this.connectedDevice = null;
      this.proxy.stop();
    }
    this.send(event);
  }

  async playTrack(input: CastTrackInput): Promise<void> {
    if (!this.session) throw new Error("Not connected to a cast device");
    const audioUrl = this.proxy.audioUrlFor(input.trackId);
    const artUrl = input.coverId ? this.proxy.artUrlFor(input.coverId) : undefined;
    await this.session.loadMedia(
      audioUrl,
      contentTypeForFormat(input.format),
      { title: input.title, subtitle: input.artist, artUrl },
      input.positionSecs,
    );
  }

  pause(): void { this.session?.pause(); }
  resume(): void { this.session?.resume(); }
  stop(): void { this.session?.stop(); }
  seek(seconds: number): void { this.session?.seek(seconds); }
  setVolume(volume: number): void { this.session?.setVolume(volume); }

  teardown(): void {
    this.session?.disconnect();
    this.session = null;
    this.proxy.stop();
  }
}
