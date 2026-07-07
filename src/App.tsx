import { useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStore, tryAutoConnect, Tab } from "./store";
import { applyTheme, loadSavedTheme } from "./lib/theme";
import { loadJSON, saveJSON } from "./components/TrackTable";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:  1000 * 60 * 5,   // 5 min — data is fresh, no background refetch
      gcTime:     1000 * 60 * 30,  // 30 min — inactive data kept in RAM
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
import { Login } from "./screens/Login";
import { Albums } from "./screens/Albums";
import { Artists } from "./screens/Artists";
import { Tracks } from "./screens/Tracks";
import { Playlists } from "./screens/Playlists";
import { Starred } from "./screens/Starred";
import { Placeholder } from "./screens/Placeholder";
import { NowPlaying } from "./screens/NowPlaying";
import { Home } from "./screens/Home";
import { Settings } from "./screens/Settings";
import { PlayerBar } from "./components/PlayerBar";
import { LeftPanel } from "./components/LeftPanel";
import { QueuePanel } from "./components/QueuePanel";
import { Icon } from "./components/Icon";
import { GlobalTooltip } from "./components/GlobalTooltip";
import { GlobalHotkeys } from "./components/GlobalHotkeys";
import { SpotlightSearch } from "./components/SpotlightSearch";
import { UpdateBanner } from "./components/UpdateBanner";

// Full old-app nav order (window.py's addTab sequence) — Home, Now Playing,
// Mix Builder, and Visualizer aren't built out yet, so they render Placeholder
// for now rather than being left out of the nav bar entirely.
const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: "home",       label: "Home",        icon: "img/home.png" },
  { id: "nowPlaying", label: "Now Playing", icon: "img/now_playing.png" },
  { id: "albums",     label: "Albums",      icon: "img/albums.png" },
  { id: "artists",    label: "Artists",     icon: "img/artists.png" },
  { id: "tracks",     label: "Tracks",      icon: "img/tracks.png" },
  { id: "playlists",  label: "Playlists",   icon: "img/playlists.png" },
  { id: "starred",    label: "Favorites",   icon: "img/heart.png" },
  { id: "mixBuilder", label: "Mix Builder", icon: "img/mix.png" },
  { id: "visualizer", label: "Visualizer",  icon: "img/visualizer.png" },
];

// Matches the old app's drag-reorderable tab bar (persisted QSettings key
// "tab_order") — same idea, localStorage instead. Guarded against a saved
// order that's stale relative to NAV (missing ids from a newly-added tab, or
// containing ids that no longer exist) rather than assuming it's always valid.
const LS_NAV_ORDER = "nav_tab_order";
const DEFAULT_NAV_ORDER: Tab[] = NAV.map((n) => n.id);

function loadNavOrder(): Tab[] {
  const saved = loadJSON<Tab[]>(LS_NAV_ORDER, DEFAULT_NAV_ORDER);
  const valid = new Set(DEFAULT_NAV_ORDER);
  const filtered = saved.filter((id) => valid.has(id));
  const missing = DEFAULT_NAV_ORDER.filter((id) => !filtered.includes(id));
  return [...filtered, ...missing];
}

// Sizing/color ported from the old app's _TabBar QSS (mixins/visuals.py:748-756)
// + its custom paintEvent halo (window.py:143-169), not guessed: 16px icons,
// fontSizePrimary (--fs-primary), BOLD for every tab (not just active — only
// the *label* color differs, the icon is always accent), 10px/5px padding, no
// opacity fade on inactive tabs (a plain color difference, full opacity both
// ways), and the active-tab highlight is a hand-painted rounded rect filled
// with accent at alpha 45/255 (~17.6%), radius 6px, no border stroke — not
// the app's general var(--hover-bg) token. minWidth gives every tab the same
// footprint regardless of label length (matches QTabBar's native equal-width
// tab sizing) — only visible on whichever tab is active (its background pill
// reveals the reserved space), which is why a short label like "Home" shows
// noticeably more padding around its icon+text than a long one like
// "Mix Builder" once it's the active tab.
// Full-label tab width (used both for layout and for computing the icon-only
// breakpoint below) and the icon-only mode's tighter width.
const FULL_TAB_WIDTH = 110;
const COMPACT_TAB_WIDTH = 44;
const TAB_GAP = 4;

