import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FixedSizeList, ListChildComponentProps } from "react-window";
import { api, Album } from "../lib/api";
import { CoverArt } from "../components/CoverArt";
import { useStore } from "../store";
import { fmtDuration } from "../lib/api";
import { Icon } from "../components/Icon";

// Same separator regex as album_grid.qml
const SEP_RE = /( \/\/\/ | • | \/ | feat\. | Feat\. | vs\. )/;

function ArtistTokens({ name, artistId }: { name: string; artistId: string | null }) {
  const navigateTo = useStore((s) => s.navigateTo);
  const tokens = name.split(SEP_RE).filter(Boolean);
  // Single artist → use known artistId; multi-artist → look up each token via search
  const isMulti = SEP_RE.test(name);

  return (
    <div className="flex flex-wrap" style={{ fontSize: "var(--fs-secondary)", lineHeight: 1.4 }}>
      {tokens.map((token, i) => {
        const isSep = SEP_RE.test(token);
        if (isSep) {
          return <span key={i} style={{ color: "var(--text-secondary)", opacity: 0.5, padding: "0 2px" }}>{token.trim()}</span>;
        }
        const handleClick = !isMulti && artistId
          ? (e: React.MouseEvent) => { e.stopPropagation(); navigateTo({ tab: "artists", artistId: artistId! }); }
          : async (e: React.MouseEvent) => {
              e.stopPropagation();
              const q = token.trim();
              const result = await api.search(q, 5, 0, 0);
              const match = result.artists.find((a) => a.name.toLowerCase() === q.toLowerCase());
              navigateTo(match
                ? { tab: "artists", artistId: match.id }
                : { tab: "artists", artistQuery: q });
            };
        return <ArtistToken key={i} text={token} onClick={handleClick} />;
      })}
    </div>
  );
}

function ArtistToken({ text, onClick }: { text: string; onClick: ((e: React.MouseEvent) => void) | null }) {
  const [hov, setHov] = useState(false);
  return (
    <span
      onClick={onClick ?? undefined}
      onMouseEnter={() => onClick && setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        color: hov ? "var(--accent)" : "var(--text-secondary)",
        cursor: onClick ? "pointer" : "default",
        position: "relative",
      }}
    >
      {text}
      {hov && (
        <span style={{ position: "absolute", bottom: -1, left: 0, right: 0, height: 1, background: "var(--accent)" }} />
      )}
    </span>
  );
}

const SORT_OPTIONS = [
  { value: "random",             label: "Random"       },
  { value: "newest",             label: "Latest"       },
  { value: "alphabeticalByName", label: "Alphabetical" },
  { value: "song_count",         label: "Song Count"   },
  { value: "starred",            label: "Favourites"   },
  { value: "compilations",       label: "Compilations" },
];

const SORT_ICONS: Record<string, string> = {
  random:             "/img/sort-random-a.png",
  newest:             "/img/sort-latest-a.png",
  alphabeticalByName: "/img/sort-alphabetical-a.png",
  song_count:         "/img/sort-num-asc.png",
  starred:            "/img/heart.png",
  compilations:       "/img/comp.png",
};

function IconBtn({
  src, active, title, onClick,
}: { src: string; active?: boolean; title?: string; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 32, height: 32, borderRadius: 4, border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--accent)",
        background: active
          ? "color-mix(in srgb, var(--accent) 15%, transparent)"
          : hov ? "var(--hover-bg)" : "transparent",
        transition: "background 150ms",
        flexShrink: 0,
      }}
    >
      <Icon src={src} size={18} />
    </button>
  );
}

const rowHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = "var(--hover-bg)"),
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = "transparent"),
};

function AlbumCard({ album, onClick }: { album: Album; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const qc = useQueryClient();
  function prefetch() {
    qc.prefetchQuery({ queryKey: ["album-tracks", album.id], queryFn: () => api.getAlbumTracks(album.id) });
  }
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => { setHovered(true); prefetch(); }}
      onMouseLeave={() => setHovered(false)}
      className="text-left group grid-card"
    >
      <CoverArt coverId={album.cover_id} size={200} className="w-full aspect-square rounded-lg group-hover:brightness-75 transition-all" />
      <div className="flex flex-col" style={{ marginTop: 8, gap: 2 }}>
        <p className="truncate font-bold" style={{ color: hovered ? "var(--accent)" : "var(--text-primary)", fontSize: "var(--fs-primary)" }}>{album.name}</p>
        <ArtistTokens name={album.artist} artistId={album.artist_id} />
        <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>
          {[album.song_count && `${album.song_count} tracks`, album.year].filter(Boolean).join(" · ")}
        </p>
      </div>
    </button>
  );
}

