import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api, Track } from "../lib/api";
import { fmtDuration } from "../lib/api";
import { useStore } from "../store";
import { CoverArt } from "./CoverArt";
import { Icon } from "./Icon";
import { ArtistTokens } from "./ArtistTokens";

// Shared, reusable track table — used by both the main Tracks screen and the
// album-detail tracklist (matches the old app's TrackListView.qml, reused
// verbatim by tracks_list.qml and album_detail.qml). Column layout/sort/
// visibility state is intentionally shared (not scoped per host) via
// localStorage, matching the old app's single QSettings namespace.

// ── Column model ─────────────────────────────────────────────────────────

interface ColumnDef {
  id: string;
  label: string;
  minWidth: number;
  sortable: boolean;
  descFirst?: boolean; // sorts descending on first click (e.g. plays, duration)
}

const COLUMNS: Record<string, ColumnDef> = {
  track:   { id: "track",   label: "TRACK",       minWidth: 220, sortable: false },
  title:   { id: "title",   label: "TITLE",       minWidth: 80,  sortable: true },
  artist:  { id: "artist",  label: "ARTIST",      minWidth: 90,  sortable: true },
  album:   { id: "album",   label: "ALBUM",       minWidth: 90,  sortable: true },
  fav:     { id: "fav",     label: "FAVORITE",    minWidth: 68,  sortable: true },
  genre:   { id: "genre",   label: "GENRE",       minWidth: 80,  sortable: false },
  dur:     { id: "dur",     label: "DURATION",    minWidth: 75,  sortable: true, descFirst: true },
  plays:   { id: "plays",   label: "PLAYS",       minWidth: 60,  sortable: true, descFirst: true },
  trackno: { id: "trackno", label: "NO.",         minWidth: 55,  sortable: true },
  year:    { id: "year",    label: "YEAR",        minWidth: 60,  sortable: true },
  date:    { id: "date",    label: "DATE ADDED",  minWidth: 100, sortable: true, descFirst: true },
  bpm:     { id: "bpm",     label: "BPM",         minWidth: 56,  sortable: true, descFirst: true },
};

// Table column order (default) vs. the picker menu's fixed listing order — these differ in the old app.
const DEFAULT_COL_ORDER = ["track", "title", "artist", "album", "fav", "genre", "dur", "plays", "trackno", "year", "date", "bpm"];
const MENU_ORDER = ["title", "artist", "fav", "genre", "dur", "plays", "album", "trackno", "year", "date", "bpm"];

const DEFAULT_COL_VISIBILITY: Record<string, boolean> = {
  title: false, artist: false, album: true, fav: true, genre: true,
  dur: true, plays: true, trackno: true, year: true, date: true, bpm: false,
};
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  title: 200, artist: 200, album: 205, fav: 68, genre: 120, dur: 75, plays: 70, trackno: 55, year: 70, date: 110, bpm: 56,
};
const DEFAULT_SORT = { col: "date", dir: "desc" as "asc" | "desc" };

const LS_ORDER = "tracks_col_order";
const LS_WIDTHS = "tracks_col_widths";
const LS_VIS = "tracks_col_visibility";
const LS_SORT = "tracks_sort_state";

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    // Arrays (colOrder) must stay arrays — spreading one into an object
    // (as done below for Record-shaped state) silently turns it into
    // {0: "track", 1: "title", ...}, breaking every array method on it.
    if (Array.isArray(fallback)) {
      return Array.isArray(parsed) ? (parsed as T) : fallback;
    }
    if (typeof fallback === "object" && fallback !== null) {
      return { ...fallback, ...parsed } as T;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}
function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort persistence
  }
}

// ── Formatters ───────────────────────────────────────────────────────────

function fmtGenre(genre: string | null): string {
  if (!genre) return "";
  return genre.split(/[;/|,]+/).map((s) => s.trim()).filter(Boolean).join(" • ");
}
function fmtPlays(n: number): string {
  return n > 0 ? String(n) : "";
}
function fmtBpm(bpm: number | null): string {
  return bpm ? bpm.toFixed(1) : "";
}
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function sortKey(t: Track, col: string): string | number {
  switch (col) {
    case "title": return t.title.toLowerCase();
    case "artist": return t.artist.toLowerCase();
    case "album": return (t.album ?? "").toLowerCase();
    case "fav": return t.starred ? 1 : 0;
    case "dur": return t.duration_secs;
    case "plays": return t.play_count;
    case "trackno": return t.track_number;
    case "year": return t.year ?? 0;
    case "date": return t.created ?? "";
    case "bpm": return t.bpm ?? 0;
    default: return 0;
  }
}

