import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api, Album } from "../lib/api";
import { useStore } from "../store";
import { AlbumCard, CARD_MIN, GAP, getColsFromWidth } from "./Albums";
import { SkeletonCard } from "../components/Skeleton";
import { Icon } from "../components/Icon";
import { loadJSON, saveJSON } from "../components/TrackTable";
import { ScrollThumb } from "../components/ScrollThumb";

// Ported from home.qml/home.py — three album rows (Recently Added / Random
// Mix / Most Played), each backed by the same get_album_list_sorted call the
// old app used, just with a different sort type. Rows page a full screenful
// at a time via arrow buttons (Carousel.qml's actual behavior — not free
// scroll), animated with a CSS transform slide, and cards resize the same
// responsive way Albums.tsx's grid does (same CARD_MIN/GAP/column-count
// formula) rather than a fixed card width.
// Simplifications from the old app, still worth keeping in mind:
//  - No on-disk home_cache.json — React Query's own cache (staleTime/gcTime,
//    set up in App.tsx) already gives "show stale instantly, refetch in
//    background" for free; a hand-rolled disk cache on top would be redundant.
//  - "Random Mix" refresh always refetches from the server, rather than the
//    old app's "reshuffle client-side, only hit the network every 3rd click"
//    — a network-saving quirk not worth the extra state for a button that's
//    not expected to be mashed repeatedly.

const PAGE_SIZE = 50; // matches the old app's per-fetch page size

interface RowConfig {
  id: string;
  title: string;
  sortType: string;
  refreshable: boolean;
}

const ROWS: RowConfig[] = [
  { id: "recent", title: "Recently Added", sortType: "newest", refreshable: true },
  { id: "random", title: "Random Mix", sortType: "random", refreshable: true },
  { id: "most_played", title: "Most Played", sortType: "frequent", refreshable: false },
];

// Drag-to-reorder rows — matches the old app's home_row_order (QSettings) via
// localStorage instead, same migration-safe load pattern as App.tsx's own
// nav-tab reorder (LS_NAV_ORDER): a saved order missing a row (future
// addition) or naming one that no longer exists can't crash or silently drop
// a row.
const LS_ROW_ORDER = "home_row_order";
const DEFAULT_ROW_ORDER = ROWS.map((r) => r.id);

function loadRowOrder(): string[] {
  const saved = loadJSON<string[]>(LS_ROW_ORDER, DEFAULT_ROW_ORDER);
  const valid = new Set(DEFAULT_ROW_ORDER);
  const filtered = saved.filter((id) => valid.has(id));
  const missing = DEFAULT_ROW_ORDER.filter((id) => !filtered.includes(id));
  return [...filtered, ...missing];
}

function GripDots() {
  return (
    <div className="grid grid-cols-2 gap-[2px]" style={{ width: 8 }}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--text-secondary)", opacity: 0.6 }} />
      ))}
    </div>
  );
}

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

