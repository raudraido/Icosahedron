import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { CoverArt } from "../components/CoverArt";
import { useStore } from "../store";
import { fmtDuration } from "../lib/api";

const rowHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = "var(--hover-bg)"),
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = "transparent"),
};

export function Starred() {
  const [tab, setTab] = useState<"tracks" | "albums" | "artists">("tracks");
  const playTrack = useStore((s) => s.playTrack);

  const { data, isLoading } = useQuery({
    queryKey: ["starred"],
    queryFn: () => api.getStarred(),
  });

  const tabs = [
    { id: "tracks"  as const, label: `Tracks (${data?.tracks.length ?? 0})`  },
    { id: "albums"  as const, label: `Albums (${data?.albums.length ?? 0})`  },
    { id: "artists" as const, label: `Artists (${data?.artists.length ?? 0})` },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <h2 className="text-lg font-semibold mr-4" style={{ color: "var(--accent)" }}>Starred</h2>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-3 py-1 rounded-lg text-sm transition-colors"
            style={{
              background: tab === t.id ? "var(--hover-bg)" : "transparent",
              color: tab === t.id ? "var(--text-secondary)" : "var(--text-primary)",
              opacity: tab === t.id ? 1 : 0.5,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scroll-overlay">
        {isLoading && <p className="p-6 text-sm" style={{ color: "var(--text-primary)", opacity: 0.4 }}>Loading…</p>}

        {tab === "tracks" && data && (
          <div>
            {data.tracks.map((t) => (
              <button
                key={t.id}
                onClick={() => playTrack(t, data.tracks)}
                className="w-full flex items-center gap-3 px-6 py-3 text-left"
                style={{ background: "transparent", borderBottom: "1px solid var(--border)" }}
                {...rowHover}
              >
                <CoverArt coverId={t.cover_id} size={36} className="w-9 h-9 rounded shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: "var(--accent)" }}>{t.title}</p>
                  <p className="text-xs truncate" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{t.artist}</p>
                </div>
                <span className="text-xs tabular-nums shrink-0" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{fmtDuration(t.duration_secs)}</span>
              </button>
            ))}
          </div>
        )}

        {tab === "albums" && data && (
          <div className="p-6 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {data.albums.map((a) => (
              <div key={a.id} className="text-left grid-card">
                <CoverArt coverId={a.cover_id} size={200} className="w-full aspect-square rounded-lg mb-2" />
                <p className="text-sm font-medium truncate" style={{ color: "var(--accent)" }}>{a.name}</p>
                <p className="text-xs truncate" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{a.artist}</p>
              </div>
            ))}
          </div>
        )}

        {tab === "artists" && data && (
          <div className="p-6 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {data.artists.map((a) => (
              <div key={a.id} className="text-center grid-card">
                <CoverArt coverId={a.cover_id} size={160} className="w-full aspect-square rounded-full mb-2" />
                <p className="text-sm truncate" style={{ color: "var(--accent)" }}>{a.name}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
