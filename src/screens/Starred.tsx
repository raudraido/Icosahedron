import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, Track } from "../lib/api";
import { AlbumCard, CARD_MIN, GAP, getColsFromWidth } from "./Albums";
import { ArtistCard } from "./Artists";
import { CoverArt } from "../components/CoverArt";
import { PlayRingButton } from "../components/PlayRingButton";
import { Icon } from "../components/Icon";
import { ColumnFilterPopup } from "../components/ColumnFilterPopup";
import { TrackTable } from "../components/TrackTable";
import { ScrollThumb } from "../components/ScrollThumb";
import { useStore } from "../store";

// Ported from favorites.qml / favorites_view.py — a single scrolling page:
// starred-artists carousel, starred-albums carousel, a derived "Top Artists
// by Favorites" carousel, then the full Favorite Songs tracklist (the shared
// TrackListView.qml component in the old app, i.e. our TrackTable — reused
// wholesale, not rebuilt bespoke). Replaces the previous three-tab-switcher
// layout (one section visible at a time), which didn't match the old app's
// "everything visible, scroll to reach songs" structure.
// Simplifications from the old app, deliberate:
//  - Un-starring refetches (`["starred"]` query invalidation added to
//    TrackTable's favorite-toggle paths) rather than the old app's local
//    beginRemoveRows/endRemoveRows splice — simpler, and the round-trip is
//    imperceptible in practice.

function PageArrow({ dir, disabled, onClick }: { dir: "left" | "right"; disabled: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={dir === "left" ? "Previous" : "Next"}
      style={{
        width: 26, height: 26, borderRadius: "50%", border: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: disabled ? "transparent" : hov ? "var(--hover-bg)" : "transparent",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <Icon
        src={dir === "left" ? "img/home_back.png" : "img/home_next.png"}
        size={13}
        style={{ background: disabled ? "#444444" : "var(--accent)" }}
      />
    </button>
  );
}

// Borderless toolbar icon (Shuffle/genre-filter) — plain flat icon, gray at
// rest, accent only while actually active (genre filter applied / popup
// open), unlike IconBtn which always tints its icon accent regardless of
// `active` (fine for column-picker/sort buttons elsewhere, wrong here).
function ToolbarIconButton({ icon, onClick, title, active }: { icon: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; title: string; active: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 40, height: 40, borderRadius: "50%", border: "none", cursor: "pointer",
        background: hov ? "var(--hover-bg)" : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <Icon src={icon} size={18} style={{ background: active ? "var(--accent)" : "var(--text-secondary)" }} />
    </button>
  );
}

function SectionLabel({ text, count }: { text: string; count: number }) {
  return (
    <div className="flex items-center" style={{ gap: 10 }}>
      <h2 style={{ color: "var(--text-primary)", fontSize: "var(--fs-title)", fontWeight: "var(--fw-emphasis)" }}>{text}</h2>
      <div className="flex items-center justify-center" style={{ height: 22, padding: "0 8px", borderRadius: 4, border: "1px solid var(--border)" }}>
        <span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: "var(--fw-emphasis)" }}>{count}</span>
      </div>
    </div>
  );
}

// This tab stays mounted (display:none while hidden — see App.tsx), so a
// carousel's viewport collapses to 0 width whenever the tab isn't visible.
// Coming back only re-triggers ResizeObserver's callback *after* the browser
// has already painted the stale/0-width layout, visible as the row snapping
// to the right size a frame late (same bug fixed in Home.tsx's album rows).
// Re-measuring synchronously the instant `active` flips true (before paint)
// closes that gap.
function useCarouselViewportWidth(active: boolean) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    setViewportWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!active) return;
    const el = viewportRef.current;
    if (!el) return;
    setViewportWidth(el.getBoundingClientRect().width);
  }, [active]);

  return { viewportRef, viewportWidth };
}

