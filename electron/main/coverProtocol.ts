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
//
// The actual abort() is debounced (ABORT_GRACE_MS), not immediate: a
// virtualized grid re-rendering after something like a fast scrollbar drag
// to the middle of a long list unmounts a burst of rows and remounts a new
// batch for the same covers essentially in the same tick. Without the grace
// period, refCount hitting 0 (old rows' cleanup) would abort() the shared
// fetch immediately — and a new request for that same cover arriving a
// moment later (new rows mounting) could still find the entry in `inFlight`
// (it isn't removed until the aborted promise's `.finally` runs) and await
// a promise that's already doomed to reject, failing instantly with no
// retry in sight. Delaying the abort gives a same-tick/next-tick new
// request a chance to increment refCount back up and cancel the pending
// abort before it ever fires, rescuing the shared fetch instead.
const ABORT_GRACE_MS = 300;

interface Entry {
  promise: Promise<{ bytes: Buffer; contentType: string }>;
  controller: AbortController;
  refCount: number;
  abortTimer: ReturnType<typeof setTimeout> | null;
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
      // Self-heal cache files written before fetchCoverArt validated its
      // response (subsonic.ts) — a non-image error body could get persisted
      // to disk as if it were a real cover. Any real cover art is well over
      // this size; treat anything smaller as a poisoned entry and re-fetch
      // instead of re-serving it forever.
      if (bytes.length >= 256) {
        return new Response(bytes, {
          status: 200,
          headers: { "Content-Type": "image/jpeg", "Cache-Control": "max-age=604800" },
        });
      }
    }

    const client = getClient();
    if (!client) return new Response(null, { status: 503 });

    let entry = inFlight.get(cacheKey);
    if (!entry) {
      const controller = new AbortController();
      const promise = client.fetchCoverArt(coverId, Number(size), controller.signal);
      entry = { promise, controller, refCount: 0, abortTimer: null };
      promise.finally(() => {
        if (inFlight.get(cacheKey) === entry) inFlight.delete(cacheKey);
      });
      inFlight.set(cacheKey, entry);
    }

    entry.refCount++;
    if (entry.abortTimer) {
      clearTimeout(entry.abortTimer);
      entry.abortTimer = null;
    }
    const onAbort = () => {
      if (!entry) return;
      entry.refCount--;
      if (entry.refCount <= 0) {
        entry.abortTimer = setTimeout(() => {
          if (entry && entry.refCount <= 0) entry.controller.abort();
        }, ABORT_GRACE_MS);
      }
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
