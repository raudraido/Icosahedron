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
    await pipeline(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream<Uint8Array>), res);
  }

  private async serveArt(client: SubsonicClient, coverId: string, res: ServerResponse): Promise<void> {
    const { bytes, contentType } = await client.fetchCoverArt(coverId);
    res.writeHead(200, { "Content-Type": contentType, "Content-Length": bytes.length });
    res.end(bytes);
  }
}
