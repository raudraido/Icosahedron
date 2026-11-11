// One-use codes for a user's first device, made by an administrator (Settings > Users) or on the
// server (devices-cli.mjs). Kept in invites.json, read fresh each time so the command line and the
// running server can both use it.
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { makeCode, normalizeCode, sha256 } from "./devices.mjs";

export const INVITE_TTL_MS = 24 * 3600 * 1000;

export function createInvites({ dir, now = () => Date.now() } = {}) {
  const file = dir ? join(dir, "invites.json") : null;
  let mem = {};
  const load = () => {
    if (!file) return mem;
    try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; }
  };
  const save = (d) => {
    if (!file) { mem = d; return; }
    mkdirSync(dir, { recursive: true });
    writeFileSync(file + ".tmp", JSON.stringify(d), { mode: 0o600 });
    renameSync(file + ".tmp", file);
    try { chmodSync(file, 0o600); } catch { /* best effort */ }
  };
  return {
    create(user) {
      const d = load();
      for (const [h, v] of Object.entries(d)) if (v.expires <= now()) delete d[h];
      const code = makeCode();
      d[sha256(normalizeCode(code))] = { user: String(user), expires: now() + INVITE_TTL_MS };
      save(d);
      return code;
    },
    /** True once for a valid code made for this user. */
    consume(user, code) {
      const d = load();
      const h = sha256(normalizeCode(code));
      const v = d[h];
      if (!v || v.expires <= now() || v.user.toLowerCase() !== String(user).toLowerCase()) return false;
      delete d[h];
      save(d);
      return true;
    },
  };
}
