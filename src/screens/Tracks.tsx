import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Track, TrackFilters } from "../lib/api";
import { TrackTable, SortState, DEFAULT_SORT, loadJSON, saveJSON, LS_SORT } from "../components/TrackTable";
import { IconBtn } from "../components/IconBtn";
import { Icon } from "../components/Icon";
import { useStore } from "../store";

const PAGE_SIZE = 200;
const FILTERABLE_COLS = ["artist", "album", "genre", "year"];

// Maps our column ids to Navidrome's native /api/song `_sort` field names.
const SORT_FIELD: Record<string, string> = {
  title: "title", artist: "artist", album: "album", year: "year", genre: "genre",
  fav: "starred", plays: "playCount", dur: "duration", trackno: "trackNumber",
  date: "createdAt", bpm: "bpm",
};

export function Tracks() {
  const qc = useQueryClient();
  const playTrack = useStore((s) => s.playTrack);
  const [page, setPage] = useState(1);
  const [sortState, setSortState] = useState<SortState>(() => loadJSON(LS_SORT("tracks"), DEFAULT_SORT));
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  // Excel-style column filters (Artist/Album/Genre/Year) — matches
  // tracks_browser.py's _col_filters; kept as component state (the old app
  // never persists these across restarts either).
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});

  // Cross-tab "open Tracks pre-filtered" intent (e.g. clicking a genre/year
  // cell in a playlist's tracklist, Playlists.tsx) — applied whenever the
  // current nav entry carries one. Tracks stays mounted across tab switches
  // (App.tsx's `mounted` set), so this can't just be a useState initializer
  // like Artists.tsx's one-time navQuery capture; it needs to reapply on
  // every *new* navigateTo call, which is exactly what depending on the
  // entry's object identity gives for free (a fresh navigateTo always
  // creates a new object, even for the same col/value).
  const trackFilter = useStore((s) => s.navHistory[s.navPos]?.trackFilter);
  useEffect(() => {
    if (!trackFilter) return;
    setColFilters({ [trackFilter.col]: new Set([trackFilter.value]) });
    setPage(1);
  }, [trackFilter]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 400);
    return () => clearTimeout(t);
  }, [query]);

  // Sort/search changes invalidate the current page position.
  useEffect(() => { setPage(1); }, [sortState, debouncedQuery]);

  const sortCol = sortState ?? { col: "date", dir: "desc" as const };
  const sortField = SORT_FIELD[sortCol.col] ?? "createdAt";
  const order = sortCol.dir === "asc" ? "ASC" : "DESC";

  // Name→id maps back the filter popup's checklist for Artist/Album/Genre —
  // fetched once up front (matches _start_filter_values_worker firing right
  // after the first page loads, so they're ready by the time a filter icon
  // is clicked) rather than lazily on first click.
  const { data: artistMap = {} } = useQuery({ queryKey: ["tracks-artist-map"], queryFn: api.getArtistIdMap, staleTime: 10 * 60_000 });
  const { data: albumMap = {} } = useQuery({ queryKey: ["tracks-album-map"], queryFn: api.getAlbumIdMap, staleTime: 10 * 60_000 });
  const { data: genreMap = {} } = useQuery({ queryKey: ["tracks-genre-map"], queryFn: api.getGenreIdMap, staleTime: 10 * 60_000 });

  // Year has no dedicated id-list endpoint, so (matching FilterValuesWorker)
  // its value list comes from a sample of up to 500 tracks matching the
  // current search — re-sampled only when the query changes, not on every
  // filter apply (matches invalidate_filter_cache's query-only trigger).
  const { data: yearSample } = useQuery({
    queryKey: ["tracks-year-sample", debouncedQuery],
    queryFn: () => api.getTracksNativePage("title", "ASC", 0, 500, debouncedQuery || undefined),
  });
  const yearValues = useMemo(() => {
    const set = new Set<string>();
    for (const t of yearSample?.tracks ?? []) if (t.year) set.add(String(t.year));
    return [...set].sort();
  }, [yearSample]);

  const colValues = useMemo(() => ({
    artist: Object.keys(artistMap), album: Object.keys(albumMap), genre: Object.keys(genreMap), year: yearValues,
  }), [artistMap, albumMap, genreMap, yearValues]);

  // Deterministic, serializable key for react-query (a Set-valued object
  // would just stringify to "{}" and never bust the cache on change).
  const filterKey = useMemo(
    () => JSON.stringify(Object.entries(colFilters).map(([c, v]) => [c, [...v].sort()]).sort()),
    [colFilters],
  );

  // Converts display-value filters to Navidrome's native id-list params —
  // matches _build_server_filters. Year is a plain scalar column, not a
  // many-valued relation like artist/album/genre, so (same as the old app)
  // only one checked value ever makes it to the server regardless of how
  // many are checked in the popup.
  const serverFilters = useMemo((): TrackFilters | undefined => {
    if (!Object.keys(colFilters).length) return undefined;
    const filters: TrackFilters = {};
    const artistIds = [...(colFilters.artist ?? [])].map((n) => artistMap[n]).filter(Boolean);
    if (artistIds.length) filters.artistIds = artistIds;
    const albumIds = [...(colFilters.album ?? [])].map((n) => albumMap[n]).filter(Boolean);
    if (albumIds.length) filters.albumIds = albumIds;
    const genreIds = [...(colFilters.genre ?? [])].map((n) => genreMap[n]).filter(Boolean);
    if (genreIds.length) filters.genreIds = genreIds;
    const year = [...(colFilters.year ?? [])][0];
    if (year) filters.year = year;
    return filters;
  }, [colFilters, artistMap, albumMap, genreMap]);

  const { data, isLoading } = useQuery({
    queryKey: ["tracks-native", sortField, order, page, debouncedQuery, filterKey],
    queryFn: () => api.getTracksNativePage(sortField, order, (page - 1) * PAGE_SIZE, page * PAGE_SIZE, debouncedQuery || undefined, serverFilters),
    placeholderData: (prev) => prev,
  });

  const tracks = data?.tracks ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function handleSortChange(next: SortState) {
    setSortState(next);
    saveJSON(LS_SORT("tracks"), next);
  }

  function handleFilterChange(col: string, values: Set<string>) {
    setColFilters((prev) => {
      const next = { ...prev };
      if (values.size) next[col] = values; else delete next[col];
      return next;
    });
    setPage(1);
  }

  const filtersActive = Object.keys(colFilters).length > 0;

  function handleClearAllFilters() {
    setColFilters({});
    setPage(1);
  }

  // Matches _fetch_all_filtered_tracks: a single request for the *entire*
  // filtered result set (not just the current page) using the same sort/
  // query/filters as the table — reused by both Play and Shuffle filtered.
  async function fetchAllFiltered(): Promise<Track[]> {
    if (total === 0) return [];
    const result = await api.getTracksNativePage(sortField, order, 0, total, debouncedQuery || undefined, serverFilters);
    return result.tracks;
  }

  async function handlePlayFiltered() {
    const all = await fetchAllFiltered();
    if (all.length) playTrack(all[0], all);
  }

  async function handleShuffleFiltered() {
    const all = await fetchAllFiltered();
    if (!all.length) return;
    const shuffled = [...all];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    playTrack(shuffled[0], shuffled);
  }

  // Matches the old app's _do_refresh: poll getScanStatus every 500ms (up to
  // 30s) until scanning stops, then re-check once more after a 1.5s settle
  // (Navidrome can flip the flag slightly before the index commit actually
  // finishes) — spinning the whole time, not just for the initial POST.
  // A 600ms floor keeps the spin visible even if the scan finishes instantly.
  async function handleRefresh() {
    if (refreshing) return;
    const startedAt = Date.now();
    setRefreshing(true);
    try {
      await api.startScan();
      for (let i = 0; i < 60; i++) {
        await sleep(500);
        const status = await api.getScanStatus().catch(() => null);
        if (status && !status.scanning) {
          await sleep(1500);
          const recheck = await api.getScanStatus().catch(() => null);
          if (!recheck || !recheck.scanning) break;
        }
      }
      await qc.invalidateQueries({ queryKey: ["tracks-native"] });
      await qc.invalidateQueries({ queryKey: ["tracks-artist-map"] });
      await qc.invalidateQueries({ queryKey: ["tracks-album-map"] });
      await qc.invalidateQueries({ queryKey: ["tracks-genre-map"] });
      await qc.invalidateQueries({ queryKey: ["tracks-year-sample"] });
    } finally {
      const remaining = 600 - (Date.now() - startedAt);
      if (remaining > 0) await sleep(remaining);
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ padding: 12 }}>
      <TrackTable
        tracks={tracks}
        loading={isLoading}
        viewKey="tracks"
        serverDriven
        numColSource="position"
        numColOffset={(page - 1) * PAGE_SIZE}
        sortState={sortState}
        onSortChange={handleSortChange}
        query={query}
        onQueryChange={setQuery}
        pagination={{ page, totalPages, onPageChange: setPage }}
        filterableCols={FILTERABLE_COLS}
        colFilters={colFilters}
        onFilterChange={handleFilterChange}
        colValues={colValues}
        toolbarLeft={
          <div className="flex items-center" style={{ gap: 4 }}>
            {filtersActive && (
              <>
                <PlayFilteredButton onPlay={handlePlayFiltered} onShuffle={handleShuffleFiltered} />
                <ToolbarIconButton src="img/filter_off-2.png" title="Clear filters" onClick={handleClearAllFilters} />
              </>
            )}
            <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-primary)", fontWeight: 600, marginLeft: filtersActive ? 4 : 0 }}>
              {total.toLocaleString("fr-FR")} tracks
            </span>
          </div>
        }
        toolbarRight={
          <IconBtn
            src="img/refresh.png"
            title="Refresh server library"
            onClick={handleRefresh}
            spinning={refreshing}
          />
        }
      />
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Matches TrackListView.qml's clearFiltersBtn/playFilteredBtn: 32×32, 4px
// hover highlight, icon always accent-tinted (not conditionally gray/accent
// like the popup's own action rows).
function ToolbarIconButton({ src, title, onClick }: { src: string; title: string; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="flex items-center justify-center"
      style={{ width: 32, height: 32, borderRadius: 4, background: hov ? "var(--hover-bg)" : "transparent", border: "none", cursor: "pointer" }}
    >
      <Icon src={src} size={18} style={{ background: "var(--accent)" }} />
    </button>
  );
}

// Click = play the filtered set, press+hold 600ms = shuffle it instead —
// matches playFilteredBtn's MouseArea (onPressed starts a 600ms Timer;
// onReleased fires the click action only if the timer hasn't already
// fired the hold action; onCanceled/mouse-leave just cancels the timer).
function PlayFilteredButton({ onPlay, onShuffle }: { onPlay: () => void; onShuffle: () => void }) {
  const [hov, setHov] = useState(false);
  const timerRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  function clearTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handleMouseDown() {
    firedRef.current = false;
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      timerRef.current = null;
      onShuffle();
    }, 600);
  }
  function handleMouseUp() {
    const held = timerRef.current === null && firedRef.current;
    clearTimer();
    if (!held) onPlay();
  }
  function handleMouseLeave() {
    setHov(false);
    clearTimer();
  }

  return (
    <button
      title="Play filtered tracks (hold to shuffle)"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      className="flex items-center justify-center"
      style={{ width: 32, height: 32, borderRadius: 4, background: hov ? "var(--hover-bg)" : "transparent", border: "none", cursor: "pointer" }}
    >
      <Icon src="img/play-button.png" size={18} style={{ background: "var(--accent)" }} />
    </button>
  );
}
