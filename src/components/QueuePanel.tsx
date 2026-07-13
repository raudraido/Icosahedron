import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStore } from "../store";
import { api, Track, fmtDuration } from "../lib/api";
import { PlayingBars } from "./PlayingBars";
import { SpinnerRing } from "./SpinnerRing";
import { Icon } from "./Icon";
import { ArtistTokens } from "./ArtistTokens";
import { ContextMenu, MenuEntry } from "./ContextMenu";
import { PromptDialog } from "./PromptDialog";
import { TrackInfoDialog } from "./TrackInfoDialog";
import { FAVORITE_PINK } from "../lib/theme";
import { QueueBottomTabs } from "./QueueBottomTabs";
import { LyricsPanel } from "./LyricsPanel";
import { ScrollThumb } from "./ScrollThumb";
import { ArtistInfoPanel } from "./ArtistInfoPanel";
import { SearchBox } from "./SearchBox";
import { ResizeHandle } from "./ResizeHandle";
import { loadJSON, saveJSON } from "./TrackTable";

export const ROW_HEIGHT = 53;

const LS_QUEUE_PANEL_WIDTH = "icosahedron_queue_panel_width";
const QUEUE_PANEL_DEFAULT_WIDTH = 360;
const QUEUE_PANEL_MIN_WIDTH = QUEUE_PANEL_DEFAULT_WIDTH * 0.8;
const QUEUE_PANEL_MAX_WIDTH = QUEUE_PANEL_DEFAULT_WIDTH * 1.2;

// 2×3 dot grip — matches queue_list.qml's drag handle, shown in the #/index
// column in place of the track number, on row hover (or while dragging).
export function GripDots() {
  return (
    <div className="grid grid-cols-2 gap-[2px]" style={{ width: 8 }}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--text-primary)", opacity: 0.5 }} />
      ))}
    </div>
  );
}

// Favorite toggle — matches queue_list.qml:266-283: 16x16, filled pink
// (FAVORITE_PINK, same hardcoded non-themed color used everywhere else in the
// app) when starred, outline text-secondary otherwise. The hover cue here is
// a 1.15x scale-up, not a color change — different from TrackTable's
// FavoriteHeart (which does hover-to-accent instead), so this is its own
// small component rather than reusing that one and changing its established
// behavior.
export function QueueFavoriteHeart({ track }: { track: Track }) {
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
      // The row itself is now a drag handle wherever the grip shows (see
      // QueueRow above) — without this, a mousedown here would bubble up
      // and start a drag before this button's own onClick ever runs.
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ width: 28, background: "none", border: "none", cursor: "pointer", display: "flex", justifyContent: "center", padding: 0, flexShrink: 0 }}
    >
      <Icon
        src={starred ? "img/heart_filled.png" : "img/heart.png"}
        size={16}
        style={{
          background: starred ? FAVORITE_PINK : "var(--text-secondary)",
          transform: hov ? "scale(1.15)" : "scale(1)",
          transition: "transform 120ms",
        }}
      />
    </button>
  );
}

