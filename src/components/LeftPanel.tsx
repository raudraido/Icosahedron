import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useStore } from "../store";
import { api } from "../lib/api";
import { getRecentTracks, formatRelativeTime, LastFmTrack } from "../lib/lastfm";
import { matchesArtistCredit } from "./ArtistTokens";
import { CoverArt } from "./CoverArt";
import { Icon } from "./Icon";
import { TetrisWidget } from "./TetrisWidget";
import { PongWidget } from "./PongWidget";
import { SpaceInvadersWidget } from "./SpaceInvadersWidget";
import { BreakoutWidget } from "./BreakoutWidget";
import { XonixWidget } from "./XonixWidget";
import { ContextMenu } from "./ContextMenu";
import { ScrollThumb } from "./ScrollThumb";
import { loadJSON, saveJSON } from "./TrackTable";

const LS_RECENTLY_PLAYED_HEIGHT = "icosahedron_recently_played_height";
const LS_RECENTLY_PLAYED_COLLAPSED = "icosahedron_recently_played_collapsed";
const RECENTLY_PLAYED_DEFAULT_HEIGHT = 220;
const RECENTLY_PLAYED_MIN_HEIGHT = 80;
// Row height depends on the theme's fs-secondary/fs-small sizes (Settings >
// Theme Builder), so "10 rows" can't be a fixed pixel constant — it's
// measured live from the header label + one actual rendered row (see the
// ResizeObserver effect below) and only falls back to this guess before
// that first measurement lands.
const RECENTLY_PLAYED_MAX_HEIGHT_FALLBACK = 480;
const RECENTLY_PLAYED_MAX_ROWS = 10;

