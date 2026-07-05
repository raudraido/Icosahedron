import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { TrackTable, SortState, DEFAULT_SORT, loadJSON, saveJSON, LS_SORT } from "../components/TrackTable";
import { IconBtn } from "../components/IconBtn";

const PAGE_SIZE = 200;

// Maps our column ids to Navidrome's native /api/song `_sort` field names.
const SORT_FIELD: Record<string, string> = {
  title: "title", artist: "artist", album: "album", year: "year", genre: "genre",
  fav: "starred", plays: "playCount", dur: "duration", trackno: "trackNumber",
  date: "createdAt", bpm: "bpm",
};

export function Tracks() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [sortState, setSortState] = useState<SortState>(() => loadJSON(LS_SORT("tracks"), DEFAULT_SORT));
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 400);
    return () => clearTimeout(t);
  }, [query]);

  // Sort/search changes invalidate the current page position.
  useEffect(() => { setPage(1); }, [sortState, debouncedQuery]);

  const sortCol = sortState ?? { col: "date", dir: "desc" as const };
  const sortField = SORT_FIELD[sortCol.col] ?? "createdAt";
  const order = sortCol.dir === "asc" ? "ASC" : "DESC";

  const { data, isLoading } = useQuery({
    queryKey: ["tracks-native", sortField, order, page, debouncedQuery],
    queryFn: () => api.getTracksNativePage(sortField, order, (page - 1) * PAGE_SIZE, page * PAGE_SIZE, debouncedQuery || undefined),
    placeholderData: (prev) => prev,
  });

  const tracks = data?.tracks ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function handleSortChange(next: SortState) {
    setSortState(next);
    saveJSON(LS_SORT("tracks"), next);
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
        toolbarLeft={
          <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-primary)", fontWeight: 600 }}>
            {total.toLocaleString("fr-FR")} tracks
          </span>
        }
        toolbarRight={
          <IconBtn
            src="/img/refresh.png"
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
