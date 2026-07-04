import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStore, tryAutoConnect, Tab } from "./store";
import { applyTheme, CREAM } from "./lib/theme";

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
import { PlayerBar } from "./components/PlayerBar";
import { LeftPanel } from "./components/LeftPanel";
import { QueuePanel } from "./components/QueuePanel";

const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: "albums",    label: "Albums",    icon: "/img/albums.png" },
  { id: "artists",   label: "Artists",   icon: "/img/artists.png" },
  { id: "tracks",    label: "Tracks",    icon: "/img/tracks.png" },
  { id: "playlists", label: "Playlists", icon: "/img/playlists.png" },
  { id: "starred",   label: "Favorites", icon: "/img/heart.png" },
];

function NavTab({ n, active, onClick }: { n: typeof NAV[0]; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all shrink-0"
      style={{
        fontSize:   "var(--fs-secondary)",
        color:      active ? "var(--accent)" : "var(--text-primary)",
        background: active ? "var(--hover-bg)" : "transparent",
        opacity:    active ? 1 : 0.65,
        boxShadow:  "none",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "var(--hover-bg)";
          e.currentTarget.style.opacity = "0.9";
        }
        e.currentTarget.style.boxShadow = `0 0 8px 1px color-mix(in srgb, var(--accent) 25%, transparent)`;
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.opacity = "0.65";
        }
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <img
        src={n.icon}
        alt=""
        style={{
          width: 14, height: 14, objectFit: "contain",
          opacity: active ? 1 : 0.7,
          filter: active
            ? "sepia(1) saturate(5) hue-rotate(-10deg) brightness(0.6)"
            : "saturate(0) brightness(0.4)",
        }}
      />
      {n.label}
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

  function handleTabClick(tab: Tab) {
    const inDetail = !!(currentEntry?.album || currentEntry?.artistId);
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
          {/* Tab bar */}
          <div
            className="flex items-center gap-0.5 px-3 shrink-0"
            style={{ height: 62, borderBottom: "1px solid var(--border)" }}
          >
            {NAV.map((n) => (
              <NavTab key={n.id} n={n} active={activeTab === n.id} onClick={() => handleTabClick(n.id)} />
            ))}
          </div>

          <div className="flex-1 overflow-hidden relative">
            <div className="absolute inset-0 flex flex-col" style={{ visibility: activeTab === "albums"    ? "visible" : "hidden" }}>{mounted.has("albums")    && <Albums />}</div>
            <div className="absolute inset-0 flex flex-col" style={{ visibility: activeTab === "artists"   ? "visible" : "hidden" }}>{mounted.has("artists")   && <Artists />}</div>
            <div className="absolute inset-0 flex flex-col" style={{ visibility: activeTab === "tracks"    ? "visible" : "hidden" }}>{mounted.has("tracks")    && <Tracks />}</div>
            <div className="absolute inset-0 flex flex-col" style={{ visibility: activeTab === "playlists" ? "visible" : "hidden" }}>{mounted.has("playlists") && <Playlists />}</div>
            <div className="absolute inset-0 flex flex-col" style={{ visibility: activeTab === "starred"   ? "visible" : "hidden" }}>{mounted.has("starred")   && <Starred />}</div>
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
    applyTheme(CREAM);
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

  return connected ? <MainApp /> : <Login />;
}