// "Recently Played" — Last.fm's own play history for whichever account is
// connected (Settings > Integrations > Last.fm), not Navidrome's. Entirely
// separate signal from the "Scrobble" toggle: this only ever reads, never
// writes, and works regardless of whether Navidrome's own server-side
// Last.fm relay is configured at all.
function RecentlyPlayed() {
  const apiKey = useStore((s) => s.lastfmPublicApiKey);
  const username = useStore((s) => s.lastfmConnectedUsername);
  // Three gates have to be on: lastfmConnected means an account is actually
  // linked (see Settings > Integrations > Last.fm's Connect flow),
  // lastFmEnabled is the Integrations-level "Recently Played" toggle
  // (only togglable once connected), lastFmSidebarVisible is the
  // purely-visual Appearance toggle layered on top of it.
  const lastfmConnected = useStore((s) => s.lastfmConnected);
  const lastFmEnabled = useStore((s) => s.lastFmEnabled);
  const sidebarVisible = useStore((s) => s.lastFmSidebarVisible);
  const enabled = lastfmConnected && lastFmEnabled && sidebarVisible;
  const playTrack = useStore((s) => s.playTrack);
  const addTrackNext = useStore((s) => s.addTrackNext);
  const addTrackToQueue = useStore((s) => s.addTrackToQueue);
  const navigateTo = useStore((s) => s.navigateTo);
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: LastFmTrack } | null>(null);
  const [height, setHeight] = useState(() => loadJSON(LS_RECENTLY_PLAYED_HEIGHT, RECENTLY_PLAYED_DEFAULT_HEIGHT));
  const [collapsed, setCollapsed] = useState(() => loadJSON(LS_RECENTLY_PLAYED_COLLAPSED, false));
  const listRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const firstRowRef = useRef<HTMLButtonElement>(null);
  const [maxHeight, setMaxHeight] = useState(RECENTLY_PLAYED_MAX_HEIGHT_FALLBACK);

  // Measures the actual rendered label-block height + one row's height
  // (both theme-font-size-dependent) so "10 rows max" tracks whatever font
  // size Settings > Theme Builder has set, instead of guessing a pixel
  // value that'd only be right for one specific size.
  useEffect(() => {
    const labelEl = labelRef.current;
    const rowEl = firstRowRef.current;
    if (!labelEl || !rowEl) return;
    function measure() {
      const next = labelEl!.offsetHeight + rowEl!.offsetHeight * RECENTLY_PLAYED_MAX_ROWS;
      setMaxHeight(next);
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(labelEl);
    ro.observe(rowEl);
    return () => ro.disconnect();
  });

  // Font size changes (or a max-height that shrinks for any other reason)
  // shouldn't leave a stale, now-too-tall height in place.
  useEffect(() => {
    if (height > maxHeight) {
      setHeight(maxHeight);
      saveJSON(LS_RECENTLY_PLAYED_HEIGHT, maxHeight);
    }
  }, [height, maxHeight]);

  // Drag-to-resize handle below the list — a plain local `current` variable
  // (not a ref) is enough since it only needs to live for the duration of
  // one drag, captured fresh by each onResizeStart call.
  function onResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    let current = startHeight;
    function onMove(ev: MouseEvent) {
      current = Math.max(RECENTLY_PLAYED_MIN_HEIGHT, Math.min(maxHeight, startHeight + (ev.clientY - startY)));
      setHeight(current);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      saveJSON(LS_RECENTLY_PLAYED_HEIGHT, current);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const {
    data, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["lastfm-recent-tracks", apiKey, username],
    queryFn: ({ pageParam }) => getRecentTracks(apiKey, username ?? "", pageParam, 50),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
    // Gated on the Settings > Playback toggle too, not just "are
    // credentials present" — no point polling Last.fm every 30s for a list
    // the user has deliberately turned off.
    enabled: Boolean(apiKey && username && enabled),
    // Auto-refresh only while just the first page is loaded — an
    // infinite-query refetch re-requests every already-fetched page in
    // sequence, so once the user's scrolled several pages deep, a 30s
    // timer doing that would mean a burst of N requests every 30s instead
    // of one. Scrolling to the bottom still fetches more on demand either way.
    refetchInterval: (query) => (query.state.data ? (query.state.data.pages.length === 1 ? 30_000 : false) : 30_000),
    retry: false,
  });
  const tracks = data?.pages.flatMap((p) => p.tracks);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
    if (nearBottom && hasNextPage && !isFetchingNextPage) fetchNextPage();
  }

  // Shared "find the real library Track behind this Last.fm history entry"
  // step — Last.fm only ever gives us free-text name/artist/album, so every
  // action (play, queue, right-click menu) needs this same search-then-match
  // round-trip before it has anything real to act on.
  async function resolveTrack(entry: LastFmTrack) {
    const result = await api.search(`${entry.artist} ${entry.name}`, 0, 0, 10);
    return result.tracks.find((t) =>
      t.title.toLowerCase() === entry.name.toLowerCase() && matchesArtistCredit(t.artist, entry.artist)
    ) ?? result.tracks[0];
  }

  async function withResolvedTrack(entry: LastFmTrack, key: string, action: (track: Awaited<ReturnType<typeof resolveTrack>>) => void) {
    setResolvingKey(key);
    try {
      const match = await resolveTrack(entry);
      if (match) action(match);
    } catch {
      // best-effort — a history entry that can't be found in the library
      // just doesn't do anything, no error dialog needed for a background list
    } finally {
      setResolvingKey(null);
    }
  }

  function handlePlay(entry: LastFmTrack, key: string) {
    withResolvedTrack(entry, key, (track) => track && playTrack(track, [track]));
  }

  // "Go to Artist" has no track match to lean on — Navidrome's own artist
  // search is the more direct (and often more reliable, since an artist-only
  // query has less to disagree on than a full title+artist track match) path.
  async function goToArtist(entry: LastFmTrack, key: string) {
    setResolvingKey(key);
    try {
      const result = await api.search(entry.artist, 5, 0, 0);
      const match = result.artists.find((a) => a.name.toLowerCase() === entry.artist.toLowerCase()) ?? result.artists[0];
      navigateTo(match ? { tab: "artists", artistId: match.id } : { tab: "artists", artistQuery: entry.artist });
    } catch {
      // best-effort
    } finally {
      setResolvingKey(null);
    }
  }

  // Not configured, toggled off, or nothing to show yet — same plain
  // spacer the sidebar used before this list existed, so the art section/
  // games below still anchor to the bottom instead of collapsing upward
  // with no filler.
  if (!apiKey || !username || !enabled || !tracks?.length) return <div className="flex-1" />;

  function toggleCollapsed() {
    setCollapsed((prev: boolean) => {
      const next = !prev;
      saveJSON(LS_RECENTLY_PLAYED_COLLAPSED, next);
      return next;
    });
  }

  return (
    <>
      <div className="flex flex-col" style={{ height: collapsed ? "auto" : height, flexShrink: 0, minHeight: 0, padding: "8px 8px 0" }}>
        <div ref={labelRef} className="flex items-center justify-between" style={{ padding: "0 2px 6px" }}>
          <span style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
            Recently Played
          </span>
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expand" : "Collapse"}
            className="flex items-center justify-center"
            style={{ width: 18, height: 18, background: "transparent", border: "none", cursor: "pointer", borderRadius: 4 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover-bg)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <Icon src={collapsed ? "img/down_arrow.png" : "img/up_arrow.png"} size={10} style={{ background: "var(--text-secondary)" }} />
          </button>
        </div>
        {!collapsed && (
        <div className="flex-1" style={{ position: "relative", minHeight: 0 }}>
        <div ref={listRef} onScroll={handleScroll} className="h-full overflow-y-auto scroll-clean" style={{ minHeight: 0 }}>
          {tracks.map((t, i) => {
            const key = `${t.name}|${t.artist}|${t.playedAt ?? i}`;
            const resolving = resolvingKey === key;
            return (
              <button
                key={key}
                ref={i === 0 ? firstRowRef : undefined}
                onClick={() => handlePlay(t, key)}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, entry: t }); }}
                disabled={resolving}
                className="flex flex-col w-full text-left"
                style={{
                  padding: "6px 8px", borderRadius: 6, cursor: resolving ? "default" : "pointer",
                  background: "transparent",
                }}
                onMouseEnter={(e) => { if (!resolving) e.currentTarget.style.background = "var(--hover-bg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <div className="flex items-center" style={{ gap: 6 }}>
                  {t.nowPlaying && (
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                  )}
                  <span className="truncate" style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)", fontWeight: 600 }}>
                    {t.name}
                  </span>
                </div>
                <div className="flex items-center" style={{ gap: 6, paddingLeft: t.nowPlaying ? 12 : 0 }}>
                  <span
                    className="truncate flex-1"
                    onClick={(e) => { e.stopPropagation(); goToArtist(t, key); }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.textDecoration = "underline"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.textDecoration = "none"; }}
                    style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)", cursor: "pointer" }}
                  >
                    {t.artist}
                  </span>
                  {t.playedAt != null && (
                    <span className="shrink-0" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)", opacity: 0.6 }}>
                      {formatRelativeTime(t.playedAt)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {isFetchingNextPage && (
            <div style={{ padding: "6px 8px", color: "var(--text-secondary)", fontSize: "var(--fs-small)", textAlign: "center" }}>
              Loading more…
            </div>
          )}
        </div>
        <ScrollThumb scrollRef={listRef} />
        </div>
        )}
      </div>

      {/* Drag-to-resize handle — same "thin strip, visible divider line
          inside it" affordance as TrackTable.tsx's column resizers, just
          the vertical (row-resize) equivalent. Nothing to resize while
          collapsed, so the handle (and the spacer below) stand in for the
          expanded view's height + resize-drag + trailing-spacer trio. */}
      {!collapsed && (
        <div
          onMouseDown={onResizeStart}
          className="flex items-center justify-center shrink-0"
          style={{ height: 10, margin: "0 8px", cursor: "row-resize" }}
        >
          <div style={{ width: "100%", height: 1, background: "var(--border)" }} />
        </div>
      )}

      {/* Absorbs whatever space the fixed-height list above doesn't use —
          same role the old plain flex-1 spacer had before this list existed. */}
      <div className="flex-1" />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { label: "Play Now", icon: "img/sub_play.png", onClick: () => withResolvedTrack(menu.entry, `${menu.entry.name}|${menu.entry.artist}`, (t) => t && playTrack(t, [t])) },
            { label: "Play Next", icon: "img/sub_next.png", onClick: () => withResolvedTrack(menu.entry, `${menu.entry.name}|${menu.entry.artist}`, (t) => t && addTrackNext(t)) },
            { label: "Add to Queue", icon: "img/queue.png", onClick: () => withResolvedTrack(menu.entry, `${menu.entry.name}|${menu.entry.artist}`, (t) => t && addTrackToQueue(t)) },
            "separator",
            { label: "Go to Artist", icon: "img/sub_artist.png", onClick: () => goToArtist(menu.entry, `${menu.entry.name}|${menu.entry.artist}`) },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

type GameId = "tetris" | "pong" | "spaceInvaders" | "breakout" | "xonix";

// Matches left_panel.qml's artTargetSize = leftPanel.width() - 16 (8px margin
// each side) — our left panel is a fixed 297px, so this is a constant rather
// than something that needs measuring.
const ART_SIZE = 297 - 8 * 2;

// 30×30 button matching the old app's ArrowButton (player/widgets.py:1988):
// chevron is 6px wide × 12px tall with a 2px stroke (drawn via QPainter.drawLine
// there; an SVG polyline gets the same result), always full opacity — enabled
// is the accent color (re-tinted via set_color(masterColor) in the old app,
// not the theme's plain text color), disabled swaps to a fixed #333 rather
// than fading via opacity. Hover fills the whole 30×30 box (12px radius,
// matching the button's own border-radius) with the theme's hover color.
export function NavArrow({ direction, disabled, onClick }: { direction: "left" | "right"; disabled: boolean; onClick: () => void }) {
  const color = disabled ? "#333333" : "var(--accent)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 30, height: 30, flexShrink: 0,
        background: "transparent", border: "none", cursor: disabled ? "default" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 12,
        transition: "background 150ms",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "var(--hover-bg)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {/* Chevron drawn in SVG — matches paintEvent drawLine approach */}
      <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
        {direction === "left" ? (
          <polyline points="7,1 1,7 7,13" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <polyline points="1,1 7,7 1,13" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}

export function LeftPanel() {
  const queue   = useStore((s) => s.queue);
  const idx     = useStore((s) => s.currentIndex);
  const track   = queue[idx] ?? null;
  const expanded = useStore((s) => s.sidebarArtExpanded);
  const toggleSidebarArt = useStore((s) => s.toggleSidebarArt);
  const [closeHov, setCloseHov] = useState(false);
  const [logoHovered, setLogoHovered] = useState(false);
  const [searchHandoff, setSearchHandoff] = useState("");

  // Server switcher — click opens a menu (see render below); the active
  // server, its saved siblings, and the switch/navigate actions all come
  // straight from the same multi-server store used by Settings > Servers.
  const servers = useStore((s) => s.servers);
  const activeServerId = useStore((s) => s.activeServerId);
  const switchServer = useStore((s) => s.switchServer);
  const navigateTo = useStore((s) => s.navigateTo);
  const openSpotlight = useStore((s) => s.openSpotlight);
  const username = useStore((s) => s.username);
  const [serverMenuPos, setServerMenuPos] = useState<{ x: number; y: number } | null>(null);
  const activeServer = servers.find((s) => s.id === activeServerId);

  // Easter egg — ported from the old app's 7-rapid-clicks-on-Home-tab
  // Tetris trigger (window.py:1066-1082), retargeted to 3 clicks on the
  // logo instead. Same 600ms "must be rapid" reset window. Now opens a game
  // picker next to the logo rather than jumping straight to Tetris, since
  // there's more than one game to choose from.
  const [activeGame, setActiveGame] = useState<GameId | null>(null);
  const [gameMenuPos, setGameMenuPos] = useState<{ x: number; y: number } | null>(null);
  const logoClickCountRef = useRef(0);
  const logoClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleLogoClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    // A plain click always toggles the server menu immediately (no delay —
    // this is the primary, everyday gesture and should feel instant). The
    // rapid-triple-click game-picker egg below rides along on the same
    // click stream; overlapping both menus on an intentional triple-click
    // is a harmless, rare edge case next to keeping the common case snappy.
    setServerMenuPos((prev) => (prev ? null : { x: rect.left, y: rect.bottom + 6 }));

    logoClickCountRef.current += 1;
    if (logoClickTimerRef.current) clearTimeout(logoClickTimerRef.current);
    logoClickTimerRef.current = setTimeout(() => { logoClickCountRef.current = 0; }, 600);
    if (logoClickCountRef.current >= 3) {
      logoClickCountRef.current = 0;
      clearTimeout(logoClickTimerRef.current);
      setGameMenuPos({ x: rect.right + 8, y: rect.top });
    }
  }

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ width: 297, background: "var(--panel-bg)", borderRight: "1px solid var(--border)" }}
    >
      {/* Header: just the logo now — nav arrows moved to the tab bar's left
          corner (App.tsx) so the tab row itself stays centered on the whole
          window instead of the remaining space next to these buttons.
          Entire row is still drag region. */}
      <div
        className="flex items-center shrink-0"
        data-tauri-drag-region
        style={{ height: 62, gap: 4, borderBottom: "1px solid var(--border)", paddingRight: 8 }}
      >
        {/* Logo: shahedron2 base + shahedron1 alpha-masked with accent —
            scales up slightly on hover so it reads as clickable (triple-click
            opens the game picker, see handleLogoClick above). */}
        <div
          onClick={handleLogoClick}
          onMouseEnter={() => setLogoHovered(true)}
          onMouseLeave={() => setLogoHovered(false)}
          style={{
            position: "relative", width: 46, height: 46, marginLeft: 8, flexShrink: 0,
            cursor: "pointer",
            transform: `scale(${logoHovered ? 1.12 : 1})`,
            transition: "transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          <img
            src="img/shahedron2.png"
            alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
          />
          <div
            style={{
              position: "absolute", inset: 0,
              background: "var(--accent)",
              WebkitMaskImage: "url(img/shahedron1.png)",
              WebkitMaskSize: "100% 100%",
              WebkitMaskRepeat: "no-repeat",
              maskImage: "url(img/shahedron1.png)",
              maskSize: "100% 100%",
              maskRepeat: "no-repeat",
            }}
          />
        </div>

        {/* Search bar — a real input, but only ever holds the very first
            keystroke: onChange immediately hands off to Spotlight (pre-filled,
            same openSpotlight(initialChar) mechanism GlobalHotkeys.tsx uses
            for "type anywhere" already) and clears itself, so the rest of
            the query is typed into Spotlight's own input with live results
            building as you go — not typed blind into this box first. */}
        <div
          className="flex items-center"
          style={{
            flex: 1, marginLeft: 10, height: 34, gap: 8, padding: "0 12px",
            background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 8,
          }}
        >
          <Icon src="img/search.png" size={14} style={{ background: "var(--text-secondary)", flexShrink: 0 }} />
          <input
            value={searchHandoff}
            onChange={(e) => {
              const v = e.target.value;
              // Explicit state reset (not a hardcoded value="") — guarantees
              // this component re-renders and the input clears immediately,
              // rather than relying on openSpotlight() incidentally causing
              // one.
              setSearchHandoff("");
              if (v) openSpotlight(v);
            }}
            onClick={() => openSpotlight()}
            placeholder="Search…"
            className="w-full outline-none"
            style={{
              background: "transparent", border: "none", color: "var(--text-primary)",
              fontSize: "var(--fs-secondary)", cursor: "text",
            }}
          />
        </div>
      </div>

      <div className="flex flex-col flex-1" style={{ position: "relative", minHeight: 0 }}>
        <RecentlyPlayed />

        {/* Art section — collapsed (height 0) by default, expands upward when the
            footer thumbnail's expand button is clicked. Matches left_panel.qml's
            artSection: same 250ms InOutCubic on height, driven by the same shared
            toggle as the footer thumbnail's width animation, so they move in lockstep
            as a handoff (no cross-fade between the two). */}
        <div style={{ padding: 8, flexShrink: 0 }}>
          <div
            style={{
              position: "relative", width: ART_SIZE,
              height: expanded ? ART_SIZE : 0,
              overflow: "hidden", borderRadius: 5, background: "#121212",
              transition: "height 250ms cubic-bezier(0.65, 0, 0.35, 1)",
            }}
          >
            {track?.cover_id ? (
              <CoverArt coverId={track.cover_id} size={ART_SIZE} className="w-full h-full" />
            ) : (
              <div className="flex items-center justify-center w-full h-full" style={{ fontSize: Math.max(20, ART_SIZE * 0.3), color: "#333333" }}>
                💿
              </div>
            )}

            {expanded && (
              <button
                onClick={() => { setCloseHov(false); toggleSidebarArt(); }}
                onMouseEnter={() => setCloseHov(true)}
                onMouseLeave={() => setCloseHov(false)}
                title="Collapse"
                style={{
                  position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 12,
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                  border: `2px solid color-mix(in srgb, var(--accent) ${closeHov ? 100 : 30}%, transparent)`,
                  background: `color-mix(in srgb, var(--accent) ${closeHov ? 40 : 10}%, transparent)`,
                  opacity: closeHov ? 1 : 0,
                  transition: "opacity 180ms",
                }}
              >
                <Icon src="img/expand.png" size={16} style={{ background: closeHov ? "#ffffff" : "#515151" }} />
              </button>
            )}
          </div>
        </div>

        {activeGame === "tetris" && <TetrisWidget onClose={() => setActiveGame(null)} />}
        {activeGame === "pong" && <PongWidget onClose={() => setActiveGame(null)} />}
        {activeGame === "spaceInvaders" && <SpaceInvadersWidget onClose={() => setActiveGame(null)} />}
        {activeGame === "breakout" && <BreakoutWidget onClose={() => setActiveGame(null)} />}
        {activeGame === "xonix" && <XonixWidget onClose={() => setActiveGame(null)} />}
      </div>

      {gameMenuPos && (
        <ContextMenu
          x={gameMenuPos.x}
          y={gameMenuPos.y}
          items={[
            { label: "Tetris", onClick: () => setActiveGame("tetris") },
            { label: "Pong", onClick: () => setActiveGame("pong") },
            { label: "Space Invaders", onClick: () => setActiveGame("spaceInvaders") },
            { label: "Breakout", onClick: () => setActiveGame("breakout") },
            { label: "Xonix", onClick: () => setActiveGame("xonix") },
          ]}
          onClose={() => setGameMenuPos(null)}
        />
      )}

      {serverMenuPos && (
        <ContextMenu
          x={serverMenuPos.x}
          y={serverMenuPos.y}
          items={[
            {
              label: activeServer?.name ?? username ?? "Not connected",
              icon: "img/navidrome.png",
              rawIcon: true,
              iconSize: 32,
              iconOffsetX: -6,
              submenu: [
                ...servers.map((s) => ({
                  label: s.name,
                  icon: "img/navidrome.png",
                  rawIcon: true,
                  color: s.id === activeServerId ? "var(--accent)" : undefined,
                  onClick: () => { if (s.id !== activeServerId) switchServer(s.id).catch(() => {}); },
                })),
                "separator" as const,
                {
                  label: "Manage Servers",
                  icon: "img/settings.png",
                  onClick: () => navigateTo({ tab: "settings", settingsTab: "servers" }),
                },
              ],
            },
            "separator",
            {
              label: "Settings",
              icon: "img/settings.png",
              onClick: () => navigateTo({ tab: "settings" }),
            },
            {
              label: "Quit",
              icon: "img/sub_close.png",
              onClick: () => api.quitApp(),
            },
          ]}
          onClose={() => setServerMenuPos(null)}
        />
      )}
    </div>
  );
}
