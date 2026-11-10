import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

/** Server-wide settings that an administrator changes at runtime (settings.json in the data directory). */
export function fileSettings(dir) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "settings.json");
  let data = {};
  try { data = JSON.parse(readFileSync(path, "utf8")); } catch { /* none yet */ }
  return {
    get: (key) => data[key],
    set(key, value) {
      data = { ...data, [key]: value };
      writeFileSync(path + ".tmp", JSON.stringify(data, null, 2));
      renameSync(path + ".tmp", path);
    },
  };
}
