import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api, Track } from "../lib/api";
import { fmtDuration } from "../lib/api";
import { useStore } from "../store";
import { CoverArt } from "./CoverArt";
import { Icon } from "./Icon";
import { IconBtn } from "./IconBtn";
import { SearchBox, SearchScopeOption } from "./SearchBox";
import { PlayingBars } from "./PlayingBars";
import { ArtistTokens } from "./ArtistTokens";
import { SkeletonTrackRow } from "./Skeleton";
import { ContextMenu, MenuEntry, MenuItem } from "./ContextMenu";
import { PromptDialog } from "./PromptDialog";
import { TrackInfoDialog } from "./TrackInfoDialog";
import { ColumnFilterPopup } from "./ColumnFilterPopup";
import { ARTIST_SEP_RE } from "./ArtistTokens";
import { FAVORITE_PINK } from "../lib/theme";
import { GripDots, InsertionIndicator, GhostRow } from "./QueuePanel";
import { ScrollThumb } from "./ScrollThumb";

// Fixed track-row height — used both by react-virtual's estimateSize and by
// the reorder drag math below (Math.floor(relY / TRACK_ROW_HEIGHT)). Only
// valid while every row is a plain track row, which is why reorderable is
// gated on !showDiscHeaders (disc-header rows are a different, 36px height).
const TRACK_ROW_HEIGHT = 58;

// Shared, reusable track table — used by both the main Tracks screen and the
// album-detail tracklist (matches the old app's TrackListView.qml, reused
// verbatim by tracks_list.qml and album_detail.qml). Column layout/sort/
// visibility state is scoped per host via a `viewKey` prop, matching the old
// app's own per-view QSettings namespaces (`tracks/col_visibility`,
// `album_detail/col_visibility`, etc. — tracks_browser.py:1976,
// albums_browser.py:637 — each screen keeps its own independent settings,
// they were never a single shared namespace).

// ── Column model ─────────────────────────────────────────────────────────

interface ColumnDef {
  id: string;
  label: string;
  minWidth: number;
  sortable: boolean;
  descFirst?: boolean; // sorts descending on first click (e.g. plays, duration)
}

// Leading row-position column — always present, first, fixed width, non-reorderable,
// non-sortable, non-toggleable, non-resizable. Change the width here.
const NUM_COL_WIDTH = 20;
// Fine-tune the "#" cell's centered content left/right without moving the
// following column: shift the box itself by this many px (positive = left)
// via equal-and-opposite margins, so the net space it occupies is unchanged.
const NUM_COL_SHIFT = 8;

const COLUMNS: Record<string, ColumnDef> = {
  track:   { id: "track",   label: "TRACK",       minWidth: 220, sortable: false },
  title:   { id: "title",   label: "TITLE",       minWidth: 80,  sortable: true },
  artist:  { id: "artist",  label: "ARTIST",      minWidth: 90,  sortable: true },
  album:   { id: "album",   label: "ALBUM",       minWidth: 90,  sortable: true },
  fav:     { id: "fav",     label: "FAVORITE",    minWidth: 68,  sortable: true },
  genre:   { id: "genre",   label: "GENRE",       minWidth: 80,  sortable: false },
  dur:     { id: "dur",     label: "DURATION",    minWidth: 70,  sortable: true, descFirst: true },
  plays:   { id: "plays",   label: "PLAYS",       minWidth: 52,  sortable: true, descFirst: true },
  trackno: { id: "trackno", label: "NO.",         minWidth: 42,  sortable: true },
  // Wider than its label alone needs — "year" is filterable (see
  // FILTERABLE_COLS/filterableCols callers), so its header always reserves
  // room for the filter funnel icon too, not just when actively sorted.
  year:    { id: "year",    label: "YEAR",        minWidth: 56,  sortable: true },
  date:    { id: "date",    label: "DATE ADDED",  minWidth: 100, sortable: true, descFirst: true },
  bpm:     { id: "bpm",     label: "BPM",         minWidth: 44,  sortable: true, descFirst: true },
};

// Header label + sort arrow + filter icon, and the cell content below it,
// are centered rather than left-aligned for these columns — the free-text
// ones (track/title/artist/album/genre, all variable-length real content)
// read better left-aligned instead.
const MID_COLS = new Set(["fav", "dur", "plays", "trackno", "year", "date", "bpm"]);

// Table column order (default) vs. the picker menu's fixed listing order — these differ in the old app.
const DEFAULT_COL_ORDER = ["track", "title", "artist", "album", "fav", "genre", "dur", "plays", "trackno", "year", "date", "bpm"];
const MENU_ORDER = ["title", "artist", "fav", "genre", "dur", "plays", "album", "trackno", "year", "date", "bpm"];
// The picker menu uses Title Case, not the table headers' ALL CAPS — matches
// the old app's themed_shadow_menu labels exactly ("Track, Title, Artist,
// Favorite, Genre, Duration, Plays, Album, No., Year, Date Added, BPM").
const MENU_LABELS: Record<string, string> = {
  title: "Title", artist: "Artist", fav: "Favorite", genre: "Genre", dur: "Duration",
  plays: "Plays", album: "Album", trackno: "No.", year: "Year", date: "Date Added", bpm: "BPM",
};

const DEFAULT_COL_VISIBILITY: Record<string, boolean> = {
  title: false, artist: false, album: true, fav: true, genre: true,
  dur: true, plays: true, trackno: true, year: true, date: true, bpm: false,
};
// Every column falls through to colBoxWidth()'s real measured minWidthFor()
// and starts shrunk to fit its header label (text + 3px each side), same as
// its resize floor — no exceptions, so the header text always sits right up
// against the separator line rather than floating in a wider box with
// visible slack. This does mean title/artist/album (real, often-long
// content) start narrow and truncate hard until manually widened — that's
// an explicit, repeated user choice: uniform tight-by-default headers,
// resize-to-widen as an opt-in action per column rather than a few columns
// guessing at a "probably needs more room" default.
const DEFAULT_COL_WIDTHS: Record<string, number> = {};
export type SortState = { col: string; dir: "asc" | "desc" } | null;
type DisplayRow =
  | { kind: "track"; track: Track; trackIndex: number }
  | { kind: "discHeader"; discNumber: number };
export const DEFAULT_SORT: SortState = { col: "date", dir: "desc" };

const LS_ORDER = (viewKey: string) => `${viewKey}_col_order`;
// _v2: fav/dur/plays/trackno/year/bpm dropped out of DEFAULT_COL_WIDTHS in
// favor of measured shrink-to-fit (see minWidthFor()) — a versioned key
// means anyone with pre-existing saved widths (mid-development testing,
// here) gets the new auto-fit behavior immediately instead of their stale
// numbers silently winning over colBoxWidth()'s `?? minWidthFor(id)`
// fallback forever, since that fallback only ever triggers when colWidths
// has no entry for a given column at all.
const LS_WIDTHS = (viewKey: string) => `${viewKey}_col_widths_v2`;
export const LS_SORT = (viewKey: string) => `${viewKey}_sort_state`;
const LS_VIS = (viewKey: string) => `${viewKey}_col_visibility`;

export function loadJSON<T>(key: string, fallback: T): T {
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
export function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort persistence
  }
}

// ── Formatters ───────────────────────────────────────────────────────────

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

// Genre token separator — handles both shapes t.genre can arrive in:
// Navidrome's native /api/song joins a track's multiple genres with " • "
// itself (subsonic.ts's parseNativeTrack, matching the old app's own
// genreStr.split(/( • )/)), while the standard Subsonic API's plain `genre`
// string field can still carry raw ID3-style multi-value delimiters
// (semicolon/slash/pipe/comma) for album-detail tracks. Splitting on only
// the semicolon/slash/pipe/comma set (as originally written) silently
// never split native-path tracks at all — "Rock • Pop" has none of those
// characters, so it rendered as one single clickable blob instead of two.
const GENRE_SEP_RE = /[;/|,•]+/;

