import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { api, Track } from "../lib/api";
import { parseLrc, ParsedLyrics, extractOffset, withOffset } from "../lib/lrc";
import { LyricsSearchDialog } from "./LyricsSearchDialog";

// Auto-fetch priority, matching the old app's _LyricsFetcher.run() exactly:
// local cache → server (Subsonic getLyrics) → LRCLib direct → LRCLib search
// → NetEase search → SimpMusic search, first hit wins. The manual "Search"
// dialog is different — it aggregates *all* sources at once for the user to
// browse/pick from (see LyricsSearchDialog).
async function autoFetch(track: Track): Promise<{ raw: string; source: string; sid: string } | null> {
  const local = await api.lyricsLocalLoad(track.id);
  if (local) return { raw: local, source: "Local", sid: "" };

  const server = await api.lyricsServer(track.artist, track.title).catch(() => null);
  if (server) return { raw: server, source: "Server", sid: "" };

  const direct = await api.lyricsDirect(track.artist, track.title, track.album ?? "", track.duration_secs).catch(() => null);
  if (direct) return { raw: direct, source: "LRCLib", sid: "" };

  for (const source of ["LRCLib", "NetEase", "SimpMusic"] as const) {
    const results = await api.lyricsSearch(track.artist, track.title, [source]).catch(() => []);
    if (!results.length) continue;
    const raw = await api.lyricsFetch(source, results[0].id).catch(() => null);
    if (raw) return { raw, source, sid: results[0].id };
  }
  return null;
}

function findActiveIndex(lines: { ms: number; text: string }[], posMs: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (posMs >= lines[i].ms) idx = i;
    else break;
  }
  return idx;
}

function ToolbarButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={title}
      style={{
        background: hov ? "var(--hover-bg)" : "transparent", border: "none", borderRadius: 5, cursor: "pointer",
        color: "var(--text-primary)", fontSize: 11, padding: "2px 8px", height: 26,
      }}
    >
      {children}
    </button>
  );
}

