import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// One profile picture per user, kept by the engine so every device shows the same one.
// Only images are accepted (JPEG, PNG, WebP by their first bytes) and only small ones: the apps
// shrink the picture before sending it.
export const AVATAR_MAX_BYTES = 512 * 1024;

/** The image type of `buf` from its first bytes, or null when it is not one we accept. */
export function imageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Pictures in `dir` (one file per user), or in memory without one. */
export function createAvatarStore(dir) {
  const mem = new Map();
  if (dir) mkdirSync(dir, { recursive: true });
  const path = (user) => join(dir, "avatar-" + createHash("sha256").update(user).digest("hex").slice(0, 32) + ".bin");
  const wrap = (buf) => ({ buf, type: imageType(buf) ?? "application/octet-stream", etag: '"' + createHash("sha1").update(buf).digest("hex").slice(0, 16) + '"' });
  return {
    get(user) {
      if (!dir) { const b = mem.get(user); return b ? wrap(b) : null; }
      try { return wrap(readFileSync(path(user))); } catch { return null; }
    },
    set(user, buf) {
      if (!dir) { mem.set(user, buf); return; }
      writeFileSync(path(user) + ".tmp", buf);
      renameSync(path(user) + ".tmp", path(user));
    },
    delete(user) {
      if (!dir) { mem.delete(user); return; }
      try { unlinkSync(path(user)); } catch { /* none */ }
    },
  };
}
