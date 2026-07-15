import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "../store";
import { api, Artist, Album, Track } from "../lib/api";
import { CoverArt } from "./CoverArt";
import { Icon } from "./Icon";
import { PlayRingButton } from "./PlayRingButton";
import { ScrollThumb } from "./ScrollThumb";
import { ArtistTokens, matchesArtistCredit } from "./ArtistTokens";

// System-wide Spotlight search overlay — ports the old app's
// components/spotlight_search.py SpotlightSearch: a dimmed full-window
// overlay with a big search input, live results grouped by Tracks/Artists/
// Albums, and keyboard-first navigation. Opened via GlobalHotkeys.tsx
// (Ctrl+F, or typing any plain character while nothing else has focus).

type CategoryKind = "track" | "artist" | "album";
type FlatRow =
  | { kind: "header"; label: string }
  | { kind: "track"; item: Track }
  | { kind: "artist"; item: Artist }
  | { kind: "album"; item: Album }
  | { kind: "showAll"; category: CategoryKind; count: number; capped: boolean };

const SEARCH_DEBOUNCE_MS = 250;

// Each category's row list is capped tight (matches the old app's compact
// dropdown), but the underlying server search asks for a much larger pool —
// the gap between what's fetched and what's displayed is exactly what "Show
// all N results" needs to report a real (if possibly-capped) count without a
// second round-trip just to find out how many there are.
const DISPLAY_LIMIT = { track: 6, artist: 4, album: 4 };
const FETCH_LIMIT = { track: 50, album: 20 };

