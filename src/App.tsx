import { useEffect, useRef, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useStore, tryAutoConnect, Tab } from "./store";
import { applyTheme, loadSavedTheme } from "./lib/theme";
import { loadJSON, saveJSON } from "./components/TrackTable";
import { queryClient } from "./lib/queryClient";
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
import { LeftPanel, NavArrow } from "./components/LeftPanel";
import { QueuePanel } from "./components/QueuePanel";
import { Icon } from "./components/Icon";
import { GlobalTooltip } from "./components/GlobalTooltip";
import { GlobalHotkeys } from "./components/GlobalHotkeys";
import { SpotlightSearch } from "./components/SpotlightSearch";
import { ShareDialog } from "./components/ShareDialog";
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
// the app's general var(--hover-bg) token. Unlike QTabBar's native
// equal-width tab sizing, tabs here always size to their own icon+label
// content — a per-tab `maxWidth` cap (computed by MainApp's check() from
// real measured content widths, not a guessed budget) only ever kicks in
// once the whole row genuinely can't fit at natural size, and only shrinks
// the specific tabs wide enough to need it. Any leftover slack goes the
// other direction instead — a per-tab `grow` pads every tab out evenly so
// the tabs section fills its space rather than leaving it blank. See
// waterFillCaps() below.
// 2 × 30px NavArrow buttons + 4px gap between them — the tab bar's left
// corner (see MainApp). No matching right-side spacer: the header is two
// fixed-purpose sections now (this arrows block, then a tabs section that
// fills 100% of what's left), not a single row centered around its own
// content — an earlier centered version left a growing dead gap between
// the last tab and the queue panel on wide windows instead of using it.
const NAV_ARROWS_WIDTH = 30 * 2 + 4;

// The gap between tabs eases from MAX toward MIN as the window narrows
// (see MainApp's check()), and only once it's already at MIN and tabs still
// don't fit at their natural content width do per-tab caps kick in. Below
// that, icon-only is the last resort — FULL_TAB_WIDTH_MIN is the floor per
// tab check() uses to decide labels genuinely can't be shown at all anymore
// (not a size actually applied to any tab).
const FULL_TAB_WIDTH_MIN = 70;
const COMPACT_TAB_WIDTH = 44;
const TAB_GAP_MAX = 4;
const TAB_GAP_MIN = 1;

// Fair-share width allocation: give every id its own natural width unless
// the total doesn't fit `available`, in which case tabs wide enough to
// exceed the per-tab "share" get capped there while everything under the
// share keeps its full natural size — repeated because capping a wide tab
// down to the share frees space that raises the share for whoever's left
// uncapped. Standard water-filling; O(n^2) is irrelevant at n=9 tabs.
function waterFillCaps<T extends string>(ids: T[], naturalWidths: number[], available: number): Partial<Record<T, number>> {
  const n = ids.length;
  const resolved = new Array(n).fill(false);
  const result = new Array(n).fill(0);
  let remaining = available;
  let unresolvedCount = n;
  let changed = true;
  while (changed && unresolvedCount > 0) {
    changed = false;
    const share = remaining / unresolvedCount;
    for (let i = 0; i < n; i++) {
      if (resolved[i] || naturalWidths[i] > share) continue;
      result[i] = naturalWidths[i];
      remaining -= naturalWidths[i];
      unresolvedCount--;
      resolved[i] = true;
      changed = true;
    }
  }
  if (unresolvedCount > 0) {
    const share = remaining / unresolvedCount;
    for (let i = 0; i < n; i++) if (!resolved[i]) result[i] = share;
  }
  const caps: Partial<Record<T, number>> = {};
  ids.forEach((id, i) => { caps[id] = result[i]; });
  return caps;
}

