import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Playlist, Track, fmtDuration } from "../lib/api";
import { CoverArt } from "../components/CoverArt";
import { CoverZoomOverlay } from "../components/CoverZoomOverlay";
import { PlayRingButton } from "../components/PlayRingButton";
import { Icon } from "../components/Icon";
import { IconBtn } from "../components/IconBtn";
import { SearchBox } from "../components/SearchBox";
import { ContextMenu } from "../components/ContextMenu";
import { PromptDialog } from "../components/PromptDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TrackTable } from "../components/TrackTable";
import { useStore } from "../store";
import { PLAY_ICON_DARK } from "../lib/theme";

// Ported from playlist_grid.qml + playlist_detail.qml / playlists_browser.py.
// Reuses established patterns/components rather than reinventing them:
//  - Grid card: same hover-play-button/cover-art pattern as Albums.tsx's
//    AlbumCard / Artists.tsx's ArtistCard.
//  - Detail header: same blurred-glow-behind-cover + click-to-zoom technique
//    as Albums.tsx's AlbumDetail / ArtistDetail.tsx.
//  - Tracklist: the *actual* shared TrackTable component (same one Tracks.tsx
//    and Albums.tsx's AlbumDetail use) — not a bespoke row list. This gets
//    the whole search/sort/column-picker/context-menu toolbar for free, and
//    already renders as its own card, matching the old app's TrackListView.qml
//    reuse instead of a bespoke tracklist widget.
//  - Drag-to-reorder: TrackTable's `reorderable`/`onReorder` props (added
//    for this), which reuse the Queue panel's own grip/drag mechanics
//    (GripDots/InsertionIndicator/GhostRow) — NOT the old app's own
//    TrackListView.qml DragHandler, which doesn't have an equivalent here.
// Reorder persistence matches the old app's update_playlist_tracks exactly:
// Subsonic has no "move" verb, so a drop remove-and-re-adds the whole
// playlist content in the new order (reorderPlaylistTracks in api.ts).

const GAP = 12;

function PlaylistCard({ playlist, onOpen, onContextMenu }: { playlist: Playlist; onOpen: () => void; onContextMenu: (e: React.MouseEvent) => void }) {
  const [hovered, setHovered] = useState(false);
  const [playHovered, setPlayHovered] = useState(false);
  const [queueHovered, setQueueHovered] = useState(false);
  const qc = useQueryClient();
  const playTrack = useStore((s) => s.playTrack);
  const appendToQueue = useStore((s) => s.appendToQueue);
  const holdTimerRef = useRef<number | null>(null);
  const heldRef = useRef(false);

  function fetchTracks() {
    return qc.fetchQuery({ queryKey: ["playlist-tracks", playlist.id], queryFn: () => api.getPlaylistTracks(playlist.id) });
  }

  function clearHoldTimer() {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  // Click = play the playlist from track 1, press+hold 600ms = shuffle it
  // instead — same hold-to-shuffle interaction as AlbumCard/ArtistCard.
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
      onClick={onOpen}
      onContextMenu={onContextMenu}
      onMouseEnter={() => { setHovered(true); fetchTracks(); }}
      onMouseLeave={() => setHovered(false)}
      className="text-left group grid-card"
    >
      <div style={{ position: "relative", overflow: "hidden", borderRadius: "8px 8px 0 0" }}>
        <CoverArt coverId={playlist.cover_id} size={200} className="w-full aspect-square rounded-t-lg group-hover:brightness-75 group-hover:scale-[1.03] transition-all" />
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
            title="Play playlist (hold to shuffle)"
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
      <div className="flex flex-col grid-card-meta group-hover:brightness-75 transition-all">
        <p className="truncate" style={{ color: hovered ? "var(--accent)" : "var(--text-primary)", fontSize: "var(--fs-primary)", fontWeight: "var(--fw-emphasis)" }}>{playlist.name}</p>
        <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>
          {playlist.song_count} track{playlist.song_count === 1 ? "" : "s"}
        </p>
      </div>
    </button>
  );
}

