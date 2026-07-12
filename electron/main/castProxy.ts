import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { SubsonicClient } from "./subsonic";

// Chromecast/DLNA devices fetch media from a URL themselves (this app never
// relays audio bytes through its own playback pipeline) — but SubsonicClient's
// own stream/cover URLs embed a fresh, non-cacheable auth token on every call
// (see subsonic.ts's authParams()), so handing a receiver device one of those
// directly would have it re-deriving a URL that's already stale by the time
// it actually opens the connection. This server re-serves both under stable
// paths instead, and passes through the *real* upstream Content-Type/
// Content-Length/Range support rather than guessing — DLNA renderers in
// particular are picky about all three being correct.
function lanAddress(): string {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  // No LAN interface found (e.g. offline) — devices won't be reachable
  // anyway, but returning *something* keeps callers from crashing on a null.
  return "127.0.0.1";
}

// How long to wait, after a receiver's audio connection dies mid-stream,
// for it to reopen (typically via a Range request) before concluding it's
// not coming back. Real-world tracing against a Denon receiver showed a
// genuine "resume" reopen lands within single-digit milliseconds of the
// close every time — DLNA renderers reacting to a control command by
// closing and immediately reopening the stream at a new byte offset is
// normal, expected behavior, not a fault. 1500ms gives that a very
// comfortable margin while still being fast to notice a real stall.
const STREAM_STALL_GRACE_MS = 1500;

export class CastProxyServer {
  private server: Server | null = null;
  private port = 0;
  private host = "127.0.0.1";
  // GENA (UPnP eventing) NOTIFY callbacks — a DLNA renderer we're
  // subscribed to POSTs state changes here itself (see castDlna.ts's
  // subscribe()) instead of us having to poll it. Keyed by path so
  // castManager.ts can register/unregister the currently-connected DLNA
  // device's handler around each connect/disconnect cycle.
  private notifyHandlers = new Map<string, (body: string) => void>();
  // Real-world testing against a Denon receiver proved GetTransportInfo's
  // own RelTime can keep reporting normal advancing playback even while the
  // receiver's actual audio-fetch connection died and never reopened — the
  // transport clock and actual data delivery aren't reliably coupled on
  // this device. This is the one signal that *is* reliable: whether a died
  // connection for a given trackId gets reopened (see STREAM_STALL_GRACE_MS
  // above) or not. Keyed by trackId since that's the only identity a
  // renderer's request carries; at most one track is ever "pending" at a
  // time in practice (a stale entry for an abandoned track is harmless —
  // the callback below is generation-checked by the caller).
  private stallTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private stallHandler: ((trackId: string) => void) | null = null;

  constructor(private getClient: () => SubsonicClient | null) {}

  /** Registers a NOTIFY body handler under `path` and returns the full
   *  callback URL to hand a renderer as its GENA subscription CALLBACK. */
  registerNotify(path: string, handler: (body: string) => void): string {
    this.notifyHandlers.set(path, handler);
    return `http://${this.host}:${this.port}/${path}`;
  }
  unregisterNotify(path: string): void {
    this.notifyHandlers.delete(path);
  }

  /** Fires when a track's audio connection died mid-stream and nothing
   *  reopened it within STREAM_STALL_GRACE_MS — see stallTimers above.
   *  `null` unregisters (matches unregisterNotify's shape, used on
   *  disconnect so a stale session's stall can't fire after the fact). */
  onStreamStalled(handler: ((trackId: string) => void) | null): void {
    this.stallHandler = handler;
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.host = lanAddress();
    const server = createServer((req, res) => { this.handle(req, res); });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    this.port = typeof address === "object" && address ? address.port : 0;
    this.server = server;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    for (const timer of this.stallTimers.values()) clearTimeout(timer);
    this.stallTimers.clear();
  }

  audioUrlFor(trackId: string): string {
    return `http://${this.host}:${this.port}/audio/${encodeURIComponent(trackId)}`;
  }

  artUrlFor(coverId: string): string {
    return `http://${this.host}:${this.port}/art/${encodeURIComponent(coverId)}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      // GENA NOTIFY — a subscribed renderer pushing a state change, not a
      // request for a resource; routed by exact path, not the kind/id
      // scheme below (registerNotify's path is opaque to that scheme).
      if (req.method === "NOTIFY") {
        const handler = this.notifyHandlers.get(url.pathname.replace(/^\//, ""));
        if (!handler) { res.writeHead(404).end(); return; }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        handler(Buffer.concat(chunks).toString("utf8"));
        // UPnP eventing expects a bare 200 with no body.
        res.writeHead(200).end();
        return;
      }

      const [, kind, rawId] = url.pathname.split("/");
      const id = rawId ? decodeURIComponent(rawId) : "";
      const client = this.getClient();
      if (!client || !id) { res.writeHead(404).end(); return; }

      if (kind === "audio") { await this.serveAudio(client, id, req, res); return; }
      if (kind === "art") { await this.serveArt(client, id, res); return; }
      res.writeHead(404).end();
    } catch {
      // A device that dropped mid-stream (Range request abandoned, socket
      // closed) throws here too — nothing useful to report back on either
      // path, and the receiver just retries/gives up on its own.
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  }

  private async serveAudio(client: SubsonicClient, trackId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A new request for this track arriving — whether it's the very first
    // one or a reopen after a prior connection died — means any pending
    // stall timer from an earlier death is moot; the stream is back.
    const pendingStall = this.stallTimers.get(trackId);
    if (pendingStall) { clearTimeout(pendingStall); this.stallTimers.delete(trackId); }
    const upstream = await fetch(client.streamUrl(trackId), {
      headers: req.headers.range ? { range: req.headers.range } : undefined,
    });
    if (!upstream.ok && upstream.status !== 206) { res.writeHead(upstream.status).end(); return; }
    if (!upstream.body) { res.writeHead(502).end(); return; }

    const headers: Record<string, string> = {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "Accept-Ranges": "bytes",
      // Asserts "streamable over HTTP" without pinning a specific DLNA media
      // profile (DLNA.ORG_PN) — Navidrome can transcode to almost any format
      // depending on server config/client capabilities, so there's no single
      // profile name that's reliably correct; "*" is the documented DLNA
      // wildcard for "just serve the bytes", which real-world renderers
      // accept fine for basic playback.
      "contentFeatures.dlna.org": "*",
      "transferMode.dlna.org": "Streaming",
    };
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers["Content-Length"] = contentLength;
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) headers["Content-Range"] = contentRange;

    res.writeHead(upstream.status === 206 ? 206 : 200, headers);
    const source = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream<Uint8Array>);
    try {
      await pipeline(source, res);
    } catch (err) {
      // Died before finishing — normal if the renderer is about to reopen at
      // a new byte offset (a Seek reacting exactly this way is expected,
      // proven to happen within single-digit ms), or if this track was
      // explicitly stopped (the DlnaDevice-side handler below is
      // responsible for ignoring that case, not this proxy — it has no way
      // to know intent, only that the connection died). Either way, arm a
      // stall check; a genuine reopen cancels it via the guard at the top
      // of this method before it ever fires.
      const timer = setTimeout(() => {
        this.stallTimers.delete(trackId);
        this.stallHandler?.(trackId);
      }, STREAM_STALL_GRACE_MS);
      this.stallTimers.set(trackId, timer);
      throw err;
    }
  }

  private async serveArt(client: SubsonicClient, coverId: string, res: ServerResponse): Promise<void> {
    const { bytes, contentType } = await client.fetchCoverArt(coverId);
    res.writeHead(200, { "Content-Type": contentType, "Content-Length": bytes.length });
    res.end(bytes);
  }
}