const CARD_MIN = 200;
const GAP = 12;
const META_HEIGHT = 62; // 3 text rows below cover

function getColsFromWidth(width: number) {
  return Math.max(1, Math.floor((width + GAP) / (CARD_MIN + GAP)));
}

interface RowData {
  albums: Album[];
  cols: number;
  cardWidth: number;
  onOpen: (a: Album) => void;
}

const GridRow = React.memo(({ index, style, data }: ListChildComponentProps<RowData>) => {
  const { albums, cols, cardWidth, onOpen } = data;
  return (
    <div style={{ ...style, display: "grid", gridTemplateColumns: `repeat(${cols}, ${cardWidth}px)`, gap: GAP, padding: `0 10px`, alignContent: "start" }}>
      {Array.from({ length: cols }, (_, c) => {
        const album = albums[index * cols + c];
        return album
          ? <AlbumCard key={album.id} album={album} onClick={() => onOpen(album)} />
          : <div key={c} />;
      })}
    </div>
  );
});

function AlbumGrid({ albums, loading, onOpen }: { albums: Album[]; loading: boolean; onOpen: (a: Album) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { width, height } = size;
  const cols = width > 0 ? getColsFromWidth(width - 20) : 4;
  const cardWidth = width > 0 ? (width - 20 - GAP * (cols - 1)) / cols : CARD_MIN;
  const rowHeight = cardWidth + META_HEIGHT + GAP;
  const rowCount = Math.ceil(albums.length / cols);
  const itemData: RowData = { albums, cols, cardWidth, onOpen };

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden" style={{ position: "relative" }}>
      {loading && <p className="text-sm" style={{ color: "var(--text-primary)", opacity: 0.4, padding: 10 }}>Loading…</p>}
      {height > 0 && width > 0 && (
        <FixedSizeList
          height={height}
          width={width}
          itemCount={rowCount}
          itemSize={rowHeight}
          itemData={itemData}
          overscanCount={3}
          style={{ willChange: "transform" }}
        >
          {GridRow}
        </FixedSizeList>
      )}
    </div>
  );
}