export function LyricsPanel({ active }: { active: boolean }) {
  const queue = useStore((s) => s.queue);
  const currentIndex = useStore((s) => s.currentIndex);
  const currentTime = useStore((s) => s.currentTime);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const track = queue[currentIndex] ?? null;

  const [status, setStatus] = useState("No track playing");
  const [parsed, setParsed] = useState<ParsedLyrics | null>(null);
  const [rawLyrics, setRawLyrics] = useState("");
  const [activeSource, setActiveSource] = useState("");
  const [activeSid, setActiveSid] = useState("");
  // Tracks whether the currently-displayed lyrics are the locally-saved copy —
  // deliberately separate from `activeSource` (matches the old app's
  // `_toolbar.set_save_mode(bool)`, which is its own flag, not derived from
  // `_active_source`: removing the local save leaves `_active_source` as
  // `'Local'` in the old app too, only this flag flips the button back to "Save").
  const [isLocalSaved, setIsLocalSaved] = useState(false);
  const [offsetMs, setOffsetMs] = useState(0);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toolbarHov, setToolbarHov] = useState(false);

  const genRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // Matches _pending_lyrics: the track a fetch is owed for, once the tab is
  // actually visible — set on every track change, cleared once that track's
  // fetch has actually run. Avoids hitting LRCLib/NetEase/SimpMusic/the
  // local disk cache for a track the user never looks the lyrics up for.
  const pendingRef = useRef<Track | null>(null);
  const loadedIdRef = useRef<string | null>(null);

  function reset(msg: string) {
    setStatus(msg);
    setParsed(null);
    setRawLyrics("");
    setActiveSource("");
    setActiveSid("");
    setIsLocalSaved(false);
    setOffsetMs(0);
    setActiveIdx(-1);
    lineRefs.current.clear();
  }

  function runFetch(t: Track) {
    loadedIdRef.current = t.id;
    pendingRef.current = null;
    const gen = ++genRef.current;
    reset("Loading lyrics…");
    autoFetch(t).then((hit) => {
      if (gen !== genRef.current) return;
      if (!hit) { setStatus("No lyrics found"); return; }
      // A locally-saved file may carry our own [offset:±ms] tag (see
      // src/lib/lrc.ts) — the old app never persisted the offset at all
      // (always reset to 0 per track), this restores it instead.
      const { offsetMs: savedOffset, text } = hit.source === "Local" ? extractOffset(hit.raw) : { offsetMs: 0, text: hit.raw };
      setRawLyrics(text);
      setActiveSource(hit.source);
      setActiveSid(hit.sid);
      setIsLocalSaved(hit.source === "Local");
      setOffsetMs(savedOffset);
      setParsed(parseLrc(text));
      setStatus("");
    });
  }

  // Track changes always update what's *pending*; the actual network/disk
  // fetch only runs once the tab is visible (either right now, if `active`,
  // or deferred until the next effect below flips `active` true) — matches
  // queue_lyrics_load()/_do_load_lyrics()'s pending-until-tab-open pattern.
  useEffect(() => {
    if (!track) { pendingRef.current = null; loadedIdRef.current = null; reset("No track playing"); return; }
    if (track.id === loadedIdRef.current) return;
    pendingRef.current = track;
    if (active) runFetch(track);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id]);

  useEffect(() => {
    if (active && pendingRef.current) runFetch(pendingRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Synced-lyrics highlight, driven by the same currentTime the footer's
  // waveform/position already tracks — matches update_lyrics_position, just
  // sourced from the store instead of a dedicated Qt signal.
  useEffect(() => {
    if (!parsed || parsed.kind !== "synced") return;
    const idx = findActiveIndex(parsed.lines, currentTime * 1000 + offsetMs);
    if (idx === activeIdx) return;
    setActiveIdx(idx);
    const el = idx >= 0 ? lineRefs.current.get(idx) : null;
    const container = scrollRef.current;
    if (el && container) {
      const target = el.offsetTop - container.clientHeight * 0.5;
      container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, offsetMs, parsed]);

  async function toggleSave() {
    if (!track) return;
    if (isLocalSaved) {
      await api.lyricsLocalRemove(track.id);
      setIsLocalSaved(false);
    } else if (rawLyrics) {
      await api.lyricsLocalSave(track.id, withOffset(rawLyrics, offsetMs));
      setActiveSource("Local");
      setIsLocalSaved(true);
    }
  }

  // Matches _clear_override_and_reload: just clears any manual search
  // override and re-runs the same priority pipeline from the top (which
  // still checks the local cache first, same as the initial load).
  function refresh() {
    if (track) runFetch(track);
  }

  function applyOverride(source: string, sid: string, raw: string) {
    setActiveSource(source);
    setActiveSid(sid);
    setRawLyrics(raw);
    setIsLocalSaved(false);
    setParsed(parseLrc(raw));
    setStatus("");
    setSearchOpen(false);
  }

  function changeOffset(delta: number) {
    setOffsetMs((v) => {
      const next = v + delta;
      // Keep the persisted copy's offset in sync once it's already been
      // saved locally — otherwise reopening this track later would restore
      // the offset from whenever "Save" was last clicked, silently out of
      // sync with whatever the user nudged it to afterward.
      if (isLocalSaved && track) api.lyricsLocalSave(track.id, withOffset(rawLyrics, next));
      return next;
    });
  }

  function seekTo(ms: number) {
    setCurrentTime(ms / 1000);
  }

  return (
    <div
      className="flex-1 flex flex-col"
      style={{ minHeight: 0, position: "relative" }}
      onMouseEnter={() => setToolbarHov(true)}
      onMouseLeave={() => setToolbarHov(false)}
    >
      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-clean" style={{ padding: "24px 0 16px" }}>
        {!parsed ? (
          <p className="text-center" style={{ color: "var(--text-secondary)", opacity: 0.4, fontSize: "var(--fs-secondary)", padding: 32 }}>
            {status}
          </p>
        ) : (
          // Matches lyrics_panel.py's _container QVBoxLayout: setSpacing(16)
          // between every line widget — was missing here, so lines only had
          // their own 2px padding between them instead of 16px apart.
          <div className="flex flex-col" style={{ gap: 16 }}>
            {activeSource && (
              <p className="text-center" style={{ color: "var(--accent)", fontSize: 10, fontWeight: 700, letterSpacing: 1, padding: "0 12px 8px", textTransform: "uppercase" }}>
                {activeSource}
              </p>
            )}
            {parsed.kind === "plain"
              ? parsed.text.split("\n").map((para, i) => (
                  <p key={i} className="text-center" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-primary)", padding: "2px 12px" }}>
                    {para || "♪"}
                  </p>
                ))
              : parsed.lines.map((line, i) => (
                  <div
                    key={i}
                    ref={(el) => { if (el) lineRefs.current.set(i, el); else lineRefs.current.delete(i); }}
                    onClick={() => seekTo(line.ms)}
                    className="text-center"
                    style={{
                      cursor: "pointer", padding: "2px 12px",
                      color: i === activeIdx ? "var(--accent)" : "var(--text-secondary)",
                      fontSize: i === activeIdx ? "calc(var(--fs-primary) + 2px)" : "var(--fs-primary)",
                      fontWeight: i === activeIdx ? 700 : 400,
                    }}
                  >
                    {line.text || "♪"}
                  </div>
                ))}
          </div>
        )}
      </div>

      {/* Hover toolbar — fades in only while the mouse is over the panel,
          matches lyrics_panel.py's _LyricsToolbar opacity animation. */}
      <div
        className="flex flex-col items-center shrink-0"
        style={{
          gap: 2, padding: "4px 8px", opacity: toolbarHov ? 1 : 0, transition: "opacity 200ms",
          pointerEvents: toolbarHov ? "auto" : "none",
        }}
      >
        <div className="flex items-center" style={{ gap: 4 }}>
          <ToolbarButton onClick={() => changeOffset(-50)} title="Shift lyrics earlier">−50ms</ToolbarButton>
          <span style={{ width: 68, textAlign: "center", color: "var(--text-primary)", fontSize: 11 }}>
            {offsetMs ? `${offsetMs > 0 ? "+" : ""}${offsetMs} ms` : "0 ms"}
          </span>
          <ToolbarButton onClick={() => changeOffset(50)} title="Shift lyrics later">+50ms</ToolbarButton>
        </div>
        <div className="flex items-center" style={{ gap: 4 }}>
          <ToolbarButton onClick={() => setSearchOpen(true)} title="Search lyrics">Search</ToolbarButton>
          <ToolbarButton onClick={toggleSave} title={isLocalSaved ? "Delete locally saved lyrics" : "Save lyrics locally"}>
            {isLocalSaved ? "Remove Local" : "Save"}
          </ToolbarButton>
          <ToolbarButton onClick={refresh} title="Clear override and re-fetch">Refresh</ToolbarButton>
        </div>
      </div>

      {searchOpen && track && (
        <LyricsSearchDialog
          artist={track.artist}
          title={track.title}
          activeSource={activeSource}
          activeSid={activeSid}
          onApply={(r, raw) => applyOverride(r.source, r.id, raw)}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}
