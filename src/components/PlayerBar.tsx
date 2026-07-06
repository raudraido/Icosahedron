import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "../store";
import { CoverArt } from "./CoverArt";
import { Icon } from "./Icon";
import { PlayRingButton } from "./PlayRingButton";
import { Waveform } from "./Waveform";
import { ArtistTokens } from "./ArtistTokens";
import { AlbumLink } from "./AlbumLink";
import { loadJSON, saveJSON } from "./TrackTable";
import { api, fmtDuration, Track } from "../lib/api";
import { ContextMenu, MenuEntry } from "./ContextMenu";
import { PromptDialog } from "./PromptDialog";
import { TrackInfoDialog } from "./TrackInfoDialog";
import { BpmMenu } from "./BpmMenu";
import { FAVORITE_PINK } from "../lib/theme";

const LS_SHOW_REMAINING = "footer_show_remaining_time";

// Matches the old app's footer_bar.qml: every transport icon is unconditionally
// accent-tinted (tintedIcon(name, accentColor)) — shuffle/repeat's on/off state
// is shown by the little dot indicator, not by dimming the icon itself.
function TBtn({
  icon,
  iconSize = 16,
  btnSize = 40,
  radius = 20,
  onClick,
  dot = false,
  title,
}: {
  icon: string;
  iconSize?: number;
  btnSize?: number;
  radius?: number;
  onClick: () => void;
  dot?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="relative flex items-center justify-center shrink-0 transition-colors"
      style={{
        width: btnSize, height: btnSize, borderRadius: radius,
        color: "var(--accent)",
        background: "transparent", border: "none", cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon src={icon} size={iconSize} />
      {dot && (
        <span
          className="absolute rounded-full"
          style={{ width: 5, height: 5, background: "var(--accent)", bottom: 2, left: "50%", transform: "translateX(-50%)" }}
        />
      )}
    </button>
  );
}

export function PlayerBar() {
  const queue          = useStore((s) => s.queue);
  const currentIndex   = useStore((s) => s.currentIndex);
  const playing        = useStore((s) => s.playing);
  const shuffle        = useStore((s) => s.shuffle);
  const repeat         = useStore((s) => s.repeat);
  const volume         = useStore((s) => s.volume);
  const currentTime    = useStore((s) => s.currentTime);
  const duration       = useStore((s) => s.duration);
  const playPause      = useStore((s) => s.playPause);
  const next           = useStore((s) => s.next);
  const prev           = useStore((s) => s.prev);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const setVolume      = useStore((s) => s.setVolume);
  const toggleShuffle  = useStore((s) => s.toggleShuffle);
  const toggleRepeat   = useStore((s) => s.toggleRepeat);
  const stop           = useStore((s) => s.stop);
  const sidebarArtExpanded = useStore((s) => s.sidebarArtExpanded);
  const toggleSidebarArt   = useStore((s) => s.toggleSidebarArt);
  const setTab             = useStore((s) => s.setTab);
  const navigateTo         = useStore((s) => s.navigateTo);
  const playTrack          = useStore((s) => s.playTrack);
  const addTrackNext       = useStore((s) => s.addTrackNext);
  const startRadio         = useStore((s) => s.startRadio);
  const [artHov, setArtHov] = useState(false);
  const [expandBtnHov, setExpandBtnHov] = useState(false);

  const qc = useQueryClient();
  const { data: playlists = [] } = useQuery({ queryKey: ["playlists"], queryFn: api.getPlaylists });
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [infoTrack, setInfoTrack] = useState<Track | null>(null);
  const [newPlaylistFor, setNewPlaylistFor] = useState<Track | null>(null);

  const track = queue[currentIndex] ?? null;

  // On-device BPM detection (native QM-DSP, native/audio-engine/src/bpm.rs) —
  // ported from the old app's BPMWorker/bpm_cache.json. Results live in the
  // global store's bpmCache (keyed by track id), not local state, so once a
  // track's been detected here, TrackTable/TrackInfoDialog show the same
  // value everywhere else too. Debounced 350ms after the track settles
  // (matches the old app's visual_update_timer) so rapid track-skipping
  // never piles up analysis calls; a `gen` counter discards any
  // still-in-flight result once a newer track has taken over, same as the
  // old app's _safe_discard_worker. Skipped entirely if already cached
  // (preloaded at connect, or detected earlier this session).
  const bpmCache = useStore((s) => s.bpmCache);
  const setBpmCache = useStore((s) => s.setBpm);
  const [bpmLoading, setBpmLoading] = useState(false);
  const bpmGenRef = useRef(0);

  useEffect(() => {
    setBpmLoading(false);
    if (!track || useStore.getState().bpmCache[track.id] != null) return;
    const gen = ++bpmGenRef.current;
    const timer = setTimeout(() => {
      setBpmLoading(true);
      api.getBpm(track.id, track.stream_url)
        .then((bpm) => { if (gen === bpmGenRef.current) { setBpmCache(track.id, bpm); setBpmLoading(false); } })
        .catch(() => { if (gen === bpmGenRef.current) setBpmLoading(false); });
    }, 350);
    return () => clearTimeout(timer);
  }, [track?.id]);

  const effectiveBpm = (track ? bpmCache[track.id] : undefined) ?? track?.bpm ?? null;

  const [bpmMenu, setBpmMenu] = useState<{ x: number; y: number } | null>(null);

  async function applyBpm(bpm: number) {
    if (!track) return;
    const rounded = Math.round(bpm * 10) / 10;
    setBpmCache(track.id, rounded);
    try { await api.setBpmOverride(track.id, rounded); } catch { /* best-effort */ }
  }
  const remaining = duration > currentTime ? duration - currentTime : 0;

  // Click totalTimeLbl to toggle total-duration vs. remaining-time countdown —
  // matches footer_bar.qml's totalTimeLbl (footerBridge.remainingToggled),
  // persisted the same way ("show_remaining_time" setting) so it survives a restart.
  const [showRemaining, setShowRemaining] = useState(() => loadJSON(LS_SHOW_REMAINING, true));
  function toggleShowRemaining() {
    setShowRemaining((v) => {
      const next = !v;
      saveJSON(LS_SHOW_REMAINING, next);
      return next;
    });
  }

  // Lets a long title spill rightward past the narrow left column into the
  // transport row's otherwise-empty space, instead of eliding immediately at
  // the column's edge — matches footer_bar.qml's titleLbl, which computes its
  // max width from controlsRow's actual left edge so it can never overlap the
  // Stop button regardless of window width. Re-measured on resize/track change.
  const barRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const controlsRowRef = useRef<HTMLDivElement>(null);
  const [titleMaxWidth, setTitleMaxWidth] = useState<number | null>(null);
  const [titleHov, setTitleHov] = useState(false);

  function recomputeTitleWidth() {
    if (!titleRef.current || !controlsRowRef.current) return;
    const titleLeft = titleRef.current.getBoundingClientRect().left;
    const controlsLeft = controlsRowRef.current.getBoundingClientRect().left;
    setTitleMaxWidth(Math.max(0, controlsLeft - titleLeft - 16));
  }

  useEffect(() => {
    recomputeTitleWidth();
    const ro = new ResizeObserver(recomputeTitleWidth);
    if (barRef.current) ro.observe(barRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, sidebarArtExpanded]);

  // Right-click menu on the footer title — same shared ContextMenu/
  // PromptDialog/TrackInfoDialog components and item list as QueuePanel's
  // buildQueueMenu, minus "Remove from Queue" (doesn't apply to the
  // currently-playing track) and plus "Add to Queue" — matches the old app's
  // _show_footer_track_context_menu (mixins/navigation.py:671-731).
  async function openAlbum(t: Track) {
    if (!t.album_id) return;
    const album = await api.getAlbum(t.album_id);
    navigateTo({ tab: "albums", album });
  }

  async function toggleFavoriteFromMenu(t: Track) {
    try { await api.setFavorite(t.id, !t.starred, "id"); } catch { /* best-effort */ }
  }

  async function addToExistingPlaylist(playlistId: string, t: Track) {
    await api.addTracksToPlaylist(playlistId, [t.id]);
    qc.invalidateQueries({ queryKey: ["playlists"] });
  }

  async function createPlaylistAndAdd(name: string) {
    const t = newPlaylistFor;
    setNewPlaylistFor(null);
    if (!t) return;
    const playlist = await api.createPlaylist(name);
    await api.addTracksToPlaylist(playlist.id, [t.id]);
    qc.invalidateQueries({ queryKey: ["playlists"] });
  }

  function buildFooterMenu(t: Track): MenuEntry[] {
    return [
      { label: "Play Now", icon: "img/sub_play.png", onClick: () => playTrack(t, queue) },
      { label: "Play Next", icon: "img/sub_next.png", onClick: () => addTrackNext(t) },
      { label: "Go to Artist", icon: "img/sub_artist.png", disabled: !t.artist_id, onClick: () => t.artist_id && navigateTo({ tab: "artists", artistId: t.artist_id }) },
      { label: "Open Album", icon: "img/album.png", disabled: !t.album_id, onClick: () => openAlbum(t) },
      { label: "Start Radio", icon: "img/radio.png", onClick: () => startRadio(t) },
      {
        label: "Add to Playlist", icon: "img/playlist.png",
        submenu: [
          { label: "New Playlist…", icon: "img/add.png", onClick: () => setNewPlaylistFor(t) },
          ...playlists.map((p) => ({
            label: `${p.name}  (${p.song_count})`,
            icon: "img/playlist.png",
            onClick: () => addToExistingPlaylist(p.id, t),
          })),
        ],
      },
      { label: "Get Info", icon: "img/info.png", onClick: () => setInfoTrack(t) },
      {
        label: t.starred ? "Remove from Favorites" : "Add to Favorites",
        icon: t.starred ? "img/heart_filled.png" : "img/heart.png",
        color: FAVORITE_PINK,
        onClick: () => toggleFavoriteFromMenu(t),
      },
    ];
  }

  return (
    <div
      ref={barRef}
      className="flex items-center shrink-0"
      style={{
        height: 132, background: "var(--panel-bg)",
        borderTop: "1px solid var(--border)",
        paddingLeft: 8, paddingRight: 12,
      }}
    >
      {/* ── LEFT: art + track info — matches footer_bar.qml's leftBlock: 19% of the
          footer's own width, floored at 160px, so it shrinks/grows with window size
          instead of a fixed pixel column (leaves more room for the waveform on wide
          windows, same trade-off the old app makes) ── */}
      <div className="flex items-center shrink-0 gap-3" style={{ width: "max(160px, 19%)", overflow: "visible" }}>
        {/* Art thumbnail — shrinks to width 0 in lockstep with the left panel's art
            section expanding (both driven by the same sidebarArtExpanded toggle),
            matching footer_bar.qml's artWrap (250ms InOutCubic on width). Expand
            button reveals on hovering the whole thumbnail (or the button itself),
            matching artHoverArea.containsMouse || expandClick.containsMouse. */}
        <div
          onMouseEnter={() => setArtHov(true)}
          onMouseLeave={() => setArtHov(false)}
          onTransitionEnd={recomputeTitleWidth}
          onContextMenu={(e) => { if (track) { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); } }}
          style={{
            position: "relative", height: 84,
            width: sidebarArtExpanded ? 0 : 84,
            overflow: "hidden", borderRadius: 4, flexShrink: 0,
            transition: "width 250ms cubic-bezier(0.65, 0, 0.35, 1)",
          }}
        >
          <CoverArt coverId={track?.cover_id ?? null} size={84} className="w-[84px] h-[84px] rounded shrink-0" />
          {!sidebarArtExpanded && (
            <button
              onClick={() => { setExpandBtnHov(false); setArtHov(false); toggleSidebarArt(); }}
              onMouseEnter={() => setExpandBtnHov(true)}
              onMouseLeave={() => setExpandBtnHov(false)}
              title="Expand"
              style={{
                position: "absolute", top: 2, right: 2, width: 24, height: 24, borderRadius: 12,
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                border: `2px solid color-mix(in srgb, var(--accent) ${expandBtnHov ? 100 : 30}%, transparent)`,
                background: `color-mix(in srgb, var(--accent) ${expandBtnHov ? 40 : 10}%, transparent)`,
                opacity: artHov || expandBtnHov ? 1 : 0,
                transition: "opacity 180ms",
              }}
            >
              <Icon src="img/expand.png" size={16} style={{ background: expandBtnHov ? "#ffffff" : "#515151" }} />
            </button>
          )}
        </div>
        <div className="min-w-0 flex flex-col justify-center gap-0.5" style={{ overflow: "visible" }}>
          <p
            ref={titleRef}
            onClick={() => track && setTab("nowPlaying")}
            onContextMenu={(e) => { if (track) { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); } }}
            onMouseEnter={() => track && setTitleHov(true)}
            onMouseLeave={() => setTitleHov(false)}
            className="font-semibold leading-snug whitespace-nowrap overflow-hidden text-ellipsis"
            style={{
              fontSize: "var(--fs-primary)", color: "var(--accent)",
              width: titleMaxWidth != null ? Math.max(titleMaxWidth, 0) : undefined,
              maxWidth: titleMaxWidth == null ? "100%" : undefined,
              cursor: track ? "pointer" : "default",
              textDecorationLine: titleHov ? "underline" : "none",
              textUnderlineOffset: "2px", textDecorationThickness: "1px", textDecorationColor: "var(--accent)",
            }}
          >
            {track?.title ?? "—"}
          </p>
          {track && (
            <ArtistTokens name={track.artist} artistId={track.artist_id} fontSize="var(--fs-secondary)" clip={false} />
          )}
          {track?.album && (
            <div className="truncate leading-snug" style={{ fontSize: "var(--fs-secondary)" }}>
              <AlbumLink name={track.album} albumId={track.album_id} />
            </div>
          )}
          {(effectiveBpm != null || bpmLoading || track?.format) && (
            <p className="truncate leading-snug" style={{ fontSize: "var(--fs-secondary)", color: "var(--text-secondary)" }}>
              {(effectiveBpm != null || bpmLoading) && (
                <span
                  onClick={(e) => { if (track && effectiveBpm != null) setBpmMenu({ x: e.clientX, y: e.clientY }); }}
                  onMouseEnter={(e) => (e.currentTarget.style.textDecorationLine = "underline")}
                  onMouseLeave={(e) => (e.currentTarget.style.textDecorationLine = "none")}
                  style={{ cursor: effectiveBpm != null ? "pointer" : "default", textUnderlineOffset: 2, textDecorationThickness: 1, textDecorationColor: "var(--accent)" }}
                >
                  {effectiveBpm != null ? `${effectiveBpm.toFixed(1)} BPM` : "···BPM"}
                </span>
              )}
              {(effectiveBpm != null || bpmLoading) && track?.format && "  ·  "}
              {track?.format}
            </p>
          )}
        </div>
      </div>

      {/* ── CENTER: transport controls + waveform ── */}
      {/* pointerEvents:none on the wrapper + "auto" on the two actual content
          rows below: this box spans the footer's full height, and since it's
          a later DOM sibling of leftBlock it paints (and hit-tests) on top of
          any artist text spilling in from the left column's clip:false case
          above — without this, clicks on that spilled text landed on this
          empty, transparent div instead of the artist token underneath it. */}
      <div className="flex-1 flex flex-col items-center justify-center" style={{ gap: 4, pointerEvents: "none" }}>

        {/* Transport row — matches QML controlsRow: 40×40 buttons (36×36 for
            stop/repeat), 58×58 play ring, 20px gaps */}
        <div ref={controlsRowRef} className="flex items-center" style={{ gap: 20, pointerEvents: "auto" }}>
          <TBtn icon="img/stop.png"    iconSize={16} btnSize={36} radius={18} onClick={stop}          title="Stop" />
          <TBtn icon="img/shuffle.png" iconSize={18} btnSize={40} radius={20} onClick={toggleShuffle} dot={shuffle} title="Shuffle" />
          <TBtn icon="img/prev.png"    iconSize={16} btnSize={40} radius={20} onClick={prev}          title="Previous" />

          {/* Play ring — 58×58, matches QML playBtn */}
          <PlayRingButton
            icon={playing ? "img/pause.png" : "img/play.png"}
            onClick={playPause}
            title={playing ? "Pause" : "Play"}
          />

          <TBtn icon="img/next.png"   iconSize={16} btnSize={40} radius={20} onClick={next}          title="Next" />
          <TBtn icon="img/repeat.png" iconSize={16} btnSize={36} radius={18} onClick={toggleRepeat}  dot={repeat} title="Repeat" />
        </div>

        {/* Waveform row — real per-track amplitude data, matches the old app's
            Canvas bar waveform (footer_bar.qml displayMode:2) rather than a
            plain slider. Right label shows remaining time as a countdown.
            Fills the full row width (matches the QML Row's `width: parent.width`
            + waveformWrap's `parent.width - both label widths - 30`) — no
            artificial cap; a leftover 580px max from the pre-waveform plain
            slider was making the bars render much shorter than they should. */}
        <div className="flex items-center w-full" style={{ gap: 15, pointerEvents: "auto" }}>
          <span className="tabular-nums text-right shrink-0" style={{ minWidth: 56, fontSize: "var(--fs-secondary)", fontWeight: 700, color: "var(--accent)" }}>
            {fmtDuration(currentTime)}
          </span>
          {track ? (
            <Waveform
              streamUrl={track.stream_url}
              trackId={track.id}
              currentTime={currentTime}
              duration={duration}
              onSeek={setCurrentTime}
            />
          ) : (
            <div className="flex-1" style={{ height: 60 }} />
          )}
          <span
            onClick={toggleShowRemaining}
            title={showRemaining ? "Show total duration" : "Show remaining time"}
            className="tabular-nums shrink-0"
            style={{ minWidth: 56, fontSize: "var(--fs-secondary)", fontWeight: 700, color: "var(--accent)", cursor: "pointer" }}
          >
            {showRemaining
              ? (duration > 0 ? `-${fmtDuration(remaining)}` : fmtDuration(0))
              : fmtDuration(duration)}
          </span>
        </div>
      </div>

      {/* ── RIGHT: settings + volume + cast — matches footer_bar.qml's rightBlock:
          same 19% proportion as leftBlock, floored higher (260px) since this row's
          icon/slider cluster needs more room than leftBlock's compact art+text ── */}
      <div className="flex items-center shrink-0 justify-end" style={{ width: "max(260px, 19%)", gap: 6 }}>
        {/* Settings */}
        <button
          className="flex items-center justify-center shrink-0"
          style={{ width: 40, height: 40, borderRadius: 20, background: "transparent", border: "none", cursor: "pointer", color: "var(--accent)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Icon src="img/settings.png" size={20} />
        </button>

        {/* Mute — muted uses a distinct muted-gray tint (not a dimmed accent), matching the old app */}
        <button
          onClick={() => setVolume(volume === 0 ? 80 : 0)}
          className="flex items-center justify-center shrink-0"
          style={{ width: 40, height: 40, borderRadius: 20, background: "transparent", border: "none", cursor: "pointer", color: volume === 0 ? "var(--text-secondary)" : "var(--accent)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Icon src={volume === 0 ? "img/volume_mute.png" : "img/volume.png"} size={29} />
        </button>

        {/* Volume slider — 100px groove matching QML */}
        <input
          type="range" min={0} max={100} value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="cursor-pointer shrink-0"
          style={{ width: 100, height: 5, accentColor: "var(--accent)" }}
        />

        {/* Cast — no casting feature implemented, so always shows the disconnected
            muted-gray tint (the old app's connected state uses accent instead) */}
        <button
          className="flex items-center justify-center shrink-0"
          style={{ width: 40, height: 40, borderRadius: 20, background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Icon src="img/cast.png" size={22} />
        </button>
      </div>

      {ctxMenu && track && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={buildFooterMenu(track)} onClose={() => setCtxMenu(null)} />
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
      {bpmMenu && effectiveBpm != null && (
        <BpmMenu x={bpmMenu.x} y={bpmMenu.y} bpm={effectiveBpm} onApply={applyBpm} onClose={() => setBpmMenu(null)} />
      )}
    </div>
  );
}