export function NewPlaylistDialog({ onCreate, onCancel }: { onCreate: (name: string, isPublic: boolean) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
        background: "color-mix(in srgb, var(--left-panel-bg) 55%, transparent)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--main-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 20, width: 320, boxShadow: "0 12px 32px color-mix(in srgb, black 30%, transparent)" }}
      >
        <h3 style={{ color: "var(--text-primary)", fontSize: "var(--fs-heading)", fontWeight: "var(--fw-emphasis)", marginBottom: 12 }}>New Playlist</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onCreate(name.trim(), isPublic); if (e.key === "Escape") onCancel(); }}
          placeholder="Playlist name"
          className="w-full outline-none"
          style={{ background: "var(--card-bg)", color: "var(--text-primary)", fontSize: "var(--fs-primary)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px" }}
        />
        <label className="flex items-center" style={{ gap: 8, marginTop: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>Public playlist</span>
        </label>
        <div className="flex justify-end" style={{ gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", background: "var(--hover-bg)", color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>Cancel</button>
          <button
            onClick={() => name.trim() && onCreate(name.trim(), isPublic)}
            disabled={!name.trim()}
            style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: name.trim() ? "pointer" : "default", background: "var(--accent)", color: PLAY_ICON_DARK, fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)", opacity: name.trim() ? 1 : 0.5 }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionIconButton({ icon, onClick, title }: { icon: string; onClick: () => void; title: string }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 40, height: 40, borderRadius: "50%", border: "1px solid var(--border)", cursor: "pointer",
        background: hov ? "var(--hover-bg)" : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <Icon src={icon} size={18} style={{ background: "var(--text-secondary)" }} />
    </button>
  );
}

// Small pill switch — matches playlist_detail.qml's public/private toggle
// (a compact animated switch, not a text button).
function Toggle({ checked, onChange, title }: { checked: boolean; onChange: () => void; title: string }) {
  return (
    <button
      onClick={onChange}
      title={title}
      style={{
        width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer", padding: 2,
        background: checked ? "var(--accent)" : "var(--hover-bg)",
        display: "flex", alignItems: "center", justifyContent: checked ? "flex-end" : "flex-start",
        transition: "background 150ms",
      }}
    >
      <div style={{ width: 16, height: 16, borderRadius: "50%", background: checked ? PLAY_ICON_DARK : "var(--text-secondary)", transition: "transform 150ms" }} />
    </button>
  );
}

function PlaylistDetail({ playlist }: { playlist: Playlist }) {
  const qc = useQueryClient();
  const playTrack = useStore((s) => s.playTrack);
  const navigateTo = useStore((s) => s.navigateTo);
  const coverUrl = useStore((s) => s.coverUrl);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [coverHov, setCoverHov] = useState(false);
  const [coverZoomOpen, setCoverZoomOpen] = useState(false);
  // Local override for the mutable Public/Private bit — same pattern as
  // Albums.tsx's AlbumDetail favorite toggle: `playlist` itself comes from
  // nav history (immutable per entry), so a live toggle needs its own state
  // rather than mutating the prop.
  const [isPublic, setIsPublic] = useState(playlist.public);
  useEffect(() => setIsPublic(playlist.public), [playlist.id, playlist.public]);

  const { data, isLoading } = useQuery({
    queryKey: ["playlist-tracks", playlist.id],
    queryFn: () => api.getPlaylistTracks(playlist.id),
  });
  useEffect(() => { if (data) setTracks(data); }, [data]);

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
  async function togglePublic() {
    const next = !isPublic;
    setIsPublic(next);
    try { await api.setPlaylistPublic(playlist.id, next); } catch { setIsPublic(!next); }
  }

  // Reorder — TrackTable calls this with the moved track's id and the
  // insertion index it was dropped at; we own persisting the new order
  // (Subsonic has no "move" verb, see reorderPlaylistTracks) and updating
  // local state so the table reflects it immediately.
  function handleReorder(trackId: string, toIndex: number) {
    setTracks((prev) => {
      const from = prev.findIndex((t) => t.id === trackId);
      if (from === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      const adjusted = from < toIndex ? toIndex - 1 : toIndex;
      next.splice(adjusted, 0, moved);
      api.reorderPlaylistTracks(playlist.id, next.length, next.map((t) => t.id)).catch(() => {
        /* best-effort — a refetch on next visit will reflect the server's real order if this failed */
      });
      return next;
    });
  }

  async function removeFromPlaylist(track: Track) {
    const index = tracks.findIndex((t) => t.id === track.id);
    if (index === -1) return;
    setTracks((prev) => prev.filter((_, i) => i !== index));
    try {
      await api.removeTrackFromPlaylist(playlist.id, index);
      // Same invalidation addToExistingPlaylist (TrackTable.tsx) does after
      // adding — the ["playlists"] grid/left-panel song_count and this
      // playlist's own ["playlist-tracks"] cache both need to drop the
      // stale pre-removal data, otherwise a later refetch (tab revisit,
      // window refocus) overwrites this local edit with the old cached list.
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["playlist-tracks", playlist.id] });
    } catch {
      // Server-side removal failed — put it back rather than leaving the UI
      // showing a removal that didn't actually persist.
      setTracks((prev) => [...prev.slice(0, index), track, ...prev.slice(index)]);
    }
  }

  return (
    <>
      {/* Rendered as a sibling of TrackTable's own scroll container, not a
          descendant — will-change:transform on a scroll container creates a
          new containing block for position:fixed descendants (see
          NowPlaying.tsx/ArtistDetail.tsx for the same fix). */}
      {coverZoomOpen && playlist.cover_id && (
        <CoverZoomOverlay coverId={playlist.cover_id} onClose={() => setCoverZoomOpen(false)} />
      )}
      <div className="flex flex-col h-full page-fade-in">
        <div style={{ padding: 12 }}>
          <div className="flex" style={{ gap: 28, padding: 28, borderRadius: 10, background: "var(--card-bg)", border: "1px solid var(--border)" }}>
            <div style={{ position: "relative", width: 264, height: 264, flexShrink: 0 }}>
              {playlist.cover_id && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute", inset: -1,
                    backgroundImage: `url(${coverUrl(playlist.cover_id, 264)})`,
                    backgroundSize: "cover", backgroundPosition: "center",
                    filter: "blur(10px)", opacity: 0.9, borderRadius: 10,
                  }}
                />
              )}
              <div
                onClick={() => playlist.cover_id && setCoverZoomOpen(true)}
                onMouseEnter={() => setCoverHov(true)}
                onMouseLeave={() => setCoverHov(false)}
                style={{
                  position: "relative", width: 264, height: 264, borderRadius: 10, overflow: "hidden",
                  cursor: playlist.cover_id ? "pointer" : "default",
                  transform: coverHov ? "scale(1.08)" : "scale(1)", transition: "transform 200ms",
                }}
              >
                <CoverArt coverId={playlist.cover_id} size={264} className="w-full h-full" />
              </div>
            </div>

            <div className="flex flex-col" style={{ flex: 1, minWidth: 0, justifyContent: "flex-start", paddingTop: 16, gap: 6 }}>
              <p style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: "var(--fw-emphasis)", letterSpacing: 1.5, textTransform: "uppercase" }}>Playlist</p>
              <h1 className="truncate" style={{ fontSize: "var(--fs-hero)", fontWeight: "var(--fw-emphasis)", color: "var(--text-primary)" }}>{playlist.name}</h1>
              {playlist.owner && <p style={{ color: "var(--accent)", fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)" }}>By {playlist.owner}</p>}
              {playlist.comment && <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{playlist.comment}</p>}
              <p style={{ color: "var(--text-secondary)", fontWeight: "var(--fw-emphasis)", fontSize: "var(--fs-secondary)" }}>
                {isLoading ? "Loading…" : `${playlist.song_count} songs  ·  ${fmtDuration(playlist.duration_secs)}`}
              </p>

              <div className="flex items-center" style={{ gap: 14, marginTop: 16 }}>
                <PlayRingButton icon="img/play.png" onClick={handlePlay} title="Play All" />
                <ActionIconButton icon="img/shuffle.png" onClick={handleShuffle} title="Shuffle" />
                <div className="flex items-center" style={{ gap: 8 }}>
                  <Toggle checked={isPublic} onChange={togglePublic} title={isPublic ? "Public — click to make private" : "Private — click to make public"} />
                  <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)" }}>
                    {isPublic ? "Public" : "Private"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1" style={{ minHeight: 0, padding: "0 12px 12px" }}>
          <TrackTable
            key={playlist.id}
            tracks={tracks}
            loading={isLoading}
            viewKey="playlist_detail"
            defaultSort={null}
            persistSort={false}
            numColSource="position"
            reorderable
            onReorder={handleReorder}
            filterableCols={["genre", "year"]}
            onFilterChange={(col, values) => {
              const value = [...values][0];
              if (value) navigateTo({ tab: "tracks", trackFilter: { col, value } });
            }}
            extraMenuItems={(track) => [
              { label: "Remove from Playlist", icon: "img/remove.png", onClick: () => removeFromPlaylist(track) },
            ]}
          />
        </div>
      </div>
    </>
  );
}

