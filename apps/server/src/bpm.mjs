import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

// Shared BPM store. BPM is a property of the track, not of the user, so one
// map serves every account on this Navidrome. The server never detects BPM —
// players that can (desktop, native analyzer) upload what they measure, and
// every other player just reads it.
//   entry: {bpm:number, manual:boolean}   manual = user-corrected, wins over detected
export function createBpmStore(dir) {
  let map = {};
  let timer;
  const file = dir ? join(dir, "bpm.json") : null;
  if (file) {
    mkdirSync(dir, { recursive: true });
    try { map = JSON.parse(readFileSync(file, "utf8")); } catch { /* first run */ }
  }
  const flush = () => {
    if (!file) return;
    writeFileSync(file + ".tmp", JSON.stringify(map));
    renameSync(file + ".tmp", file);
  };
  const valid = (v) => typeof v === "number" && Number.isFinite(v) && v >= 20 && v <= 400;
  return {
    get: (id) => map[id]?.bpm,
    all: () => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.bpm])),
    /** @returns {boolean} whether the value was stored */
    set(id, bpm, manual) {
      if (!id || id.length > 128 || !valid(bpm)) return false;
      if (map[id]?.manual && !manual) return false; // detection must not clobber a correction
      map[id] = { bpm: Math.round(bpm * 100) / 100, manual: !!manual };
      clearTimeout(timer);
      timer = setTimeout(flush, 1000);
      timer.unref?.();
      return true;
    },
    flush,
  };
}
