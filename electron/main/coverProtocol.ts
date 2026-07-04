import { protocol } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SubsonicClient } from "./subsonic";

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]/g, "_");
}

export function registerCoverProtocol(cacheDir: string, getClient: () => SubsonicClient | null): void {
  protocol.handle("cover", async (request) => {
    const url = new URL(request.url);
    const coverId = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const size = url.searchParams.get("size") ?? "200";
    const cacheFile = join(cacheDir, `${safeId(coverId)}_${size}`);

    if (existsSync(cacheFile)) {
      const bytes = await readFile(cacheFile);
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "max-age=604800" },
      });
    }

    const client = getClient();
    if (!client) return new Response(null, { status: 503 });

    try {
      const { bytes, contentType } = await client.fetchCoverArt(coverId, Number(size));
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cacheFile, bytes);
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Type": contentType, "Cache-Control": "max-age=604800" },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