function NavTab({
  n, active, dragging, compact, onClick, onDragStart, onDragOver, onDragEnd,
}: {
  n: typeof NAV[0]; active: boolean; dragging: boolean; compact: boolean; onClick: () => void;
  onDragStart: () => void; onDragOver: () => void; onDragEnd: () => void;
}) {
  return (
    <button
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDragEnd={onDragEnd}
      title={compact ? n.label : undefined}
      className="flex items-center justify-center gap-1.5 shrink-0 transition-colors"
      style={{
        padding: "10px 5px",
        minWidth: compact ? COMPACT_TAB_WIDTH : FULL_TAB_WIDTH,
        borderRadius: 6,
        fontSize:   "var(--fs-primary)",
        fontWeight: 700,
        background: active ? "color-mix(in srgb, var(--accent) 17.6%, transparent)" : "transparent",
        opacity: dragging ? 0.4 : 1,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--hover-bg)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon src={n.icon} size={compact ? 20 : 16} style={{ background: "var(--accent)" }} />
      {!compact && <span style={{ color: active ? "var(--accent)" : "var(--text-primary)" }}>{n.label}</span>}
    </button>
  );
}

function MainApp() {
  const activeTab    = useStore((s) => s.activeTab);
  const setTab       = useStore((s) => s.setTab);
  const pushNav      = useStore((s) => s.pushNav);
  const currentEntry = useStore((s) => s.navHistory[s.navPos]);
  const [mounted, setMounted] = useState<Set<string>>(() => new Set([activeTab]));
  useEffect(() => {
    setMounted((prev) => prev.has(activeTab) ? prev : new Set([...prev, activeTab]));
  }, [activeTab]);

  const [navOrder, setNavOrder] = useState<Tab[]>(loadNavOrder);
  const [dragTab, setDragTab] = useState<Tab | null>(null);
  useEffect(() => { saveJSON(LS_NAV_ORDER, navOrder); }, [navOrder]);

  // Icon-only compact mode — matches the old app's _update_tab_mode: switches
  // when the tab bar's full-label width no longer fits the header, using the
  // *same* threshold for entering and leaving (no hysteresis gap there either,
  // so a resize sitting right at the boundary can flicker in both apps).
  const headerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    function check() {
      const needed = navOrder.length * FULL_TAB_WIDTH + (navOrder.length - 1) * TAB_GAP;
      setCompact(needed > el!.clientWidth - 24); // -24 = the row's own px-3 padding
    }
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [navOrder.length]);

  function handleDragOver(overId: Tab) {
    if (!dragTab || dragTab === overId) return;
    setNavOrder((prev) => {
      const from = prev.indexOf(dragTab);
      const to = prev.indexOf(overId);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, dragTab);
      return next;
    });
  }

  function handleTabClick(tab: Tab) {
    const inDetail = !!(currentEntry?.album || currentEntry?.artistId || currentEntry?.playlist);
    if (tab === activeTab && inDetail) {
      pushNav(); // push clean entry (no detail) → jumps to grid top
    } else {
      setTab(tab);
    }
  }

  return (
    <div className="flex flex-col h-screen" style={{ background: "var(--panel-bg)" }}>
      <div className="flex flex-1 overflow-hidden">
        <LeftPanel />

        <div className="flex flex-col flex-1 overflow-hidden" style={{ background: "var(--main-bg)" }}>
          {/* Tab bar — centered in the header (matches the old app's main_header,
              which puts an addStretch() on both sides of the QTabBar) */}
          <div
            ref={headerRef}
            className="flex items-center justify-center px-3 shrink-0"
            style={{ height: 62, gap: 4, borderBottom: "1px solid var(--border)" }}
          >
            {navOrder.map((id) => {
              const n = NAV.find((entry) => entry.id === id);
              if (!n) return null;
              return (
                <NavTab
                  key={n.id}
                  n={n}
                  compact={compact}
                  active={activeTab === n.id}
                  dragging={dragTab === n.id}
                  onClick={() => handleTabClick(n.id)}
                  onDragStart={() => setDragTab(n.id)}
                  onDragOver={() => handleDragOver(n.id)}
                  onDragEnd={() => setDragTab(null)}
                />
              );
            })}
          </div>

          <div className="flex-1 overflow-hidden relative">
            {/* display:none (not visibility:hidden) — a hidden visibility:hidden panel still
                gets laid out/painted every frame, so a heavy virtualized grid (hundreds of
                <img> covers) can visibly lag behind the tab switch for a frame or two. */}
            <div className="absolute inset-0 flex flex-col tab-pane" style={{ display: activeTab === "home"       ? "flex" : "none" }}>{mounted.has("home")       && <Home />}</div>
            <div className="absolute inset-0 flex flex-col tab-pane" style={{ display: activeTab === "nowPlaying" ? "flex" : "none" }}>{mounted.has("nowPlaying") && <NowPlaying active={activeTab === "nowPlaying"} />}</div>
            <div className="absolute inset-0 flex flex-col tab-pane" style={{ display: activeTab === "albums"     ? "flex" : "none" }}>{mounted.has("albums")     && <Albums />}</div>
            <div className="absolute inset-0 flex flex-col tab-pane" style={{ display: activeTab === "artists"    ? "flex" : "none" }}>{mounted.has("artists")    && <Artists />}</div>
            <div className="absolute inset-0 flex flex-col tab-pane" style={{ display: activeTab === "tracks"     ? "flex" : "none" }}>{mounted.has("tracks")     && <Tracks />}</div>
            <div className="absolute inset-0 flex flex-col tab-pane" style={{ display: activeTab === "playlists"  ? "flex" : "none" }}>{mounted.has("playlists")  && <Playlists />}</div>
            <div className="absolute inset-0 flex flex-col tab-pane" style={{ display: activeTab === "starred"    ? "flex" : "none" }}>{mounted.has("starred")    && <Starred />}</div>
            <div className="absolute inset-0 flex flex-col tab-pane" style={{ display: activeTab === "mixBuilder" ? "flex" : "none" }}>{mounted.has("mixBuilder") && <Placeholder label="Mix Builder" />}</div>
            <div className="absolute inset-0 flex flex-col tab-pane" style={{ display: activeTab === "visualizer" ? "flex" : "none" }}>{mounted.has("visualizer") && <Placeholder label="Visualizer" />}</div>
            <div className="absolute inset-0 flex flex-col tab-pane" style={{ display: activeTab === "settings"   ? "flex" : "none" }}>{mounted.has("settings")   && <Settings />}</div>
          </div>
        </div>

        <QueuePanel />
      </div>

      <PlayerBar />
    </div>
  );
}

export default function App() {
  return <QueryClientProvider client={queryClient}><AppInner /></QueryClientProvider>;
}

function AppInner() {
  const connected = useStore((s) => s.connected);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    applyTheme(loadSavedTheme());
    tryAutoConnect().finally(() => setBooting(false));

    // Show scrollbar thumb while scrolling — mirrors old app's isScrollActive / scrollHideTimer(600ms)
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const html = document.documentElement;
    const onScroll = () => {
      html.classList.add("is-scrolling");
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => html.classList.remove("is-scrolling"), 600);
    };
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      if (scrollTimer) clearTimeout(scrollTimer);
    };
  }, []);

  if (booting) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "var(--panel-bg)" }}>
        <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>Connecting…</span>
      </div>
    );
  }

  return (
    <>
      {connected ? <MainApp /> : <Login />}
      {connected && <GlobalHotkeys />}
      {connected && <SpotlightSearch />}
      <GlobalTooltip />
      <UpdateBanner />
    </>
  );
}