function AlbumRow({
  title, sortType, refreshable, dragging, onGripMouseDown, active,
}: RowConfig & {
  dragging: boolean; onGripMouseDown: (e: React.MouseEvent) => void; active: boolean;
}) {
  const navigateTo = useStore((s) => s.navigateTo);
  const {
    data, isLoading, isFetching, refetch, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["home", sortType],
    queryFn: ({ pageParam }) => api.getAlbumList(sortType, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    // Subsonic's getAlbumList2 has no total count — treat a short page (fewer
    // than requested) as "that's everything the server has" and stop there.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
  });
  const albums = data?.pages.flat() ?? [];

  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);

  // useLayoutEffect + an immediate synchronous measurement (rather than
  // waiting for ResizeObserver's own first callback) so the correct column
  // count is already known before the browser paints — otherwise the first
  // frame renders the viewportWidth===0 fallback (4 cols @ CARD_MIN) and then
  // visibly snaps to the real size a frame later every time this tab remounts.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    setViewportWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Home stays mounted (just `display:none`) while another tab is active, so
  // this container collapses to 0 width while hidden. Coming back only
  // re-triggers ResizeObserver's callback *after* the browser has already
  // painted the stale/0-width layout — visible as the grid snapping to the
  // right size a frame late. Re-measuring synchronously the instant this tab
  // becomes active again (before paint) closes that gap.
  useLayoutEffect(() => {
    if (!active) return;
    const el = viewportRef.current;
    if (!el) return;
    setViewportWidth(el.getBoundingClientRect().width);
  }, [active]);

  // Same column-count formula as Albums.tsx's grid, so a row's cards are the
  // same size as (and resize in step with) the album grid's own cards.
  const cols = viewportWidth > 0 ? getColsFromWidth(viewportWidth) : 4;
  const cardWidth = viewportWidth > 0 ? (viewportWidth - GAP * (cols - 1)) / cols : CARD_MIN;
  const step = cardWidth + GAP;

  const knownPageCount = Math.max(1, Math.ceil(albums.length / cols));
  // "How far can the user actually page right now" — one page past the last
  // full page of already-fetched albums whenever more can still be fetched,
  // so the arrow isn't disabled just because we haven't asked the server yet.
  const pageCount = hasNextPage ? knownPageCount + 1 : knownPageCount;

  // Reset to the first page if the row's data (or how many cards fit) changes
  // out from under the current page index — otherwise a resize or a refetch
  // that returns fewer albums could strand pageIndex past the new last page.
  useEffect(() => { setPageIndex(0); }, [sortType, cols]);

  function openAlbum(album: Album) {
    navigateTo({ tab: "albums", album });
  }

  function nextPage() {
    if (pageIndex < knownPageCount - 1) { setPageIndex((p) => p + 1); return; }
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage().then(() => setPageIndex((p) => p + 1));
    }
  }

  const offset = pageIndex * cols * step;
  const rightDisabled = pageIndex >= knownPageCount - 1 && !hasNextPage;

  return (
    <div className="flex flex-col" style={{ gap: 10, opacity: dragging ? 0.4 : 1 }}>
      <div className="flex items-center" style={{ gap: 8 }}>
        <div
          onMouseDown={onGripMouseDown}
          title="Drag to reorder"
          style={{ cursor: "grab", padding: 4, display: "flex" }}
        >
          <GripDots />
        </div>
        <h2 style={{ color: "var(--text-primary)", fontSize: "var(--fs-title)", fontWeight: 700 }}>{title}</h2>
        <div className="flex items-center" style={{ marginLeft: "auto", gap: 2 }}>
          {refreshable && (
            <button
              onClick={() => refetch()}
              title="Refresh"
              disabled={isFetching}
              style={{ background: "none", border: "none", cursor: isFetching ? "default" : "pointer", padding: 4, display: "flex" }}
            >
              <Icon
                src="img/refresh.png"
                size={15}
                style={{
                  background: "var(--accent)",
                  animation: isFetching ? "spinner-rotate 800ms linear infinite" : undefined,
                }}
              />
            </button>
          )}
          {pageCount > 1 && (
            <>
              <PageArrow dir="left" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => Math.max(0, p - 1))} />
              <PageArrow dir="right" disabled={rightDisabled} onClick={nextPage} />
            </>
          )}
        </div>
      </div>
      <div ref={viewportRef} style={{ overflow: "hidden" }}>
        <div
          style={{
            display: "flex", gap: GAP,
            transform: `translateX(-${offset}px)`,
            transition: "transform 300ms cubic-bezier(0.65, 0, 0.35, 1)",
          }}
        >
          {isLoading && !data
            ? Array.from({ length: 8 }, (_, i) => (
                <div key={i} style={{ width: cardWidth, flexShrink: 0 }}><SkeletonCard /></div>
              ))
            : albums.map((album) => (
                <div key={album.id} style={{ width: cardWidth, flexShrink: 0 }}>
                  <AlbumCard album={album} onOpen={openAlbum} />
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}

export function Home() {
  const active = useStore((s) => s.activeTab === "home");
  const [rowOrder, setRowOrder] = useState<string[]>(loadRowOrder);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const orderRef = useRef(rowOrder);
  orderRef.current = rowOrder;
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { saveJSON(LS_ROW_ORDER, rowOrder); }, [rowOrder]);

  // Manual mousedown/mousemove/mouseup drag instead of native HTML5
  // draggable — native dragover only fires on whatever element is directly
  // under the cursor, at a throttled rate, so reordering felt like it needed
  // the pointer to land precisely on a drop target. Plain mouse events fire
  // on every pointer move regardless of what's underneath, so this reacts
  // continuously to where the cursor actually is instead — same approach
  // QueuePanel.tsx's track drag-reorder already uses, just testing each
  // row's live bounding rect (rows have variable height here, unlike a
  // fixed-row list) instead of dividing by a constant row height.
  function handleGripMouseDown(rowId: string) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      setDragRowId(rowId);
      document.body.style.userSelect = "none";

      function onMove(ev: MouseEvent) {
        const order = orderRef.current;
        for (const id of order) {
          if (id === rowId) continue;
          const el = rowRefs.current[id];
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          if (ev.clientY < rect.top || ev.clientY > rect.bottom) continue;
          const from = order.indexOf(rowId);
          const to = order.indexOf(id);
          if (from !== -1 && to !== -1 && from !== to) {
            const next = [...order];
            next.splice(from, 1);
            next.splice(to, 0, rowId);
            setRowOrder(next);
          }
          break;
        }
      }
      function onUp() {
        setDragRowId(null);
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  const rows = rowOrder.map((id) => ROWS.find((r) => r.id === id)).filter((r): r is RowConfig => !!r);

  return (
    <div className="flex-1" style={{ position: "relative", minHeight: 0 }}>
      <div ref={scrollRef} className="h-full overflow-y-auto scroll-clean" style={{ padding: 12 }}>
        <div className="flex flex-col" style={{ gap: 28 }}>
          {rows.map((row) => (
            <div key={row.id} ref={(el) => { rowRefs.current[row.id] = el; }}>
              <AlbumRow
                {...row}
                active={active}
                dragging={dragRowId === row.id}
                onGripMouseDown={handleGripMouseDown(row.id)}
              />
            </div>
          ))}
        </div>
      </div>
      <ScrollThumb scrollRef={scrollRef} />
    </div>
  );
}
