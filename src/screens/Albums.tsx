import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FixedSizeList, ListChildComponentProps } from "react-window";
import { api, Album } from "../lib/api";
import { CoverArt } from "../components/CoverArt";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { PlayRingButton } from "../components/PlayRingButton";
import { CoverZoomOverlay } from "../components/CoverZoomOverlay";
import { ArtistTokens } from "../components/ArtistTokens";
import { TrackTable, loadJSON, saveJSON } from "../components/TrackTable";
import { IconBtn } from "../components/IconBtn";
import { SearchBox } from "../components/SearchBox";
import { SkeletonCard } from "../components/Skeleton";
import { ScrollThumb } from "../components/ScrollThumb";
import { FAVORITE_PINK, PLAY_ICON_DARK } from "../lib/theme";

const SORT_OPTIONS = [
  { value: "random",             label: "Random"       },
  { value: "newest",             label: "Latest"       },
  { value: "alphabeticalByName", label: "Alphabetical" },
  { value: "song_count",         label: "Song Count"   },
  { value: "starred",            label: "Favourites"   },
  { value: "compilations",       label: "Compilations" },
];

const SORT_ICON_KEY: Record<string, string> = {
  random:             "random",
  newest:             "latest",
  alphabeticalByName: "alphabetical",
};

// Matches the old app's toggle_sort_state defaults: every sort starts
// ascending except song_count, which starts at "most songs first".
function defaultAscending(sortKey: string): boolean {
  return sortKey !== "song_count";
}

function getSortIcon(sortKey: string, ascending: boolean): string {
  if (sortKey === "starred") return "img/heart.png";
  if (sortKey === "compilations") return "img/comp.png";
  if (sortKey === "song_count") return `img/sort-num-${ascending ? "asc" : "desc"}.png`;
  const iconKey = SORT_ICON_KEY[sortKey] ?? sortKey;
  return `img/sort-${iconKey}-${ascending ? "a" : "d"}.png`;
}


export const AlbumCard = React.memo(function AlbumCard({ album, onOpen }: { album: Album; onOpen: (a: Album) => void }) {
  const [hovered, setHovered] = useState(false);
  const [playHovered, setPlayHovered] = useState(false);
  const [queueHovered, setQueueHovered] = useState(false);
  const qc = useQueryClient();
  const playTrack = useStore((s) => s.playTrack);
  const appendToQueue = useStore((s) => s.appendToQueue);
  const holdTimerRef = useRef<number | null>(null);
  const heldRef = useRef(false);

  function fetchTracks() {
    return qc.fetchQuery({ queryKey: ["album-tracks", album.id], queryFn: () => api.getAlbumTracks(album.id) });
  }

  function clearHoldTimer() {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  // Click = play the album from track 1, press+hold 600ms = shuffle it
  // instead — matches PlayFilteredButton's (Tracks.tsx) same hold-to-shuffle
  // MouseArea interaction.
  function handlePlayMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    heldRef.current = false;
    holdTimerRef.current = window.setTimeout(async () => {
      heldRef.current = true;
      holdTimerRef.current = null;
      const tracks = await fetchTracks();
      if (!tracks.length) return;
      const shuffled = [...tracks];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      playTrack(shuffled[0], shuffled);
    }, 600);
  }
  async function handlePlayMouseUp(e: React.MouseEvent) {
    e.stopPropagation();
    const held = holdTimerRef.current === null && heldRef.current;
    clearHoldTimer();
    if (held) return;
    const tracks = await fetchTracks();
    if (tracks.length) playTrack(tracks[0], tracks);
  }

  async function handleAddToQueue(e: React.MouseEvent) {
    e.stopPropagation();
    const tracks = await fetchTracks();
    if (tracks.length) appendToQueue(tracks);
  }

  return (
    <button
      onClick={() => onOpen(album)}
      onMouseEnter={() => { setHovered(true); fetchTracks(); }}
      onMouseLeave={() => setHovered(false)}
      className="text-left group grid-card"
    >
      <div style={{ position: "relative" }}>
        <CoverArt coverId={album.cover_id} size={200} className="w-full aspect-square rounded-lg group-hover:brightness-75 transition-all" />
        <div
          style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(60px, 33%)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
            opacity: playHovered || queueHovered ? 1 : hovered ? 0.8 : 0,
            transition: "opacity 150ms",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            onMouseDown={handlePlayMouseDown}
            onMouseUp={handlePlayMouseUp}
            onMouseEnter={() => setPlayHovered(true)}
            onMouseLeave={() => { setPlayHovered(false); clearHoldTimer(); }}
            title="Play album (hold to shuffle)"
            style={{
              width: "100%", aspectRatio: "1",
              transform: `scale(${playHovered ? 1 : 0.8})`,
              borderRadius: "50%",
              background: "var(--accent)",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "transform 150ms",
              cursor: "pointer",
            }}
          >
            <Icon src="img/play.png" size={20} style={{ background: PLAY_ICON_DARK, marginLeft: 2 }} />
          </div>
          <div
            onClick={handleAddToQueue}
            onMouseEnter={() => setQueueHovered(true)}
            onMouseLeave={() => setQueueHovered(false)}
            title="Add to Queue"
            style={{
              width: "55%", aspectRatio: "1",
              transform: `scale(${queueHovered ? 1 : 0.85})`,
              borderRadius: "50%",
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "transform 150ms",
              cursor: "pointer",
            }}
          >
            <Icon src="img/add_list.png" size={20} style={{ background: "var(--accent)" }} />
          </div>
        </div>
      </div>
      <div className="flex flex-col" style={{ marginTop: 8, gap: 2 }}>
        <p className="truncate font-bold" style={{ color: hovered ? "var(--accent)" : "var(--text-primary)", fontSize: "var(--fs-primary)" }}>{album.name}</p>
        <ArtistTokens name={album.artist} artistId={album.artist_id} />
        <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>
          {[album.song_count && `${album.song_count} tracks`, album.year].filter(Boolean).join(" · ")}
        </p>
      </div>
    </button>
  );
});

