import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Track } from "../lib/api";
import { useStore } from "../store";
import { CoverArt } from "../components/CoverArt";
import { loadJSON, saveJSON } from "../components/TrackTable";
import { loadPool } from "../lib/mixPool";
import { bpmAnalysisStatus } from "../lib/bpmAnalysis";
import {
  addSeed, autoName, binInRange, bpmActive, bpmAvailable, bpmAxis, bpmCoverage, BPM_MAX, BPM_MIN, bpmFraction, bpmHistogram, bpmOf,
  buildFlowMix, buildMix, countMatches, coveragePercent, defaultSettings, FLOW_PRESETS, fmtLength,
  genreSeeds, hiddenCount, isStarted, joinBpm, localSuggestions, MAX_VISIBLE_ROWS, mixBpmStats, normalizeBpmRange, poolKey,
  presetSettings, reasonLine, removeSeed, sanitizeCurve, setBpmRange, setYears, SIZES, snapSize, swapCandidate, targetBpm,
  toggleGenre, toggleSkipGenre, topArtists, totalSeconds, YEAR_MIN,
  type FlowPresetId, type MixItem, type MixSeed, type MixSettings, type PoolItem, type PresetId, type SeedSuggestion,
} from "../lib/mixBuilder";

// Mix Builder: say what you want, work on a ready proposal, keep or swap what you like.
//   quick starts + "Start with" seeds + dials  ->  a live mix (keep / swap / more like this / remove / drag)
//   ->  a tray with the numbers and Play / Add to queue / Save as playlist.
// The logic is in lib/mixBuilder.ts (pure, tested), the candidates are loaded by lib/mixPool.ts.

const LS_KEY = "mix_builder_v1";
const LS_LEAVE_OUT = "mix_builder_leave_out"; // kept apart from the dials: Clear and the quick starts do not reset it

interface LeaveOut { skipSpoken: boolean; skipGenres: string[] }
function loadLeaveOut(): LeaveOut {
  const l = loadJSON<LeaveOut>(LS_LEAVE_OUT, { skipSpoken: true, skipGenres: [] });
  return { skipSpoken: l.skipSpoken !== false, skipGenres: Array.isArray(l.skipGenres) ? l.skipGenres.filter((g) => typeof g === "string") : [] };
}
/** Dev override: `localStorage.mix_builder_force_bpm = "1"` shows the BPM dial and Flow whatever the coverage is. */
function forceBpm(): boolean {
  try { return localStorage.getItem("mix_builder_force_bpm") === "1"; } catch { return false; }
}
const SAVE_BATCH = 200; // songs per "add to playlist" call, so a 1000-song mix is never one huge request

interface Saved { settings: MixSettings; kept: MixItem[] }

function loadSaved(): Saved {
  const s = loadJSON<Partial<Saved>>(LS_KEY, {});
  const def = defaultSettings();
  const raw = (s.settings ?? {}) as Partial<MixSettings>;
  const settings: MixSettings = {
    ...def, ...raw,
    seeds: Array.isArray(raw.seeds) ? raw.seeds : [],
    years: Array.isArray(raw.years) && raw.years.length === 2 ? [Number(raw.years[0]), Number(raw.years[1])] : null,
    size: snapSize(Number(raw.size ?? def.size)),
    bpm: normalizeBpmRange(Array.isArray(raw.bpm) ? raw.bpm : null),
    flow: raw.flow === true,
    curve: sanitizeCurve(raw.curve),
  };
  const kept = Array.isArray(s.kept) ? s.kept.filter((m) => m?.track?.id && m.locked) : [];
  return { settings, kept };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

const num = (n: number) => n.toLocaleString("en-US");

// ── small pieces ─────────────────────────────────────────────────────────────────────────────────────
function Chip({ children, on, onClick, title }: { children: React.ReactNode; on?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick} aria-pressed={on} title={title}
      style={{
        border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, borderRadius: 999, padding: "3px 10px",
        fontSize: "var(--fs-small)", cursor: "pointer",
        background: on ? "color-mix(in srgb, var(--accent) 17.6%, transparent)" : "transparent",
        color: on ? "var(--accent)" : "var(--text-primary)", fontWeight: on ? "var(--fw-emphasis)" : "var(--fw-secondary)",
      }}
    >{children}</button>
  );
}

function Pill({ children, onClick, accent, big, disabled, title }: { children: React.ReactNode; onClick: () => void; accent?: boolean; big?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      style={{
        height: big ? 38 : 32, padding: big ? "0 18px" : "0 14px", borderRadius: 999, fontSize: "var(--fs-secondary)",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 8,
        border: accent ? "none" : "1px solid var(--border)",
        background: accent ? "var(--accent)" : "transparent",
        color: accent ? "var(--on-accent, #111)" : "var(--text-primary)", fontWeight: "var(--fw-emphasis)",
      }}
    >{children}</button>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between" style={{ gap: 10 }}>
      <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>{label}</span>
      <button
        role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
        style={{ width: 38, height: 22, borderRadius: 11, border: "none", position: "relative", flexShrink: 0, cursor: "pointer", background: on ? "var(--accent)" : "var(--hover-bg)" }}
      >
        <span style={{ position: "absolute", top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: "50%", background: on ? "var(--main-bg)" : "var(--text-primary)", transition: "left .15s" }} />
      </button>
    </div>
  );
}