export function SpotlightSearch() {
  const open = useStore((s) => s.spotlightOpen);
  const initial = useStore((s) => s.spotlightInitial);
  const close = useStore((s) => s.closeSpotlight);
  const playTrack = useStore((s) => s.playTrack);
  const appendToQueue = useStore((s) => s.appendToQueue);
  const navigateTo = useStore((s) => s.navigateTo);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ tracks: Track[]; artists: Artist[]; albums: Album[] }>({ tracks: [], artists: [], albums: [] });
  // Raw (pre-filter) fetched counts — used only to tell whether the *server*
  // fetch itself hit FETCH_LIMIT, since the client-side name/title filter
  // below can shrink the displayed count well under FETCH_LIMIT even when
  // there were more true matches sitting beyond what got fetched at all.
  const [rawCounts, setRawCounts] = useState({ tracks: 0, albums: 0 });
  // Artists don't go through search3 at all (see the effect below) — its
  // own text search only matches some word-boundary/prefix subset of a
  // plain substring match (e.g. missed real hits Artists.tsx's full-list
  // substring filter finds), so it's an unreliable pre-filter for this one
  // category specifically, unlike tracks/albums where it's a safe (if
  // coarse) superset. Artists.tsx already pays this same full-list fetch
  // cost and it's cheap/cached, so Spotlight just reuses that approach.
  const { data: allArtists = [] } = useQuery({ queryKey: ["all-artists"], queryFn: api.getAllArtists, staleTime: 10 * 60_000, enabled: open });
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(initial);
    setResults({ tracks: [], artists: [], albums: [] });
    setRawCounts({ tracks: 0, albums: 0 });
    setActiveIndex(0);
    // Rendered fresh each time it opens, so the input isn't focusable until
    // after this paint — a microtask-delayed focus matches show_search's
    // own QTimer-free "just show and focus" but actually works in the DOM.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults({ tracks: [], artists: [], albums: [] });
      setRawCounts({ tracks: 0, albums: 0 });
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await api.search(q, 0, FETCH_LIMIT.album, FETCH_LIMIT.track);
        const qLower = q.toLowerCase();
        // search3 is a coarse server-side pre-filter (matches loosely across
        // title/artist/album/genre/etc, same as Tracks.tsx's own scope
        // comment above), so narrow it down client-side to each category's
        // own field — a track title match, not an artist-name match (that's
        // what the Artists section below is for), same idea as Tracks.tsx's
        // per-field scope filter. Artists themselves are matched against
        // allArtists below instead, not this search3 result.
        setResults({
          tracks: r.tracks.filter((t) => t.title.toLowerCase().includes(qLower)),
          artists: allArtists.filter((a) => a.name.toLowerCase().includes(qLower)),
          albums: r.albums.filter((a) => a.name.toLowerCase().includes(qLower)),
        });
        setRawCounts({ tracks: r.tracks.length, albums: r.albums.length });
        setActiveIndex(0);
      } catch { /* best-effort — leave prior results in place */ }
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, open, allArtists]);

  const rows = useMemo((): FlatRow[] => {
    const out: FlatRow[] = [];
    if (results.tracks.length) {
      out.push({ kind: "header", label: "Tracks" });
      for (const t of results.tracks.slice(0, DISPLAY_LIMIT.track)) out.push({ kind: "track", item: t });
      out.push({ kind: "showAll", category: "track", count: results.tracks.length, capped: rawCounts.tracks >= FETCH_LIMIT.track });
    }
    if (results.artists.length) {
      out.push({ kind: "header", label: "Artists" });
      for (const a of results.artists.slice(0, DISPLAY_LIMIT.artist)) out.push({ kind: "artist", item: a });
      out.push({ kind: "showAll", category: "artist", count: results.artists.length, capped: false });
    }
    if (results.albums.length) {
      out.push({ kind: "header", label: "Albums" });
      for (const a of results.albums.slice(0, DISPLAY_LIMIT.album)) out.push({ kind: "album", item: a });
      out.push({ kind: "showAll", category: "album", count: results.albums.length, capped: rawCounts.albums >= FETCH_LIMIT.album });
    }
    return out;
  }, [results, rawCounts]);

  const selectableIndexes = useMemo(
    () => rows.map((r, i) => (r.kind === "header" ? -1 : i)).filter((i) => i >= 0),
    [rows],
  );

  function moveSelection(dir: 1 | -1, step = 1) {
    if (!selectableIndexes.length) return;
    const pos = selectableIndexes.indexOf(activeIndex);
    const nextPos = Math.max(0, Math.min(selectableIndexes.length - 1, (pos === -1 ? 0 : pos) + dir * step));
    setActiveIndex(selectableIndexes[nextPos]);
  }

  async function playDefault(row: FlatRow) {
    if (row.kind === "track") {
      playTrack(row.item, [row.item]);
      close();
    } else if (row.kind === "album") {
      const tracks = await api.getAlbumTracks(row.item.id);
      if (tracks.length) playTrack(tracks[0], tracks);
      close();
    } else if (row.kind === "artist") {
      // Plain "play" for an artist row has no single obvious track — pull
      // their top songs and play the set, same source the old app's
      // ArtistPlayWorker used for this exact spotlight action.
      let top = await api.getTopSongs(row.item.name, 50);
      if (!top.length) {
        // getTopSongs relies on Navidrome/last.fm charting data, which an
        // artist who only appears via a featured/compilation credit (not as
        // a primary album artist) won't have — fall back to a broad song
        // search filtered to a genuine track-credit match (same check
        // ArtistDetail's "Appears On" uses), so an artist with at least one
        // real track always has something to play.
        const result = await api.search(row.item.name, 0, 0, 500);
        top = result.tracks.filter((t) => matchesArtistCredit(t.artist, row.item.name));
      }
      if (top.length) playTrack(top[0], top);
      close();
    }
  }

  // "Add to Queue" — same track resolution as playDefault, but appends to
  // the end of the queue instead of replacing it, and doesn't close the
  // overlay so several results can be queued up in one search session.
  async function addToQueue(row: FlatRow) {
    if (row.kind === "track") {
      appendToQueue([row.item]);
    } else if (row.kind === "album") {
      const tracks = await api.getAlbumTracks(row.item.id);
      if (tracks.length) appendToQueue(tracks);
    } else if (row.kind === "artist") {
      let top = await api.getTopSongs(row.item.name, 50);
      if (!top.length) {
        const result = await api.search(row.item.name, 0, 0, 500);
        top = result.tracks.filter((t) => matchesArtistCredit(t.artist, row.item.name));
      }
      if (top.length) appendToQueue(top);
    }
  }

  // Secondary action for a track row — play the whole album it's on, same
  // as the old app's "Play Full Album" button (Shift+Enter's track branch).
  async function playTrackAlbum(track: Track) {
    if (!track.album_id) return;
    const tracks = await api.getAlbumTracks(track.album_id);
    if (tracks.length) playTrack(tracks[0], tracks);
    close();
  }

  function enterView(row: FlatRow) {
    if (row.kind === "album") {
      navigateTo({ tab: "albums", album: row.item });
      close();
    } else if (row.kind === "artist") {
      navigateTo({ tab: "artists", artistId: row.item.id });
      close();
    }
  }

  // "Show all N results" — jumps to the full tab pre-filled with the same
  // search text instead of trying to browse/paginate the whole result set
  // inside this overlay, which isn't what Spotlight is for (see the
  // trackQuery/albumQuery NavEntry fields and their consuming effects in
  // Tracks.tsx/Albums.tsx/Artists.tsx).
  function showAll(category: CategoryKind) {
    const q = query.trim();
    if (category === "track") navigateTo({ tab: "tracks", trackQuery: q, trackQueryScope: "title" });
    else if (category === "album") navigateTo({ tab: "albums", albumQuery: q, albumQueryNameOnly: true });
    else navigateTo({ tab: "artists", artistQuery: q });
    close();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); moveSelection(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); moveSelection(-1); return; }
    if (e.key === "PageDown") { e.preventDefault(); moveSelection(1, 5); return; }
    if (e.key === "PageUp") { e.preventDefault(); moveSelection(-1, 5); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[activeIndex];
      if (!row || row.kind === "header") return;
      if (row.kind === "showAll") { showAll(row.category); return; }
      if (e.shiftKey && (row.kind === "album" || row.kind === "artist")) enterView(row);
      else if (e.shiftKey && row.kind === "track" && row.item.album_id) playTrackAlbum(row.item);
      else playDefault(row);
    }
  }

  if (!open) return null;

  return (
    <div
      className="flex items-start justify-center"
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        // Centered-ish (~35vh) while there's nothing to show yet (empty
        // query, no results) — reads as a focused, deliberate dialog rather
        // than a bar stuck near the top of an otherwise-empty screen. Once
        // results populate, animate up to a fixed 5vh anchor so the box
        // grows downward from a stable point instead of re-centering (and
        // potentially jumping) as its own height changes with every
        // keystroke. `paddingTop` (unlike `alignItems`) can be transitioned,
        // which is what makes this reposition read as a slide rather than a
        // jump-cut.
        paddingTop: rows.length > 0 ? "5vh" : "35vh",
        transition: "padding-top 220ms cubic-bezier(0.25, 1, 0.5, 1)",
        backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
        background: "color-mix(in srgb, var(--left-panel-bg) 55%, transparent)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        className="flex flex-col spotlight-pop"
        style={{
          width: 640, maxWidth: "90vw", maxHeight: "90vh",
          background: "var(--left-panel-bg)", border: "1px solid var(--border)", borderRadius: 10,
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)", overflow: "hidden",
        }}
      >
        <div style={{ padding: "18px 20px" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search for songs, artists, or albums…"
            className="w-full outline-none"
            style={{ background: "transparent", border: "none", color: "var(--text-primary)", fontSize: "var(--fs-title)" }}
          />
        </div>

        {rows.length > 0 && (
          <div style={{ flex: "1 1 auto", minHeight: 0, position: "relative", display: "flex", flexDirection: "column", borderTop: "1px solid var(--border)" }}>
          <div ref={listRef} className="scroll-clean" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "6px 8px" }}>
            {rows.map((row, i) => {
              if (row.kind === "header") {
                return (
                  <div key={`h-${row.label}`} style={{ padding: "10px 10px 4px" }}>
                    <span style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: "var(--fw-emphasis)", letterSpacing: 1, textTransform: "uppercase" }}>
                      {row.label}
                    </span>
                  </div>
                );
              }
              if (row.kind === "showAll") {
                const active = i === activeIndex;
                return (
                  <div
                    key={`showall-${row.category}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => showAll(row.category)}
                    style={{
                      padding: "8px 10px", marginBottom: 2, borderRadius: 6, cursor: "pointer",
                      background: active ? "var(--hover-bg)" : "transparent",
                    }}
                  >
                    <span style={{ color: "var(--accent)", fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)" }}>
                      Show all {row.count}{row.capped ? "+" : ""} result{row.count === 1 && !row.capped ? "" : "s"} →
                    </span>
                  </div>
                );
              }
              const active = i === activeIndex;
              const coverId = row.item.cover_id;
              const title = row.kind === "artist" ? row.item.name : (row.kind === "album" ? row.item.name : row.item.title);
              const albumCountSubtitle = row.kind === "artist" ? `${row.item.album_count} album${row.item.album_count !== 1 ? "s" : ""}` : null;
              return (
                <div
                  key={`${row.kind}-${row.item.id}-${i}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => playDefault(row)}
                  className="flex items-center"
                  style={{
                    gap: 12, padding: "8px 10px", borderRadius: 6, cursor: "pointer",
                    background: active ? "var(--hover-bg)" : "transparent",
                  }}
                >
                  <CoverArt coverId={coverId} size={48} className="shrink-0" style={{ width: 44, height: 44, borderRadius: row.kind === "artist" ? "50%" : 4 }} />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="truncate" style={{ color: "var(--text-primary)", fontWeight: "var(--fw-emphasis)", fontSize: "var(--fs-primary)" }}>{title}</span>
                    {(row.kind === "track" || row.kind === "album") ? (
                      <ArtistTokens
                        name={row.item.artist || (row.kind === "track" ? "Unknown Artist" : "Various Artists")}
                        artistId={row.item.artist_id}
                        onNavigate={close}
                      />
                    ) : (
                      <span className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{albumCountSubtitle}</span>
                    )}
                  </div>
                  {active && (
                    <div className="flex items-center shrink-0" style={{ gap: 6 }}>
                      {row.kind === "track" && row.item.album_id && (
                        <button
                          onClick={(e) => { e.stopPropagation(); playTrackAlbum(row.item); }}
                          title="Play Full Album (Shift+Enter)"
                          className="flex items-center justify-center shrink-0"
                          style={{ width: 32, height: 32, borderRadius: "50%", background: "transparent", border: "none", cursor: "pointer" }}
                        >
                          <Icon src="img/album.png" size={16} style={{ background: "var(--accent)" }} />
                        </button>
                      )}
                      {(row.kind === "album" || row.kind === "artist") && (
                        <button
                          onClick={(e) => { e.stopPropagation(); enterView(row); }}
                          title="Enter view (Shift+Enter)"
                          className="flex items-center justify-center shrink-0"
                          style={{ width: 32, height: 32, borderRadius: "50%", background: "transparent", border: "none", cursor: "pointer" }}
                        >
                          <Icon src="img/enter.png" size={16} style={{ background: "var(--accent)" }} />
                        </button>
                      )}
                      <PlayRingButton
                        icon="img/play.png"
                        size={32}
                        iconSize={13}
                        title={row.kind === "track" ? "Play Track" : row.kind === "album" ? "Play Album" : "Play Artist"}
                        onClick={() => playDefault(row)}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); addToQueue(row); }}
                        title="Add to Queue"
                        className="flex items-center justify-center shrink-0"
                        style={{ width: 32, height: 32, borderRadius: "50%", background: "transparent", border: "none", cursor: "pointer" }}
                      >
                        <Icon src="img/add_list.png" size={22} style={{ background: "var(--accent)" }} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <ScrollThumb scrollRef={listRef} />
          </div>
        )}
      </div>
    </div>
  );
}