function NavTab({
  n, active, dragging, compact, cap, grow, onClick, onDragStart, onDragOver, onDragEnd,
}: {
  n: typeof NAV[0]; active: boolean; dragging: boolean; compact: boolean;
  /** Width ceiling in px, from MainApp's check()/waterFillCaps() — undefined
   *  means unconstrained (the common case: render at natural content
   *  width). Only a tab whose natural width actually exceeds `cap` gets
   *  truncated; anything under it renders at its own smaller natural size
   *  instead of being padded out to match wider tabs. Mutually exclusive
   *  with `grow`. */
  cap?: number;
  /** Forced width in px, only set when there's more room in the tabs
   *  section than every tab needs at its own natural size — pads the tab
   *  out beyond its content so the section fills the row instead of
   *  leaving the extra space blank. Mutually exclusive with `cap`. */
  grow?: number;
  onClick: () => void;
  onDragStart: () => void; onDragOver: () => void; onDragEnd: () => void;
}) {
  return (
    <button
      data-nav-id={n.id}
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDragEnd={onDragEnd}
      title={compact ? n.label : undefined}
      className="flex items-center justify-center gap-1.5 shrink-0 transition-colors"
      style={{
        padding: "10px 5px",
        width: compact ? COMPACT_TAB_WIDTH : grow,
        maxWidth: compact ? undefined : cap,
        borderRadius: 6,
        fontSize:   "var(--fs-primary)",
        fontWeight: "var(--fw-emphasis)",
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
      <Icon src={n.icon} size={compact ? 20 : 16} style={{ background: "var(--accent)", flexShrink: 0 }} />
      {!compact && (
        <span
          style={{
            color: active ? "var(--accent)" : "var(--text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
          }}
        >
          {n.label}
        </span>
      )}
    </button>
  );
}

function MainApp() {
  const activeTab    = useStore((s) => s.activeTab);
  const setTab       = useStore((s) => s.setTab);
  const pushNav      = useStore((s) => s.pushNav);
  const currentEntry = useStore((s) => s.navHistory[s.navPos]);
  const navBack = useStore((s) => s.navBack);
  const navFwd  = useStore((s) => s.navFwd);
  const canBack = useStore((s) => s.navHistory.length > 0 && s.navPos > 0);
  const canFwd  = useStore((s) => s.navPos < s.navHistory.length - 1);
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
  // Sizing is driven by each tab's real measured content width (via
  // measureRef's hidden clone row below), not a guessed uniform budget — an
  // earlier version assumed every tab needed the same ~134px, which both
  // triggered shrinking far before the row's actual content required it and
  // capped long labels ("Now Playing") below their real natural width even
  // right at that trigger point.
  const headerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [tabGap, setTabGap] = useState(TAB_GAP_MAX);
  const [tabCaps, setTabCaps] = useState<Partial<Record<Tab, number>>>({});
  // Forced per-tab width, only set when there's *more* room than every tab
  // needs at its own natural size — the row is two fixed sections now (nav
  // arrows, then tabs), not centered against a phantom right-side spacer, so
  // slack has to go somewhere rather than sitting blank between the last
  // tab and the queue panel: it's split evenly and added to every tab's
  // natural width. Mutually exclusive with tabCaps (shrinking) — at most one
  // of the two is ever non-empty.
  const [tabGrown, setTabGrown] = useState<Partial<Record<Tab, number>>>({});
  useEffect(() => {
    const el = headerRef.current;
    const measureEl = measureRef.current;
    if (!el || !measureEl) return;
    // Natural widths always come from the hidden, unconstrained clone row —
    // never from the visible tabs' own offsetWidth, which may already be
    // sitting under a cap from a previous narrower layout and would then
    // under-report, sticking the row in shrink mode even after the window
    // grows back.
    function measureNatural(): number[] {
      const byId: Record<string, number> = {};
      measureEl!.querySelectorAll<HTMLButtonElement>("[data-nav-id]").forEach((btn) => {
        byId[btn.dataset.navId!] = btn.offsetWidth;
      });
      return navOrder.map((id) => byId[id] ?? FULL_TAB_WIDTH_MIN);
    }
    function check() {
      // -24 = the row's own px-3 padding; -NAV_ARROWS_WIDTH = the left
      // corner's nav-arrow buttons, the only other fixed-width section left
      // in this row now — the tabs section fills 100% of what's left.
      const available = el!.clientWidth - 24 - NAV_ARROWS_WIDTH;
      const widths = measureNatural();
      const naturalSum = widths.reduce((a, b) => a + b, 0);
      const gapCount = navOrder.length - 1;
      const neededAtMaxGap = naturalSum + gapCount * TAB_GAP_MAX;

      if (available >= neededAtMaxGap) {
        // Room to spare even at everyone's natural size and the widest gap
        // — grow every tab by an equal share of what's left over so the
        // tabs section fills the row all the way to its right edge instead
        // of leaving that slack as dead space.
        const share = (available - neededAtMaxGap) / navOrder.length;
        const grown: Partial<Record<Tab, number>> = {};
        navOrder.forEach((id, i) => { grown[id] = widths[i] + share; });
        setCompact(false);
        setTabGap(TAB_GAP_MAX);
        setTabGrown(grown);
        setTabCaps({});
        return;
      }
      setTabGrown({});
      if (available >= naturalSum + gapCount * TAB_GAP_MIN) {
        // Fits at everyone's natural width as long as the gap shrinks —
        // solve for the exact gap needed rather than capping any tab.
        const gap = gapCount > 0 ? (available - naturalSum) / gapCount : TAB_GAP_MAX;
        setCompact(false);
        setTabGap(Math.max(TAB_GAP_MIN, Math.min(TAB_GAP_MAX, gap)));
        setTabCaps({});
        return;
      }
      const availableForTabs = available - gapCount * TAB_GAP_MIN;
      if (availableForTabs < navOrder.length * FULL_TAB_WIDTH_MIN) {
        // Doesn't fit even at the smallest per-tab floor + smallest gap —
        // only now does it fall back to icon-only.
        setCompact(true);
        setTabGap(TAB_GAP_MAX);
        setTabCaps({});
        return;
      }
      setCompact(false);
      setTabGap(TAB_GAP_MIN);
      setTabCaps(waterFillCaps(navOrder, widths, availableForTabs));
    }
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    // Re-measure once the webfont finishes loading — text metrics before
    // that reflect the fallback font, not Inter Variable, and
    // font-display:swap doesn't fire a layout event of its own to re-trigger this.
    document.fonts?.ready?.then(check);
    return () => ro.disconnect();
  }, [navOrder]);

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
    const inDetail = !!(currentEntry?.album || currentEntry?.artistId || currentEntry?.playlist || currentEntry?.mix);
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
          {/* Tab bar — two fixed sections, not centered against the old
              app's main_header addStretch()-on-both-sides model: nav
              (back/forward) arrows in the left corner (moved here from
              LeftPanel.tsx's header), then a tabs section that fills 100%
              of the row's remaining width up to the queue panel, growing
              every tab evenly to use up any slack instead of leaving it
              blank on the right. */}
          <div
            ref={headerRef}
            className="flex items-center px-3 shrink-0"
            style={{ height: 62, borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex items-center shrink-0" style={{ width: NAV_ARROWS_WIDTH, gap: 4 }}>
              <NavArrow direction="left"  disabled={!canBack} onClick={navBack} />
              <NavArrow direction="right" disabled={!canFwd}  onClick={navFwd} />
            </div>

            {/* justify-content only matters in icon-only mode: at natural
                size or while growing, tabs already fill the section edge to
                edge on their own (see check()'s grow/gap logic), so
                flex-start vs. center makes no visible difference there —
                but compact mode's fixed-size icons rarely fill the whole
                row, and left-aligning them (the default) would otherwise
                leave them stuck to the left edge instead of centered in the
                space actually available. */}
            <div className="flex-1 flex items-center" style={{ gap: tabGap, justifyContent: compact ? "center" : "flex-start" }}>
            {navOrder.map((id) => {
              const n = NAV.find((entry) => entry.id === id);
              if (!n) return null;
              return (
                <NavTab
                  key={n.id}
                  n={n}
                  compact={compact}
                  cap={tabCaps[n.id]}
                  grow={tabGrown[n.id]}
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
          </div>

          {/* Hidden, unconstrained clone of the tab row purely for measuring
              each tab's real natural content width (see check()'s
              measureNatural()) — off-screen rather than display:none/
              visibility:hidden alone, since either of those can report 0
              offsetWidth in some layout paths; absolute positioning well
              outside the viewport keeps it laid out (so it has real
              dimensions) without affecting page flow or being visible. */}
          <div
            ref={measureRef}
            aria-hidden
            className="flex items-center"
            style={{ position: "absolute", top: -9999, left: -9999, gap: TAB_GAP_MAX, pointerEvents: "none" }}
          >
            {navOrder.map((id) => {
              const n = NAV.find((entry) => entry.id === id);
              if (!n) return null;
              return (
                <NavTab
                  key={n.id}
                  n={n}
                  compact={false}
                  active={false}
                  dragging={false}
                  onClick={() => {}}
                  onDragStart={() => {}}
                  onDragOver={() => {}}
                  onDragEnd={() => {}}
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
      {connected && <ShareDialog />}
      <GlobalTooltip />
      <UpdateBanner />
    </>
  );
}