export const CARD_MIN = 200;
export const GAP = 12;
const META_HEIGHT = 62; // 3 text rows below cover

export function getColsFromWidth(width: number) {
  return Math.max(1, Math.floor((width + GAP) / (CARD_MIN + GAP)));
}

interface RowData {
  albums: Album[];
  cols: number;
  cardWidth: number;
  onOpen: (a: Album) => void;
}

const GridRow = React.memo(({ index, style, data }: ListChildComponentProps<RowData>) => {
  const { albums, cols, cardWidth, onOpen } = data;
  return (
    <div style={{ ...style, display: "grid", gridTemplateColumns: `repeat(${cols}, ${cardWidth}px)`, gap: GAP, padding: `0 12px`, alignContent: "start" }}>
      {Array.from({ length: cols }, (_, c) => {
        const album = albums[index * cols + c];
        return album
          ? <AlbumCard key={album.id} album={album} onOpen={onOpen} />
          : <div key={c} />;
      })}
    </div>
  );
});

function AlbumGrid({ albums, loading, onOpen }: { albums: Album[]; loading: boolean; onOpen: (a: Album) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listOuterRef = useRef<HTMLDivElement>(null);
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
  const cols = width > 0 ? getColsFromWidth(width - 24) : 4;
  const cardWidth = width > 0 ? (width - 24 - GAP * (cols - 1)) / cols : CARD_MIN;
  const rowHeight = cardWidth + META_HEIGHT + GAP;
  const rowCount = Math.ceil(albums.length / cols);
  const itemData: RowData = { albums, cols, cardWidth, onOpen };
  const showSkeleton = loading && albums.length === 0;
  const skeletonRows = height > 0 ? Math.ceil(height / rowHeight) + 1 : 0;

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden" style={{ position: "relative" }}>
      {showSkeleton && width > 0 && height > 0 && Array.from({ length: skeletonRows }, (_, r) => (
        <div
          key={r}
          style={{
            position: "absolute", top: r * rowHeight, left: 0, right: 0,
            display: "grid", gridTemplateColumns: `repeat(${cols}, ${cardWidth}px)`, gap: GAP, padding: "0 12px",
          }}
        >
          {Array.from({ length: cols }, (_, c) => <SkeletonCard key={c} />)}
        </div>
      ))}
      {!showSkeleton && height > 0 && width > 0 && (
        <>
          <FixedSizeList
            outerRef={listOuterRef}
            className="scroll-clean"
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
          <ScrollThumb scrollRef={listOuterRef} />
        </>
      )}
    </div>
  );
}

// Matches the old app's compute_meta() time formatting.
function fmtAlbumDuration(totalSecs: number): string {
  const totalMin = Math.floor(totalSecs / 60);
  const sec = totalSecs % 60;
  if (totalMin >= 60) return `${Math.floor(totalMin / 60)} hr ${totalMin % 60} min`;
  return `${totalMin} min ${sec} sec`;
}