function Dial({ title, value, children }: { title: string; value?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="flex items-baseline justify-between" style={{ gap: 8 }}>
        <span style={{ fontSize: "var(--fs-small)", fontWeight: "var(--fw-emphasis)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-primary)", opacity: 0.7 }}>{title}</span>
        {value && <span style={{ fontSize: "var(--fs-secondary)", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{value}</span>}
      </div>
      {children}
    </div>
  );
}

/** Two handles on one rail. Dragging calls onChange live; the screen debounces what it fetches. */
function RangeSlider({ min, max, value, onChange, label }: { min: number; max: number; value: [number, number]; onChange: (v: [number, number]) => void; label: string }) {
  const rail = useRef<HTMLDivElement>(null);
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  function handle(i: 0 | 1) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const r = rail.current!.getBoundingClientRect();
        const p = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
        const v = Math.round(min + p * (max - min));
        const next: [number, number] = [value[0], value[1]];
        next[i] = v;
        if (i === 0 && next[0] > next[1]) next[0] = next[1];
        if (i === 1 && next[1] < next[0]) next[1] = next[0];
        onChange(next);
      };
      const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    };
  }
  function key(i: 0 | 1) {
    return (e: React.KeyboardEvent) => {
      const d = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : 0;
      if (!d) return;
      e.preventDefault();
      const next: [number, number] = [value[0], value[1]];
      next[i] = Math.max(min, Math.min(max, next[i] + d));
      if (next[0] > next[1]) { if (i === 0) next[0] = next[1]; else next[1] = next[0]; }
      onChange(next);
    };
  }
  const h = (i: 0 | 1) => (
    <div
      role="slider" tabIndex={0} aria-label={`${label} ${i ? "to" : "from"}`} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value[i]}
      onPointerDown={handle(i)} onKeyDown={key(i)}
      style={{ position: "absolute", top: 3, left: `${pct(value[i])}%`, width: 16, height: 16, marginLeft: -8, borderRadius: "50%", background: "var(--card-bg)", border: "2px solid var(--accent)", cursor: "grab", touchAction: "none" }}
    />
  );
  return (
    <div ref={rail} style={{ position: "relative", height: 22, userSelect: "none", touchAction: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 9, height: 4, borderRadius: 2, background: "var(--hover-bg)" }} />
      <div style={{ position: "absolute", top: 9, height: 4, borderRadius: 2, background: "var(--accent)", left: `${pct(value[0])}%`, width: `${pct(value[1]) - pct(value[0])}%` }} />
      {h(0)}{h(1)}
    </div>
  );
}

