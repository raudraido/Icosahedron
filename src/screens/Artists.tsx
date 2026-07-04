import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { CoverArt } from "../components/CoverArt";
import { ArtistDetail } from "./ArtistDetail";
import { useStore } from "../store";

export function Artists() {
  const pushNav = useStore((s) => s.pushNav);
  const navBack = useStore((s) => s.navBack);
  const selectedId = useStore((s) => s.navHistory[s.navPos]?.artistId ?? null);
  const navQuery   = useStore((s) => s.navHistory[s.navPos]?.artistQuery ?? "");
  const [query, setQuery] = useState(navQuery);

  const { data: artists = [], isLoading } = useQuery({
    queryKey: ["artists"],
    queryFn: () => api.getAllArtists().then((a) => a.sort((x, y) => x.name.localeCompare(y.name))),
  });

  if (selectedId) {
    return (
      <div className="h-full overflow-hidden">
        <ArtistDetail artistId={selectedId} onBack={navBack} />
      </div>
    );
  }

  const filtered = query
    ? artists.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
    : artists;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <h2 className="text-lg font-semibold flex-1" style={{ color: "var(--accent)" }}>Artists</h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="text-sm rounded-lg px-3 py-1.5 outline-none w-48"
          style={{ background: "var(--card-bg)", color: "var(--text-secondary)" }}
        />
      </div>

      <div className="flex-1 overflow-y-auto scroll-overlay p-6">
        {isLoading && <p className="text-sm" style={{ color: "var(--text-primary)", opacity: 0.3 }}>Loading…</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {filtered.map((a) => (
            <button
              key={a.id}
              onClick={() => pushNav({ artistId: a.id })}
              className="text-left grid-card group"
            >
              <CoverArt coverId={a.cover_id} size={160} className="w-full aspect-square rounded-full mb-2 group-hover:brightness-75 transition-all" />
              <p className="text-sm text-center truncate" style={{ color: "var(--accent)" }}>{a.name}</p>
              <p className="text-xs text-center" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{a.album_count} albums</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