function AlbumDetail({ album }: { album: Album }) {
  const playTrack = useStore((s) => s.playTrack);
  const navigateTo = useStore((s) => s.navigateTo);
  const coverUrl = useStore((s) => s.coverUrl);
  const [starred, setStarred] = useState(album.starred);
  const [coverHovered, setCoverHovered] = useState(false);
  const [coverZoomOpen, setCoverZoomOpen] = useState(false);
  const [shuffleHovered, setShuffleHovered] = useState(false);
  const [likeHovered, setLikeHovered] = useState(false);

  useEffect(() => setStarred(album.starred), [album.id, album.starred]);

  const { data: tracks = [], isLoading: tracksLoading } = useQuery({
    queryKey: ["album-tracks", album.id],
    queryFn: () => api.getAlbumTracks(album.id),
  });

  const meta = [
    album.year ? String(album.year) : "",
    album.song_count ? `${album.song_count} songs` : "",
    album.duration_secs ? fmtAlbumDuration(album.duration_secs) : "",
  ].filter(Boolean).join(" • ");

  function handlePlay() {
    if (tracks[0]) playTrack(tracks[0], tracks);
  }

  function handleShuffle() {
    if (!tracks.length) return;
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    playTrack(shuffled[0], shuffled);
  }

  async function handleFavorite() {
    const next = !starred;
    setStarred(next); // optimistic
    try {
      await api.setFavorite(album.id, next, "id");
    } catch {
      setStarred(!next);
    }
  }

  return (
    <>
      {coverZoomOpen && album.cover_id && (
        <CoverZoomOverlay coverId={album.cover_id} onClose={() => setCoverZoomOpen(false)} />
      )}
      <div className="flex flex-col h-full page-fade-in">
      <div style={{ padding: 12 }}>
        <div
          style={{
            display: "flex", gap: 28, padding: 28,
            borderRadius: 10, background: "var(--card-bg)", border: "1px solid var(--border)",
          }}
        >
          <div style={{ position: "relative", width: 264, height: 264, flexShrink: 0 }}>
            {album.cover_id && (
              <div
                aria-hidden
                style={{
                  position: "absolute", inset: -1,
                  backgroundImage: `url(${coverUrl(album.cover_id, 264)})`,
                  backgroundSize: "cover", backgroundPosition: "center",
                  filter: "blur(10px)",
                  opacity: 0.9,
                  borderRadius: 10,
                }}
              />
            )}
            <div
              onClick={() => album.cover_id && setCoverZoomOpen(true)}
              onMouseEnter={() => setCoverHovered(true)}
              onMouseLeave={() => setCoverHovered(false)}
              style={{
                position: "relative",
                width: 264, height: 264, borderRadius: 10, overflow: "hidden", cursor: "pointer",
                transform: coverHovered ? "scale(1.08)" : "scale(1)",
                transition: "transform 200ms",
              }}
            >
              <CoverArt coverId={album.cover_id} size={264} className="w-full h-full" />
            </div>
          </div>

          <div className="flex flex-col" style={{ flex: 1, minWidth: 0, justifyContent: "flex-start", paddingTop: 16, gap: 6 }}>
            <h1 style={{ fontSize: "var(--fs-hero)", fontWeight: 700, color: "var(--text-primary)" }}>{album.name}</h1>
            <ArtistTokens name={album.artist} artistId={album.artist_id} fontSize="var(--fs-primary)" alwaysAccent />
            <p style={{ color: "var(--text-secondary)", fontWeight: 700, fontSize: "var(--fs-secondary)" }}>
              {tracksLoading && !meta ? "Loading…" : meta}
            </p>

            <div className="flex items-center" style={{ gap: 10, marginTop: 16 }}>
              <PlayRingButton icon="img/play.png" onClick={handlePlay} onHoldShuffle={handleShuffle} title="Play Album" />

              <button
                onClick={handleShuffle}
                onMouseEnter={() => setShuffleHovered(true)}
                onMouseLeave={() => setShuffleHovered(false)}
                title="Shuffle"
                style={{
                  width: 40, height: 40, borderRadius: 8, border: "none", cursor: "pointer",
                  background: shuffleHovered ? "var(--hover-bg)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "background 150ms",
                }}
              >
                <Icon src="img/shuffle.png" size={20} style={{ background: "var(--text-secondary)" }} />
              </button>

              <button
                onClick={handleFavorite}
                onMouseEnter={() => setLikeHovered(true)}
                onMouseLeave={() => setLikeHovered(false)}
                title="Add to Favorite Albums"
                style={{
                  width: 40, height: 40, borderRadius: 8, border: "none", cursor: "pointer",
                  background: likeHovered ? "var(--hover-bg)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "background 150ms",
                }}
              >
                <Icon src={starred ? "img/heart_filled.png" : "img/heart.png"} size={22} style={{ background: starred ? FAVORITE_PINK : "var(--text-secondary)" }} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1" style={{ minHeight: 0, padding: "0 12px 12px" }}>
        <TrackTable
          key={album.id}
          tracks={tracks}
          loading={tracksLoading}
          viewKey="album_detail"
          defaultSort={null}
          persistSort={false}
          showDiscHeaders
          filterableCols={["genre", "year"]}
          onFilterChange={(col, values) => {
            const value = [...values][0];
            if (value) navigateTo({ tab: "tracks", trackFilter: { col, value } });
          }}
        />
      </div>
      </div>
    </>
  );
}

