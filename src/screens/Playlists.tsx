import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, Playlist } from "../lib/api";
import { CoverArt } from "../components/CoverArt";
import { useStore } from "../store";
import { fmtDuration } from "../lib/api";

const rowHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = "var(--hover-bg)"),
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = "transparent"),
};

export function Playlists() {
  const [selected, setSelected] = useState<Playlist | null>(null);
  const playTrack = useStore((s) => s.playTrack);

  const { data: playlists = [], isLoading } = useQuery({
    queryKey: ["playlists"],
    queryFn: () => api.getPlaylists(),
  });

  const { data: tracks = [], isLoading: tracksLoading } = useQuery({
    queryKey: ["playlist-tracks", selected?.id],
    queryFn: () => api.getPlaylistTracks(selected!.id),
    enabled: !!selected,
  });

  if (selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex gap-6 p-6 shrink-0" style={{ background: "var(--card-bg)", borderBottom: "1px solid var(--border)" }}>
          <CoverArt coverId={selected.cover_id} size={160} className="w-32 h-32 rounded-lg shrink-0" />
          <div className="flex flex-col justify-end gap-1">
            <p className="text-xs uppercase tracking-wider" style={{ color: "var(--text-primary)", opacity: 0.4 }}>Playlist</p>
            <h1 className="text-2xl font-bold" style={{ color: "var(--accent)" }}>{selected.name}</h1>
            {selected.comment && <p className="text-sm" style={{ color: "var(--text-secondary)", opacity: 0.7 }}>{selected.comment}</p>}
            <p className="text-sm" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{selected.song_count} tracks · {fmtDuration(selected.duration_secs)}</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => tracks[0] && playTrack(tracks[0], tracks)}
                className="px-4 py-1.5 rounded-full text-sm font-medium"
                style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: "var(--text-secondary)" }}
              >
                Play
              </button>
              <button
                onClick={() => setSelected(null)}
                className="px-4 py-1.5 rounded-full text-sm"
                style={{ background: "var(--hover-bg)", color: "var(--text-primary)" }}
              >
                Back
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scroll-overlay">
          {tracksLoading && <p className="p-6 text-sm" style={{ color: "var(--text-primary)", opacity: 0.4 }}>Loading…</p>}
          {tracks.map((t, i) => (
            <button
              key={`${t.id}-${i}`}
              onClick={() => playTrack(t, tracks)}
              className="w-full flex items-center gap-3 px-6 py-3 text-left"
              style={{ background: "transparent", borderBottom: "1px solid var(--border)" }}
              {...rowHover}
            >
              <span className="w-6 text-center text-xs shrink-0" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{i + 1}</span>
              <CoverArt coverId={t.cover_id} size={36} className="w-9 h-9 rounded shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: "var(--accent)" }}>{t.title}</p>
                <p className="text-xs truncate" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{t.artist}</p>
              </div>
              <span className="text-xs tabular-nums shrink-0" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{fmtDuration(t.duration_secs)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <h2 className="text-lg font-semibold" style={{ color: "var(--accent)" }}>Playlists</h2>
      </div>
      <div className="flex-1 overflow-y-auto scroll-overlay p-6">
        {isLoading && <p className="text-sm" style={{ color: "var(--text-primary)", opacity: 0.4 }}>Loading…</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {playlists.map((p) => (
            <button key={p.id} onClick={() => setSelected(p)} className="text-left group grid-card">
              <CoverArt coverId={p.cover_id} size={200} className="w-full aspect-square rounded-lg mb-2 group-hover:brightness-75 transition-all" />
              <p className="text-sm font-medium truncate" style={{ color: "var(--accent)" }}>{p.name}</p>
              <p className="text-xs" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{p.song_count} tracks</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