// Insertion-point indicator — an 8px accent dot + a 2px accent line spanning
// the row, shown at whichever boundary the dragged row would land on.
// Matches queue_list.qml's separate dot+line indicator (lines 343-360).
export function InsertionIndicator() {
  return (
    <div className="flex items-center" style={{ height: 0, position: "relative", pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 12, top: -4, width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />
      <div style={{ position: "absolute", left: 12, right: 12, top: -1, height: 2, background: "var(--accent)" }} />
    </div>
  );
}

// Floating "ghost" row that follows the cursor's Y position while dragging —
// matches queue_list.qml's ghost overlay (lines 322-341): lighter panel
// background, accent border, radius 6, 0.80 opacity.
export function GhostRow({ track, y }: { track: Track; y: number }) {
  return (
    <div
      style={{
        position: "absolute", left: 6, right: 6, top: y - ROW_HEIGHT / 2, height: ROW_HEIGHT,
        display: "flex", alignItems: "center", gap: 8, padding: "0 12px",
        background: "color-mix(in srgb, var(--panel-bg) 95%, white)",
        border: "1px solid var(--accent)", borderRadius: 6, opacity: 0.8,
        pointerEvents: "none", zIndex: 20,
      }}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate" style={{ fontSize: "var(--fs-primary)", color: "var(--text-primary)", fontWeight: "var(--fw-emphasis)" }}>{track.title}</p>
        <p className="truncate" style={{ fontSize: "var(--fs-secondary)", color: "var(--text-secondary)" }}>{track.artist}</p>
      </div>
    </div>
  );
}

interface RowProps {
  track: Track;
  index: number;
  isCurrent: boolean;
  isPast: boolean;
  playing: boolean;
  dragging: boolean;
  onPlay: () => void;
  onGripMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

// The grip icon only appears on hover, but once it's showing, the whole row
// is a drag handle, not just the grip's own small column — the grip is just
// the affordance/indicator, not the only place a drag can start from. Plain
// clicks/double-clicks still work fine alongside this: a mousedown+mouseup
// with no real pointer movement never sets dropIndexRef (see
// handleGripMouseDown below), so it doesn't trigger a reorder, and
// onDoubleClick fires independently of the mousedown/mouseup pair either way.
function QueueRow({ track: t, index: i, isCurrent, isPast, playing, dragging, onPlay, onGripMouseDown, onContextMenu }: RowProps) {
  const [hov, setHov] = useState(false);
  const showGrip = hov || dragging;

  return (
    // Was a <button>, but it wraps QueueFavoriteHeart's own <button> —
    // nesting <button> inside <button> is invalid HTML (React warns on
    // hydration: "cannot contain a nested <button>"). This row never had an
    // onClick anyway (only onDoubleClick/onContextMenu/drag), so native
    // button semantics weren't buying anything a plain focusable div with
    // an explicit role doesn't already cover.
    <div
      role="button"
      tabIndex={0}
      onDoubleClick={onPlay}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onMouseDown={showGrip ? onGripMouseDown : undefined}
      className="w-full flex items-center text-left relative transition-colors"
      style={{ height: ROW_HEIGHT, opacity: dragging ? 0.3 : 1, cursor: showGrip ? "grab" : "default" }}
    >
      {/* Same inset/rounded-rect halo shape for both states — was previously a
          plain full-bleed background on the row itself for hover (no inset, no
          radius), which looked like a different shape than the active row's
          inset accent pill.
          zIndex: -1 matters here, not just cosmetic — a `position:absolute`
          element with no z-index still paints *above* plain static in-flow
          siblings regardless of DOM order (positioned elements get their own
          "auto" stacking level above the static layer). The active halo's
          accent tint is only 15% opaque so text stayed legible through it by
          accident; the hover halo was a fully solid `var(--hover-bg)` fill,
          so it was genuinely painting over and hiding the row's text on
          hover. Without an explicit z-index below the static content, both
          halos would eventually cause this, not just the opaque one. */}
      {isCurrent ? (
        <div
          className="absolute rounded-lg"
          style={{ inset: "1px 8px", zIndex: -1, background: `color-mix(in srgb, var(--accent) 15%, transparent)`, pointerEvents: "none" }}
        />
      ) : hov && (
        <div
          className="absolute rounded-lg"
          style={{ inset: "1px 8px", zIndex: -1, background: "var(--hover-bg)", pointerEvents: "none" }}
        />
      )}

      {/* Index / bars / grip — numW=32 in queue_list.qml (x:6, width:32), was
          38 here, plus the width mismatch shifted where the title column
          started. The drag mousedown now lives on the row itself (above),
          not here — this is just the visual grip indicator. */}
      <div
        className="flex items-center justify-center shrink-0"
        style={{ width: 32, marginLeft: 6 }}
      >
        {showGrip ? (
          <GripDots />
        ) : isCurrent && playing ? (
          <PlayingBars />
        ) : (
          <span
            style={{
              fontSize: "var(--fs-small)",
              color: isCurrent ? "var(--accent)" : "var(--text-primary)",
              opacity: isPast ? 0.4 : (isCurrent ? 1 : 0.5),
              fontWeight: isCurrent ? "var(--fw-emphasis)" : "var(--fw-small)",
            }}
          >
            {i + 1}
          </span>
        )}
      </div>

      {/* Title + artist — artist uses ArtistTokens for multi-artist separation/
          clickable navigation (queue_list.qml:239-263, same separator regex
          as everywhere else), alwaysAccent when this row is the current track
          (all tokens go accent-colored while playing, not just on hover). */}
      <div className="flex-1 min-w-0 px-2" style={{ opacity: isPast ? 0.4 : 1 }}>
        <p className="truncate" style={{ fontSize: "var(--fs-primary)", color: isCurrent ? "var(--accent)" : "var(--text-primary)", fontWeight: isCurrent ? "var(--fw-emphasis)" : "var(--fw-primary)" }}>
          {t.title}
        </p>
        <ArtistTokens name={t.artist} artistId={t.artist_id} fontSize="var(--fs-secondary)" alwaysAccent={isCurrent} />
      </div>

      <QueueFavoriteHeart track={t} />

      {/* Duration — fixed width (durW=50 in queue_list.qml), not just
          shrink-to-content: without a fixed width here, the flex:1 title/
          artist column absorbs a different amount of space depending on how
          many digits this row's duration has, which shifted the favorite
          heart's position left/right per row instead of it sitting at a
          fixed spot like the old app. */}
      <span
        className="shrink-0 tabular-nums text-right"
        style={{ width: 50, marginRight: 8, fontSize: "var(--fs-secondary)", color: isCurrent ? "var(--accent)" : "var(--text-primary)", opacity: isPast ? 0.3 : 0.5 }}
      >
        {fmtDuration(t.duration_secs)}
      </span>
    </div>
  );
}

// Upload/download/clear group in the queue header — same muted-icon +
// var(--hover-bg) halo + opacity-0.4-when-disabled convention as
// TrackTable.tsx's PageBtn, so it stays theme-aware (light/dark) instead of
// the hardcoded greys the old single Clear Queue button used. Deliberately
// *not* dimmed further via opacity at rest — 0.4 is this app's disabled
// signal (see the ternary below), so any resting opacity close to that read
// as "can't click this" instead of "quiet until needed". var(--text-secondary)
// alone (already dimmer than --text-primary/--accent) carries the muting.
function QueueToolbarBtn({
  src, title, onClick, disabled,
}: { src: string; title: string; onClick: () => void; disabled?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex items-center justify-center"
      style={{
        width: 32, height: 32, borderRadius: 4,
        color: "var(--text-secondary)",
        opacity: disabled ? 0.4 : 1,
        background: hov && !disabled ? "var(--hover-bg)" : "transparent",
        transition: "background 150ms",
        cursor: disabled ? "default" : "pointer",
      }}
      onMouseEnter={() => !disabled && setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <Icon src={src} size={18} />
    </button>
  );
}

export function QueuePanel() {
  const queue          = useStore((s) => s.queue);
  const currentIndex   = useStore((s) => s.currentIndex);
  const playing        = useStore((s) => s.playing);
  const playTrack      = useStore((s) => s.playTrack);
  const clearQueue     = useStore((s) => s.clearQueue);
  const radioLoading   = useStore((s) => s.radioLoading);
  const reorderQueue   = useStore((s) => s.reorderQueue);
  const removeFromQueue = useStore((s) => s.removeFromQueue);
  const addTrackNext   = useStore((s) => s.addTrackNext);
  const startRadio     = useStore((s) => s.startRadio);
  const navigateTo     = useStore((s) => s.navigateTo);
  const openShareDialog = useStore((s) => s.openShareDialog);
  const saveQueueToServer     = useStore((s) => s.saveQueueToServer);
  const restoreQueueFromServer = useStore((s) => s.restoreQueueFromServer);
  const queueSyncBusy  = useStore((s) => s.queueSyncBusy);
  const qc = useQueryClient();

  const listRef = useRef<HTMLDivElement>(null);
  const dropIndexRef = useRef<number | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [ghostY, setGhostY] = useState<number | null>(null);
  const activeTab    = useStore((s) => s.queuePanelTab);
  const setActiveTab = useStore((s) => s.setQueuePanelTab);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Right-click menu — same shared ContextMenu/PromptDialog/TrackInfoDialog
  // components as TrackTable.tsx, but a queue-specific item list/order (no
  // separators, "Open Album", "Remove from Queue", no "Add to Queue" since
  // it's already queued) matching queue_panel.py:892-919 exactly.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; track: Track } | null>(null);
  const [infoTrack, setInfoTrack] = useState<Track | null>(null);
  const [newPlaylistFor, setNewPlaylistFor] = useState<Track | null>(null);
  const { data: playlists = [] } = useQuery({ queryKey: ["playlists"], queryFn: api.getPlaylists });

  function handleRowContextMenu(e: React.MouseEvent, track: Track) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, track });
  }

  async function openAlbum(t: Track) {
    if (!t.album_id) return;
    const album = await api.getAlbum(t.album_id);
    navigateTo({ tab: "albums", album });
  }

  async function toggleFavoriteFromMenu(track: Track) {
    try {
      await api.setFavorite(track.id, !track.starred, "id");
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

  function buildQueueMenu(track: Track): MenuEntry[] {
    return [
      { label: "Play Now", icon: "img/sub_play.png", onClick: () => playTrack(track, queue) },
      { label: "Play Next", icon: "img/sub_next.png", onClick: () => addTrackNext(track) },
      { label: "Go to Artist", icon: "img/sub_artist.png", disabled: !track.artist_id, onClick: () => track.artist_id && navigateTo({ tab: "artists", artistId: track.artist_id }) },
      { label: "Open Album", icon: "img/album.png", disabled: !track.album_id, onClick: () => openAlbum(track) },
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
      { label: "Get Info", icon: "img/info.png", onClick: () => setInfoTrack(track) },
      {
        label: track.starred ? "Remove from Favorites" : "Add to Favorites",
        icon: track.starred ? "img/heart_filled.png" : "img/heart.png",
        color: FAVORITE_PINK,
        onClick: () => toggleFavoriteFromMenu(track),
      },
      { label: "Share", icon: "img/share.png", onClick: () => openShareDialog({ id: track.id, type: "song", name: track.title }) },
      { label: "Remove from Queue", icon: "img/remove.png", onClick: () => removeFromQueue(track.id) },
    ];
  }

  // Search filters by original queue index rather than producing a
  // sub-array — isCurrent/isPast/row numbering and drag-reorder all key off
  // the track's real position in the queue, which a filtered copy would lose.
  const filteredIndices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return queue.map((_, i) => i);
    return queue.reduce<number[]>((acc, t, i) => {
      if (t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)) acc.push(i);
      return acc;
    }, []);
  }, [queue, searchQuery]);

  // Virtualized — the queue can hold thousands of tracks; rendering every
  // row as a real DOM node made this always-mounted panel re-reconcile all
  // of them on every unrelated store update (e.g. simply switching tabs).
  const virtualizer = useVirtualizer({
    count: filteredIndices.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Auto-center the now-playing row whenever the track changes (skip, addNext,
  // radio advancing, etc.) — track-change driven, not queue-length-driven, so
  // reordering/adding tracks elsewhere in the queue doesn't yank the user's
  // scroll position around while they're just browsing it.
  useEffect(() => {
    if (currentIndex < 0) return;
    const row = filteredIndices.indexOf(currentIndex);
    if (row === -1) return;
    virtualizer.scrollToIndex(row, { align: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  // Manual mousedown/mousemove/mouseup drag instead of native HTML5
  // draggable — native `dragover` only fires at a throttled, low frequency
  // (not on every pointer move), which made the ghost row visibly pop
  // between positions instead of smoothly tracking the cursor. Plain mouse
  // events fire at full rate, so the ghost/indicator can update every frame.
  function handleGripMouseDown(trackId: string) {
    return (e: React.MouseEvent) => {
      // Now that this listens on the whole row (not just the small grip
      // column), a right-click anywhere on it would otherwise also start a
      // drag alongside opening the context menu — left-click only.
      if (e.button !== 0) return;
      e.preventDefault();
      setDragId(trackId);
      dropIndexRef.current = null;
      document.body.style.userSelect = "none";

      function onMove(ev: MouseEvent) {
        const listEl = listRef.current;
        if (!listEl) return;
        const listRect = listEl.getBoundingClientRect();
        const relY = ev.clientY - listRect.top + listEl.scrollTop;
        setGhostY(relY);
        const rawIndex = relY / ROW_HEIGHT;
        const index = Math.floor(rawIndex);
        const fraction = rawIndex - index;
        const insertIndex = Math.max(0, Math.min(queue.length, fraction > 0.5 ? index + 1 : index));
        dropIndexRef.current = insertIndex;
        setDropIndex(insertIndex);
      }

      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        if (dropIndexRef.current !== null) reorderQueue(trackId, dropIndexRef.current);
        setDragId(null);
        setDropIndex(null);
        setGhostY(null);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  const draggedTrack = dragId ? queue.find((t) => t.id === dragId) ?? null : null;

  const [panelWidth, setPanelWidth] = useState(() => loadJSON(LS_QUEUE_PANEL_WIDTH, QUEUE_PANEL_DEFAULT_WIDTH));
  const [panelResizing, setPanelResizing] = useState(false);

  function onPanelResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    let current = startWidth;
    setPanelResizing(true);
    function onMove(ev: MouseEvent) {
      // Dragging left (toward the queue panel) should grow it — subtract
      // the delta since this handle sits on the panel's *left* edge.
      current = Math.max(QUEUE_PANEL_MIN_WIDTH, Math.min(QUEUE_PANEL_MAX_WIDTH, startWidth - (ev.clientX - startX)));
      setPanelWidth(current);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setPanelResizing(false);
      saveJSON(LS_QUEUE_PANEL_WIDTH, current);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ position: "relative", width: panelWidth, background: "var(--panel-bg)", borderLeft: "1px solid var(--border)" }}
    >
      <ResizeHandle placement="left" dragging={panelResizing} onMouseDown={onPanelResizeStart} />
      {/* Header — icon toolbar instead of the "Queue" title/position/duration
          text it used to show: upload (save queue to server) → download
          (restore queue from server) → clear queue on the left, search on
          the right. Upload/clear disable on an empty queue (nothing to save
          or clear); download doesn't, since restoring is exactly how you'd
          fill an empty queue. All three disable during queueSyncBusy so a
          save and a restore can't race each other. */}
      <div
        className="flex items-center shrink-0"
        style={{ height: 62, paddingLeft: 10, paddingRight: 8, borderBottom: "1px solid var(--border)" }}
      >
        <QueueToolbarBtn
          src="img/upload.png"
          title="Save Queue to Server"
          onClick={saveQueueToServer}
          disabled={queueSyncBusy || queue.length === 0}
        />
        <QueueToolbarBtn
          src="img/download.png"
          title="Restore Queue from Server"
          onClick={restoreQueueFromServer}
          disabled={queueSyncBusy}
        />
        <QueueToolbarBtn
          src="img/trash.png"
          title="Clear Queue"
          onClick={clearQueue}
          disabled={queue.length === 0}
        />
        <div className="flex-1" />
        <SearchBox
          open={searchOpen}
          onToggle={() => setSearchOpen((v) => !v)}
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search queue…"
          expandedWidth={122}
        />
      </div>

      {/* All three tabs stay mounted (just hidden via display:none) rather
          than unmounting on tab switch — matches the old app, where Queue/
          Lyrics/Info are hidden widgets, never destroyed, so switching away
          and back doesn't lose in-flight drag state, lyrics offset/scroll
          position, or the artist bio's expanded state. The one behavior
          difference from the old app: lyrics/artist-info now fetch as soon
          as the track changes rather than only once the tab is first opened
          (that old-app optimization relied on per-tab pending/timer state
          that doesn't map cleanly onto "always mounted"). */}
      <div className="flex-1" style={{ position: "relative", minHeight: 0, display: activeTab === "queue" ? "block" : "none" }}>
      <div
        ref={listRef}
        className="overflow-y-auto scroll-clean"
        style={{ position: "relative", height: "100%" }}
      >
        {radioLoading && (
          <div
            style={{
              position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <SpinnerRing />
          </div>
        )}

        {queue.length === 0 && (
          <p className="p-4" style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)", opacity: 0.3 }}>
            Nothing queued
          </p>
        )}

        {queue.length > 0 && filteredIndices.length === 0 && (
          <p className="p-4" style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)", opacity: 0.3 }}>
            No matches
          </p>
        )}

        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const i = filteredIndices[vRow.index];
            const t = queue[i];
            return (
              <div key={`${t.id}-${i}`} style={{ position: "absolute", top: vRow.start, left: 0, right: 0 }}>
                <QueueRow
                  track={t}
                  index={i}
                  isCurrent={i === currentIndex}
                  isPast={currentIndex >= 0 && i < currentIndex}
                  playing={playing}
                  dragging={dragId === t.id}
                  onPlay={() => playTrack(t, queue)}
                  onGripMouseDown={handleGripMouseDown(t.id)}
                  onContextMenu={(e) => handleRowContextMenu(e, t)}
                />
              </div>
            );
          })}
        </div>
        {dragId && dropIndex !== null && (
          <div style={{ position: "absolute", top: dropIndex * ROW_HEIGHT, left: 0, right: 0 }}>
            <InsertionIndicator />
          </div>
        )}

        {draggedTrack && ghostY !== null && <GhostRow track={draggedTrack} y={ghostY} />}
      </div>
      <ScrollThumb scrollRef={listRef} />
      </div>

      <div style={{ display: activeTab === "lyrics" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <LyricsPanel active={activeTab === "lyrics"} />
      </div>
      <div style={{ display: activeTab === "info" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <ArtistInfoPanel active={activeTab === "info"} />
      </div>

      <QueueBottomTabs active={activeTab} onChange={setActiveTab} />

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildQueueMenu(ctxMenu.track)}
          onClose={() => setCtxMenu(null)}
        />
      )}
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
    </div>
  );
}
