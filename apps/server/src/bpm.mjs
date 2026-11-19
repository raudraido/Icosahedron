import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

// Shared BPM store. BPM is a property of the track, not of the user, so one
// map serves every account on this Navidrome. The store itself never detects BPM —
// players that can (desktop, native analyzer) upload what they measure, the
// library analysis (bpm-analyzer.mjs) fills the gaps, and every other player just reads it.
//   entry: {bpm:number, manual:boolean, confidence?:number}
//     manual      = user-corrected, wins over detected, always shown
//     confidence  = 0..1, only on values the library analysis measured (older values and the ones players
//                   upload have none). A detected value below the minimum confidence an administrator set
//                   is "unreliable": it stays stored for review but is left out of everything players read.
export function createBpmStore(dir, { minConfidence = 0, onMinConfidence } = {}) {
  let map = {};
  let timer;
  let minConf = Number.isFinite(minConfidence) ? Math.min(1, Math.max(0, minConfidence)) : 0;
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
  const later = () => { clearTimeout(timer); timer = setTimeout(flush, 1000); timer.unref?.(); };
  const valid = (v) => typeof v === "number" && Number.isFinite(v) && v >= 20 && v <= 400;
  const unreliable = (e) => !e.manual && typeof e.confidence === "number" && e.confidence < minConf;
  const entry = (bpm, manual, confidence) => {
    const e = { bpm: Math.round(bpm * 100) / 100, manual: !!manual };
    if (!manual && typeof confidence === "number" && Number.isFinite(confidence)) e.confidence = Math.round(Math.min(1, Math.max(0, confidence)) * 1000) / 1000;
    return e;
  };
  return {
    /** What players read: a hidden (unreliable) value is as good as none. */
    get: (id) => (map[id] && !unreliable(map[id]) ? map[id].bpm : undefined),
    /** Whether the track has a stored value (detected, manual or unreliable). The analysis uses this: it never measures such a track again. */
    has: (id) => map[id] !== undefined,
    /** The stored entry as it is, for the analysis and its report (a copy). */
    entry: (id) => (map[id] ? { ...map[id] } : undefined),
    /** Number of values players see. */
    size: () => Object.values(map).filter((e) => !unreliable(e)).length,
    stats() {
      const s = { total: 0, visible: 0, unreliable: 0, manual: 0, withConfidence: 0, unscored: 0 };
      for (const e of Object.values(map)) {
        s.total++;
        if (e.manual) { s.manual++; s.visible++; continue; }
        if (typeof e.confidence === "number") s.withConfidence++; else s.unscored++;
        if (unreliable(e)) s.unreliable++; else s.visible++;
      }
      return s;
    },
    get minConfidence() { return minConf; },
    setMinConfidence(v) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return false;
      minConf = v;
      onMinConfidence?.(v);
      return true;
    },
    /** Every stored entry, hidden ones too, as [id, entry] (the report). */
    entries: () => Object.entries(map).map(([k, v]) => [k, { ...v }]),
    /**
     * Stores a detected value only if the track still has none. The library analysis writes through
     * this, so a value that another player uploaded while the job ran is never replaced.
     * @returns {boolean} whether it was stored
     */
    setIfAbsent(id, bpm, confidence) {
      if (map[id] !== undefined) return false;
      return this.set(id, bpm, false, confidence);
    },
    /**
     * The one case where a stored value is replaced by the analysis (an administrator's explicit
     * "re-check"): the entry must still be exactly the detected, confidence-less value that was queued.
     * A correction, a value with a confidence, or any other change made meanwhile is left alone.
     * @returns {boolean} whether it was replaced
     */
    replaceUnscored(id, expectedBpm, bpm, confidence) {
      const e = map[id];
      if (!e || e.manual || e.confidence !== undefined || e.bpm !== expectedBpm) return false;
      if (!valid(bpm)) return false;
      map[id] = entry(bpm, false, confidence);
      later();
      return true;
    },
    all: () => Object.fromEntries(Object.entries(map).filter(([, v]) => !unreliable(v)).map(([k, v]) => [k, v.bpm])),
    /** @returns {boolean} whether the value was stored */
    set(id, bpm, manual, confidence) {
      if (!id || id.length > 128 || !valid(bpm)) return false;
      if (map[id]?.manual && !manual) return false; // detection must not clobber a correction
      map[id] = entry(bpm, manual, confidence);
      later();
      return true;
    },
    flush,
  };
}
