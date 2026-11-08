import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** JSON-file persistence, one file per user, atomic write. */
export function fileStore(dir) {
  mkdirSync(dir, { recursive: true });
  const path = (user) => join(dir, createHash("sha256").update(user).digest("hex").slice(0, 32) + ".json");
  const timers = new Map();
  return {
    load(user) {
      try { return JSON.parse(readFileSync(path(user), "utf8")); } catch { return undefined; }
    },
    save(user, data) {
      // debounce: state updates arrive every second or so while playing
      clearTimeout(timers.get(user));
      timers.set(user, setTimeout(() => {
        const p = path(user);
        writeFileSync(p + ".tmp", JSON.stringify(data));
        renameSync(p + ".tmp", p);
      }, 1000).unref());
    },
  };
}

export function memoryStore() {
  const m = new Map();
  return { load: (u) => m.get(u), save: (u, d) => void m.set(u, structuredClone(d)) };
}
