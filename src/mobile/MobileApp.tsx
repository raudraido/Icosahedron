import { useEffect, useState } from "react";
import { ArrowLeft, Disc3, Ellipsis, Heart, House, ListMusic, Mic, Pause, Play, Search, SkipForward } from "lucide-react";
import { useStore, type Tab } from "../store";
import { Home } from "../screens/Home";
import { Albums } from "../screens/Albums";
import { Artists } from "../screens/Artists";
import { Tracks } from "../screens/Tracks";
import { Playlists } from "../screens/Playlists";
import { Starred } from "../screens/Starred";
import { Settings } from "../screens/Settings";
import { MobilePlayer } from "./MobilePlayer";

// Phone layout: slim header, the active screen, a mini player, and a bottom tab
// bar. The mini player opens the full-screen player. Replaces the desktop
// shell's left panel, queue panel, wide tab row and player bar.
const TABS: { id: Tab; label: string; Icon: typeof House }[] = [
  { id: "home", label: "Home", Icon: House },
  { id: "albums", label: "Albums", Icon: Disc3 },
  { id: "artists", label: "Artists", Icon: Mic },
  { id: "playlists", label: "Playlists", Icon: ListMusic },
  { id: "starred", label: "Favorites", Icon: Heart },
];
const MORE: { id: Tab; label: string }[] = [
  { id: "tracks", label: "Tracks" },
  { id: "settings", label: "Settings" },
];
const SUPPORTED = new Set<Tab>([...TABS.map((t) => t.id), ...MORE.map((m) => m.id)]);

function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const queue = useStore((s) => s.queue);
  const index = useStore((s) => s.currentIndex);
  const playing = useStore((s) => s.playing);
  const time = useStore((s) => s.currentTime);
  const duration = useStore((s) => s.duration);
  const coverUrl = useStore((s) => s.coverUrl);
  const { playPause, next } = useStore.getState();
  const track = queue[index];
  if (!track) return null;
  const btn = { background: "transparent", border: "none", color: "var(--text-primary)", padding: 10, display: "flex", cursor: "pointer" } as const;
  return (
    <div style={{ background: "var(--header-bg)", borderTop: "1px solid var(--border)", position: "relative" }}>
      <div style={{ position: "absolute", top: 0, left: 0, height: 2, width: `${duration > 0 ? Math.min(100, (time / duration) * 100) : 0}%`, background: "var(--accent)" }} />
      <div style={{ display: "flex", alignItems: "center", height: 60, padding: "0 4px 0 8px", gap: 10 }}>
        <button onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, background: "transparent", border: "none", color: "inherit", textAlign: "left", cursor: "pointer", padding: 0 }}>
          <div style={{ width: 44, height: 44, borderRadius: 6, overflow: "hidden", background: "var(--card-bg)", flexShrink: 0 }}>
            {track.cover_id && <img src={coverUrl(track.cover_id, 96)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.title}</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.artist}</div>
          </div>
        </button>
        <button style={btn} onClick={playPause} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
        </button>
        <button style={btn} onClick={next} aria-label="Next"><SkipForward size={24} fill="currentColor" /></button>
      </div>
    </div>
  );
}

export function MobileApp() {
  const activeTab = useStore((s) => s.activeTab);
  const setTab = useStore((s) => s.setTab);
  const navBack = useStore((s) => s.navBack);
  const canBack = useStore((s) => s.navHistory.length > 0 && s.navPos > 0);
  const openSpotlight = useStore((s) => s.openSpotlight);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const tab: Tab = SUPPORTED.has(activeTab) ? activeTab : "home";
  const [mounted, setMounted] = useState<Set<string>>(() => new Set([tab]));
  useEffect(() => { setMounted((p) => (p.has(tab) ? p : new Set([...p, tab]))); }, [tab]);
  useEffect(() => { if (!SUPPORTED.has(activeTab)) setTab("home"); }, [activeTab, setTab]);

  const title = [...TABS, ...MORE].find((t) => t.id === tab)?.label ?? "";
  const pane = (id: Tab, node: React.ReactNode) => (
    <div className="absolute inset-0 flex flex-col tab-pane" style={{ display: tab === id ? "flex" : "none" }}>{mounted.has(id) && node}</div>
  );
  const hb = { background: "transparent", border: "none", color: "var(--text-primary)", padding: 10, display: "flex", cursor: "pointer" } as const;

  return (
    <div
      className="mobile-shell"
      style={{
        height: "100dvh", display: "flex", flexDirection: "column", background: "var(--main-bg)", color: "var(--text-primary)",
        paddingTop: "env(safe-area-inset-top)", overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", height: 48, flexShrink: 0, padding: "0 4px", background: "var(--header-bg)", borderBottom: "1px solid var(--border)" }}>
        <button style={{ ...hb, visibility: canBack ? "visible" : "hidden" }} onClick={navBack} aria-label="Back"><ArrowLeft size={22} /></button>
        <div style={{ flex: 1, textAlign: "center", fontWeight: 700 }}>{title}</div>
        <button style={hb} onClick={() => openSpotlight()} aria-label="Search"><Search size={22} /></button>
      </div>

      <div style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}>
        {pane("home", <Home />)}
        {pane("albums", <Albums />)}
        {pane("artists", <Artists />)}
        {pane("tracks", <Tracks />)}
        {pane("playlists", <Playlists />)}
        {pane("starred", <Starred />)}
        {pane("settings", <Settings />)}
      </div>

      <MiniPlayer onOpen={() => setPlayerOpen(true)} />

      <nav style={{ display: "flex", flexShrink: 0, background: "var(--header-bg)", borderTop: "1px solid var(--border)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {TABS.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => { setMoreOpen(false); setTab(id); }}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "8px 0 6px", background: "transparent", border: "none", cursor: "pointer", color: active ? "var(--accent)" : "var(--text-secondary)", fontSize: 10 }}
            >
              <Icon size={22} />{label}
            </button>
          );
        })}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "8px 0 6px", background: "transparent", border: "none", cursor: "pointer", color: MORE.some((m) => m.id === tab) ? "var(--accent)" : "var(--text-secondary)", fontSize: 10 }}
        >
          <Ellipsis size={22} />More
        </button>
      </nav>

      {moreOpen && (
        <div onClick={() => setMoreOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 7000 }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: "absolute", right: 8, bottom: "calc(64px + env(safe-area-inset-bottom))", minWidth: 180, padding: 6, borderRadius: 12, background: "var(--left-panel-bg)", border: "1px solid var(--border)", boxShadow: "0 8px 24px rgba(0,0,0,.4)" }}
          >
            {MORE.map((m) => (
              <button
                key={m.id}
                onClick={() => { setMoreOpen(false); setTab(m.id); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 14px", background: "transparent", border: "none", borderRadius: 8, color: tab === m.id ? "var(--accent)" : "var(--text-primary)", fontSize: 15, cursor: "pointer" }}
              >{m.label}</button>
            ))}
          </div>
        </div>
      )}

      {playerOpen && <MobilePlayer onClose={() => setPlayerOpen(false)} />}
    </div>
  );
}
