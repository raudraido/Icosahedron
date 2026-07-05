import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FixedSizeList, ListChildComponentProps } from "react-window";
import { api, Artist } from "../lib/api";
import { CoverArt } from "../components/CoverArt";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { IconBtn } from "../components/IconBtn";
import { SearchBox } from "../components/SearchBox";
import { SkeletonCard } from "../components/Skeleton";
import { ArtistDetail } from "./ArtistDetail";
import { PLAY_ICON_DARK } from "../lib/theme";

const SORT_OPTIONS = [
  { value: "random",       label: "Random"       },
  { value: "most_played",  label: "Most Played"  },
  { value: "alphabetical", label: "Alphabetical" },
  { value: "albums_count", label: "Albums Count" },
];

// Matches the old app's toggle_sort_state defaults.
function defaultAscending(sortKey: string): boolean {
  return sortKey === "random" || sortKey === "alphabetical";
}

// Matches the old app's _sort_icon_path — albums_count has no directional icon variant.
function getSortIcon(sortKey: string, ascending: boolean): string {
  if (sortKey === "albums_count") return "/img/album.png";
  return `/img/sort-${sortKey}-${ascending ? "a" : "d"}.png`;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ArtistCard = React.memo(function ArtistCard({ artist, onOpen }: { artist: Artist; onOpen: (a: Artist) => void }) {
  const [hovered, setHovered] = useState(false);
  const [playHovered, setPlayHovered] = useState(false);
  const qc = useQueryClient();
  const playTrack = useStore((s) => s.playTrack);

  function fetchTracks() {
    return qc.fetchQuery({
      queryKey: ["artist-play-tracks", artist.id],
      queryFn: async () => {
        const detail = await api.getArtist(artist.id);
        const firstAlbum = detail.albums[0];
        return firstAlbum ? api.getAlbumTracks(firstAlbum.id) : [];
      },
    });
  }

  async function handlePlay(e: React.MouseEvent) {
    e.stopPropagation();
    const tracks = await fetchTracks();
    if (tracks.length) playTrack(tracks[0], tracks);
  }

  return (
    <button
      onClick={() => onOpen(artist)}
      onMouseEnter={() => { setHovered(true); fetchTracks(); }}
      onMouseLeave={() => setHovered(false)}
      className="text-left group grid-card"
    >
      <div style={{ position: "relative" }}>
        <CoverArt coverId={artist.cover_id} size={200} className="w-full aspect-square rounded-lg group-hover:brightness-75 transition-all" />
        <div
          onClick={handlePlay}
          onMouseEnter={() => setPlayHovered(true)}
          onMouseLeave={() => setPlayHovered(false)}
          style={{
            position: "absolute", top: "50%", left: "50%",
            width: "min(60px, 33%)", aspectRatio: "1",
            transform: `translate(-50%, -50%) scale(${playHovered ? 1 : 0.8})`,
            borderRadius: "50%",
            background: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: playHovered ? 1 : hovered ? 0.8 : 0,
            transition: "opacity 150ms, transform 150ms",
            cursor: "pointer",
          }}
        >
          <Icon src="/img/play.png" size={20} style={{ background: PLAY_ICON_DARK, marginLeft: 2 }} />
        </div>
      </div>
      <div className="flex flex-col" style={{ marginTop: 8, gap: 2 }}>
        <p className="truncate font-bold" style={{ color: hovered ? "var(--accent)" : "var(--text-primary)", fontSize: "var(--fs-primary)" }}>{artist.name}</p>
        <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>
          {artist.album_count} album{artist.album_count === 1 ? "" : "s"}
        </p>
        {artist.song_count > 0 && (
          <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{artist.song_count} tracks</p>
        )}
      </div>
    </button>
  );
});

const CARD_MIN = 200;
const GAP = 12;
const META_HEIGHT = 62; // 3 text rows below cover (name, album count, track count)

function getColsFromWidth(width: number) {
  return Math.max(1, Math.floor((width + GAP) / (CARD_MIN + GAP)));
}

interface RowData {
  artists: Artist[];
  cols: number;
  cardWidth: number;
  onOpen: (a: Artist) => void;
}

const GridRow = React.memo(({ index, style, data }: ListChildComponentProps<RowData>) => {
  const { artists, cols, cardWidth, onOpen } = data;
  return (
    <div style={{ ...style, display: "grid", gridTemplateColumns: `repeat(${cols}, ${cardWidth}px)`, gap: GAP, padding: `0 10px`, alignContent: "start" }}>
      {Array.from({ length: cols }, (_, c) => {
        const artist = artists[index * cols + c];
        return artist
          ? <ArtistCard key={artist.id} artist={artist} onOpen={onOpen} />
          : <div key={c} />;
      })}
    </div>
  );
});

function ArtistGrid({ artists, loading, onOpen }: { artists: Artist[]; loading: boolean; onOpen: (a: Artist) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { width, height } = size;
  const cols = width > 0 ? getColsFromWidth(width - 20) : 4;
  const cardWidth = width > 0 ? (width - 20 - GAP * (cols - 1)) / cols : CARD_MIN;
  const rowHeight = cardWidth + META_HEIGHT + GAP;
  const rowCount = Math.ceil(artists.length / cols);
  const itemData: RowData = { artists, cols, cardWidth, onOpen };
  const showSkeleton = loading && artists.length === 0;
  const skeletonRows = height > 0 ? Math.ceil(height / rowHeight) + 1 : 0;

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden" style={{ position: "relative" }}>
      {showSkeleton && width > 0 && height > 0 && Array.from({ length: skeletonRows }, (_, r) => (
        <div
          key={r}
          style={{
            position: "absolute", top: r * rowHeight, left: 0, right: 0,
            display: "grid", gridTemplateColumns: `repeat(${cols}, ${cardWidth}px)`, gap: GAP, padding: "0 10px",
          }}
        >
          {Array.from({ length: cols }, (_, c) => <SkeletonCard key={c} />)}
        </div>
      ))}
      {!showSkeleton && height > 0 && width > 0 && (
        <FixedSizeList
          height={height}
          width={width}
          itemCount={rowCount}
          itemSize={rowHeight}
          itemData={itemData}
          overscanCount={6}
          style={{ willChange: "transform" }}
        >
          {GridRow}
        </FixedSizeList>
      )}
    </div>
  );
}

export function Artists() {
  const [sort, setSort] = useState("most_played");
  const [sortStates, setSortStates] = useState<Record<string, boolean>>({});
  const [randomNonce, setRandomNonce] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const pushNav = useStore((s) => s.pushNav);
  const navBack = useStore((s) => s.navBack);
  const selectedId = useStore((s) => s.navHistory[s.navPos]?.artistId ?? null);
  const navQuery = useStore((s) => s.navHistory[s.navPos]?.artistQuery ?? "");
  const [searchText, setSearchText] = useState(navQuery);

  const isAscending = (sortKey: string) => sortStates[sortKey] ?? defaultAscending(sortKey);

  function selectSort(newSort: string) {
    if (sort === newSort) {
      setSortStates((prev) => ({ ...prev, [newSort]: !isAscending(newSort) }));
    } else {
      setSort(newSort);
    }
    if (newSort === "random") setRandomNonce((n) => n + 1);
    setSortMenuOpen(false);
  }

  const { data: rawArtists = [], isLoading: loading } = useQuery({
    queryKey: ["artists-native", sort],
    queryFn: () => api.getAllArtistsSorted(sort),
    placeholderData: (prev) => prev,
  });

  const artists = React.useMemo(() => {
    if (sort === "random") return shuffleArray(rawArtists);
    return isAscending(sort) ? rawArtists : [...rawArtists].reverse();
  }, [rawArtists, sort, sortStates[sort], randomNonce]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const displayedArtists = searchText.trim()
    ? artists.filter((a) => a.name.toLowerCase().includes(searchText.toLowerCase()))
    : artists;

  const openArtist = useCallback((artist: Artist) => {
    pushNav({ artistId: artist.id, artistQuery: searchText });
  }, [pushNav, searchText]);

  if (selectedId) {
    return (
      <div className="h-full overflow-hidden">
        <ArtistDetail artistId={selectedId} onBack={navBack} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ── */}
      <div className="flex items-center shrink-0 px-6" style={{ height: 58, gap: 6, borderBottom: "1px solid var(--border)" }}>
        <h2 className="font-semibold" style={{ flex: 1, color: "var(--text-secondary)", fontSize: "var(--fs-primary)" }}>
          {loading
            ? "Loading artists…"
            : searchText
              ? `${displayedArtists.length} / ${artists.length.toLocaleString("fr-FR")} artists`
              : `${artists.length.toLocaleString("fr-FR")} artists`}
        </h2>

        <SearchBox
          open={searchOpen}
          onToggle={() => setSearchOpen((v) => !v)}
          value={searchText}
          onChange={setSearchText}
          placeholder="Search artists…"
        />

        {/* Sort icon + dropdown */}
        <div ref={sortRef} style={{ position: "relative" }}>
          <IconBtn
            src={getSortIcon(sort, isAscending(sort))}
            active={sortMenuOpen}
            title="Sort"
            onClick={() => setSortMenuOpen((v) => !v)}
          />
          {sortMenuOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0,
              background: "var(--main-bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 4,
              minWidth: 168,
              zIndex: 100,
              display: "flex", flexDirection: "column", gap: 1,
              boxShadow: "0 4px 16px color-mix(in srgb, var(--text-primary) 15%, transparent)",
            }}>
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => selectSort(o.value)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", margin: 0, padding: "5px 20px 5px 12px", textAlign: "left",
                    background: "transparent", border: "none", cursor: "pointer",
                    color: "var(--text-secondary)",
                    fontSize: "var(--fs-primary)", fontWeight: 400,
                    borderRadius: 4,
                    boxSizing: "border-box",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Icon src={getSortIcon(o.value, isAscending(o.value))} size={14} style={{ background: "var(--accent)" }} />
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <ArtistGrid artists={displayedArtists} loading={loading} onOpen={openArtist} />
    </div>
  );
}
