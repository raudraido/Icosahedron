import { useEffect, useRef, useState } from "react";
import { api, LyricsSearchResult } from "../lib/api";
import { parseLrc } from "../lib/lrc";
import { PLAY_ICON_DARK } from "../lib/theme";
import { ScrollThumb } from "./ScrollThumb";

const SOURCES = ["LRCLib", "NetEase", "SimpMusic"];

interface Props {
  artist: string;
  title: string;
  activeSource: string;
  activeSid: string;
  onApply: (result: LyricsSearchResult, raw: string) => void;
  onClose: () => void;
}

// Matches the old app's LyricsSearchDialog (lyrics_panel.py:299-553): manual
// title/artist override, results list on the left, plain-text preview
// (first 30 lines for synced lyrics) on the right, Apply commits the raw
// LRC/plain text as an override for the current track.
export function LyricsSearchDialog({ artist, title, activeSource, activeSid, onApply, onClose }: Props) {
  const [titleQuery, setTitleQuery] = useState(title);
  const [artistQuery, setArtistQuery] = useState(artist);
  const [results, setResults] = useState<LyricsSearchResult[]>([]);
  const [status, setStatus] = useState("");
  const resultsRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<LyricsSearchResult | null>(null);
  const [preview, setPreview] = useState("Select a result to preview");
  const [previewRaw, setPreviewRaw] = useState("");
  const [searching, setSearching] = useState(false);

  async function doSearch() {
    if (!artistQuery.trim() && !titleQuery.trim()) return;
    setSearching(true);
    setStatus("Searching…");
    setResults([]);
    setSelected(null);
    setPreviewRaw("");
    setPreview("Select a result to preview");
    try {
      const found = await api.lyricsSearch(artistQuery.trim(), titleQuery.trim(), SOURCES);
      setResults(found);
      setStatus(found.length ? `${found.length} result(s)` : "No results found");
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => { doSearch(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function selectResult(r: LyricsSearchResult) {
    setSelected(r);
    setPreviewRaw("");
    setPreview("Loading preview…");
    const raw = await api.lyricsFetch(r.source, r.id);
    if (!raw) {
      setPreview("No lyrics found for this result");
      return;
    }
    setPreviewRaw(raw);
    const parsed = parseLrc(raw);
    if (parsed.kind === "synced") {
      const lines = parsed.lines.slice(0, 30).map((l) => l.text);
      setPreview(lines.join("\n") + (parsed.lines.length > 30 ? `\n… (${parsed.lines.length} lines total)` : ""));
    } else {
      setPreview(parsed.text.slice(0, 800));
    }
  }

  function apply() {
    if (selected && previewRaw) onApply(selected, previewRaw);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "color-mix(in srgb, black 40%, transparent)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--main-bg)", border: "1px solid var(--border)", borderRadius: 10,
          padding: 16, width: 720, height: 480, display: "flex", flexDirection: "column", gap: 10,
          boxShadow: "0 12px 32px color-mix(in srgb, black 30%, transparent)",
        }}
      >
        <div className="flex items-center">
          <h3 style={{ color: "var(--text-primary)", fontSize: "var(--fs-heading)", fontWeight: 700 }}>Search Lyrics</h3>
          <div className="flex-1" />
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", fontSize: 16 }}
          >
            ✕
          </button>
        </div>

        <div className="flex" style={{ gap: 8 }}>
          <input
            value={titleQuery}
            onChange={(e) => setTitleQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Title"
            className="outline-none"
            style={{ flex: 2, background: "var(--card-bg)", color: "var(--text-primary)", fontSize: "var(--fs-secondary)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px" }}
          />
          <input
            value={artistQuery}
            onChange={(e) => setArtistQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Artist"
            className="outline-none"
            style={{ flex: 2, background: "var(--card-bg)", color: "var(--text-primary)", fontSize: "var(--fs-secondary)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px" }}
          />
          <button
            onClick={doSearch}
            disabled={searching}
            style={{ flex: 1, background: "var(--hover-bg)", color: "var(--text-primary)", fontSize: "var(--fs-secondary)", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}
          >
            Search
          </button>
        </div>

        <div className="flex-1 flex" style={{ gap: 10, minHeight: 0 }}>
          <div style={{ flex: 1, position: "relative" }}>
          <div ref={resultsRef} className="scroll-clean" style={{ height: "100%", overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
            {results.map((r) => {
              const isActive = r.source === activeSource && r.id === activeSid;
              return (
                <button
                  key={`${r.source}-${r.id}`}
                  onClick={() => selectResult(r)}
                  className="w-full text-left"
                  style={{
                    display: "block", padding: "8px 10px", background: selected === r ? "var(--hover-bg)" : "transparent",
                    border: "none", cursor: "pointer", color: isActive ? "var(--accent)" : "var(--text-primary)",
                    fontWeight: isActive ? 700 : 400, fontSize: "var(--fs-secondary)",
                  }}
                >
                  {r.synced ? "⏱ " : "  "}{r.title} — {r.artist}  [{r.source}]
                </button>
              );
            })}
          </div>
          <ScrollThumb scrollRef={resultsRef} />
          </div>
          <div style={{ flex: 1, position: "relative" }}>
          <div
            ref={previewRef}
            className="scroll-clean"
            style={{
              height: "100%", overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: 10,
              color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", whiteSpace: "pre-wrap",
            }}
          >
            {preview}
          </div>
          <ScrollThumb scrollRef={previewRef} />
          </div>
        </div>

        <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>{status}</div>

        <div className="flex justify-end" style={{ gap: 8 }}>
          <button
            onClick={onClose}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", background: "transparent", color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}
          >
            Cancel
          </button>
          <button
            onClick={apply}
            disabled={!previewRaw}
            style={{
              padding: "6px 14px", borderRadius: 6, border: "none", cursor: previewRaw ? "pointer" : "default",
              background: "var(--accent)", color: PLAY_ICON_DARK, fontSize: "var(--fs-secondary)", fontWeight: 600,
              opacity: previewRaw ? 1 : 0.5,
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