export function Playlists() {
  const qc = useQueryClient();
  // Matches Albums.tsx/Artists.tsx: selection lives in the shared nav
  // history, not local state — so switching to a different tab and back
  // (setTab always pushes a bare {tab} entry) or re-clicking the already-
  // active Playlists tab (App.tsx's handleTabClick → pushNav()) both land
  // back on the grid for free, instead of a stale detail view sticking
  // around because this component never unmounts.
  const pushNav = useStore((s) => s.pushNav);
  const selected = useStore((s) => s.navHistory[s.navPos]?.playlist ?? null);
  // This screen (App.tsx's `mounted` set) never unmounts once first
  // visited, and react-query's 5min staleTime means just switching back to
  // this tab wouldn't otherwise refetch — so a playlist edited from another
  // client (or the Navidrome web UI) while this app sits open on another
  // tab would show stale data indefinitely. Re-checking server state on
  // every tab activation instead of trusting the cache fixes that.
  const activeTab = useStore((s) => s.activeTab);
  useEffect(() => {
    if (activeTab !== "playlists") return;
    // Deferred a tick — this fires right as the previous tab is tearing
    // down (e.g. Favorites' own large list unmount), and invalidating
    // synchronously in that same window competes with it for the main
    // thread, turning what should be an instant tab switch (cached data
    // renders immediately either way) into a noticeable stall. Letting the
    // switch itself finish painting first keeps this a pure background
    // refetch, same "show cached now, patch in fresh data if any" as before.
    const t = setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      if (selected) qc.invalidateQueries({ queryKey: ["playlist-tracks", selected.id] });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null);
  const [itemMenu, setItemMenu] = useState<{ x: number; y: number; playlist: Playlist } | null>(null);
  const openShareDialog = useStore((s) => s.openShareDialog);
  const [renameTarget, setRenameTarget] = useState<Playlist | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Playlist | null>(null);

  const { data: playlists = [], isLoading } = useQuery({
    queryKey: ["playlists"],
    queryFn: () => api.getPlaylists(),
  });

  const displayedPlaylists = searchText.trim()
    ? playlists.filter((p) => p.name.toLowerCase().includes(searchText.toLowerCase()))
    : playlists;

  async function handleCreate(name: string, isPublic: boolean) {
    setCreateOpen(false);
    await api.createPlaylist(name, isPublic);
    qc.invalidateQueries({ queryKey: ["playlists"] });
  }
  async function handleRename(name: string) {
    const target = renameTarget;
    setRenameTarget(null);
    if (!target) return;
    await api.renamePlaylist(target.id, name);
    qc.invalidateQueries({ queryKey: ["playlists"] });
  }
  async function handleDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    await api.deletePlaylist(target.id);
    qc.invalidateQueries({ queryKey: ["playlists"] });
  }

  if (selected) {
    return <PlaylistDetail playlist={selected} />;
  }

  return (
    <div
      className="flex flex-col h-full page-fade-in"
      onContextMenu={(e) => { e.preventDefault(); setBgMenu({ x: e.clientX, y: e.clientY }); }}
    >
      <div className="flex items-center shrink-0 px-6" style={{ height: 58, gap: 6 }}>
        <h2 style={{ flex: 1, color: "var(--text-secondary)", fontSize: "var(--fs-primary)", fontWeight: "var(--fw-emphasis)" }}>
          {isLoading
            ? "Loading playlists…"
            : searchText
              ? `${displayedPlaylists.length} / ${playlists.length} playlists`
              : `${playlists.length} playlist${playlists.length === 1 ? "" : "s"}`}
        </h2>
        <SearchBox
          open={searchOpen}
          onToggle={() => setSearchOpen((v) => !v)}
          value={searchText}
          onChange={setSearchText}
          placeholder="Search playlists…"
        />
        <IconBtn src="img/add.png" title="New Playlist" onClick={() => setCreateOpen(true)} />
      </div>
      <div className="flex-1 overflow-y-auto scroll-overlay" style={{ padding: "0 12px 12px" }}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))]" style={{ gap: GAP }}>
          {displayedPlaylists.map((p) => (
            <PlaylistCard
              key={p.id}
              playlist={p}
              onOpen={() => pushNav({ playlist: p })}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setItemMenu({ x: e.clientX, y: e.clientY, playlist: p }); }}
            />
          ))}
        </div>
      </div>

      {bgMenu && (
        <ContextMenu
          x={bgMenu.x} y={bgMenu.y}
          items={[{ label: "New Playlist…", icon: "img/add.png", onClick: () => setCreateOpen(true) }]}
          onClose={() => setBgMenu(null)}
        />
      )}
      {itemMenu && (
        <ContextMenu
          x={itemMenu.x} y={itemMenu.y}
          items={[
            { label: "Share", icon: "img/share.png", onClick: () => openShareDialog({ id: itemMenu.playlist.id, type: "playlist", name: itemMenu.playlist.name }) },
            { label: "Rename Playlist", icon: "img/info.png", onClick: () => setRenameTarget(itemMenu.playlist) },
            { label: "Delete Playlist", icon: "img/remove.png", color: "#E53935", onClick: () => setDeleteTarget(itemMenu.playlist) },
          ]}
          onClose={() => setItemMenu(null)}
        />
      )}
      {createOpen && <NewPlaylistDialog onCreate={handleCreate} onCancel={() => setCreateOpen(false)} />}
      {renameTarget && (
        <PromptDialog
          title="Rename Playlist"
          placeholder={renameTarget.name}
          confirmLabel="Rename"
          onSubmit={handleRename}
          onCancel={() => setRenameTarget(null)}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete Playlist"
          message={`Delete "${deleteTarget.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