// ── the screen ───────────────────────────────────────────────────────────────────────────────────────
export function MixBuilder() {
  const qc = useQueryClient();
  const playTrack = useStore((s) => s.playTrack);
  const appendToQueue = useStore((s) => s.appendToQueue);
  const mixRequest = useStore((s) => s.mixRequest);

  const saved = useMemo(loadSaved, []);
  const [settings, setSettings] = useState<MixSettings>(saved.settings);
  const [mix, setMix] = useState<MixItem[]>(saved.kept);
  const [nonce, setNonce] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [allGenres, setAllGenres] = useState(false);
  const autoPlay = useRef(false);
  const toastTimer = useRef<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const say = (m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const started = isStarted(settings);
  const patch = (p: Partial<MixSettings>) => setSettings((s) => ({ ...s, ...p, pure: p.pure ?? false }));
  const [leaveOut, setLeaveOut] = useState<LeaveOut>(loadLeaveOut);
  const [leaveOpen, setLeaveOpen] = useState(false);
  useEffect(() => { saveJSON(LS_LEAVE_OUT, leaveOut); }, [leaveOut]);
  // What every start and every pool respects: the dials plus what is left out.
  // BPM: the whole library's id -> BPM map (the HUB's shared store, or this computer's cache without a HUB), the
  // library's song count, and from those the coverage that decides whether the BPM dial and Flow show.
  const bpmQ = useQuery({ queryKey: ["mixBpmMap"], queryFn: () => api.getBpmCacheAll(), staleTime: 2 * 60_000 });
  const totalQ = useQuery({
    queryKey: ["mixLibraryTotal"], staleTime: 30 * 60_000,
    queryFn: async () => {
      const n = await api.getTracksNativePage("title", "ASC", 0, 1).then((r) => r.total).catch(() => 0);
      if (n > 0) return n;
      return (await api.getScanStatus().catch(() => null))?.count || null;
    },
  });
  const bpmMap = bpmQ.data;
  const bpmCount = useMemo(() => { let n = 0; if (bpmMap) for (const k in bpmMap) if (bpmMap[k] > 0) n++; return n; }, [bpmMap]);
  const coverage = bpmCoverage(bpmCount, totalQ.data);
  const force = useMemo(forceBpm, []);
  const bpmReady = bpmQ.isFetched && totalQ.isFetched; // answered or failed: either way we know what there is
  const showBpm = bpmReady && bpmAvailable(coverage, force);
  // What every start and every pool respects: the dials plus what is left out. Without BPM the BPM dial and Flow are off.
  const full = useMemo<MixSettings>(
    () => ({ ...settings, ...leaveOut, ...(bpmReady && !showBpm ? { bpm: null, flow: false } : {}) }),
    [settings, leaveOut, bpmReady, showBpm],
  );
  const dSettings = useDebounced(full, 250);
  const usesBpm = (bpmActive(dSettings) || !!dSettings.flow) && !dSettings.pure;
  // A saved BPM range or Flow waits for the BPM data (a moment) instead of building a mix without it.
  const waitsForBpm = usesBpm && !bpmReady;

  // What the server is asked for: the library's genres (with counts) and the pool for the current seeds/dials.
  const genresQ = useQuery({ queryKey: ["mixGenres"], queryFn: () => api.getGenres(), staleTime: 10 * 60_000 });
  const genres = genresQ.data ?? [];
  const lastQ = useQuery({
    queryKey: ["mixLastArtist"], staleTime: 5 * 60_000,
    // "recent" = the albums played last; the first one's artist is "the artist I played last".
    queryFn: async () => topArtists(await api.getAlbumList("recent", 10, 0).catch(() => []), 1)[0] ?? null,
  });
  const poolQ = useQuery({
    // A BPM range loads the songs of that range, so the key has the range (poolKey) and roughly how much BPM data
    // there is (the analysis keeps adding to it).
    queryKey: ["mixPool", poolKey(dSettings), dSettings.pure ? nonce : 0, bpmActive(dSettings) ? Math.floor(bpmCount / 1000) : 0],
    queryFn: ({ signal }) => loadPool(dSettings, () => signal.aborted, bpmMap),
    enabled: isStarted(dSettings) && !waitsForBpm,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  // The candidates with their BPM (only when the BPM matters: the mix is not reshuffled when the map arrives late).
  const pool: PoolItem[] = useMemo(() => {
    const items = poolQ.data?.items ?? [];
    return usesBpm ? joinBpm(items, bpmMap) : items;
  }, [poolQ.data, bpmMap, usesBpm]);
  const stale = poolQ.isPlaceholderData || (started && dSettings !== full);

  // Builds the mix whenever the pool, the dials or Re-roll change: kept songs stay, the rest is picked again.
  const mixRef = useRef(mix);
  mixRef.current = mix;
  useEffect(() => {
    if (!isStarted(dSettings) || !poolQ.data || poolQ.isPlaceholderData || waitsForBpm) return;
    const current = usesBpm ? joinBpm(mixRef.current, bpmMap) : mixRef.current;
    // Flow: the kept songs keep the slot they are in. Otherwise they go on top.
    const { mix: next } = dSettings.flow && !dSettings.pure
      ? buildFlowMix(pool, dSettings, current)
      : buildMix(pool, dSettings, current.filter((m) => m.locked));
    setMix(next);
    if (autoPlay.current && next.length) { autoPlay.current = false; playAll(next); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, poolQ.isPlaceholderData, dSettings, nonce, waitsForBpm]);

  const matches = useMemo(() => (stale ? 0 : countMatches(pool, dSettings)), [pool, dSettings, stale]);
  const capped = !!poolQ.data?.capped;

  // Remember the last state (the dials and the songs that were kept).
  useEffect(() => {
    saveJSON(LS_KEY, { settings, kept: mix.filter((m) => m.locked) });
  }, [settings, mix]);

  // "Start a Mix from this" elsewhere in the app: start over from that artist.
  const lastReq = useRef(0);
  useEffect(() => {
    if (!mixRequest || mixRequest.n <= lastReq.current) return;
    lastReq.current = mixRequest.n;
    const seed: MixSeed = mixRequest.kind === "artist" ? { kind: "artist", value: mixRequest.value, id: mixRequest.id } : { kind: "genre", value: mixRequest.value };
    setMix([]);
    setSettings((s) => addSeed({ ...defaultSettings(), size: s.size }, seed));
    setSaveOpen(false);
  }, [mixRequest]);

  const name = useMemo(() => autoName(settings), [settings]);
  useEffect(() => { if (!saveOpen) setSaveName(name); }, [name, saveOpen]);

  // ── actions ──
  function playAll(list: MixItem[] = mix) {
    if (!list.length) return;
    const tracks = list.map((m) => m.track);
    playTrack(tracks[0], tracks);
    say(`Playing ${num(tracks.length)} songs`);
  }
  function queueAll() {
    if (!mix.length) return;
    appendToQueue(mix.map((m) => m.track));
    say(`${num(mix.length)} songs added to the queue`);
  }
  async function savePlaylist() {
    const n = saveName.trim();
    if (!n || !mix.length || busy) return;
    setBusy("save");
    try {
      const playlist = await api.createPlaylist(n);
      const ids = mix.map((m) => m.track.id);
      for (let i = 0; i < ids.length; i += SAVE_BATCH) await api.addTracksToPlaylist(playlist.id, ids.slice(i, i + SAVE_BATCH));
      qc.invalidateQueries({ queryKey: ["playlists"] });
      setSaveOpen(false);
      say(`Saved “${n}” (${num(ids.length)} songs)`);
    } catch {
      say("Could not save the playlist. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  }
  function clearAll() {
    setSettings(defaultSettings());
    setMix([]);
    setSaveOpen(false);
  }
  function setSize(n: number) { patch({ size: n, pure: settings.pure }); }

  async function quick(kind: "random" | "lucky" | "because" | PresetId) {
    setMix([]);
    setSaveOpen(false);
    const size = settings.size;
    if (kind === "random") {
      const n = 500;
      autoPlay.current = true;
      setNonce((x) => x + 1); // a new draw every time, never the cached one
      setSettings({ ...defaultSettings(), pure: true, size: n, title: "Random" });
      say(`Picking ${num(n)} songs completely at random from your whole library`);
      return;
    }
    if (kind === "lucky" || kind === "because") {
      setBusy("quick");
      try {
        let artists: { name: string; id: string }[] = [];
        if (kind === "lucky") artists = topArtists(await api.getAlbumList("frequent", 50, 0).catch(() => []), 3);
        else if (lastQ.data) artists = [lastQ.data];
        if (!artists.length) { say("Play a few songs first: this start needs something you have played."); return; }
        let s: MixSettings = { ...defaultSettings(), size: kind === "lucky" ? snapSize(50) : size, discover: kind === "lucky" ? 25 : 50, title: kind === "lucky" ? "Lucky mix" : `Because I played ${artists[0].name}` };
        for (const a of artists) s = addSeed(s, { kind: "artist", value: a.name, id: a.id });
        setSettings(s);
        if (kind === "lucky") say("Lucky mix: your most played artists and what sounds like them");
      } finally { setBusy(null); }
      return;
    }
    setSettings(presetSettings(kind, genres, undefined, showBpm));
  }

  // ── the list ──
  function act(i: number, what: "keep" | "swap" | "more" | "drop") {
    const m = mix[i];
    if (!m) return;
    if (what === "keep") { setMix((l) => l.map((x, j) => (j === i ? { ...x, locked: !x.locked } : x))); return; }
    if (what === "drop") { setMix((l) => l.filter((_, j) => j !== i)); return; }
    if (what === "more") {
      const t = m.track;
      setSettings((s) => addSeed(s, { kind: "artist", value: t.artist, id: t.artist_id ?? undefined }));
      say(`More like ${t.artist}: added as a seed`);
      return;
    }
    // With Flow the new song should have about the BPM of the one it replaces (or the curve's BPM there).
    const flowOn = !!dSettings.flow && !dSettings.pure;
    const around = flowOn ? bpmOf(joinBpm([m], bpmMap)[0].track) ?? targetBpm(dSettings, mix.length > 1 ? i / (mix.length - 1) : 0) : undefined;
    const next = swapCandidate(pool, dSettings, mix, Math.random, around);
    if (!next) { say("No other song fits right now."); return; }
    setMix((l) => l.map((x, j) => (j === i ? next : x)));
  }
  function drop(to: number) {
    const from = dragFrom.current;
    dragFrom.current = null;
    setDragOver(null);
    if (from === null || from === to) return;
    // With Flow a song that was dragged is kept, so it stays where it was put when the mix is built again.
    const pin = !!settings.flow && showBpm;
    setMix((l) => { const c = [...l]; const [it] = c.splice(from, 1); c.splice(to, 0, pin ? { ...it, locked: true } : it); return c; });
  }
  function setFlow(on: boolean) { setSettings((s) => ({ ...s, flow: on, curve: sanitizeCurve(s.curve), pure: false })); }
  function setCurve(curve: number[]) { setSettings((s) => ({ ...s, curve, pure: false })); }

  const thisYear = new Date().getFullYear();
  const years = settings.years ?? [YEAR_MIN, thisYear];
  const shownGenres = useMemo(() => {
    const picked = new Set(genreSeeds(settings).map((g) => g.value.toLowerCase()));
    const sorted = [...genres].sort((a, b) => b.songCount - a.songCount);
    const top = allGenres ? sorted : sorted.slice(0, 24);
    const extra = sorted.filter((g) => picked.has(g.name.toLowerCase()) && !top.includes(g));
    return [...top, ...extra];
  }, [genres, settings, allGenres]);
  const flowOn = showBpm && !!settings.flow && !settings.pure;
  const bpmRange = bpmActive(settings) ? settings.bpm! : null;
  const histogram = useMemo(() => bpmHistogram(bpmMap ? Object.values(bpmMap) : []), [bpmMap]);
  // The mix with the BPM of each song (the kept songs from an earlier visit have none until now).
  const shown = useMemo(() => (showBpm ? joinBpm(mix, bpmMap) : mix), [mix, bpmMap, showBpm]);
  const stats = useMemo(() => mixBpmStats(shown), [shown]);
  const axis = bpmAxis(full);
  const visible = shown.slice(0, MAX_VISIBLE_ROWS);
  const loading = (started && (poolQ.isFetching || stale)) || waitsForBpm;
  // Is it an administrator of a HUB that has the analysis? Only then the "analyse" hint makes sense.
  const adminQ = useQuery({ queryKey: ["mixBpmAdmin"], queryFn: () => bpmAnalysisStatus(), enabled: bpmReady && !showBpm, staleTime: 5 * 60_000 });
  const navigateTo = useStore((s) => s.navigateTo);

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      <style>{`
        .mb-row { display: grid; grid-template-columns: 26px 44px minmax(0,1fr) 54px auto; gap: 12px; align-items: center; padding: 6px 8px; border-radius: 10px; border: 1px solid transparent; }
        .mb-row.withbpm { grid-template-columns: 26px 44px minmax(0,1fr) 62px 54px auto; }
        @media (max-width: 640px) { .mb-row.withbpm { grid-template-columns: 26px 44px minmax(0,1fr) 62px auto; } .mb-row.withbpm .mb-dur { display: none; } }
        .mb-row:hover { background: var(--hover-bg); }
        .mb-row.kept { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
        .mb-row.over { border-color: var(--accent); }
        .mb-acts { display: flex; gap: 2px; opacity: 0; transition: opacity .12s; }
        .mb-row:hover .mb-acts, .mb-row:focus-within .mb-acts, .mb-row.kept .mb-acts { opacity: 1; }
        .mb-acts button { border: 0; background: transparent; width: 30px; height: 30px; border-radius: 8px; font-size: 15px; color: var(--text-primary); cursor: pointer; }
        .mb-acts button:hover { background: var(--hover-bg); }
        .mb-grid { display: grid; grid-template-columns: 300px minmax(0,1fr); gap: 14px; align-items: start; }
        @media (max-width: 900px) { .mb-grid { grid-template-columns: minmax(0,1fr); } }
        .mb-sugg button { display: flex; width: 100%; gap: 10px; align-items: center; border: 0; background: transparent; padding: 8px 14px; text-align: left; color: var(--text-primary); cursor: pointer; font-size: var(--fs-secondary); }
        .mb-sugg button:hover, .mb-sugg button.on { background: var(--hover-bg); }
      `}</style>

      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0, padding: "16px 20px" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", display: "grid", gap: 14 }}>
          <h1 style={{ margin: 0, fontSize: "var(--fs-title)", fontWeight: "var(--fw-emphasis)", color: "var(--text-secondary)" }}>Mix Builder</h1>

          {/* Quick starts */}
          <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
            <Pill big accent onClick={() => quick("random")} title="Every song in the library has the same chance. Starts playing.">Play 500 random</Pill>
            <Pill big onClick={() => quick("lucky")} disabled={busy === "quick"} title="Your most played artists and the songs that sound like them">Lucky mix</Pill>
            <Pill onClick={() => quick("workout")}>Workout</Pill>
            <Pill onClick={() => quick("focus")}>Focus</Pill>
            <Pill onClick={() => quick("party")}>Party</Pill>
            <Pill onClick={() => quick("throwback")}>Throwback</Pill>
            <Pill onClick={() => quick("fresh")}>Fresh finds</Pill>
            {lastQ.data && <Pill onClick={() => quick("because")}>Because I played {lastQ.data.name}</Pill>}
            <span className="flex items-center" style={{ gap: 4, marginLeft: 4, color: "var(--text-primary)", opacity: 0.8, fontSize: "var(--fs-small)" }}>
              Size
              {SIZES.map((n) => <Chip key={n} on={settings.size === n} onClick={() => setSize(n)}>{n}</Chip>)}
            </span>
            <button
              onClick={() => setLeaveOpen((v) => !v)} aria-expanded={leaveOpen}
              style={{ marginLeft: "auto", background: "transparent", border: 0, cursor: "pointer", color: "var(--text-primary)", opacity: 0.85, fontSize: "var(--fs-small)", textDecoration: "underline", textUnderlineOffset: 3 }}
            >Leave out…{leaveOut.skipSpoken || leaveOut.skipGenres.length ? ` (${(leaveOut.skipSpoken ? 1 : 0) + leaveOut.skipGenres.length})` : ""}</button>
          </div>

          {leaveOpen && <LeaveOutPanel value={leaveOut} genres={genres} onChange={setLeaveOut} />}

          <StartWith settings={settings} genres={genres} onAdd={(seed) => setSettings((s) => addSeed(s, seed))} onRemove={(i) => setSettings((s) => removeSeed(s, i))} />

          <div className="mb-grid">
            {/* Dials */}
            <aside style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 14, display: "grid", gap: 16 }}>
              <div style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)", borderRadius: 10, padding: "8px 10px", fontWeight: "var(--fw-emphasis)", fontSize: "var(--fs-secondary)", fontVariantNumeric: "tabular-nums" }}>
                {!started ? "Pick a quick start or type what you like"
                  : loading ? "Looking through your library…"
                  : settings.pure ? `${num(mix.length)} random songs picked`
                  : `${num(matches)}${capped ? "+" : ""} songs match → ${num(mix.length)} picked`}
              </div>
              <Dial title="Years" value={settings.years ? `${years[0]}–${years[1]}` : "any"}>
                <RangeSlider min={YEAR_MIN} max={thisYear} value={years} label="Years" onChange={(v) => setSettings((s) => setYears({ ...s, pure: false }, v[0] <= YEAR_MIN && v[1] >= thisYear ? null : v))} />
              </Dial>
              {showBpm && (
                <Dial title="BPM" value={bpmRange ? `${bpmRange[0]}–${bpmRange[1]}` : "any"}>
                  <div className="flex items-end" style={{ gap: 2, height: 54 }} aria-hidden="true">
                    {histogram.map((n, i) => (
                      <span
                        key={i} title={`${BPM_MIN + i * 4}–${BPM_MIN + i * 4 + 3} BPM: ${num(n)}`}
                        style={{ flex: 1, minHeight: 2, height: `${Math.max(4, (n / Math.max(1, ...histogram)) * 100)}%`, borderRadius: "2px 2px 0 0", background: binInRange(i, bpmRange) ? "var(--accent)" : "var(--border)", opacity: binInRange(i, bpmRange) ? 0.85 : 1 }}
                      />
                    ))}
                  </div>
                  <RangeSlider min={BPM_MIN} max={BPM_MAX} value={bpmRange ?? [BPM_MIN, BPM_MAX]} label="BPM" onChange={(v) => setSettings((s) => setBpmRange(s, v))} />
                  {bpmRange && <div style={{ color: "var(--text-secondary)", opacity: 0.8, fontSize: "var(--fs-small)" }}>Songs without a BPM are left out while the range is narrower than {BPM_MIN}–{BPM_MAX}.</div>}
                </Dial>
              )}
              {bpmReady && !showBpm && totalQ.data && (bpmCount > 0 || !!adminQ.data) && (
                <div style={{ color: "var(--text-primary)", opacity: 0.7, fontSize: "var(--fs-small)" }}>
                  BPM is known for {coveragePercent(coverage)}% of your library.
                  {adminQ.data && (
                    <> Analyse it in <button onClick={() => navigateTo({ tab: "settings", settingsTab: "sync" })} style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer", color: "var(--accent)", font: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}>Settings → Sync Server</button>.</>
                  )}
                </div>
              )}
              <Dial title="Genres">
                <div className="flex flex-wrap" style={{ gap: 6 }}>
                  {shownGenres.map((g) => (
                    <Chip key={g.name} on={genreSeeds(settings).some((x) => x.value.toLowerCase() === g.name.toLowerCase())} onClick={() => setSettings((s) => toggleGenre({ ...s, pure: false }, g.name))}>
                      {g.name} <span style={{ opacity: 0.65, fontVariantNumeric: "tabular-nums" }}>{num(g.songCount)}</span>
                    </Chip>
                  ))}
                  {genres.length > 24 && <Chip onClick={() => setAllGenres((v) => !v)}>{allGenres ? "Fewer" : `All ${genres.length}`}</Chip>}
                  {genresQ.isSuccess && !genres.length && <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>No genres in the library.</span>}
                </div>
              </Dial>
              <Dial title="Familiar or new" value={settings.discover < 34 ? "mostly familiar" : settings.discover > 66 ? "mostly new" : "a mix"}>
                <input type="range" min={0} max={100} value={settings.discover} aria-label="Songs I play or songs I have not" onChange={(e) => patch({ discover: Number(e.target.value), pure: settings.pure })} style={{ width: "100%", accentColor: "var(--accent)" }} />
                <div className="flex justify-between" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}><span>Songs I play</span><span>Songs I have not</span></div>
              </Dial>
              <Switch label="Favourites only" on={settings.favOnly} onChange={(v) => patch({ favOnly: v })} />
              <Switch label="Not played yet" on={settings.unplayedOnly} onChange={(v) => patch({ unplayedOnly: v })} />
            </aside>

            {/* The live mix */}
            <main style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 14, display: "grid", gap: 10, minWidth: 0 }}>
              <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
                <span style={{ flex: 1, fontSize: "var(--fs-small)", fontWeight: "var(--fw-emphasis)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-primary)", opacity: 0.7 }}>Your mix</span>
                {showBpm && <Chip on={flowOn} onClick={() => setFlow(!settings.flow)} title="Shape the mix by BPM: draw how the energy should rise and fall">Flow</Chip>}
                <Pill onClick={() => { setNonce((n) => n + 1); say("Re-rolled the songs you did not keep"); }} disabled={!started}>Re-roll unlocked</Pill>
                <Pill onClick={clearAll} disabled={!started && !mix.length}>Clear</Pill>
              </div>

              {flowOn && (
                <FlowEditor
                  curve={sanitizeCurve(settings.curve)} axis={axis} onCommit={setCurve}
                  actual={shown.map((m) => bpmFraction(full, bpmOf(m.track)))}
                />
              )}
              {flowOn && started && !loading && mix.length > 0 && mix.length < settings.size && (
                <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
                  Only {num(mix.length)} songs with a BPM fit. Widen the BPM range or the other dials for a longer mix.
                </div>
              )}

              {!started && (
                <div style={{ color: "var(--text-secondary)", textAlign: "center", padding: "40px 10px", fontSize: "var(--fs-secondary)" }}>
                  Start with a quick start above, or type an artist, a song, a genre or a decade like “90s”. A mix is picked for you; keep what you like and swap the rest.
                </div>
              )}
              {started && !loading && poolQ.isError && (
                <div style={{ color: "var(--error)", textAlign: "center", padding: 24 }}>
                  Could not load songs from the server. <button onClick={() => poolQ.refetch()} style={{ color: "var(--accent)", textDecoration: "underline", cursor: "pointer" }}>Try again</button>
                </div>
              )}
              {started && !loading && !poolQ.isError && !mix.length && (
                <div style={{ color: "var(--text-secondary)", textAlign: "center", padding: "30px 10px", fontSize: "var(--fs-secondary)" }}>
                  Nothing matches yet. Widen the years, or remove a genre or a switch.
                </div>
              )}

              <div style={{ display: "grid", gap: 2, opacity: loading && mix.length ? 0.6 : 1 }}>
                {visible.map((m, i) => (
                  <MixRow
                    key={m.track.id} item={m} index={i} over={dragOver === i} showBpm={showBpm}
                    onAct={(w) => act(i, w)}
                    onDragStart={() => { dragFrom.current = i; }}
                    onDragOver={() => setDragOver(i)}
                    onDragLeave={() => setDragOver((o) => (o === i ? null : o))}
                    onDrop={() => drop(i)}
                  />
                ))}
                {hiddenCount(mix.length) > 0 && (
                  <div style={{ border: "1px dashed var(--border)", borderRadius: 10, textAlign: "center", padding: 10, color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>
                    … and {num(hiddenCount(mix.length))} more songs, picked the same way. Play, Add to queue and Save use all {num(mix.length)}.
                  </div>
                )}
              </div>
            </main>
          </div>
        </div>
      </div>

      {/* Tray */}
      <div style={{ flexShrink: 0, borderTop: "1px solid var(--border)", background: "var(--header-bg)", padding: "10px 20px" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
          <Stat value={num(mix.length)} label="songs" />
          <Stat value={fmtLength(totalSeconds(mix))} label="length" />
          {showBpm && stats.avg !== null && <Stat value={String(Math.round(stats.avg))} label="avg BPM" />}
          {showBpm && stats.series.length > 1 && <BpmSpark series={stats.series} axis={axis} />}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {toast && <span role="status" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", maxWidth: 360 }}>{toast}</span>}
            <Pill onClick={queueAll} disabled={!mix.length}>Add to queue</Pill>
            <Pill onClick={() => setSaveOpen((v) => !v)} disabled={!mix.length}>Save as playlist…</Pill>
            <Pill accent big onClick={() => playAll()} disabled={!mix.length}>▶ Play</Pill>
          </div>
          {saveOpen && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", width: "100%", paddingTop: 8, borderTop: "1px solid var(--border)" }}>
              <input
                value={saveName} onChange={(e) => setSaveName(e.target.value)} aria-label="Playlist name" maxLength={120}
                onKeyDown={(e) => { if (e.key === "Enter") void savePlaylist(); if (e.key === "Escape") setSaveOpen(false); }}
                style={{ flex: 1, minWidth: 200, background: "var(--main-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}
                autoFocus
              />
              <Pill accent onClick={() => void savePlaylist()} disabled={!saveName.trim() || busy === "save"}>{busy === "save" ? "Saving…" : "Save"}</Pill>
              <Pill onClick={() => setSaveOpen(false)}>Cancel</Pill>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Leave out": spoken word and skipped genres, for every start (also Play 500 random). */
function LeaveOutPanel({ value, genres, onChange }: { value: LeaveOut; genres: { name: string; songCount: number }[]; onChange: (v: LeaveOut) => void }) {
  const [q, setQ] = useState("");
  const skipped = value.skipGenres;
  const has = (g: string) => skipped.some((x) => x.toLowerCase() === g.toLowerCase());
  const sorted = useMemo(() => [...genres].sort((a, b) => b.songCount - a.songCount), [genres]);
  const needle = q.trim().toLowerCase();
  const found = (needle ? sorted.filter((g) => g.name.toLowerCase().includes(needle)) : sorted.slice(0, 12)).filter((g) => !has(g.name)).slice(0, 12);
  return (
    <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", display: "grid", gap: 10 }}>
      <b style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>Leave out</b>
      <label className="flex items-center" style={{ gap: 8, color: "var(--text-primary)", fontSize: "var(--fs-secondary)", cursor: "pointer" }}>
        <input type="checkbox" checked={value.skipSpoken} onChange={(e) => onChange({ ...value, skipSpoken: e.target.checked })} style={{ accentColor: "var(--accent)" }} />
        Audiobooks and spoken word
        <span style={{ opacity: 0.65, fontSize: "var(--fs-small)" }}>(a genre named audiobook, spoken word, podcast, hörspiel or raamat, or a track over 20 minutes)</span>
      </label>
      <div style={{ display: "grid", gap: 6 }}>
        <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>Genres to skip</span>
        <div className="flex flex-wrap items-center" style={{ gap: 6 }}>
          {skipped.map((g) => <Chip key={g} on onClick={() => onChange({ ...value, skipGenres: toggleSkipGenre(skipped, g) })} title="Allow this genre again">{g} ×</Chip>)}
          {!skipped.length && <span style={{ color: "var(--text-secondary)", opacity: 0.7, fontSize: "var(--fs-small)" }}>None. Songs of a skipped genre never come up, in any start.</span>}
        </div>
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a genre to skip…" aria-label="Find a genre to skip"
          style={{ maxWidth: 280, background: "var(--main-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "6px 10px", color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}
        />
        <div className="flex flex-wrap" style={{ gap: 6 }}>
          {found.map((g) => <Chip key={g.name} onClick={() => onChange({ ...value, skipGenres: toggleSkipGenre(skipped, g.name) })}>{g.name} <span style={{ opacity: 0.65 }}>{num(g.songCount)}</span></Chip>)}
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ display: "grid", fontVariantNumeric: "tabular-nums" }}>
      <b style={{ fontSize: "var(--fs-heading)", color: "var(--text-secondary)" }}>{value}</b>
      <span style={{ fontSize: "var(--fs-small)", color: "var(--text-primary)", opacity: 0.7, textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</span>
    </div>
  );
}

/** Flow's curve editor: five points to drag (up = faster), presets, and a dashed line with the mix's real BPM. */
const FLOW_W = 400, FLOW_H = 110, FLOW_PAD = 10;
function FlowEditor({ curve, axis, actual, onCommit }: {
  curve: number[]; axis: [number, number]; actual: (number | null)[]; onCommit: (c: number[]) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<number[] | null>(null);
  const c = draft ?? curve;
  const y = (v: number) => FLOW_H - FLOW_PAD - v * (FLOW_H - 2 * FLOW_PAD);
  const x = (i: number, n: number) => (n > 1 ? (i / (n - 1)) * FLOW_W : 0);
  const line = c.map((v, i) => `${x(i, c.length).toFixed(1)},${y(v).toFixed(1)}`);
  const real = actual.flatMap((f, i) => (f === null ? [] : [`${x(i, actual.length).toFixed(1)},${y(f).toFixed(1)}`]));
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.005);

  function down(i: number) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      let latest = c;
      const move = (ev: PointerEvent) => {
        const r = box.current!.getBoundingClientRect();
        const yy = ((ev.clientY - r.top) / r.height) * FLOW_H;
        const v = Math.max(0, Math.min(1, (FLOW_H - FLOW_PAD - yy) / (FLOW_H - 2 * FLOW_PAD)));
        latest = latest.map((o, j) => (j === i ? v : o));
        setDraft(latest);
      };
      const up = () => {
        el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
        setDraft(null);
        onCommit(latest); // the mix is built again once, when the point is let go
      };
      el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    };
  }
  function key(i: number) {
    return (e: React.KeyboardEvent) => {
      const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.05 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.05 : 0;
      if (!d) return;
      e.preventDefault();
      onCommit(curve.map((o, j) => (j === i ? Math.max(0, Math.min(1, o + d)) : o)));
    };
  }
  const bpmAt = (v: number) => Math.round(axis[0] + v * (axis[1] - axis[0]));
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px", display: "grid", gap: 8, background: "var(--main-bg)" }}>
      <div className="flex flex-wrap items-center" style={{ gap: 6, color: "var(--text-primary)", fontSize: "var(--fs-small)" }}>
        <span style={{ marginRight: 4 }}>Draw the energy of the mix: drag the points. The dashed line is the mix as it came out.</span>
        {(Object.keys(FLOW_PRESETS) as FlowPresetId[]).map((id) => (
          <Chip key={id} on={same(curve, FLOW_PRESETS[id].curve)} onClick={() => onCommit([...FLOW_PRESETS[id].curve])}>{FLOW_PRESETS[id].label}</Chip>
        ))}
      </div>
      <div style={{ padding: `0 ${FLOW_PAD}px` }}>
        <div ref={box} style={{ position: "relative", height: FLOW_H, touchAction: "none" }}>
          <svg viewBox={`0 0 ${FLOW_W} ${FLOW_H}`} preserveAspectRatio="none" role="img" aria-label="BPM curve of the mix" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
            <path d={`M${line.join(" L")} L${FLOW_W},${FLOW_H} L0,${FLOW_H} Z`} fill="color-mix(in srgb, var(--accent) 14%, transparent)" />
            <path d={`M${line.join(" L")}`} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            {real.length > 1 && <polyline points={real.join(" ")} fill="none" stroke="var(--text-primary)" strokeOpacity={0.7} strokeWidth={1.2} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
          </svg>
          <span style={{ position: "absolute", left: 2, top: 0, fontSize: 10, color: "var(--text-primary)", opacity: 0.7, pointerEvents: "none" }}>{axis[1]} BPM</span>
          <span style={{ position: "absolute", left: 2, bottom: 0, fontSize: 10, color: "var(--text-primary)", opacity: 0.7, pointerEvents: "none" }}>{axis[0]}</span>
          {c.map((v, i) => (
            <div
              key={i} role="slider" tabIndex={0} aria-label={`Flow point ${i + 1} of ${c.length}`} aria-orientation="vertical"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-valuetext={`${bpmAt(v)} BPM`}
              onPointerDown={down(i)} onKeyDown={key(i)} title={`${bpmAt(v)} BPM`}
              style={{ position: "absolute", left: `${(x(i, c.length) / FLOW_W) * 100}%`, top: `${(y(v) / FLOW_H) * 100}%`, width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: "50%", background: "var(--card-bg)", border: "2px solid var(--accent)", cursor: "ns-resize", touchAction: "none" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The BPM of the mix, song after song, in the tray. */
function BpmSpark({ series, axis }: { series: number[]; axis: [number, number] }) {
  const W = 150, H = 34;
  const span = Math.max(1, axis[1] - axis[0]);
  const pts = series.map((b, i) => `${((i / (series.length - 1)) * W).toFixed(1)},${(H - 4 - Math.max(0, Math.min(1, (b - axis[0]) / span)) * (H - 8)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="BPM across the mix" style={{ width: 150, height: 34 }}>
      <polyline points={pts.join(" ")} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MixRow({ item, index, over, showBpm, onAct, onDragStart, onDragOver, onDragLeave, onDrop }: {
  item: MixItem; index: number; over: boolean; showBpm: boolean;
  onAct: (w: "keep" | "swap" | "more" | "drop") => void;
  onDragStart: () => void; onDragOver: () => void; onDragLeave: () => void; onDrop: () => void;
}) {
  const t: Track = item.track;
  return (
    <div
      className={`mb-row${item.locked ? " kept" : ""}${over ? " over" : ""}${showBpm ? " withbpm" : ""}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(index)); onDragStart(); }}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      <span title="Drag to reorder" style={{ color: "var(--text-primary)", opacity: 0.6, textAlign: "right", fontSize: "var(--fs-small)", cursor: "grab", fontVariantNumeric: "tabular-nums" }}>{index + 1}</span>
      <CoverArt coverId={t.cover_id} size={44} className="rounded-md" style={{ width: 44, height: 44 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "var(--text-secondary)", fontWeight: "var(--fw-emphasis)", fontSize: "var(--fs-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
        <div style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.artist}</div>
        <div style={{ color: "var(--text-primary)", opacity: 0.7, fontSize: "var(--fs-small)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reasonLine(item)}</div>
      </div>
      {showBpm && (
        <span title="BPM" style={{ color: "var(--text-secondary)", textAlign: "right", fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)", fontVariantNumeric: "tabular-nums" }}>
          {bpmOf(t) !== null ? Math.round(bpmOf(t)!) : "–"}<small style={{ color: "var(--text-primary)", opacity: 0.7, fontWeight: "var(--fw-secondary)", marginLeft: 3 }}>BPM</small>
        </span>
      )}
      <span className="mb-dur" style={{ color: "var(--text-primary)", opacity: 0.8, textAlign: "right", fontSize: "var(--fs-secondary)", fontVariantNumeric: "tabular-nums" }}>{fmtLength(t.duration_secs)}</span>
      <div className="mb-acts">
        <button onClick={() => onAct("keep")} aria-pressed={item.locked} title={item.locked ? "Kept: stays when you re-roll" : "Keep this song when I re-roll"} aria-label="Keep" style={{ color: item.locked ? "var(--accent)" : undefined }}>{item.locked ? "♥" : "♡"}</button>
        <button onClick={() => onAct("swap")} title="Swap for another song" aria-label="Swap">↻</button>
        <button onClick={() => onAct("more")} title={`More like ${t.artist}`} aria-label="More like this">✦</button>
        <button onClick={() => onAct("drop")} title="Remove" aria-label="Remove">×</button>
      </div>
    </div>
  );
}

/** The "Start with" box: seed chips, a text field and suggestions (arrows, Enter, Backspace removes the last chip). */
function StartWith({ settings, genres, onAdd, onRemove }: {
  settings: MixSettings; genres: { name: string; songCount: number }[];
  onAdd: (s: MixSeed) => void; onRemove: (i: number) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [remote, setRemote] = useState<SeedSuggestion[]>([]);
  const q = useDebounced(text.trim(), 200);

  useEffect(() => {
    if (!q) { setRemote([]); return; }
    let live = true;
    api.search(q, 4, 0, 3).then((r) => {
      if (!live) return;
      setRemote([
        ...r.artists.map((a): SeedSuggestion => ({ seed: { kind: "artist", value: a.name, id: a.id }, label: "artist", text: a.name })),
        // A song becomes its artist.
        ...r.tracks.filter((t) => t.artist).map((t): SeedSuggestion => ({ seed: { kind: "artist", value: t.artist, id: t.artist_id ?? undefined }, label: "song", text: `${t.title} · ${t.artist}` })),
      ]);
    }).catch(() => { if (live) setRemote([]); });
    return () => { live = false; };
  }, [q]);

  const list = useMemo(() => {
    const local = localSuggestions(text, genres);
    const d = local.filter((s) => s.label === "decade");
    const g = local.filter((s) => s.label === "genre");
    const artists = remote.filter((s) => s.label === "artist");
    const songs = remote.filter((s) => s.label === "song");
    return [...d, ...artists, ...g, ...songs].slice(0, 8);
  }, [text, genres, remote]);
  useEffect(() => setIdx(0), [list.length, text]);

  function add(s: SeedSuggestion | undefined) {
    if (!s) return;
    onAdd(s.seed);
    setText(""); setOpen(false);
  }
  const hint = settings.seeds.length
    ? "Songs are picked to fit these. Add more, or press ✦ on a song to use its artist as a seed."
    : "Right-click a song anywhere in the app and choose “Start a Mix from this”.";

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div className="flex flex-wrap items-center" style={{ position: "relative", gap: 8, background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: "8px 10px" }}>
        {settings.seeds.map((d, i) => (
          <span key={`${d.kind}-${d.value}`} className="inline-flex items-center" style={{ gap: 6, background: "color-mix(in srgb, var(--accent) 17.6%, transparent)", color: "var(--accent)", borderRadius: 999, padding: "3px 6px 3px 11px", fontWeight: "var(--fw-emphasis)", fontSize: "var(--fs-secondary)" }}>
            <i style={{ fontStyle: "normal", fontWeight: "var(--fw-secondary)", color: "var(--text-primary)", opacity: 0.7, fontSize: "var(--fs-small)", textTransform: "uppercase", letterSpacing: ".05em" }}>{d.kind}</i>
            {d.value}
            <button onClick={() => onRemove(i)} aria-label={`Remove ${d.value}`} style={{ border: 0, background: "transparent", color: "inherit", width: 20, height: 20, borderRadius: "50%", cursor: "pointer" }}>×</button>
          </span>
        ))}
        <input
          value={text} placeholder="Start with an artist, song, genre or “90s”…" aria-label="Start with" autoComplete="off"
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && list.length) { e.preventDefault(); setIdx((i) => (i + 1) % list.length); }
            else if (e.key === "ArrowUp" && list.length) { e.preventDefault(); setIdx((i) => (i - 1 + list.length) % list.length); }
            else if (e.key === "Enter" && open && list[idx]) { e.preventDefault(); add(list[idx]); }
            else if (e.key === "Escape") setOpen(false);
            else if (e.key === "Backspace" && !text && settings.seeds.length) onRemove(settings.seeds.length - 1);
          }}
          style={{ flex: 1, minWidth: 220, background: "transparent", border: 0, outline: 0, padding: "8px 4px", fontSize: "var(--fs-primary)", color: "var(--text-secondary)" }}
        />
        {open && list.length > 0 && (
          <div className="mb-sugg" role="listbox" style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)", background: "var(--left-panel-bg)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.35)", zIndex: 20, overflow: "hidden" }}>
            {list.map((s, i) => (
              <button key={`${s.label}-${s.text}`} role="option" aria-selected={i === idx} className={i === idx ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); add(s); }}>
                <em style={{ fontStyle: "normal", width: 62, flexShrink: 0, fontSize: "var(--fs-small)", textTransform: "uppercase", letterSpacing: ".06em", opacity: 0.7 }}>{s.label}</em>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.text}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ color: "var(--text-primary)", opacity: 0.7, fontSize: "var(--fs-small)", padding: "0 2px" }}>{hint}</div>
    </div>
  );
}