// Cascading filter values — when another column already has an active
// filter, the popup derives its own value list from the currently-loaded
// (already-filtered) tracks instead of the full global list, matching
// tracks_browser.py's _values_from_tree: only show values that actually
// occur in the current result set. Artist splits multi-artist cells the
// same way ArtistTokens does everywhere else in this app (the old app used
// a separately-defined, slightly different separator list just for this
// one cascading case — standardizing on one separator set is more
// consistent than reproducing that discrepancy, same call made for
// ArtistInfoPanel's paging split).
function deriveFilterValues(tracks: Track[], col: string): string[] {
  const vals = new Set<string>();
  for (const t of tracks) {
    if (col === "artist") {
      for (const part of t.artist.split(ARTIST_SEP_RE)) {
        const trimmed = part.trim();
        if (trimmed && !ARTIST_SEP_RE.test(part)) vals.add(trimmed);
      }
    } else if (col === "album") {
      if (t.album) vals.add(t.album);
    } else if (col === "genre") {
      for (const part of (t.genre ?? "").split(GENRE_SEP_RE)) {
        const trimmed = part.trim();
        if (trimmed) vals.add(trimmed);
      }
    } else if (col === "year") {
      if (t.year) vals.add(String(t.year));
    }
  }
  return [...vals].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

function sortKey(t: Track, col: string, bpmCache?: Record<string, number>): string | number {
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
    case "bpm": return bpmCache?.[t.id] ?? t.bpm ?? 0;
    default: return 0;
  }
}

function sortTracks(tracks: Track[], col: string, dir: "asc" | "desc", bpmCache?: Record<string, number>): Track[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...tracks].sort((a, b) => {
    const ka = sortKey(a, col, bpmCache);
    const kb = sortKey(b, col, bpmCache);
    if (ka < kb) return -1 * factor;
    if (ka > kb) return 1 * factor;
    return 0;
  });
}

// ── Column filter funnel icon — matches TrackListView.qml's filter icon:
// textSecondary normally, accentColor on hover *or* whenever this column
// has an active filter (not just while hovering). ──────────────────────────

function FilterIcon({ active, onClick }: { active: boolean; onClick: (e: React.MouseEvent<HTMLDivElement>) => void }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      data-filter-trigger
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ width: 14, height: 14, flexShrink: 0, cursor: "pointer" }}
    >
      <Icon src="img/filter.png" size={14} style={{ background: hov || active ? "var(--accent)" : "var(--text-secondary)" }} />
    </div>
  );
}

// Hover-accent + underline clickable text — matches the QML's album/genre/
// year cells (albText/genre-token/yearStr) exactly: textSecondary normally,
// accentColor + underline only while hovered, cursor default when disabled
// (album with no id, genre with no value, year blank).
function HoverToken({ text, clickable, onClick, onHover, className }: {
  text: string; clickable: boolean; onClick?: () => void; onHover?: () => void; className?: string;
}) {
  const [hov, setHov] = useState(false);
  return (
    <span
      onClick={clickable ? (e) => { e.stopPropagation(); onClick?.(); } : undefined}
      onMouseEnter={() => { if (clickable) setHov(true); onHover?.(); }}
      onMouseLeave={() => setHov(false)}
      className={className}
      style={{
        color: hov ? "var(--accent)" : "var(--text-secondary)", fontSize: "var(--fs-secondary)",
        cursor: clickable ? "pointer" : "default",
        textDecorationLine: hov ? "underline" : "none",
        textUnderlineOffset: "2px", textDecorationThickness: "1px", textDecorationColor: "var(--accent)",
      }}
    >
      {text}
    </span>
  );
}

// ── Favorite toggle ──────────────────────────────────────────────────────

function FavoriteHeart({ track }: { track: Track }) {
  const [starred, setStarred] = useState(track.starred);
  const [hov, setHov] = useState(false);
  const qc = useQueryClient();
  useEffect(() => setStarred(track.starred), [track.id, track.starred]);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !starred;
    setStarred(next);
    try {
      await api.setFavorite(track.id, next, "id");
      // Lets the Favorites tab's starred-tracks list drop this row (or the
      // Tracks/Album tables pick up the new heart state) without needing a
      // manual re-visit — matches the old app's immediate row removal on
      // un-star, just via a refetch instead of a local splice.
      qc.invalidateQueries({ queryKey: ["starred"] });
    } catch {
      setStarred(!next);
    }
  }

  return (
    <button
      onClick={toggle}
      // The row itself is a drag handle in reorderable views (e.g.
      // Playlists) once the grip shows — without this, a mousedown here
      // would bubble up and start a drag before this button's own onClick
      // ever runs.
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 0 }}
    >
      <Icon
        src={starred ? "img/heart_filled.png" : "img/heart.png"}
        size={16}
        style={{ background: starred ? FAVORITE_PINK : hov ? "var(--accent)" : "var(--text-secondary)" }}
      />
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────────────