export function Albums() {
  const [sort, setSort] = useState("newest");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortRef   = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const playTrack  = useStore((s) => s.playTrack);
  const pushNav    = useStore((s) => s.pushNav);
  const navBack    = useStore((s) => s.navBack);
  const selected = useStore((s) => s.navHistory[s.navPos]?.album ?? null);

  const { data: albums = [], isLoading: loading } = useQuery({
    queryKey: ["albums", sort],
    queryFn: async () => {
      const raw = sort === "compilations"
        ? await api.getCompilations()
        : await api.getAllAlbums(sort === "song_count" ? "alphabeticalByName" : sort);
      if (sort === "song_count") raw.sort((x, y) => (y.song_count ?? 0) - (x.song_count ?? 0));
      return raw;
    },
  });

  const { data: tracks = [], isLoading: tracksLoading } = useQuery({
    queryKey: ["album-tracks", selected?.id],
    queryFn: () => api.getAlbumTracks(selected!.id),
    enabled: !!selected,
  });

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
    else setSearchText("");
  }, [searchOpen]);

  const displayedAlbums = searchText.trim()
    ? albums.filter((a) => {
        const q = searchText.toLowerCase();
        return a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q);
      })
    : albums;

  function openAlbum(album: Album) {
    pushNav({ album });
  }

  if (selected) {
    return (
      <div className="flex flex-col h-full overflow-y-auto scroll-overlay">
        <div className="flex gap-6 p-6 shrink-0" style={{ background: "var(--card-bg)", borderBottom: "1px solid var(--border)" }}>
          <CoverArt coverId={selected.cover_id} size={180} className="w-36 h-36 rounded-lg shrink-0" />
          <div className="flex flex-col justify-end gap-1">
            <p className="text-xs uppercase tracking-wider" style={{ color: "var(--text-primary)", opacity: 0.4 }}>Album</p>
            <h1 className="text-2xl font-bold" style={{ color: "var(--accent)" }}>{selected.name}</h1>
            <p style={{ color: "var(--text-secondary)" }}>{selected.artist}</p>
            <p className="text-sm" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{selected.year} · {selected.song_count} tracks</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => tracks[0] && playTrack(tracks[0], tracks)}
                className="px-4 py-1.5 rounded-full text-sm font-medium"
                style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: "var(--text-secondary)" }}
              >
                Play
              </button>
              <button
                onClick={navBack}
                className="px-4 py-1.5 rounded-full text-sm"
                style={{ background: "var(--hover-bg)", color: "var(--text-primary)" }}
              >
                Back
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scroll-overlay" style={{ borderColor: "var(--border)" }}>
          {tracksLoading && <p className="p-6 text-sm" style={{ color: "var(--text-primary)", opacity: 0.4 }}>Loading…</p>}
          {tracks.map((t, i) => (
            <button
              key={t.id}
              onClick={() => playTrack(t, tracks)}
              className="w-full flex items-center gap-4 px-6 py-3 text-left"
              style={{ background: "transparent", borderBottom: "1px solid var(--border)" }}
              {...rowHover}
            >
              <span className="w-6 text-center text-xs tabular-nums" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{t.track_number || i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: "var(--accent)" }}>{t.title}</p>
                {t.artist !== selected.artist && (
                  <p className="text-xs truncate" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{t.artist}</p>
                )}
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
      {/* ── Toolbar ── */}
      <div className="flex items-center shrink-0 px-6" style={{ height: 58, gap: 6, borderBottom: "1px solid var(--border)" }}>
        <h2 className="font-semibold" style={{ flex: 1, color: "var(--text-secondary)", fontSize: "var(--fs-primary)" }}>
          {loading
            ? "Albums"
            : searchText
              ? `${displayedAlbums.length} / ${albums.length.toLocaleString("fr-FR")} albums`
              : `${albums.length.toLocaleString("fr-FR")} albums`}
        </h2>

        {/* Expanding search input */}
        <input
          ref={searchRef}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setSearchOpen(false)}
          placeholder="Search albums…"
          style={{
            width: searchOpen ? 204 : 0,
            opacity: searchOpen ? 1 : 0,
            overflow: "hidden",
            padding: searchOpen ? "0 10px" : 0,
            height: 30,
            transition: "width 250ms cubic-bezier(0.77,0,0.175,1), opacity 200ms",
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text-primary)",
            fontSize: "var(--fs-secondary)",
            outline: "none",
            flexShrink: 0,
          }}
        />

        {/* Search toggle */}
        <IconBtn
          src="/img/search.png"
          active={searchOpen}
          title="Search"
          onClick={() => setSearchOpen((v) => !v)}
        />

        {/* Sort icon + dropdown */}
        <div ref={sortRef} style={{ position: "relative" }}>
          <IconBtn
            src={SORT_ICONS[sort] ?? "/img/sort-latest-a.png"}
            active={sortMenuOpen}
            title="Sort"
            onClick={() => setSortMenuOpen((v) => !v)}
          />
          {sortMenuOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0,
              background: "var(--main-bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 4,
              minWidth: 168,
              zIndex: 100,
              display: "flex", flexDirection: "column", gap: 1,
              boxShadow: "0 4px 16px color-mix(in srgb, var(--text-primary) 15%, transparent)",
            }}>
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => { setSort(o.value); setSortMenuOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", margin: 0, padding: "5px 12px", textAlign: "left",
                    background: "transparent", border: "none", cursor: "pointer",
                    color: "var(--text-secondary)",
                    fontSize: "var(--fs-primary)",
                    borderRadius: 4,
                    boxSizing: "border-box",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Icon src={SORT_ICONS[o.value]} size={14} style={{ background: "var(--accent)" }} />
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <AlbumGrid albums={displayedAlbums} loading={loading} onOpen={openAlbum} />
    </div>
  );
}
