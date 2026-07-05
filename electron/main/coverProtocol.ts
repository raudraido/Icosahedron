import { protocol } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SubsonicClient } from "./subsonic";

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]/g, "_");
}

// De-dupes concurrent fetches for the same cover — rapid scrolling back and
// forth over a not-yet-cached row before its first fetch resolves would
// otherwise fire a fresh request to the server every time, piling up
// concurrent load and making transient failures (→ broken-image icon) more
// likely. Keyed by the same string used for the on-disk cache file.
//
// Ref-counted so it can also cancel: fast scrolling mounts and unmounts many
// <img>s in quick succession, and each unmount aborts its own `cover://`
// request — but without acting on that, the outbound fetch to the server
// keeps running anyway, competing for bandwidth/connections against requests
// for covers actually still on screen. Once every requester for a given
// cover has aborted, the underlying fetch gets cancelled too, so the
// currently-visible viewport's requests aren't starved behind a backlog of
// requests for rows the user has already scrolled past.
interface Entry {
  promise: Promise<{ bytes: Buffer; contentType: string }>;
  controller: AbortController;
  refCount: number;
}
const inFlight = new Map<string, Entry>();

export function registerCoverProtocol(cacheDir: string, getClient: () => SubsonicClient | null): void {
  protocol.handle("cover", async (request) => {
    const url = new URL(request.url);
    const coverId = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const size = url.searchParams.get("size") ?? "200";
    const cacheKey = `${safeId(coverId)}_${size}`;
    const cacheFile = join(cacheDir, cacheKey);

    if (existsSync(cacheFile)) {
      const bytes = await readFile(cacheFile);
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "max-age=604800" },
      });
    }

    const client = getClient();
    if (!client) return new Response(null, { status: 503 });

    let entry = inFlight.get(cacheKey);
    if (!entry) {
      const controller = new AbortController();
      const promise = client.fetchCoverArt(coverId, Number(size), controller.signal);
      entry = { promise, controller, refCount: 0 };
      promise.finally(() => {
        if (inFlight.get(cacheKey) === entry) inFlight.delete(cacheKey);
      });
      inFlight.set(cacheKey, entry);
    }

    entry.refCount++;
    const onAbort = () => {
      if (!entry) return;
      entry.refCount--;
      if (entry.refCount <= 0) entry.controller.abort();
    };
    request.signal.addEventListener("abort", onAbort);

    try {
      const { bytes, contentType } = await entry.promise;
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cacheFile, bytes);
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Type": contentType, "Cache-Control": "max-age=604800" },
      });
    } catch {
      return new Response(null, { status: 404 });
    } finally {
      request.signal.removeEventListener("abort", onAbort);
    }
  });
}