function sortTracks(tracks: Track[], col: string, dir: "asc" | "desc"): Track[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...tracks].sort((a, b) => {
    const ka = sortKey(a, col);
    const kb = sortKey(b, col);
    if (ka < kb) return -1 * factor;
    if (ka > kb) return 1 * factor;
    return 0;
  });
}

// ── Favorite toggle ──────────────────────────────────────────────────────

function FavoriteHeart({ track }: { track: Track }) {
  const [starred, setStarred] = useState(track.starred);
  const [hov, setHov] = useState(false);
  useEffect(() => setStarred(track.starred), [track.id, track.starred]);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !starred;
    setStarred(next);
    try {
      await api.setFavorite(track.id, next, "id");
    } catch {
      setStarred(!next);
    }
  }

  return (
    <button
      onClick={toggle}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 0 }}
    >
      <Icon
        src={starred ? "/img/heart_filled.png" : "/img/heart.png"}
        size={16}
        style={{ background: starred ? "#E91E63" : hov ? "var(--accent)" : "var(--text-secondary)" }}
      />
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────────────

export function TrackTable({ tracks, loading = false }: { tracks: Track[]; loading?: boolean }) {
  const playTrack = useStore((s) => s.playTrack);
  const navigateTo = useStore((s) => s.navigateTo);
  const currentId = useStore((s) => s.queue[s.currentIndex]?.id);
  const qc = useQueryClient();

  const [query, setQuery] = useState("");
  const [colOrder, setColOrder] = useState<string[]>(() => loadJSON(LS_ORDER, DEFAULT_COL_ORDER));
  const [colVisibility, setColVisibility] = useState<Record<string, boolean>>(() => loadJSON(LS_VIS, DEFAULT_COL_VISIBILITY));
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => loadJSON(LS_WIDTHS, DEFAULT_COL_WIDTHS));
  const [sortState, setSortState] = useState<{ col: string; dir: "asc" | "desc" }>(() => loadJSON(LS_SORT, DEFAULT_SORT));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  const clickCountRef = useRef(1);
  const colOrderRef = useRef(colOrder);
  const colWidthsRef = useRef(colWidths);
  useEffect(() => { colOrderRef.current = colOrder; }, [colOrder]);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);

  const pickerRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const filtered = query.trim()
    ? tracks.filter((t) => {
        const q = query.toLowerCase();
        return t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || (t.album ?? "").toLowerCase().includes(q);
      })
    : tracks;

  const sorted = React.useMemo(() => sortTracks(filtered, sortState.col, sortState.dir), [filtered, sortState]);

  const visibleCols = colOrder.filter((id) => id === "track" || colVisibility[id]);

  function handleSort(colId: string) {
    const def = COLUMNS[colId];
    if (!def.sortable) return;
    let next: { col: string; dir: "asc" | "desc" };
    if (sortState.col !== colId) {
      next = { col: colId, dir: def.descFirst ? "desc" : "asc" };
      clickCountRef.current = 1;
    } else if (clickCountRef.current === 1) {
      next = { col: colId, dir: sortState.dir === "asc" ? "desc" : "asc" };
      clickCountRef.current = 2;
    } else {
      next = DEFAULT_SORT;
      clickCountRef.current = 1;
    }
    setSortState(next);
    saveJSON(LS_SORT, next);
  }

  function toggleColumn(colId: string) {
    setColVisibility((prev) => {
      const next = { ...prev, [colId]: !prev[colId] };
      saveJSON(LS_VIS, next);
      return next;
    });
  }

  // ── Column resize ──
  function onResizeStart(e: React.MouseEvent, colId: string) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidthsRef.current[colId] ?? COLUMNS[colId].minWidth;
    function onMove(ev: MouseEvent) {
      const width = Math.max(COLUMNS[colId].minWidth, startWidth + (ev.clientX - startX));
      setColWidths((prev) => ({ ...prev, [colId]: width }));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      saveJSON(LS_WIDTHS, colWidthsRef.current);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ── Column drag-reorder ──
  const dragColRef = useRef<string | null>(null);
  function onHeaderDragStart(e: React.DragEvent, colId: string) {
    dragColRef.current = colId;
    e.dataTransfer.effectAllowed = "move";
  }
  function onHeaderDragOver(e: React.DragEvent, colId: string) {
    e.preventDefault();
    const dragged = dragColRef.current;
    if (!dragged || dragged === colId) return;
    setColOrder((prev) => {
      const from = prev.indexOf(dragged);
      const to = prev.indexOf(colId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, dragged);
      return next;
    });
  }
  function onHeaderDragEnd() {
    dragColRef.current = null;
    saveJSON(LS_ORDER, colOrderRef.current);
  }

  // ── Row selection / playback ──
  function handleRowClick(e: React.MouseEvent, track: Track, index: number) {
    if (e.shiftKey && lastClickedIndex !== null) {
      const [from, to] = [Math.min(lastClickedIndex, index), Math.max(lastClickedIndex, index)];
      setSelected(new Set(sorted.slice(from, to + 1).map((t) => t.id)));
    } else if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.has(track.id) ? next.delete(track.id) : next.add(track.id);
        return next;
      });
      setLastClickedIndex(index);
    } else {
      setSelected(new Set([track.id]));
      setLastClickedIndex(index);
    }
  }

  function insertAfterCurrentAndPlay(track: Track) {
    const { queue, currentIndex } = useStore.getState();
    const newQueue = [...queue];
    newQueue.splice(currentIndex + 1, 0, track);
    playTrack(track, newQueue);
  }

  function handleRowDoubleClick(track: Track) {
    insertAfterCurrentAndPlay(track);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || selected.size === 0) return;
    const selectedTracks = sorted.filter((t) => selected.has(t.id));
    if (selectedTracks.length > 1) {
      playTrack(selectedTracks[0], selectedTracks);
    } else {
      insertAfterCurrentAndPlay(selectedTracks[0]);
    }
  }

  async function openAlbum(t: Track) {
    if (!t.album_id) return;
    const album = await api.getAlbum(t.album_id);
    navigateTo({ tab: "albums", album });
  }

  function prefetchAlbum(t: Track) {
    if (t.album_id) qc.prefetchQuery({ queryKey: ["album", t.album_id], queryFn: () => api.getAlbum(t.album_id!) });
  }

  function playAll() {
    if (sorted.length) playTrack(sorted[0], sorted);
  }

  function renderCell(colId: string, t: Track, isPlaying: boolean) {
    switch (colId) {
      case "track":
        return (
          <div className="flex items-center min-w-0" style={{ gap: 12, flex: 1 }}>
            <CoverArt coverId={t.cover_id} size={52} className="shrink-0 w-[52px] h-[52px] rounded-[3px]" />
            <div className="min-w-0 flex-1">
              <p className="truncate" style={{ color: isPlaying ? "var(--accent)" : "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>{t.title}</p>
              <ArtistTokens name={t.artist} artistId={t.artist_id} fontSize="var(--fs-small)" />
            </div>
          </div>
        );
      case "title":
        return <span className="truncate" style={{ color: isPlaying ? "var(--accent)" : "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>{t.title}</span>;
      case "artist":
        return <ArtistTokens name={t.artist} artistId={t.artist_id} />;
      case "album":
        return t.album ? (
          <span
            onClick={(e) => { e.stopPropagation(); openAlbum(t); }}
            onMouseEnter={() => prefetchAlbum(t)}
            className="truncate"
            style={{ color: "var(--text-secondary)", cursor: "pointer", fontSize: "var(--fs-secondary)" }}
          >
            {t.album}
          </span>
        ) : null;
      case "fav":
        return <FavoriteHeart track={t} />;
      case "genre":
        return <span className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{fmtGenre(t.genre)}</span>;
      case "dur":
        return <span className="tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{fmtDuration(t.duration_secs)}</span>;
      case "plays":
        return <span className="tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{fmtPlays(t.play_count)}</span>;
      case "trackno":
        return <span className="tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{t.track_number || ""}</span>;
      case "year":
        return <span className="tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{t.year || ""}</span>;
      case "date":
        return <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{fmtDate(t.created)}</span>;
      case "bpm":
        return <span className="tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{fmtBpm(t.bpm)}</span>;
      default:
        return null;
    }
  }

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 58,
    overscan: 10,
  });

  return (
    <div className="flex flex-col h-full" style={{ borderRadius: 10, background: "var(--card-bg)", border: "1px solid var(--border)", overflow: "hidden" }}>
      {/* Toolbar */}
      <div className="flex items-center shrink-0" style={{ height: 36, padding: "0 20px", gap: 8, marginTop: 12 }}>
        <h2 className="font-semibold" style={{ flex: 1, color: "var(--text-secondary)", fontSize: "var(--fs-primary)" }}>
          {loading ? "Tracks" : `${sorted.length.toLocaleString("fr-FR")} tracks`}
        </h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tracks…"
          style={{
            width: 204, height: 28, padding: "0 10px", borderRadius: 4,
            background: "transparent", border: "1px solid var(--border)",
            color: "var(--text-primary)", fontSize: "var(--fs-secondary)", outline: "none",
          }}
        />
        <button
          onClick={playAll}
          title="Play all"
          style={{ width: 32, height: 32, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}
        >
          <Icon src="/img/play.png" size={16} />
        </button>
        <div ref={pickerRef} style={{ position: "relative" }}>
          <button
            onClick={() => setPickerOpen((v) => !v)}
            title="Columns"
            style={{ width: 32, height: 32, borderRadius: 4, border: "none", background: pickerOpen ? "var(--hover-bg)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}
          >
            <Icon src="/img/burger.png" size={18} />
          </button>
          {pickerOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0,
              background: "var(--main-bg)", border: "1px solid var(--border)", borderRadius: 8,
              padding: 4, minWidth: 160, zIndex: 100,
              display: "flex", flexDirection: "column", gap: 1,
              boxShadow: "0 4px 16px color-mix(in srgb, var(--text-primary) 15%, transparent)",
            }}>
              {MENU_ORDER.map((id) => (
                <button
                  key={id}
                  onClick={() => toggleColumn(id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", margin: 0, padding: "5px 12px", textAlign: "left",
                    background: "transparent", border: "none", cursor: "pointer",
                    color: "var(--text-secondary)", fontSize: "var(--fs-primary)",
                    borderRadius: 4, boxSizing: "border-box",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Icon src="/img/yes.png" size={12} style={{ background: "var(--accent)", opacity: colVisibility[id] ? 1 : 0 }} />
                  {COLUMNS[id].label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center shrink-0" style={{ height: 36, padding: "0 24px", gap: 12 }}>
        {visibleCols.map((id) => {
          const col = COLUMNS[id];
          const isTrack = id === "track";
          return (
            <div
              key={id}
              draggable
              onDragStart={(e) => onHeaderDragStart(e, id)}
              onDragOver={(e) => onHeaderDragOver(e, id)}
              onDragEnd={onHeaderDragEnd}
              onClick={() => handleSort(id)}
              style={{
                position: "relative",
                flex: isTrack ? 1 : `0 0 ${colWidths[id] ?? col.minWidth}px`,
                minWidth: 0,
                display: "flex", alignItems: "center", gap: 4,
                cursor: col.sortable ? "pointer" : "default",
                userSelect: "none",
              }}
            >
              <span className="truncate" style={{ fontSize: "var(--fs-small)", fontWeight: 700, letterSpacing: 0.5, color: "var(--text-secondary)", opacity: 0.7 }}>
                {col.label}
              </span>
              {sortState.col === id && (
                <span style={{ color: "var(--accent)", fontSize: 10 }}>{sortState.dir === "asc" ? "▲" : "▼"}</span>
              )}
              {!isTrack && (
                <div
                  onMouseDown={(e) => onResizeStart(e, id)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ position: "absolute", right: -6, top: 0, bottom: 0, width: 12, cursor: "col-resize" }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Rows */}
      <div ref={parentRef} className="flex-1 scroll-smooth" tabIndex={0} onKeyDown={handleKeyDown} style={{ borderTop: "1px solid var(--border)" }}>
        {loading && <p className="p-6 text-sm" style={{ color: "var(--text-primary)", opacity: 0.4 }}>Loading…</p>}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((row) => {
            const t = sorted[row.index];
            const isPlaying = t.id === currentId;
            const isSelected = selected.has(t.id);
            return (
              <div
                key={t.id}
                data-index={row.index}
                ref={virtualizer.measureElement}
                onClick={(e) => handleRowClick(e, t, row.index)}
                onDoubleClick={() => handleRowDoubleClick(t)}
                style={{
                  position: "absolute", top: row.start, left: 0, right: 0, height: 58,
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "0 24px", cursor: "pointer",
                  background: isPlaying
                    ? "color-mix(in srgb, var(--accent) 15%, transparent)"
                    : isSelected
                      ? "var(--hover-bg)"
                      : "transparent",
                }}
                onMouseEnter={(e) => { if (!isPlaying && !isSelected) e.currentTarget.style.background = "var(--hover-bg)"; }}
                onMouseLeave={(e) => { if (!isPlaying && !isSelected) e.currentTarget.style.background = "transparent"; }}
              >
                {visibleCols.map((id) => (
                  <div key={id} style={{ flex: id === "track" ? 1 : `0 0 ${colWidths[id] ?? COLUMNS[id].minWidth}px`, minWidth: 0, overflow: "hidden" }}>
                    {renderCell(id, t, isPlaying)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
