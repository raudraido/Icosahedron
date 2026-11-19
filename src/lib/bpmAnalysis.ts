// Library-wide BPM analysis on the Icosahedron HUB (docs/sync-settings.md, "BPM analysis"). Only a
// server administrator can use it; the HUB answers everyone else 403 and an older HUB 404.
import { createEngine } from "../platform/engineApi";
import { platform } from "../platform";

const engine = createEngine(() => platform.invoke("sync_auth"));

export interface BpmAnalysisStatus {
  state: "idle" | "running" | "stopping";
  phase: "listing" | "analysing" | null;
  /** Done in this job: measured, failed, and skipped because the song got a value meanwhile. */
  analysed: number;
  failed: number;
  skipped: number;
  /** Songs this job set out to analyse (those without a BPM that had not failed before). */
  total: number;
  remaining: number;
  etaSeconds: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  workers: number;
  lastError: string | null;
  /** Songs that have a BPM, and songs in the library (null when the HUB does not know yet). */
  withBpm: number;
  libraryTotal: number | null;
  /** Songs that failed (now or in an earlier job) and are not tried again unless asked. */
  failedTotal: number;
  // Added with confidence (a HUB from before has none of these).
  /** Detected values with a confidence / without one (measured before confidence existed) / left out of what players read. */
  withConfidence?: number;
  unscored?: number;
  unreliable?: number;
  /** Minimum confidence, 0..1: a measured value below it is not shown to players. 0 hides nothing. */
  minConfidence?: number;
  /** Songs left out before download (too short, or a genre without a beat) and not retried unless asked. */
  skippedTotal?: number;
  prefiltered?: number;
  rechecked?: number;
}

export interface BpmAnalysisOptions {
  workers: number;
  /** Try the songs that failed before again. */
  retryFailed?: boolean;
  /** Measure again the values that have no confidence yet (the only case where a stored value is replaced). */
  recheck?: boolean;
  /** Also measure the songs the prefilter leaves out. */
  includeSkipped?: boolean;
}

export type BpmAnalysisStart = "ok" | "running" | "analyser_missing" | "refused" | "offline" | "error";

/** The job's state, or null when this account may not use it (not an administrator) or the HUB is too old. */
export async function bpmAnalysisStatus(): Promise<BpmAnalysisStatus | null> {
  const r = await engine("/bpm/analyze");
  if (!r?.ok) return null;
  try { return (await r.json()) as BpmAnalysisStatus; } catch { return null; }
}

export async function startBpmAnalysis(o: BpmAnalysisOptions): Promise<BpmAnalysisStart> {
  const r = await engine("/bpm/analyze", { method: "POST", body: JSON.stringify(o) });
  if (!r) return "offline";
  if (r.ok) return "ok";
  if (r.status === 409) return "running";
  if (r.status === 403 || r.status === 404) return "refused";
  if (r.status === 503) return "analyser_missing";
  return "error";
}

/** Sets the minimum confidence (administrators only). Returns the value now in force, or null when refused. */
export async function setBpmMinConfidence(minConfidence: number): Promise<number | null> {
  const r = await engine("/bpm/analyze/min-confidence", { method: "PUT", body: JSON.stringify({ minConfidence }) });
  if (!r?.ok) return null;
  try { return ((await r.json()) as { minConfidence: number }).minConfidence; } catch { return null; }
}

export async function stopBpmAnalysis(): Promise<void> {
  await engine("/bpm/analyze", { method: "DELETE" });
}

/** "about 2 h 40 min", "about 12 min", "under a minute" */
export function formatEta(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const m = Math.round(seconds / 60);
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60);
  return `about ${h} h ${m % 60} min`;
}