function AlbumCarousel({ albums, active }: { albums: import("../lib/api").Album[]; active: boolean }) {
  const navigateTo = useStore((s) => s.navigateTo);
  const { viewportRef, viewportWidth } = useCarouselViewportWidth(active);
  const [pageIndex, setPageIndex] = useState(0);

  const cols = viewportWidth > 0 ? getColsFromWidth(viewportWidth) : 4;
  const cardWidth = viewportWidth > 0 ? (viewportWidth - GAP * (cols - 1)) / cols : CARD_MIN;
  const step = cardWidth + GAP;
  const pageCount = Math.max(1, Math.ceil(albums.length / cols));
  useEffect(() => { setPageIndex(0); }, [albums.length, cols]);
  const offset = pageIndex * cols * step;

  function openAlbum(album: import("../lib/api").Album) {
    navigateTo({ tab: "albums", album });
  }

  if (albums.length === 0) return null;

  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      <div className="flex items-center" style={{ gap: 8 }}>
        <SectionLabel text="Favorite Albums" count={albums.length} />
        {pageCount > 1 && (
          <div className="flex items-center" style={{ marginLeft: "auto", gap: 2 }}>
            <PageArrow dir="left" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => Math.max(0, p - 1))} />
            <PageArrow dir="right" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))} />
          </div>
        )}
      </div>
      <div ref={viewportRef} style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", gap: GAP, transform: `translateX(-${offset}px)`, transition: "transform 300ms cubic-bezier(0.65, 0, 0.35, 1)" }}>
          {albums.map((a) => (
            <div key={a.id} style={{ width: cardWidth, flexShrink: 0 }}>
              <AlbumCard album={a} onOpen={openAlbum} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ArtistCarousel({ artists, active }: { artists: import("../lib/api").Artist[]; active: boolean }) {
  const navigateTo = useStore((s) => s.navigateTo);
  const { viewportRef, viewportWidth } = useCarouselViewportWidth(active);
  const [pageIndex, setPageIndex] = useState(0);

  const cols = viewportWidth > 0 ? getColsFromWidth(viewportWidth) : 4;
  const cardWidth = viewportWidth > 0 ? (viewportWidth - GAP * (cols - 1)) / cols : CARD_MIN;
  const step = cardWidth + GAP;
  const pageCount = Math.max(1, Math.ceil(artists.length / cols));
  useEffect(() => { setPageIndex(0); }, [artists.length, cols]);
  const offset = pageIndex * cols * step;

  function openArtist(artist: import("../lib/api").Artist) {
    navigateTo({ tab: "artists", artistId: artist.id });
  }

  if (artists.length === 0) return null;

  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      <div className="flex items-center" style={{ gap: 8 }}>
        <SectionLabel text="Favorite Artists" count={artists.length} />
        {pageCount > 1 && (
          <div className="flex items-center" style={{ marginLeft: "auto", gap: 2 }}>
            <PageArrow dir="left" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => Math.max(0, p - 1))} />
            <PageArrow dir="right" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))} />
          </div>
        )}
      </div>
      <div ref={viewportRef} style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", gap: GAP, transform: `translateX(-${offset}px)`, transition: "transform 300ms cubic-bezier(0.65, 0, 0.35, 1)" }}>
          {artists.map((a) => (
            <div key={a.id} style={{ width: cardWidth, flexShrink: 0 }}>
              <ArtistCard artist={a} onOpen={openArtist} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface TopArtistEntry { name: string; count: number; coverId: string | null }

// Matches favorites_view.py:933-948 exactly: Counter(track.artist for each
// favorite song), top 16 by count descending, cover art borrowed from the
// first favorite track found by that artist name (song_cover_lookup). Reuses
// the same album-shaped Carousel card the old app does (showPlayButton:false,
// subtextClickable:false) — click toggles this artist as a track filter
// instead of navigating or playing.
function computeTopArtists(tracks: Track[]): TopArtistEntry[] {
  const counts = new Map<string, number>();
  const covers = new Map<string, string | null>();
  for (const t of tracks) {
    if (!t.artist) continue;
    counts.set(t.artist, (counts.get(t.artist) ?? 0) + 1);
    if (!covers.has(t.artist)) covers.set(t.artist, t.cover_id);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([name, count]) => ({ name, count, coverId: covers.get(name) ?? null }));
}

function TopArtistCard({ entry, selected, onClick }: { entry: TopArtistEntry; selected: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="text-left group grid-card"
    >
      <div style={{ position: "relative" }}>
        <CoverArt
          coverId={entry.coverId}
          size={200}
          className="w-full aspect-square rounded-lg transition-all"
        />
        <div
          aria-hidden
          style={{
            position: "absolute", inset: 0, borderRadius: 8,
            border: `2px solid ${selected ? "var(--accent)" : "transparent"}`,
            background: selected ? "color-mix(in srgb, var(--accent) 15%, transparent)" : hov ? "color-mix(in srgb, black 25%, transparent)" : "transparent",
            transition: "background 150ms, border-color 150ms",
          }}
        />
      </div>
      <div className="flex flex-col" style={{ marginTop: 8, gap: 2 }}>
        <p className="truncate" style={{ color: selected || hov ? "var(--accent)" : "var(--text-primary)", fontSize: "var(--fs-primary)", fontWeight: "var(--fw-emphasis)" }}>{entry.name}</p>
        <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>
          {entry.count} song{entry.count === 1 ? "" : "s"}
        </p>
      </div>
    </button>
  );
}

function TopArtistCarousel({ entries, selectedName, onSelect, active }: { entries: TopArtistEntry[]; selectedName: string | null; onSelect: (name: string) => void; active: boolean }) {
  const { viewportRef, viewportWidth } = useCarouselViewportWidth(active);
  const [pageIndex, setPageIndex] = useState(0);

  const cols = viewportWidth > 0 ? getColsFromWidth(viewportWidth) : 4;
  const cardWidth = viewportWidth > 0 ? (viewportWidth - GAP * (cols - 1)) / cols : CARD_MIN;
  const step = cardWidth + GAP;
  const pageCount = Math.max(1, Math.ceil(entries.length / cols));
  useEffect(() => { setPageIndex(0); }, [entries.length, cols]);
  const offset = pageIndex * cols * step;

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      <div className="flex items-center" style={{ gap: 8 }}>
        <SectionLabel text="Top Artists by Favorites" count={entries.length} />
        {pageCount > 1 && (
          <div className="flex items-center" style={{ marginLeft: "auto", gap: 2 }}>
            <PageArrow dir="left" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => Math.max(0, p - 1))} />
            <PageArrow dir="right" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))} />
          </div>
        )}
      </div>
      <div ref={viewportRef} style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", gap: GAP, transform: `translateX(-${offset}px)`, transition: "transform 300ms cubic-bezier(0.65, 0, 0.35, 1)" }}>
          {entries.map((e) => (
            <div key={e.name} style={{ width: cardWidth, flexShrink: 0 }}>
              <TopArtistCard entry={e} selected={selectedName === e.name} onClick={() => onSelect(e.name)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Starred() {
  const active = useStore((s) => s.activeTab === "starred");
  const playTrack = useStore((s) => s.playTrack);
  const navigateTo = useStore((s) => s.navigateTo);
  const [genreFilter, setGenreFilter] = useState<Set<string>>(new Set());
  // Top-Artists-carousel-as-filter — matches favorites_view.py's
  // _on_top_artist_card_clicked: selecting an artist filters the song list
  // to just that artist's favorites and clears any active genre filter
  // (and vice versa — the two are mutually exclusive, same as the old app).
  const [artistFilter, setArtistFilter] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["starred"],
    queryFn: () => api.getStarred(),
    staleTime: 30_000, // matches the old app's 30s stale-on-revisit refresh window
  });

  const tracks = data?.tracks ?? [];
  const topArtists = useMemo(() => computeTopArtists(tracks), [tracks]);
  const filteredTracks = artistFilter
    ? tracks.filter((t) => t.artist === artistFilter)
    : genreFilter.size
      ? tracks.filter((t) => t.genre && genreFilter.has(t.genre))
      : tracks;

  // Toolbar-level genre filter — favorites_view.py's own "Genre filter"
  // button + _GenrePopup (multi-select checklist), a *separate* affordance
  // from Tracks.tsx's per-column Excel-style funnel icons (which this view
  // deliberately doesn't use — see the genre column's cell-click-only
  // behavior below). Reuses the same ColumnFilterPopup checklist component,
  // just triggered from a toolbar button instead of a column header.
  const genreValues = useMemo(() => {
    const set = new Set<string>();
    for (const t of tracks) if (t.genre) set.add(t.genre);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tracks]);
  const [genrePopup, setGenrePopup] = useState<{ x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function selectTopArtist(name: string) {
    setArtistFilter((prev) => (prev === name ? null : name));
    setGenreFilter(new Set());
  }
  // Toolbar funnel filter applies locally (filters the Favorites list itself).
  function handleGenreFilterChange(values: Set<string>) {
    setGenreFilter(values);
    setArtistFilter(null);
  }
  // Genre/year cell click (in the table itself) navigates to the Tracks tab
  // pre-filtered instead — matches Albums.tsx/Playlists.tsx's AlbumDetail
  // behavior (filterableCols without colValues = plain click-through-to-Tracks,
  // not a local filter), rather than filtering the Favorites tracklist itself.
  function handleCellFilterClick(col: string, values: Set<string>) {
    const value = [...values][0];
    if (value) navigateTo({ tab: "tracks", trackFilter: { col, value } });
  }

  function handlePlayAll() {
    if (filteredTracks[0]) playTrack(filteredTracks[0], filteredTracks);
  }
  function handleShuffle() {
    if (!filteredTracks.length) return;
    const shuffled = [...filteredTracks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    playTrack(shuffled[0], shuffled);
  }

  return (
    <>
      <div className="h-full" style={{ position: "relative", minHeight: 0 }}>
      <div ref={scrollRef} className="h-full overflow-y-auto scroll-clean" style={{ padding: 12 }}>
        <div className="flex flex-col" style={{ gap: 24 }}>
          {isLoading && tracks.length === 0 && (
            <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>Loading…</p>
          )}

          {data && <ArtistCarousel artists={data.artists} active={active} />}
          {data && <AlbumCarousel albums={data.albums} active={active} />}
          <TopArtistCarousel entries={topArtists} selectedName={artistFilter} onSelect={selectTopArtist} active={active} />

          {data && (
            <div className="flex flex-col" style={{ gap: 10 }}>
              <div className="flex items-center" style={{ gap: 12 }}>
                <SectionLabel text="Favorite Songs" count={filteredTracks.length} />
              </div>
              <div className="flex items-center" style={{ gap: 12 }}>
                <PlayRingButton icon="img/play.png" onClick={handlePlayAll} title="Play All" />
                <ToolbarIconButton icon="img/shuffle.png" onClick={handleShuffle} title="Shuffle" active={false} />
                <ToolbarIconButton
                  icon="img/filter.png"
                  title="Filter by genre"
                  active={genreFilter.size > 0 || !!genrePopup}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setGenrePopup({ x: rect.left, y: rect.bottom });
                  }}
                />
                {(genreFilter.size > 0 || artistFilter) && (
                  <button
                    onClick={() => { setGenreFilter(new Set()); setArtistFilter(null); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: "var(--fs-secondary)", padding: 0 }}
                  >
                    Clear filter
                  </button>
                )}
              </div>

              <TrackTable
                tracks={filteredTracks}
                loading={isLoading}
                viewKey="favorites"
                defaultSort={null}
                persistSort
                numColSource="position"
                filterableCols={["genre", "year"]}
                onFilterChange={handleCellFilterClick}
              />
            </div>
          )}
        </div>
      </div>
      <ScrollThumb scrollRef={scrollRef} />
      </div>

      {genrePopup && (
        <ColumnFilterPopup
          x={genrePopup.x}
          y={genrePopup.y}
          allValues={genreValues}
          activeValues={genreFilter}
          isIdBased
          onApply={(values) => handleGenreFilterChange(values)}
          onSort={() => {}}
          onClose={() => setGenrePopup(null)}
        />
      )}
    </>
  );
}
