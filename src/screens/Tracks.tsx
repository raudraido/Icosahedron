import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "../lib/api";
import { fmtDuration } from "../lib/api";
import { useStore } from "../store";
import { CoverArt } from "../components/CoverArt";

export function Tracks() {
  const [query, setQuery] = useState("");
  const playTrack = useStore((s) => s.playTrack);
  const currentId = useStore((s) => s.queue[s.currentIndex]?.id);
  const parentRef = useRef<HTMLDivElement>(null);

  const { data: tracks = [], isLoading } = useQuery({
    queryKey: ["tracks"],
    queryFn: () => api.getTracks(500, 0),
  });

  const filtered = query
    ? tracks.filter(
        (t) =>
          t.title.toLowerCase().includes(query.toLowerCase()) ||
          t.artist.toLowerCase().includes(query.toLowerCase())
      )
    : tracks;

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 10,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <h2 className="text-lg font-semibold flex-1" style={{ color: "var(--accent)" }}>Tracks</h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="text-sm rounded-lg px-3 py-1.5 outline-none w-56"
          style={{ background: "var(--card-bg)", color: "var(--text-secondary)" }}
        />
      </div>

      <div ref={parentRef} className="flex-1 overflow-y-auto scroll-overlay">
        {isLoading && <p className="p-6 text-sm" style={{ color: "var(--text-primary)", opacity: 0.4 }}>Loading…</p>}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((row) => {
            const t = filtered[row.index];
            const active = t.id === currentId;
            return (
              <button
                key={t.id}
                data-index={row.index}
                ref={virtualizer.measureElement}
                onClick={() => playTrack(t, filtered)}
                style={{
                  position: "absolute", top: row.start, left: 0, right: 0,
                  background: active ? "var(--hover-bg)" : "transparent",
                  borderBottom: "1px solid var(--border)",
                }}
                className="flex items-center gap-3 px-6 py-3 text-left w-full transition-colors"
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = active ? "var(--hover-bg)" : "transparent")}
              >
                <CoverArt coverId={t.cover_id} size={36} className="w-9 h-9 rounded shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: active ? "var(--accent)" : "var(--text-secondary)" }}>{t.title}</p>
                  <p className="text-xs truncate" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{t.artist}</p>
                </div>
                <span className="text-xs tabular-nums shrink-0" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{fmtDuration(t.duration_secs)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