const LS_ALBUMS_SORT = "albums_sort";
const LS_ALBUMS_SORT_STATES = "albums_sort_states";

export function Albums() {
  const [sort, setSort] = useState(() => loadJSON(LS_ALBUMS_SORT, "newest"));
  const [sortStates, setSortStates] = useState<Record<string, boolean>>(() => loadJSON(LS_ALBUMS_SORT_STATES, {}));
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortRef   = useRef<HTMLDivElement>(null);
  const pushNav    = useStore((s) => s.pushNav);
  const selected = useStore((s) => s.navHistory[s.navPos]?.album ?? null);
  // Cross-tab "open Albums pre-filled with this free-text search" intent —
  // set by Spotlight's "Show all N results" link (SpotlightSearch.tsx).
  // Keyed off the whole nav entry (not just albumQuery itself) so
  // re-searching the exact same text a second time still re-applies it —
  // Albums stays mounted across tab switches (App.tsx's `mounted` set), so a
  // plain useState initializer would only ever apply once at mount.
  const navEntry = useStore((s) => s.navHistory[s.navPos]);
  useEffect(() => {
    if (navEntry?.albumQuery === undefined) return;
    setSearchText(navEntry.albumQuery);
    setSearchOpen(true);
  }, [navEntry]);

  const isAscending = (sortKey: string) => sortStates[sortKey] ?? defaultAscending(sortKey);

  useEffect(() => saveJSON(LS_ALBUMS_SORT, sort), [sort]);
  useEffect(() => saveJSON(LS_ALBUMS_SORT_STATES, sortStates), [sortStates]);

  function selectSort(newSort: string) {
    if (newSort === "starred" || newSort === "compilations") {
      setSort(newSort);
    } else if (sort === newSort) {
      // Clicking the currently active sort flips its direction.
      setSortStates((prev) => ({ ...prev, [newSort]: !isAscending(newSort) }));
    } else {
      // Switching to a new sort activates it at its remembered (or default) direction.
      setSort(newSort);
    }
    setSortMenuOpen(false);
  }

  const { data: rawAlbums = [], isLoading: loading } = useQuery({
    queryKey: ["albums", sort],
    queryFn: async () => sort === "compilations"
      ? await api.getCompilations()
      : await api.getAllAlbums(sort === "song_count" ? "alphabeticalByName" : sort),
    placeholderData: (prev) => prev,
  });

  const albums = React.useMemo(() => {
    if (sort === "starred" || sort === "compilations") return rawAlbums;
    const ascending = isAscending(sort);
    if (sort === "song_count") {
      return [...rawAlbums].sort((x, y) =>
        ascending ? (x.song_count ?? 0) - (y.song_count ?? 0) : (y.song_count ?? 0) - (x.song_count ?? 0));
    }
    return ascending ? rawAlbums : [...rawAlbums].reverse();
  }, [rawAlbums, sort, sortStates[sort]]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);


  const displayedAlbums = searchText.trim()
    ? albums.filter((a) => {
        const q = searchText.toLowerCase();
        return a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q);
      })
    : albums;

  const openAlbum = useCallback((album: Album) => {
    pushNav({ album });
  }, [pushNav]);

  if (selected) {
    return <AlbumDetail album={selected} />;
  }

  return (
    <div className="flex flex-col h-full page-fade-in">
      {/* ── Toolbar ── */}
      <div className="flex items-center shrink-0 px-6" style={{ height: 58, gap: 6 }}>
        <h2 className="font-semibold" style={{ flex: 1, color: "var(--text-secondary)", fontSize: "var(--fs-primary)" }}>
          {loading
            ? "Loading albums…"
            : searchText
              ? `${displayedAlbums.length} / ${albums.length.toLocaleString("fr-FR")} albums`
              : `${albums.length.toLocaleString("fr-FR")} albums`}
        </h2>

        <SearchBox
          open={searchOpen}
          onToggle={() => setSearchOpen((v) => !v)}
          value={searchText}
          onChange={setSearchText}
          placeholder="Search albums…"
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

      <AlbumGrid albums={displayedAlbums} loading={loading} onOpen={openAlbum} />
    </div>
  );
}
