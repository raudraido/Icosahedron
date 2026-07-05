import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { QueueBottomTabs, QueueTab } from "./QueueBottomTabs";
import { LyricsPanel } from "./LyricsPanel";
import { ArtistInfoPanel } from "./ArtistInfoPanel";

const ROW_HEIGHT = 53;

// 2×3 dot grip — matches queue_list.qml's drag handle, shown in the #/index
// column in place of the track number, on row hover (or while dragging).
function GripDots() {
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
function QueueFavoriteHeart({ track }: { track: Track }) {
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
      style={{ width: 28, background: "none", border: "none", cursor: "pointer", display: "flex", justifyContent: "center", padding: 0, flexShrink: 0 }}
    >
      <Icon
        src={starred ? "/img/heart_filled.png" : "/img/heart.png"}
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
function InsertionIndicator() {
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
function GhostRow({ track, y }: { track: Track; y: number }) {
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
        <p className="truncate" style={{ fontSize: "var(--fs-primary)", color: "var(--text-primary)", fontWeight: 700 }}>{track.title}</p>
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
  onGripMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

// Drag is confined to the grip in the #/index column, not the whole row —
// matches the old app's reasoning: the row already has click/double-click
// handling (double-click to play), so only the grip column is draggable to
// avoid the two interactions fighting each other.
function QueueRow({ track: t, index: i, isCurrent, isPast, playing, dragging, onPlay, onGripMouseDown, onContextMenu }: RowProps) {
  const [hov, setHov] = useState(false);
  const showGrip = hov || dragging;

  return (
    <button
      onDoubleClick={onPlay}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="w-full flex items-center text-left relative transition-colors"
      style={{ height: ROW_HEIGHT, opacity: dragging ? 0.3 : 1 }}
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
          started. */}
      <div
        onMouseDown={showGrip ? onGripMouseDown : undefined}
        className="flex items-center justify-center shrink-0"
        style={{ width: 32, marginLeft: 6, cursor: showGrip ? "grab" : "default" }}
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
              fontWeight: isCurrent ? 700 : 400,
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
        <p className="truncate" style={{ fontSize: "var(--fs-primary)", color: isCurrent ? "var(--accent)" : "var(--text-primary)", fontWeight: isCurrent ? 700 : 400 }}>
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
  const qc = useQueryClient();

  const listRef = useRef<HTMLDivElement>(null);
  const dropIndexRef = useRef<number | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [ghostY, setGhostY] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<QueueTab>("queue");

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
      { label: "Play Now", icon: "/img/sub_play.png", onClick: () => playTrack(track, queue) },
      { label: "Play Next", icon: "/img/sub_next.png", onClick: () => addTrackNext(track) },
      { label: "Go to Artist", icon: "/img/sub_artist.png", disabled: !track.artist_id, onClick: () => track.artist_id && navigateTo({ tab: "artists", artistId: track.artist_id }) },
      { label: "Open Album", icon: "/img/album.png", disabled: !track.album_id, onClick: () => openAlbum(track) },
      { label: "Start Radio", icon: "/img/radio.png", onClick: () => startRadio(track) },
      {
        label: "Add to Playlist", icon: "/img/playlist.png",
        submenu: [
          { label: "New Playlist…", icon: "/img/add.png", onClick: () => setNewPlaylistFor(track) },
          ...playlists.map((p) => ({
            label: `${p.name}  (${p.song_count})`,
            icon: "/img/playlist.png",
            onClick: () => addToExistingPlaylist(p.id, track),
          })),
        ],
      },
      { label: "Get Info", icon: "/img/info.png", onClick: () => setInfoTrack(track) },
      {
        label: track.starred ? "Remove from Favorites" : "Add to Favorites",
        icon: track.starred ? "/img/heart_filled.png" : "/img/heart.png",
        color: FAVORITE_PINK,
        onClick: () => toggleFavoriteFromMenu(track),
      },
      { label: "Remove from Queue", icon: "/img/remove.png", onClick: () => removeFromQueue(track.id) },
    ];
  }

  const totalSecs = queue.reduce((acc, t) => acc + t.duration_secs, 0);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const totalFmt = h > 0
    ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
    : `${m}:${String(s).padStart(2,"0")}`;

  // Manual mousedown/mousemove/mouseup drag instead of native HTML5
  // draggable — native `dragover` only fires at a throttled, low frequency
  // (not on every pointer move), which made the ghost row visibly pop
  // between positions instead of smoothly tracking the cursor. Plain mouse
  // events fire at full rate, so the ghost/indicator can update every frame.
  function handleGripMouseDown(trackId: string) {
    return (e: React.MouseEvent) => {
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

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ width: 360, background: "var(--panel-bg)", borderLeft: "1px solid var(--border)" }}
    >
      {/* Header — matches queue_panel.py:480-525/698-716 exactly: "Queue" is
          title case (not all-caps/letter-spaced), bold, full opacity; position
          ("3/12") is text-secondary; duration is tinted to the *accent* color,
          not muted gray — none of these three are opacity-faded in the old
          app, just plain solid colors. Padding is asymmetric (14px left, 8px
          right), and the two gaps (Queue→position, position→duration) differ
          (8px, 6px), so this can't use a single uniform flex `gap`. */}
      <div
        className="flex items-center shrink-0"
        style={{ height: 62, paddingLeft: 14, paddingRight: 8, borderBottom: "1px solid var(--border)" }}
      >
        <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-primary)", fontWeight: 700 }}>
          Queue
        </span>
        {queue.length > 0 && (
          <>
            <span style={{ fontSize: "var(--fs-secondary)", color: "var(--text-secondary)", marginLeft: 8 }}>
              {currentIndex + 1}/{queue.length}
            </span>
            <span style={{ fontSize: "var(--fs-secondary)", color: "var(--accent)", marginLeft: 6 }}>
              {totalFmt}
            </span>
          </>
        )}
        <div className="flex-1" />
        {queue.length > 0 && (
          <button
            onClick={clearQueue}
            title="Clear Queue"
            className="flex items-center justify-center"
            style={{ width: 28, height: 28, color: "#555555" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#aaaaaa")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#555555")}
          >
            <Icon src="/img/trash.png" size={18} />
          </button>
        )}
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
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto scroll-clean"
        style={{ position: "relative", display: activeTab === "queue" ? "block" : "none" }}
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

        {queue.map((t, i) => (
          <div key={`${t.id}-${i}`}>
            {dragId && dropIndex === i && <InsertionIndicator />}
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
        ))}
        {dragId && dropIndex === queue.length && <InsertionIndicator />}

        {draggedTrack && ghostY !== null && <GhostRow track={draggedTrack} y={ghostY} />}
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