export function TrackTable({
  tracks, loading = false, defaultSort = DEFAULT_SORT, persistSort = true, showDiscHeaders = false,
  serverDriven = false, sortState: controlledSortState, onSortChange, query: controlledQuery, onQueryChange,
  searchScope, searchScopeOptions, onSearchScopeChange,
  pagination, toolbarLeft, toolbarRight, numColSource = "trackNumber", numColOffset = 0, viewKey,
  filterableCols = [], colFilters, onFilterChange, colValues,
  reorderable = false, onReorder, extraMenuItems, externalScrollRef,
}: {
  tracks: Track[];
  loading?: boolean;
  /** Namespaces column order/widths/visibility/sort in localStorage (e.g. "tracks",
   *  "album_detail") so the two hosts don't share settings — matches the old app's
   *  own per-view QSettings groups. */
  viewKey: string;
  /** Initial/reset sort. Pass null for "no sort" (natural order) — e.g. an album's tracklist, which is
   *  already in disc/track order from the server, vs. date-added-descending for the main library. */
  defaultSort?: SortState;
  /** Main Tracks screen remembers sort across sessions; a single album's tracklist shouldn't inherit that. */
  persistSort?: boolean;
  /** What the leading "#" column shows: the track's own `track_number` metadata field (resets per
   *  disc for free — the album detail tracklist) or a running position within the given `tracks`
   *  array plus `numColOffset` (the main Tracks screen — each page is its own array, so without an
   *  offset this would wrongly reset to 1 on every page instead of continuing 201, 202...). */
  numColSource?: "trackNumber" | "position";
  /** Added to the position number when `numColSource="position"` — pass the current page's starting
   *  index (e.g. `(page - 1) * pageSize`) so numbering runs continuously across pages. */
  numColOffset?: number;
  /** Album-detail only: insert "Disc N" separator rows between discs. Matches the old app's
   *  TrackListView.qml, which only shows these in natural (unsorted, unfiltered) order — a search
   *  or column sort flattens the list and the headers stop making sense. */
  showDiscHeaders?: boolean;
  /** Server already returned `tracks` pre-sorted/pre-filtered/paginated — skip all client-side
   *  sort/filter and trust the prop as-is. Requires `sortState`/`onSortChange` and
   *  `query`/`onQueryChange` (controlled), since the parent needs to know sort/search *before*
   *  the first fetch. Used by the main Tracks screen; album detail doesn't need this. */
  serverDriven?: boolean;
  sortState?: SortState;
  onSortChange?: (s: SortState) => void;
  query?: string;
  onQueryChange?: (q: string) => void;
  /** Optional search-scope dropdown, forwarded to SearchBox's small
   *  down-arrow button — only the main Tracks screen passes these; every
   *  other host omits them and the search box renders unchanged. */
  searchScope?: string;
  searchScopeOptions?: SearchScopeOption[];
  onSearchScopeChange?: (v: string) => void;
  pagination?: { page: number; totalPages: number; onPageChange: (page: number) => void };
  /** Extra content (e.g. track count) rendered at the toolbar's left edge. */
  toolbarLeft?: React.ReactNode;
  /** Extra content (e.g. the refresh button) rendered between the search box and the
   *  column picker — matches the old app's header order: search box, then refresh,
   *  then the rightmost burger/column menu. */
  toolbarRight?: React.ReactNode;
  /** Column ids where the cell's own value becomes clickable-to-filter (genre/year cells
   *  call `onFilterChange` with just that one value) — matches the old app's
   *  `filterableCols`. The header's Excel-style filter *funnel icon* additionally requires
   *  `colValues` (its checklist's value source); without it, cells are still clickable but
   *  no funnel icon renders — e.g. Playlists.tsx wires genre/year cells to navigate to the
   *  Tracks tab pre-filtered, without needing the full checklist popup Tracks.tsx itself
   *  provides via colValues. */
  filterableCols?: string[];
  /** Active filter values per column id (empty/absent = no filter on that column) — owned
   *  by the parent since applying one means refetching server-side (see Tracks.tsx). */
  colFilters?: Record<string, Set<string>>;
  onFilterChange?: (col: string, values: Set<string>) => void;
  /** Global distinct-value list per filterable column (e.g. every artist name library-wide,
   *  not just this page) — used unless another column already has an active filter, in
   *  which case values are instead derived from the currently-loaded `tracks` (cascading). */
  colValues?: Record<string, string[]>;
  /** Drag-to-reorder via the Queue panel's own grip/drag mechanics (GripDots/
   *  InsertionIndicator/GhostRow, imported from QueuePanel.tsx rather than
   *  duplicated). Only takes effect in natural order (no active sort/search)
   *  and requires `showDiscHeaders` to be false — reorder math assumes every
   *  row is a uniform TRACK_ROW_HEIGHT, which disc-header rows would break. */
  reorderable?: boolean;
  /** Called once per completed drag with the moved track's id and the
   *  insertion index (0..tracks.length) it was dropped at — the host owns
   *  actually persisting the new order (e.g. Playlists.tsx's
   *  reorderPlaylistTracks) and updating its own `tracks` prop afterward. */
  onReorder?: (trackId: string, toIndex: number) => void;
  /** Extra context-menu rows appended after the built-in ones (e.g.
   *  Playlists.tsx's "Remove from Playlist") — a callback rather than a
   *  static list since the entry usually needs the specific track/index. */
  extraMenuItems?: (track: Track) => MenuEntry[];
  /** Attach the row virtualizer to an ancestor's own scroll container
   *  instead of giving this table its own internal one — for hosts like
   *  Starred.tsx, where the tracklist is one section of a single
   *  continuously-scrolling page (carousels above it) rather than a
   *  dedicated full-height view. Without this, an embedded TrackTable's
   *  `h-full` has no bounded ancestor to resolve against, so its "virtualized"
   *  row list silently renders every row as a real DOM node all the time —
   *  functionally unvirtualized, and increasingly expensive to re-render
   *  (e.g. on every drag frame) the larger the list gets. */
  externalScrollRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const playTrack = useStore((s) => s.playTrack);
  const navigateTo = useStore((s) => s.navigateTo);
  const addTrackNext = useStore((s) => s.addTrackNext);
  const openShareDialog = useStore((s) => s.openShareDialog);
  const addTrackToQueue = useStore((s) => s.addTrackToQueue);
  const startRadio = useStore((s) => s.startRadio);
  const currentId = useStore((s) => s.queue[s.currentIndex]?.id);
  const playing = useStore((s) => s.playing);
  const qc = useQueryClient();

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; track: Track } | null>(null);
  const [infoTrack, setInfoTrack] = useState<Track | null>(null);
  const [newPlaylistFor, setNewPlaylistFor] = useState<Track | null>(null);
  const [filterPopup, setFilterPopup] = useState<{ col: string; x: number; y: number } | null>(null);
  const { data: playlists = [] } = useQuery({ queryKey: ["playlists"], queryFn: api.getPlaylists });

  const [internalQuery, setInternalQuery] = useState("");
  const query = serverDriven ? (controlledQuery ?? "") : internalQuery;
  const setQuery = serverDriven ? (onQueryChange ?? (() => {})) : setInternalQuery;

  const [searchOpen, setSearchOpen] = useState(false);
  // A controlled query can arrive from outside (e.g. Spotlight's "Show all N
  // results" link setting Tracks.tsx's query via nav-entry effect) while the
  // box is still collapsed — reveal it so the populated text isn't hidden.
  useEffect(() => { if (controlledQuery) setSearchOpen(true); }, [controlledQuery]);
  const [colOrder, setColOrder] = useState<string[]>(() => loadJSON(LS_ORDER(viewKey), DEFAULT_COL_ORDER));
  const [colVisibility, setColVisibility] = useState<Record<string, boolean>>(() => loadJSON(LS_VIS(viewKey), DEFAULT_COL_VISIBILITY));
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => loadJSON(LS_WIDTHS(viewKey), DEFAULT_COL_WIDTHS));
  const [internalSortState, setInternalSortState] = useState<SortState>(
    () => persistSort ? loadJSON(LS_SORT(viewKey), defaultSort) : defaultSort,
  );
  const sortState = serverDriven ? (controlledSortState ?? null) : internalSortState;

  // Real measured header-label widths (via headerMeasureRef's hidden clone
  // below) — replaces guessed-at-a-glance minWidth constants with the
  // column's actual rendered text width at the table's real header font, so
  // "drag a column down to its minimum" genuinely bottoms out at "just fits
  // the header label," not some approximation of it. COLUMNS[id].minWidth
  // is kept as the fallback for the one frame before this first measures.
  const headerMeasureRef = useRef<HTMLDivElement>(null);
  const [measuredLabelWidths, setMeasuredLabelWidths] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const el = headerMeasureRef.current;
    if (!el) return;
    function measure() {
      const widths: Record<string, number> = {};
      el!.querySelectorAll<HTMLSpanElement>("[data-measure-label]").forEach((span) => {
        // offsetWidth rounds to the nearest integer, not up — a true
        // fractional width of e.g. 43.4px can report as 43, reserving
        // 0.4px too little and tripping text-overflow:ellipsis on that
        // column alone (a real, observed bug: single-pixel-tight columns
        // truncating seemingly at random depending on which way a given
        // label's fractional width happened to round). getBoundingClientRect
        // gives the true fractional value; Math.ceil guarantees the
        // reservation always rounds in the safe direction.
        widths[span.dataset.measureLabel!] = Math.ceil(span.getBoundingClientRect().width);
      });
      setMeasuredLabelWidths(widths);
    }
    measure();
    // Text metrics before the webfont finishes loading reflect the
    // fallback font, not Inter Variable — font-display:swap doesn't fire a
    // layout event of its own to re-trigger a re-measure.
    document.fonts?.ready?.then(measure);
  }, []);
  // A filterable column (year/genre — see filterableCols) always reserves
  // room for its funnel icon (14px + 4px gap) even at rest, not just while
  // actively sorted — the sort arrow's extra room (SORT_ARROW_EXTRA) is
  // handled separately in colBoxWidth below since it's conditional on
  // sortState, not a permanent per-column allowance. Gated on `colValues`
  // too, exactly matching the FilterIcon's own render condition below — a
  // caller can pass filterableCols without colValues (Albums/Playlists/
  // Starred all do, for genre/year), in which case the icon never actually
  // renders at all, and reserving space for it anyway leaves the column
  // permanently padded out with dead space no content ever occupies.
  // HEADER_PADDING (6px each side, actual CSS padding on the header cell
  // below — a real, fixed reservation, not just leftover flex space) is
  // the floor's own breathing room between the label (or, for a filterable
  // column, its trailing icon) and the resize-handle divider.
  //
  // MEASUREMENT_FUDGE exists because the off-screen measurement clone
  // (position:absolute, way outside the viewport) measures narrower than
  // the same text actually renders at on-screen in practice (confirmed via
  // DevTools on a real build: a "NO." span reserved exactly its measured
  // 22px still showed "N…") — and critically, that shortfall isn't a fixed
  // amount, it varies per label, which is exactly what made the padding
  // look inconsistent (2-6px) column to column: whatever the real overshoot
  // was for a given label ate directly into its own reserved padding, by a
  // different amount each time. This needs to be generous enough that it
  // can never eat into HEADER_PADDING at all, for *any* label — a
  // consistent, always-fully-visible 6px matters more here than shaving a
  // few extra px off the reservation.
  const HEADER_PADDING = 6;
  const MEASUREMENT_FUDGE = 6;
  function minWidthFor(id: string): number {
    // track's own floor isn't about fitting its header word ("TRACK") at
    // all — its real content is a 52px cover thumbnail plus stacked
    // title/artist text (see renderCell's "track" case), nothing like
    // every other column's label-only measurement. COLUMNS.track.minWidth
    // is a fixed, hand-picked floor for that instead.
    if (id === "track") return COLUMNS.track.minWidth;
    const label = (measuredLabelWidths[id] ?? COLUMNS[id].minWidth) + MEASUREMENT_FUDGE;
    const iconExtra = filterableCols.includes(id) && colValues ? 4 + 14 : 0;
    return label + iconExtra + HEADER_PADDING * 2;
  }
  // Shared by the header row, its data rows, and the loading skeleton so all
  // three always agree on a column's actual on-screen width — critical since
  // this is a real spreadsheet-style table where the header and its data
  // must land at identical pixel boundaries. Widens a column beyond its
  // stored/minimum width (never shrinks below either) whenever it's the
  // active sort column, so the ▲/▼ arrow appearing next to a MID_COLS label
  // doesn't just cram into the existing space (which would either truncate
  // the label or visibly shift it off the column's true center) — the
  // column grows to fit, and the whole label+arrow group stays centered
  // within that wider box.
  const SORT_ARROW_EXTRA = 16;
  function colBoxWidth(id: string): number {
    // Math.max, not `??` — a manual resize saved before minWidthFor()'s
    // own formula changed (e.g. today's Math.ceil() rounding fix) freezes
    // in whatever the old, possibly-too-small floor was forever, since
    // colWidths[id] is then permanently defined and `??` never falls back
    // to the corrected minWidthFor() again. Clamping up here instead makes
    // "never below the true current minimum" a real invariant enforced on
    // every render, not just at the moment of a resize drag — a stale
    // saved width can only ever get pulled up to the safe floor, never
    // silently stay under it.
    const base = Math.max(colWidths[id] ?? 0, minWidthFor(id));
    return sortState?.col === id ? base + SORT_ARROW_EXTRA : base;
  }
  function applySortState(next: SortState) {
    if (persistSort) saveJSON(LS_SORT(viewKey), next);
    if (serverDriven) onSortChange?.(next);
    else setInternalSortState(next);
  }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  const clickCountRef = useRef(1);
  const justDraggedHeaderRef = useRef(false);
  const colWidthsRef = useRef(colWidths);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);

  const pickerRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  // How far parentRef's own top sits below externalScrollRef's scrollable
  // content top (TanStack Virtual's `scrollMargin`) — needed because the
  // table isn't flush against the scroll container's top in a host like
  // Starred.tsx (carousels render above it), so translating scrollTop into
  // "which rows are visible" has to account for that offset. Measured via
  // getBoundingClientRect (viewport-relative, so it already reflects
  // current scroll position) rather than offsetTop, which would need every
  // intermediate ancestor to share the same offsetParent chain — not
  // guaranteed through Starred's carousel wrappers.
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const scrollEl = externalScrollRef?.current;
    const rowsEl = parentRef.current;
    if (!scrollEl || !rowsEl) return;
    function measure() {
      setScrollMargin(rowsEl!.getBoundingClientRect().top - scrollEl!.getBoundingClientRect().top + scrollEl!.scrollTop);
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
    ro.observe(rowsEl);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalScrollRef, loading, tracks.length]);

  // ── Drag-to-reorder (see reorderable/onReorder prop docs above) — natural
  // order only, same manual mousedown/mousemove/mouseup mechanics as the
  // Queue panel's own drag-reorder.
  const reorderActive = reorderable && !showDiscHeaders && !sortState && !query.trim();
  const dropIndexRef = useRef<number | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [ghostY, setGhostY] = useState<number | null>(null);

  function handleGripMouseDown(trackId: string) {
    return (e: React.MouseEvent) => {
      // Now that this listens on the whole row (not just the grip column),
      // a right-click anywhere on it would otherwise also start a drag
      // alongside opening the context menu — left-click only.
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      setDragId(trackId);
      dropIndexRef.current = null;
      document.body.style.userSelect = "none";

      function onMove(ev: MouseEvent) {
        const listEl = parentRef.current;
        if (!listEl) return;
        const listRect = listEl.getBoundingClientRect();
        const relY = ev.clientY - listRect.top + listEl.scrollTop;
        setGhostY(relY);
        const rawIndex = relY / TRACK_ROW_HEIGHT;
        const index = Math.floor(rawIndex);
        const fraction = rawIndex - index;
        const insertIndex = Math.max(0, Math.min(sorted.length, fraction > 0.5 ? index + 1 : index));
        dropIndexRef.current = insertIndex;
        setDropIndex(insertIndex);
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        if (dropIndexRef.current !== null) onReorder?.(trackId, dropIndexRef.current);
        setDragId(null);
        setDropIndex(null);
        setGhostY(null);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  useEffect(() => {
    if (parentRef.current) parentRef.current.scrollTop = 0;
  }, [pagination?.page]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const filtered = serverDriven || !query.trim()
    ? tracks
    : tracks.filter((t) => {
        const q = query.toLowerCase();
        return t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || (t.album ?? "").toLowerCase().includes(q);
      });

  const bpmCache = useStore((s) => s.bpmCache);
  const sorted = React.useMemo(
    () => serverDriven || !sortState ? filtered : sortTracks(filtered, sortState.col, sortState.dir, bpmCache),
    [filtered, sortState, serverDriven, bpmCache],
  );

  // Disc separators only make sense in natural (unsorted, unfiltered) order —
  // a search or column sort flattens the list, matching the old app's rule.
  const showHeadersNow = showDiscHeaders && !sortState && !query.trim();
  const displayRows = React.useMemo(() => {
    if (!showHeadersNow) {
      return sorted.map((track, trackIndex): DisplayRow => ({ kind: "track", track, trackIndex }));
    }
    const hasMultipleDiscs = new Set(sorted.map((t) => t.disc_number)).size > 1;
    if (!hasMultipleDiscs) {
      return sorted.map((track, trackIndex): DisplayRow => ({ kind: "track", track, trackIndex }));
    }
    const rows: DisplayRow[] = [];
    let lastDisc: number | null = null;
    sorted.forEach((track, trackIndex) => {
      if (track.disc_number !== lastDisc) {
        rows.push({ kind: "discHeader", discNumber: track.disc_number });
        lastDisc = track.disc_number;
      }
      rows.push({ kind: "track", track, trackIndex });
    });
    return rows;
  }, [sorted, showHeadersNow]);

  const visibleCols = colOrder.filter((id) => id === "track" || colVisibility[id]);

  function handleSort(colId: string) {
    // A column-resize or column-reorder drag ends with the mouse wherever
    // it happened to be released — the browser's native "click" still
    // fires on the header itself afterward regardless of which one just
    // happened. justDraggedHeaderRef (set by both onResizeStart's onMove
    // and the reorder drag's onMove below, cleared here) swallows that one
    // spurious click without needing to guess a distance/time threshold.
    if (justDraggedHeaderRef.current) { justDraggedHeaderRef.current = false; return; }
    const def = COLUMNS[colId];
    if (!def.sortable) return;
    let next: SortState;
    if (!sortState || sortState.col !== colId) {
      next = { col: colId, dir: def.descFirst ? "desc" : "asc" };
      clickCountRef.current = 1;
    } else if (clickCountRef.current === 1) {
      next = { col: colId, dir: sortState.dir === "asc" ? "desc" : "asc" };
      clickCountRef.current = 2;
    } else {
      next = defaultSort;
      clickCountRef.current = defaultSort ? 1 : 0;
    }
    applySortState(next);
  }

  function toggleColumn(colId: string) {
    setColVisibility((prev) => {
      const next = { ...prev, [colId]: !prev[colId] };
      saveJSON(LS_VIS(viewKey), next);
      return next;
    });
  }

  // ── Column resize ──
  function onResizeStart(e: React.MouseEvent, colId: string) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    // Read the column's *actual* rendered width off the DOM rather than
    // assuming colWidths/minWidthFor matches it — for every other column
    // those always agree (flex: 0 0 <width>px, no grow involved), but
    // track is flex-grow:1 (auto-filling leftover space), so its real
    // on-screen width is usually much larger than minWidthFor's 220px
    // floor.
    const headerCell = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-col-header]");
    const startWidth = headerCell?.getBoundingClientRect().width ?? colWidthsRef.current[colId] ?? minWidthFor(colId);

    // track never gets its own stored width — it stays permanently
    // flex-grow:1, silently absorbing whatever space every other
    // (fixed-width) column doesn't use, which is what keeps the whole row
    // filling the container exactly, with no gap or overflow, for *every*
    // column's resize, not just track's. So dragging track's own handle
    // doesn't set a width on track at all: it resizes its neighbor (the
    // next visible column) in the opposite direction instead — shrinking
    // the neighbor hands track that space to grow into; growing the
    // neighbor takes space away from what's left for track to fill,
    // shrinking track by the same amount as a pure side effect of
    // flexbox's own leftover-space math, never set directly.
    const isTrackResize = colId === "track";
    const targetId = isTrackResize ? visibleCols[visibleCols.indexOf(colId) + 1] : colId;
    if (!targetId) return; // track has no neighbor to trade width with
    const targetStartWidth = isTrackResize ? (colWidthsRef.current[targetId] ?? minWidthFor(targetId)) : startWidth;
    const trackFloor = isTrackResize ? minWidthFor("track") : 0;

    function onMove(ev: MouseEvent) {
      justDraggedHeaderRef.current = true;
      const rawDelta = ev.clientX - startX;
      if (isTrackResize) {
        // Dragging track's handle right grows track (matches the
        // direction every other column's own handle already works in),
        // which means its neighbor shrinks by that same amount — the
        // opposite sign of a normal, direct resize.
        const maxNeighborWidth = targetStartWidth + (startWidth - trackFloor); // caps how much the neighbor can grow before track would dip below its own floor
        const width = Math.min(maxNeighborWidth, Math.max(minWidthFor(targetId), targetStartWidth - rawDelta));
        setColWidths((prev) => ({ ...prev, [targetId]: width }));
      } else {
        const width = Math.max(minWidthFor(targetId), targetStartWidth + rawDelta);
        setColWidths((prev) => ({ ...prev, [targetId]: width }));
      }
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      saveJSON(LS_WIDTHS(viewKey), colWidthsRef.current);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ── Column drag-reorder ──
  // Manual mousedown/mousemove/mouseup instead of native HTML5 draggable —
  // same reasoning as the row-reorder drag below: native dragover only
  // fires at a throttled rate, which made the old live column-swap
  // visibly pop between positions instead of tracking the cursor
  // smoothly. Locked to the horizontal axis (the ghost only ever follows
  // cursor X, staying pinned to the header row's own vertical position)
  // and styled identically to QueuePanel's row-reorder ghost/indicator
  // (accent border, translucent panel background) — same UX language,
  // just rotated 90°.
  const headerRowRef = useRef<HTMLDivElement>(null);
  const dropColIndexRef = useRef<number | null>(null);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dropColIndex, setDropColIndex] = useState<number | null>(null);
  const [ghostX, setGhostX] = useState<number | null>(null);
  const [indicatorX, setIndicatorX] = useState<number | null>(null);

  function handleHeaderMouseDown(colId: string) {
    return (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      setDragColId(colId);
      dropColIndexRef.current = null;
      document.body.style.userSelect = "none";

      function onMove(ev: MouseEvent) {
        justDraggedHeaderRef.current = true;
        const rowEl = headerRowRef.current;
        if (!rowEl) return;
        const rowRect = rowEl.getBoundingClientRect();
        setGhostX(ev.clientX - rowRect.left);

        // Hit-test real column boundaries (widths vary per column, unlike
        // the row-reorder's uniform ROW_HEIGHT below, so this can't just
        // divide position by a constant) — whichever column's midpoint the
        // cursor hasn't reached yet is the insertion point.
        const cells = Array.from(rowEl.querySelectorAll<HTMLElement>("[data-col-header]"));
        let insertIndex = cells.length;
        let boundaryX = cells.length > 0 ? cells[cells.length - 1].getBoundingClientRect().right - rowRect.left : 0;
        for (let i = 0; i < cells.length; i++) {
          const r = cells[i].getBoundingClientRect();
          if (ev.clientX < r.left + r.width / 2) {
            insertIndex = i;
            boundaryX = r.left - rowRect.left;
            break;
          }
        }
        dropColIndexRef.current = insertIndex;
        setDropColIndex(insertIndex);
        setIndicatorX(boundaryX);
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        const target = dropColIndexRef.current;
        if (target !== null) {
          setColOrder((prev) => {
            const from = prev.indexOf(colId);
            if (from === -1) return prev;
            // `target` is an index into visibleCols — onMove's hit-test
            // above only ever sees rendered (i.e. visible) header cells —
            // not into `prev`, which also contains any hidden columns.
            // Resolve it to the boundary column's real position in the
            // full order first, rather than reusing the visible-only index
            // directly against `prev`: with any column hidden, the two
            // index spaces diverge and drops land in the wrong place.
            const boundaryId = target < visibleCols.length ? visibleCols[target] : null;
            if (boundaryId === colId) return prev; // dropped back onto itself — no-op
            const boundaryIndex = boundaryId ? prev.indexOf(boundaryId) : prev.length;
            const next = [...prev];
            next.splice(from, 1);
            // Removing `from` shifts every index after it back by one, so
            // the boundary index needs the same adjustment before re-inserting.
            const adjusted = from < boundaryIndex ? boundaryIndex - 1 : boundaryIndex;
            next.splice(Math.max(0, Math.min(next.length, adjusted)), 0, colId);
            saveJSON(LS_ORDER(viewKey), next);
            return next;
          });
        }
        setDragColId(null);
        setDropColIndex(null);
        setGhostX(null);
        setIndicatorX(null);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
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

  // ── Right-click context menu ── (matches the old app's ShadowContextMenu on
  // TrackListView.qml — Play Now / Play Next / Add to Queue / Go to Artist /
  // Start Radio / Add to Playlist / Filter by / Get Info / Add to Favorites)
  function handleRowContextMenu(e: React.MouseEvent, track: Track) {
    e.preventDefault();
    if (!selected.has(track.id)) setSelected(new Set([track.id]));
    setCtxMenu({ x: e.clientX, y: e.clientY, track });
  }

  async function toggleFavoriteFromMenu(track: Track) {
    try {
      await api.setFavorite(track.id, !track.starred, "id");
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "album-tracks" || q.queryKey[0] === "tracks-native" || q.queryKey[0] === "starred" });
    } catch { /* best-effort — row will just show the stale state until next fetch */ }
  }

  async function addToExistingPlaylist(playlistId: string, track: Track) {
    await api.addTracksToPlaylist(playlistId, [track.id]);
    qc.invalidateQueries({ queryKey: ["playlists"] });
  }

  async function createPlaylistAndAdd(name: string) {
    const track = newPlaylistFor;
    setNewPlaylistFor(null);
    if (!track) return;
    const playlist = await api.createPlaylist(name);
    await api.addTracksToPlaylist(playlist.id, [track.id]);
    qc.invalidateQueries({ queryKey: ["playlists"] });
  }

  // ── Unique: Filter by album/artist ── (matches the old app's
  // tracks_browser.py:2796-2815 "Filter by" submenu — only shown where
  // Excel-style column filters actually exist, i.e. filterableCols/
  // onFilterChange are wired up (the Tracks screen, not album detail).
  function buildFilterByItems(track: Track): MenuItem[] {
    const items: MenuItem[] = [];
    if (filterableCols.includes("album") && onFilterChange && track.album) {
      items.push({ label: `Album: ${track.album}`, icon: "img/album.png", onClick: () => onFilterChange("album", new Set([track.album!])) });
    }
    if (filterableCols.includes("artist") && onFilterChange && track.artist) {
      const names = track.artist.split(ARTIST_SEP_RE)
        .filter((part) => part.trim() && !ARTIST_SEP_RE.test(part))
        .map((part) => part.trim());
      for (const name of names) {
        items.push({ label: `Artist: ${name}`, icon: "img/sub_artist.png", onClick: () => onFilterChange("artist", new Set([name])) });
      }
    }
    return items;
  }

  function buildTrackMenu(track: Track): MenuEntry[] {
    const filterByItems = buildFilterByItems(track);
    return [
      { label: "Play Now", icon: "img/sub_play.png", onClick: () => playTrack(track, [track]) },
      { label: "Play Next", icon: "img/sub_next.png", onClick: () => addTrackNext(track) },
      { label: "Add to Queue", icon: "img/queue.png", onClick: () => addTrackToQueue(track) },
      { label: "Go to Artist", icon: "img/sub_artist.png", disabled: !track.artist_id, onClick: () => track.artist_id && navigateTo({ tab: "artists", artistId: track.artist_id }) },
      { label: "Start Radio", icon: "img/radio.png", onClick: () => startRadio(track) },
      {
        label: "Add to Playlist", icon: "img/playlist.png",
        submenu: [
          { label: "New Playlist…", icon: "img/add.png", onClick: () => setNewPlaylistFor(track) },
          ...playlists.map((p) => ({
            label: `${p.name}  (${p.song_count})`,
            icon: "img/playlist.png",
            onClick: () => addToExistingPlaylist(p.id, track),
          })),
        ],
      },
      ...(filterByItems.length ? [{ label: "Filter by", icon: "img/filter.png", submenu: filterByItems }] : []),
      { label: "Get Info", icon: "img/info.png", onClick: () => setInfoTrack(track) },
      {
        label: track.starred ? "Remove from Favorites" : "Add to Favorites",
        icon: track.starred ? "img/heart_filled.png" : "img/heart.png",
        color: FAVORITE_PINK,
        onClick: () => toggleFavoriteFromMenu(track),
      },
      { label: "Share", icon: "img/share.png", onClick: () => openShareDialog({ id: track.id, type: "song", name: track.title }) },
      ...(extraMenuItems ? extraMenuItems(track) : []),
    ];
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

  function renderCell(colId: string, t: Track, isPlaying: boolean) {
    switch (colId) {
      case "track":
        return (
          <div className="flex items-center min-w-0" style={{ gap: 12, flex: 1 }}>
            <CoverArt coverId={t.cover_id} size={52} className="shrink-0 w-[52px] h-[52px] rounded-[3px]" />
            <div className="min-w-0 flex-1">
              <p className="truncate" style={{ color: isPlaying ? "var(--accent)" : "var(--text-primary)", fontSize: "var(--fs-primary)", fontWeight: "var(--fw-emphasis)" }}>{t.title}</p>
              <ArtistTokens name={t.artist} artistId={t.artist_id} fontSize="var(--fs-secondary)" />
            </div>
          </div>
        );
      case "title":
        return <span className="truncate" style={{ color: isPlaying ? "var(--accent)" : "var(--text-primary)", fontSize: "var(--fs-primary)", fontWeight: "var(--fw-emphasis)" }}>{t.title}</span>;
      case "artist":
        return <ArtistTokens name={t.artist} artistId={t.artist_id} />;
      case "album":
        // HoverToken renders a plain <span> — `overflow`/`text-overflow`
        // (what `truncate` sets) have no clipping effect on an inline
        // element, only on a block/inline-block one, so passing
        // className="truncate" straight to it never actually ellipsized
        // long album names. Wrapping it in a block-level div (which fills
        // the already width-constrained data cell) gives text-overflow
        // something it can actually apply to.
        return t.album ? (
          <div className="truncate">
            <HoverToken
              text={t.album}
              clickable
              onClick={() => openAlbum(t)}
              onHover={() => prefetchAlbum(t)}
            />
          </div>
        ) : null;
      case "fav":
        return <FavoriteHeart track={t} />;
      case "genre": {
        // Each genre token is independently clickable — matches
        // trackGenreClicked(genre) applying a genre column filter for just
        // that one value (_apply_col_filter(6, {genre})), only wired up
        // where the Excel-style filters actually exist (the Tracks screen;
        // album detail doesn't pass filterableCols/onFilterChange).
        const canFilter = filterableCols.includes("genre") && Boolean(onFilterChange);
        const parts = (t.genre ?? "").split(GENRE_SEP_RE).map((s) => s.trim()).filter(Boolean);
        if (!parts.length) return null;
        // div, not span — same reason as the "album" case above: a plain
        // inline span never actually clips/ellipsizes regardless of the
        // truncate class, only a block-level element does.
        return (
          <div className="truncate">
            {parts.map((g, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span style={{ color: "var(--text-secondary)", opacity: 0.4, fontSize: "var(--fs-secondary)" }}> • </span>}
                <HoverToken text={g} clickable={canFilter} onClick={() => onFilterChange?.("genre", new Set([g]))} />
              </React.Fragment>
            ))}
          </div>
        );
      }
      case "dur":
        return <span className="tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{fmtDuration(t.duration_secs)}</span>;
      case "plays":
        return <span className="tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{fmtPlays(t.play_count)}</span>;
      case "trackno":
        return <span className="tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{t.track_number || ""}</span>;
      case "year": {
        // Matches trackYearClicked(year) → _apply_col_filter(5, {year}) —
        // same Tracks-screen-only gating as genre above.
        const canFilterYear = filterableCols.includes("year") && Boolean(onFilterChange) && Boolean(t.year);
        return t.year ? (
          <HoverToken
            text={String(t.year)}
            clickable={canFilterYear}
            onClick={() => onFilterChange?.("year", new Set([String(t.year)]))}
            className="tabular-nums"
          />
        ) : null;
      }
      case "date":
        return <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{fmtDate(t.created)}</span>;
      case "bpm":
        return <span className="tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{fmtBpm(bpmCache[t.id] ?? t.bpm)}</span>;
      default:
        return null;
    }
  }

  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => externalScrollRef?.current ?? parentRef.current,
    estimateSize: (i) => displayRows[i].kind === "discHeader" ? 36 : 58,
    overscan: 10,
    scrollMargin: externalScrollRef ? scrollMargin : 0,
  });
  // virtualItem.start bakes scrollMargin into every offset (it's measured
  // from the *scroll element's* top) — subtract it back out to get each
  // row's position local to this table's own row-list container, which
  // itself already sits scrollMargin px down the page.
  const rowTopOffset = externalScrollRef ? scrollMargin : 0;

  return (
    <>
    {/* h-full only when self-scrolling — with an externalScrollRef, this
        card has no bounded height of its own at all: it just grows to fit
        its full content (toolbar + header + every row's real total height),
        the same way the rest of the host page's content does, and the
        ancestor scroll container handles all the actual scrolling. Without
        this, h-full has no defined parent height to resolve against inside
        a host like Starred.tsx, collapses to "auto" all the way down
        through flex-1/height:100% below, and — more importantly — silently
        defeats row virtualization entirely (see externalScrollRef's doc
        comment). */}
    <div className={externalScrollRef ? "flex flex-col" : "flex flex-col h-full"} style={{ borderRadius: 10, background: "var(--card-bg)", border: "1px solid var(--border)", overflow: "hidden" }}>
      {/* Toolbar */}
      <div className="flex items-center shrink-0" style={{ height: 36, padding: "0 20px", gap: 8, marginTop: 12 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center" }}>{toolbarLeft}</div>

        <SearchBox
          open={searchOpen}
          onToggle={() => setSearchOpen((v) => !v)}
          value={query}
          onChange={setQuery}
          placeholder="Search tracks…"
          scope={searchScope}
          scopeOptions={searchScopeOptions}
          onScopeChange={onSearchScopeChange}
        />
        {toolbarRight}
        <div ref={pickerRef} style={{ position: "relative" }}>
          <IconBtn src="img/burger.png" active={pickerOpen} title="Columns" onClick={() => setPickerOpen((v) => !v)} />
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
                    width: "100%", margin: 0, padding: "5px 20px 5px 12px", textAlign: "left",
                    background: "transparent", border: "none", cursor: "pointer",
                    color: "var(--text-secondary)", fontSize: "var(--fs-primary)", fontWeight: "var(--fw-primary)",
                    borderRadius: 4, boxSizing: "border-box",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Icon src="img/yes.png" size={12} style={{ background: "var(--accent)", opacity: colVisibility[id] ? 1 : 0 }} />
                  {MENU_LABELS[id]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Hidden, unconstrained clone of every header label purely for
          measuring its real rendered width (see minWidthFor()) — off-screen
          rather than display:none/visibility:hidden alone, since either can
          report 0 offsetWidth in some layout paths. Uses the exact same
          span styling as the real headers below so the measurement is
          pixel-accurate to what's actually on screen. */}
      <div ref={headerMeasureRef} aria-hidden style={{ position: "absolute", top: -9999, left: -9999 }}>
        {Object.values(COLUMNS).map((col) => (
          <span
            key={col.id}
            data-measure-label={col.id}
            style={{ fontSize: "var(--fs-small)", fontWeight: "var(--fw-emphasis)", letterSpacing: 0.8, whiteSpace: "nowrap" }}
          >
            {col.label}
          </span>
        ))}
      </div>

      {/* Column headers */}
      {/* gap: 0, not the row's old 12px — each column's own 3px+3px padding
          (see minWidthFor()) is already the entire promised "3px both sides"
          spacing; a 12px flex-gap on top of that meant the real distance
          between two columns' text was 3+12+3=18px, not 3+3=6px, no matter
          how tightly each individual column's own box was sized. Must stay
          in sync with the data rows' own gap below (same reasoning: header
          and data columns need identical pixel boundaries). */}
      <div ref={headerRowRef} className="flex items-center shrink-0" style={{ position: "relative", height: 36, padding: "0 24px", gap: 0 }}>
        <div style={{ flex: `0 0 ${NUM_COL_WIDTH}px`, marginLeft: -NUM_COL_SHIFT, marginRight: NUM_COL_SHIFT, display: "flex", justifyContent: "center" }}>
          <span style={{ fontSize: "var(--fs-small)", fontWeight: "var(--fw-emphasis)", letterSpacing: 0.8, color: "var(--text-secondary)" }}>#</span>
        </div>
        {visibleCols.map((id) => {
          const col = COLUMNS[id];
          const isTrack = id === "track";
          return (
            <div
              key={id}
              data-col-header
              onMouseDown={handleHeaderMouseDown(id)}
              onClick={() => handleSort(id)}
              style={{
                position: "relative",
                opacity: dragColId === id ? 0.3 : 1,
                // track is permanently flex-grow:1 — it always absorbs
                // whatever space every other (fixed-width) column doesn't
                // use, which is what keeps the row filling the container
                // exactly. Its own resize handle doesn't touch this at
                // all; see onResizeStart's comment — dragging it instead
                // resizes the neighbor column, and track's rendered width
                // changes as a side effect of that.
                flex: isTrack ? 1 : `0 0 ${colBoxWidth(id)}px`,
                minWidth: 0,
                boxSizing: "border-box",
                // Explicit padding, not just leftover flex space, is what
                // actually guarantees "text sits HEADER_PADDING from the
                // separator on both sides" — justifyContent:"center"
                // distributes slack evenly on its own, but flex-start
                // (title/artist/album, left-aligned) shoves content flush
                // to the box's left edge with zero gap and dumps all the
                // slack on the right instead. minWidthFor() assumes this
                // padding is what's consuming its own reserved space;
                // box-sizing: border-box keeps the flex-basis width (and
                // therefore the resize-handle divider's position) unchanged
                // by it.
                padding: `0 ${HEADER_PADDING}px`,
                // track/title/artist/album (the free-text columns, i.e.
                // everything NOT in MID_COLS) are deliberately left-aligned,
                // matching how their own data cells read below — a left-
                // aligned column naturally shows more room on the right
                // than the left whenever the box has any slack at all
                // (MEASUREMENT_FUDGE's safety margin included); that's just
                // what left-alignment looks like, not the lopsided-center
                // bug this used to be before HEADER_PADDING/FUDGE existed.
                display: "flex", alignItems: "center", justifyContent: MID_COLS.has(id) ? "center" : "flex-start", gap: 4,
                cursor: col.sortable ? "pointer" : "default",
                userSelect: "none",
              }}
            >
              <span className="truncate" style={{ fontSize: "var(--fs-small)", fontWeight: "var(--fw-emphasis)", letterSpacing: 0.8, color: "var(--text-secondary)" }}>
                {col.label}
              </span>
              {sortState?.col === id && (
                <span style={{ color: "var(--accent)", fontSize: "var(--fs-small)" }}>{sortState.dir === "asc" ? "▲" : "▼"}</span>
              )}
              {filterableCols.includes(id) && colValues && (
                <FilterIcon
                  active={Boolean(colFilters?.[id]?.size)}
                  onClick={(e) => {
                    e.stopPropagation(); // don't also trigger handleSort(id)
                    if (filterPopup?.col === id) {
                      setFilterPopup(null); // clicking the open column's icon again closes it
                      return;
                    }
                    const rect = e.currentTarget.closest<HTMLElement>("[data-col-header]")!.getBoundingClientRect();
                    setFilterPopup({ col: id, x: rect.left, y: rect.bottom });
                  }}
                />
              )}
              {/* track gets a handle too now that it has a real adjustable
                  basis width (see the flex comment above), not just every
                  other column. right:-4, width:8 (was -6/12, sized for the
                  row's old 12px gap) — straddles the boundary between this
                  column and the next now that they sit directly adjacent
                  (gap:0), extending 4px into each side's own padding rather
                  than centering in a gap that no longer exists. */}
              <div
                onMouseDown={(e) => onResizeStart(e, id)}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center justify-center"
                style={{ position: "absolute", right: -4, top: 0, bottom: 0, width: 8, cursor: "col-resize" }}
              >
                <div style={{ width: 1, height: "50%", background: "var(--text-primary)" }} />
              </div>
            </div>
          );
        })}
        {/* Insertion-point indicator — vertical accent line + dot, the
            same shape as QueuePanel's InsertionIndicator just rotated 90°
            for a horizontal column reorder instead of a vertical row one. */}
        {dragColId && dropColIndex !== null && indicatorX !== null && (
          <div style={{ position: "absolute", left: indicatorX, top: 4, bottom: 4, width: 0, pointerEvents: "none" }}>
            <div style={{ position: "absolute", left: -4, top: -4, width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />
            <div style={{ position: "absolute", left: -1, top: 0, bottom: 0, width: 2, background: "var(--accent)" }} />
          </div>
        )}
        {/* Floating ghost that follows the cursor's X position while
            dragging — locked to the horizontal axis (only `left` ever
            changes; it stays pinned to the header row's own height/Y) and
            styled identically to QueuePanel's GhostRow: lighter panel
            background, accent border, radius 6, 0.8 opacity. */}
        {dragColId && ghostX !== null && (
          <div
            style={{
              position: "absolute", top: 0, height: 36,
              left: ghostX - colBoxWidth(dragColId) / 2, width: colBoxWidth(dragColId),
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "color-mix(in srgb, var(--panel-bg) 95%, white)",
              border: "1px solid var(--accent)", borderRadius: 6, opacity: 0.8,
              pointerEvents: "none", zIndex: 20,
            }}
          >
            <span style={{ fontSize: "var(--fs-small)", fontWeight: "var(--fw-emphasis)", letterSpacing: 0.8, color: "var(--text-primary)" }}>
              {COLUMNS[dragColId].label}
            </span>
          </div>
        )}
      </div>

      {/* Rows */}
      <div className="flex-1" style={{ position: "relative", minHeight: 0 }}>
      <div ref={parentRef} className="scroll-clean" tabIndex={0} onKeyDown={handleKeyDown} style={{ height: "100%", borderTop: "1px solid var(--border)", position: "relative" }}>
        {loading && displayRows.length === 0 && Array.from({ length: 12 }, (_, i) => (
          <SkeletonTrackRow
            key={i}
            numColWidth={NUM_COL_WIDTH}
            columns={visibleCols.map((id) => ({
              id,
              width: colBoxWidth(id),
              centered: MID_COLS.has(id),
            }))}
          />
        ))}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((row) => {
            const displayRow = displayRows[row.index];

            if (displayRow.kind === "discHeader") {
              return (
                <div
                  key={`disc-${displayRow.discNumber}`}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute", top: row.start - rowTopOffset, left: 0, right: 0, height: 36,
                    display: "flex", alignItems: "center", padding: "0 24px",
                  }}
                >
                  <span style={{ marginLeft: NUM_COL_WIDTH, color: "var(--text-secondary)", fontWeight: "var(--fw-emphasis)", fontSize: "var(--fs-secondary)" }}>
                    Disc {displayRow.discNumber}
                  </span>
                </div>
              );
            }

            const { track: t, trackIndex } = displayRow;
            const isPlaying = t.id === currentId;
            const isSelected = selected.has(t.id);
            return (
              <div
                key={t.id}
                data-index={row.index}
                ref={virtualizer.measureElement}
                onClick={(e) => handleRowClick(e, t, trackIndex)}
                onDoubleClick={() => handleRowDoubleClick(t)}
                onContextMenu={(e) => handleRowContextMenu(e, t)}
                // The grip icon (.track-num-grip below) only appears on
                // hover via CSS, but once it's showing, the whole row is a
                // drag handle, not just its own small column — same as
                // QueuePanel.tsx's row. Plain clicks/double-clicks still
                // work fine alongside this: a mousedown+mouseup with no
                // real pointer movement never sets dropIndexRef (see
                // handleGripMouseDown above), so it doesn't trigger a
                // reorder.
                onMouseDown={reorderActive ? handleGripMouseDown(t.id) : undefined}
                className={reorderActive ? "reorder-row" : undefined}
                style={{
                  position: "absolute", top: row.start - rowTopOffset, left: 0, right: 0, height: 58,
                  // gap: 0 — must match the header row's own gap (see its
                  // comment) so header and data columns land on identical
                  // pixel boundaries.
                  display: "flex", alignItems: "center", gap: 0,
                  padding: "0 24px", cursor: "pointer",
                  background: isPlaying
                    ? "color-mix(in srgb, var(--accent) 15%, transparent)"
                    : isSelected
                      ? "var(--hover-bg)"
                      : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!isPlaying && !isSelected) e.currentTarget.style.background = "var(--hover-bg)";
                  // Inline styles beat CSS regardless of specificity, so the
                  // unconditional cursor:"pointer" above would otherwise
                  // permanently shadow a .reorder-row:hover CSS rule — has
                  // to be set imperatively here instead, same reason the
                  // hover background above is too (this row is virtualized;
                  // React state here would re-render the whole list on
                  // every hover change).
                  if (reorderActive) e.currentTarget.style.cursor = "grab";
                }}
                onMouseLeave={(e) => {
                  if (!isPlaying && !isSelected) e.currentTarget.style.background = "transparent";
                  if (reorderActive) e.currentTarget.style.cursor = "pointer";
                }}
              >
                <div
                  style={{ flex: `0 0 ${NUM_COL_WIDTH}px`, marginLeft: -NUM_COL_SHIFT, marginRight: NUM_COL_SHIFT, position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  {reorderActive && (
                    <div className="track-num-grip" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <GripDots />
                    </div>
                  )}
                  <div className={reorderActive ? "track-num-plain" : undefined} style={{ position: reorderActive ? "absolute" : undefined, inset: reorderActive ? 0 : undefined, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {isPlaying && playing ? <PlayingBars /> : (
                      <span className="tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>
                        {numColSource === "position" ? numColOffset + trackIndex + 1 : (t.track_number || "")}
                      </span>
                    )}
                  </div>
                </div>
                {visibleCols.map((id) => (
                  <div
                    key={id}
                    style={{
                      // Must match the header cell's own flex exactly —
                      // track is permanently flex-grow:1 (see its comment
                      // there and onResizeStart's).
                      flex: id === "track" ? 1 : `0 0 ${colBoxWidth(id)}px`,
                      minWidth: 0, overflow: "hidden",
                      ...(MID_COLS.has(id) ? { display: "flex", justifyContent: "center" } : {}),
                    }}
                  >
                    {renderCell(id, t, isPlaying)}
                  </div>
                ))}
              </div>
            );
          })}
          {dragId && dropIndex !== null && (
            <div style={{ position: "absolute", top: dropIndex * TRACK_ROW_HEIGHT, left: 0, right: 0 }}>
              <InsertionIndicator />
            </div>
          )}
        </div>
        {dragId && ghostY !== null && (() => {
          const draggedTrack = sorted.find((t) => t.id === dragId);
          return draggedTrack ? <GhostRow track={draggedTrack} y={ghostY} /> : null;
        })()}
      </div>
      {/* Not in external-scroll mode — the host already renders its own
          ScrollThumb for the whole page (e.g. Starred.tsx); parentRef
          itself never actually scrolls in that mode, so this would just be
          an inert duplicate. */}
      {!externalScrollRef && <ScrollThumb scrollRef={parentRef} />}
      </div>

      {pagination && (
        <div className="flex items-center shrink-0" style={{ height: 44, gap: 5, paddingLeft: 15, borderTop: "1px solid var(--border)" }}>
          <PageBtn arrow onClick={() => pagination.onPageChange(pagination.page - 1)} disabled={pagination.page <= 1}>‹</PageBtn>
          {pageNumbers(pagination.page, pagination.totalPages).map((p, i) =>
            p === null ? (
              <div key={`pad-${i}`} style={{ width: 32, height: 32 }} />
            ) : p === "..." ? (
              <div key={`ellipsis-${i}`} className="flex items-center justify-center" style={{ width: 32, height: 32, color: "var(--text-secondary)", fontSize: "var(--fs-primary)", opacity: 0.6 }}>…</div>
            ) : (
              <PageBtn key={p} onClick={() => pagination.onPageChange(p)} active={p === pagination.page}>{p}</PageBtn>
            ),
          )}
          <PageBtn arrow onClick={() => pagination.onPageChange(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}>›</PageBtn>
        </div>
      )}
    </div>

    {ctxMenu && (
      <ContextMenu
        x={ctxMenu.x}
        y={ctxMenu.y}
        items={buildTrackMenu(ctxMenu.track)}
        onClose={() => setCtxMenu(null)}
      />
    )}
    {filterPopup && (() => {
      // Cascading: once some *other* column already has an active filter,
      // this popup's own value list narrows to whatever actually occurs in
      // the currently-loaded (already server-filtered) tracks instead of
      // the full library-wide list — matches _open_filter_popup's
      // other_filters_active check.
      const otherActive = Object.entries(colFilters ?? {}).some(([c, v]) => c !== filterPopup.col && v.size > 0);
      const values = otherActive ? deriveFilterValues(tracks, filterPopup.col) : (colValues?.[filterPopup.col] ?? []);
      return (
        <ColumnFilterPopup
          x={filterPopup.x}
          y={filterPopup.y}
          allValues={values}
          activeValues={colFilters?.[filterPopup.col] ?? new Set()}
          isIdBased={filterPopup.col !== "year"}
          onApply={(values) => onFilterChange?.(filterPopup.col, values)}
          onSort={(dir) => { clickCountRef.current = 1; applySortState({ col: filterPopup.col, dir }); }}
          onClose={() => setFilterPopup(null)}
        />
      );
    })()}
    {infoTrack && <TrackInfoDialog track={infoTrack} onClose={() => setInfoTrack(null)} />}
    {newPlaylistFor && (
      <PromptDialog
        title="New Playlist"
        placeholder="Playlist name"
        confirmLabel="Create"
        onSubmit={createPlaylistAndAdd}
        onCancel={() => setNewPlaylistFor(null)}
      />
    )}
    </>
  );
}

// Always returns exactly SLOTS (7) items (padding with null only for the
// total<=7 edge case) — matching the old app's TrackListView.qml, whose
// pagination row is always exactly 7 fixed-size boxes. Standard adaptive
// 3-mode scheme so it stays at exactly 7 in every case, including the
// middle of a large range (a naive fixed window there can need up to 9:
// leading "1 …" + a window around current + trailing "… total"):
//   near start:  1 2 3 4 5 … total
//   near end:    1 … total-4 total-3 total-2 total-1 total
//   middle:      1 … current-1 current current+1 … total
const PAGE_SLOTS = 7;

function pageNumbers(current: number, total: number): (number | "..." | null)[] {
  let items: (number | "...")[];
  if (total <= PAGE_SLOTS) {
    items = Array.from({ length: total }, (_, i) => i + 1);
  } else if (current <= 4) {
    items = [1, 2, 3, 4, 5, "...", total];
  } else if (current >= total - 3) {
    items = [1, "...", total - 4, total - 3, total - 2, total - 1, total];
  } else {
    items = [1, "...", current - 1, current, current + 1, "...", total];
  }
  const padded: (number | "..." | null)[] = [...items];
  while (padded.length < PAGE_SLOTS) padded.push(null);
  return padded.slice(0, PAGE_SLOTS);
}

// Fixed 32×32 box regardless of content (a page number's digit count never
// changes the button's size) — see the pageNumbers() comment for why this
// matters. Page numbers are full-strength --text-primary at --fs-primary size
// (only the active page gets --accent + bold; only the ellipsis is dimmed/
// --text-secondary) — matches TrackListView.qml's Repeater delegate exactly:
// `color: isActive ? accentColor : (isEllipsis ? textSecondary : textPrimary)`,
// `font.pixelSize: fontSizePrimary` for every slot. Arrows are a size up
// (fontSizePrimary + 2 in the QML — derived via calc() from the same token
// rather than a new hardcoded size).
function PageBtn({ children, onClick, active, disabled, arrow = false }: { children: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; arrow?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="flex items-center justify-center"
      style={{
        width: 32, height: 32, borderRadius: 4, border: "none",
        background: hov && !disabled && !active ? "var(--hover-bg)" : "transparent",
        color: disabled ? "var(--text-secondary)" : active ? "var(--accent)" : "var(--text-primary)",
        opacity: disabled ? 0.4 : 1,
        fontWeight: active ? "var(--fw-emphasis)" : "var(--fw-secondary)",
        fontSize: arrow ? "calc(var(--fs-primary) + 2px)" : "var(--fs-primary)",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
