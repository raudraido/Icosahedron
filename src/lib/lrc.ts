// LRC line format: [mm:ss.xx] text — ported from lyrics_panel.py's parse_lrc.
const LRC_RE = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/;

export type ParsedLyrics =
  | { kind: "synced"; lines: { ms: number; text: string }[] }
  | { kind: "plain"; text: string };

export function parseLrc(raw: string): ParsedLyrics {
  const lines: { ms: number; text: string }[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const m = LRC_RE.exec(rawLine.trim());
    if (!m) continue;
    const [, minutes, secs, msRaw, lyric] = m;
    const ms = msRaw ? Number(msRaw.padEnd(3, "0")) : 0;
    const timeMs = Number(minutes) * 60_000 + Number(secs) * 1000 + ms;
    if (lyric.trim() || lines.length) lines.push({ ms: timeMs, text: lyric });
  }
  if (lines.length) return { kind: "synced", lines: lines.sort((a, b) => a.ms - b.ms) };
  return { kind: "plain", text: raw.trim() };
}

// [offset:±ms] is a real (if uncommonly-supported) LRC metadata tag — used
// here to persist this app's own manual offset alongside a locally-saved
// lyrics file, something the old app never did (its offset was always
// session-only, reset to 0 on every track change). Doesn't collide with
// parseLrc: LRC_RE only matches digit-led time tags, so an unrecognized
// `[offset:...]` line is already silently skipped as plain text.
const OFFSET_RE = /^\[offset:(-?\d+)\]$/i;

export function extractOffset(raw: string): { offsetMs: number; text: string } {
  let offsetMs = 0;
  const rest: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = OFFSET_RE.exec(line.trim());
    if (m) offsetMs = Number(m[1]);
    else rest.push(line);
  }
  return { offsetMs, text: rest.join("\n") };
}

export function withOffset(text: string, offsetMs: number): string {
  return offsetMs ? `[offset:${offsetMs}]\n${text}` : text;
}
