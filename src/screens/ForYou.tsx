import { useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmtDuration, Track } from "../lib/api";
import { PlayRingButton } from "../components/PlayRingButton";
import { TrackTable } from "../components/TrackTable";
import { useStore } from "../store";
import { CoverArt } from "../components/CoverArt";
import { Icon } from "../components/Icon";
import { SkeletonCard } from "../components/Skeleton";
import { CARD_MIN, GAP, getColsFromWidth } from "./Albums";
import { PageArrow } from "./Home";
import { loadJSON, saveJSON } from "../components/TrackTable";
import { PLAY_ICON_DARK } from "../lib/theme";

// "For You" home row — zero-click discovery mixes rebuilt once per day:
//  - Daily Mix 1..4: seeded by the user's most-played artists (derived from
//    getAlbumList("frequent") — Subsonic has no top-artists endpoint), each
//    filled with getSimilarSongs + getTopSongs for that artist, the same
//    pool Start Radio draws from.
//  - Discovery Mix: getRandomSongs across the whole library.
//  - Fresh Mix: tracks pulled from the newest-added albums.
// Everything is shuffled with a PRNG seeded by today's date (+ a refresh
// nonce), so mixes are stable across app restarts within a day but roll over
// to a new lineup at midnight — that's what makes them "daily" rather than
// just random. React Query caches under the same date key for the same
// reason.

export interface Mix {
  id: string;
  title: string;
  /** Card line 2 — what this mix is ("Inspired by Darude", "Random picks
   *  from your library"), mirroring the album card's artist line. */
  tagline: string;
  /** Detail-header line — the first artists found in the mix. */
  subtitle: string;
  /** Up to 4 distinct track covers — rendered as a 2×2 collage (the same
   *  look Navidrome generates server-side for playlist art) when all 4
   *  exist, or as a single plain cover when the mix spans fewer albums. */
  coverIds: string[];
  tracks: Track[];
}

const MIX_SIZE = 30;
const ARTIST_MIX_COUNT = 4;

// mulberry32 — tiny deterministic PRNG; seeded from the date string so the
// whole day's shuffles are reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function seededShuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function dedupe(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

/** Up to 4 distinct covers across a mix's tracks — the collage sources. */
function coversFrom(tracks: Track[]): string[] {
  const ids: string[] = [];
  for (const t of tracks) {
    if (t.cover_id && !ids.includes(t.cover_id)) ids.push(t.cover_id);
    if (ids.length === 4) break;
  }
  return ids;
}

/** Top 3 distinct artist names in a mix — the card's subtitle. */
function artistLine(tracks: Track[]): string {
  const names: string[] = [];
  for (const t of tracks) {
    if (t.artist && !names.includes(t.artist)) names.push(t.artist);
    if (names.length === 3) break;
  }
  return names.join(", ");
}

// On-disk cache so a restart doesn't rebuild (and refetch) the exact same
// deterministic lineup — unlike Home's album rows, a mix build fans out into
// ~a dozen API calls, so this one is worth persisting. The date key and
// reroll nonce are part of the stored value: a stale entry (yesterday's, or
// pre-reroll) simply misses and falls through to a rebuild.
const LS_MIXES = "foryou_mixes_v3"; // v2: coverId → coverIds collage; v3: + tagline

function loadCachedMixes(dateKey: string, nonce: number): Mix[] | null {
  const saved = loadJSON<{ dateKey: string; nonce: number; mixes: Mix[] } | null>(LS_MIXES, null);
  return saved && saved.dateKey === dateKey && saved.nonce === nonce && Array.isArray(saved.mixes) ? saved.mixes : null;
}

async function buildMixes(dateKey: string, nonce: number): Promise<Mix[]> {
  const cached = loadCachedMixes(dateKey, nonce);
  if (cached) return cached;
  const rand = mulberry32(hashString(dateKey) + nonce);

  // Seed artists from the most-played albums — unique by artist_id, in a
  // day-stable shuffled order so the mix lineup rotates day to day even if
  // the play-count ranking doesn't move.
  const frequent = await api.getAlbumList("frequent", 50, 0).catch(() => []);
  const byArtist = new Map<string, { name: string; coverId: string | null }>();
  for (const a of frequent) {
    if (a.artist_id && a.artist && !byArtist.has(a.artist_id)) {
      byArtist.set(a.artist_id, { name: a.artist, coverId: a.cover_id });
    }
  }
  const seeds = seededShuffle([...byArtist.entries()], rand).slice(0, ARTIST_MIX_COUNT);

  const artistMixes = Promise.all(seeds.map(async ([artistId, info], i): Promise<Mix | null> => {
    const [similar, top] = await Promise.all([
      api.getSimilarSongs(artistId, 40).catch(() => []),
      api.getTopSongs(info.name, 10).catch(() => []),
    ]);
    const tracks = seededShuffle(dedupe([...top, ...similar]), rand).slice(0, MIX_SIZE);
    if (tracks.length < 5) return null; // not enough material for a real mix
    const coverIds = coversFrom(tracks);
    if (!coverIds.length && info.coverId) coverIds.push(info.coverId);
    return {
      id: `daily-${i}`,
      title: `Daily Mix ${i + 1}`,
      tagline: `Inspired by ${info.name}`,
      subtitle: artistLine(tracks),
      coverIds,
      tracks,
    };
  }));

  const discoveryMix = api.getRandomSongs(MIX_SIZE + 10).catch(() => [] as Track[]).then((songs): Mix | null => {
    const tracks = dedupe(songs).slice(0, MIX_SIZE);
    if (tracks.length < 5) return null;
    return { id: "discovery", title: "Discovery Mix", tagline: "Random picks from your library", subtitle: artistLine(tracks), coverIds: coversFrom(tracks), tracks };
  });

  const freshMix = (async (): Promise<Mix | null> => {
    const newest = await api.getAlbumList("newest", 5, 0).catch(() => []);
    const perAlbum = await Promise.all(newest.map((a) => api.getAlbumTracks(a.id).catch(() => [] as Track[])));
    const tracks = seededShuffle(dedupe(perAlbum.flat()), rand).slice(0, MIX_SIZE);
    if (tracks.length < 5) return null;
    return { id: "fresh", title: "Fresh Mix", tagline: "From recently added albums", subtitle: artistLine(tracks), coverIds: coversFrom(tracks), tracks };
  })();

  const resolved = await Promise.all([discoveryMix, freshMix, ...await artistMixes]);
  const mixes = resolved.filter((m): m is Mix => m !== null);
  if (mixes.length) saveJSON(LS_MIXES, { dateKey, nonce, mixes });
  return mixes;
}

/** 2×2 cover collage — same visual Navidrome renders server-side for
 *  playlist art. Falls back to a plain single cover below 4 distinct
 *  albums (matching Navidrome's own fallback behavior). `size` is the
 *  full collage edge; each quarter is requested at half that. */
function MixCover({ coverIds, size, className, style }: { coverIds: string[]; size: number; className?: string; style?: React.CSSProperties }) {
  if (coverIds.length < 4) {
    return <CoverArt coverId={coverIds[0] ?? null} size={size} className={className} style={style} />;
  }
  return (
    <div
      className={className}
      style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", overflow: "hidden", ...style }}
    >
      {coverIds.slice(0, 4).map((id) => (
        <CoverArt key={id} coverId={id} size={Math.ceil(size / 2)} className="w-full h-full" />
      ))}
    </div>
  );
}

function MixCard({ mix, width, onPlay, onOpen }: { mix: Mix; width: number; onPlay: (mix: Mix) => void; onOpen: (mix: Mix) => void }) {
  const [hovered, setHovered] = useState(false);
  const [playHovered, setPlayHovered] = useState(false);
  return (
    <button
      onClick={() => onOpen(mix)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="text-left group grid-card"
      style={{ width, flexShrink: 0 }}
    >
      <div style={{ position: "relative", overflow: "hidden", borderRadius: "8px 8px 0 0" }}>
        <MixCover coverIds={mix.coverIds} size={200} className="w-full aspect-square rounded-t-lg group-hover:brightness-75 group-hover:scale-[1.03] transition-all" />
        <div
          onClick={(e) => { e.stopPropagation(); onPlay(mix); }}
          onMouseEnter={() => setPlayHovered(true)}
          onMouseLeave={() => setPlayHovered(false)}
          title={`Play ${mix.title}`}
          style={{
            cursor: "pointer",
            position: "absolute", top: "50%", left: "50%",
            transform: `translate(-50%, -50%) scale(${playHovered ? 1 : 0.8})`,
            width: "min(60px, 33%)", aspectRatio: "1", borderRadius: "50%",
            background: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: hovered ? 1 : 0,
            transition: "opacity 150ms, transform 150ms",
          }}
        >
          <Icon src="img/play.png" size={20} style={{ background: PLAY_ICON_DARK, marginLeft: 2 }} />
        </div>
      </div>
      <div className="flex flex-col grid-card-meta group-hover:brightness-75 transition-all">
        <p className="truncate" style={{ color: hovered ? "var(--accent)" : "var(--text-primary)", fontSize: "var(--fs-primary)", fontWeight: "var(--fw-emphasis)" }}>{mix.title}</p>
        <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{mix.tagline}</p>
        <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{mix.tracks.length} tracks</p>
      </div>
    </button>
  );
}

export function ForYouRow({
  dragging, onGripMouseDown, active, gripDots, onOpenMix,
}: {
  dragging: boolean; onGripMouseDown: (e: React.MouseEvent) => void; active: boolean; gripDots: React.ReactNode; onOpenMix: (mix: Mix) => void;
}) {
  const playTrack = useStore((s) => s.playTrack);
  // Bumping the nonce reshuffles today's mixes on demand (refresh button) —
  // it feeds the PRNG seed, so a refresh genuinely rerolls seed artists and
  // track order rather than refetching the same deterministic lineup.
  const dateKey = new Date().toISOString().slice(0, 10);
  // Start from the persisted lineup's nonce (not 0) so a same-day restart
  // after rerolling still hits the cache instead of rebuilding lineup #0.
  const [nonce, setNonce] = useState(() => {
    const saved = loadJSON<{ dateKey: string; nonce: number } | null>(LS_MIXES, null);
    return saved && saved.dateKey === dateKey ? saved.nonce : 0;
  });

  const { data: mixes = [], isLoading, isFetching } = useQuery({
    queryKey: ["foryou", dateKey, nonce],
    queryFn: () => buildMixes(dateKey, nonce),
    staleTime: Infinity, // today's mixes never go stale — the date key rolls instead
  });

  // Same width-measuring + column formula as Home's AlbumRow, so mix cards
  // line up exactly with the album rows above/below.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    setViewportWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!active) return;
    const el = viewportRef.current;
    if (!el) return;
    setViewportWidth(el.getBoundingClientRect().width);
  }, [active]);

  const cols = viewportWidth > 0 ? getColsFromWidth(viewportWidth) : 4;
  const cardWidth = viewportWidth > 0 ? (viewportWidth - GAP * (cols - 1)) / cols : CARD_MIN;
  const step = cardWidth + GAP;

  // Same page-a-screenful carousel as Home's AlbumRow — all mixes are already
  // in memory, so unlike AlbumRow there's never a "fetch next page" case.
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = Math.max(1, Math.ceil(mixes.length / cols));
  useLayoutEffect(() => { setPageIndex(0); }, [cols, mixes.length]);
  const offset = pageIndex * cols * step;

  function handlePlay(mix: Mix) {
    if (mix.tracks.length) playTrack(mix.tracks[0], mix.tracks);
  }

  return (
    <div className="flex flex-col" style={{ gap: 10, opacity: dragging ? 0.4 : 1 }}>
      <div className="flex items-center" style={{ gap: 8 }}>
        <div onMouseDown={onGripMouseDown} title="Drag to reorder" style={{ cursor: "grab", padding: 4, display: "flex" }}>
          {gripDots}
        </div>
        <h2 style={{ color: "var(--text-primary)", fontSize: "var(--fs-title)", fontWeight: "var(--fw-emphasis)" }}>Daily Mix</h2>
        <div className="flex items-center" style={{ marginLeft: "auto", gap: 2 }}>
          <button
            onClick={() => setNonce((n) => n + 1)}
            title="Reroll mixes"
            disabled={isFetching}
            style={{ background: "none", border: "none", cursor: isFetching ? "default" : "pointer", padding: 4, display: "flex" }}
          >
            <Icon
              src="img/refresh.png"
              size={15}
              style={{ background: "var(--accent)", animation: isFetching ? "spinner-rotate 800ms linear infinite" : undefined }}
            />
          </button>
          {pageCount > 1 && (
            <>
              <PageArrow dir="left" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => Math.max(0, p - 1))} />
              <PageArrow dir="right" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))} />
            </>
          )}
        </div>
      </div>
      <div ref={viewportRef} style={{ overflow: "hidden" }}>
        <div
          style={{
            display: "flex", gap: GAP,
            transform: `translateX(-${offset}px)`,
            transition: "transform 300ms cubic-bezier(0.65, 0, 0.35, 1)",
          }}
        >
          {isLoading
            ? Array.from({ length: 6 }, (_, i) => (
                <div key={i} style={{ width: cardWidth, flexShrink: 0 }}><SkeletonCard /></div>
              ))
            : mixes.map((mix) => <MixCard key={mix.id} mix={mix} width={cardWidth} onPlay={handlePlay} onOpen={onOpenMix} />)}
        </div>
      </div>
    </div>
  );
}

/** Full-screen view of one mix's tracklist — opened by clicking a mix card
 *  (the hover play button still plays without opening). Rendered by Home in
 *  place of its rows; the global nav back button returns to Home since the
 *  open mix lives in the nav history. Header mirrors the album detail's
 *  cover/title/play/shuffle layout. */
export function MixDetail({ mix }: { mix: Mix }) {
  const playTrack = useStore((s) => s.playTrack);
  const navigateTo = useStore((s) => s.navigateTo);
  const [shuffleHovered, setShuffleHovered] = useState(false);
  const totalSecs = mix.tracks.reduce((sum, t) => sum + (t.duration_secs || 0), 0);

  function handlePlay() {
    if (mix.tracks[0]) playTrack(mix.tracks[0], mix.tracks);
  }
  function handleShuffle() {
    if (!mix.tracks.length) return;
    const shuffled = [...mix.tracks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    playTrack(shuffled[0], shuffled);
  }

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      <div style={{ padding: 12 }}>
        <div className="flex" style={{ gap: 20, padding: 16, borderRadius: 10, background: "var(--card-bg)", border: "1px solid var(--border)" }}>
          <MixCover coverIds={mix.coverIds} size={264} className="rounded-lg" style={{ width: 200, height: 200, flexShrink: 0 }} />
          <div className="flex flex-col" style={{ flex: 1, minWidth: 0, justifyContent: "flex-start", paddingTop: 16, gap: 6 }}>
            <h1 style={{ fontSize: "var(--fs-hero)", fontWeight: "var(--fw-emphasis)", color: "var(--text-primary)" }}>{mix.title}</h1>
            <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-primary)" }}>{mix.subtitle}</p>
            <p style={{ color: "var(--text-secondary)", fontWeight: "var(--fw-emphasis)", fontSize: "var(--fs-secondary)" }}>
              {mix.tracks.length} songs  ·  {fmtDuration(totalSecs)}
            </p>
            <div className="flex items-center" style={{ gap: 10, marginTop: 16 }}>
              <PlayRingButton icon="img/play.png" onClick={handlePlay} onHoldShuffle={handleShuffle} title="Play Mix" />
              <button
                onClick={handleShuffle}
                onMouseEnter={() => setShuffleHovered(true)}
                onMouseLeave={() => setShuffleHovered(false)}
                title="Shuffle"
                style={{
                  width: 40, height: 40, borderRadius: 8, border: "none", cursor: "pointer",
                  background: shuffleHovered ? "var(--hover-bg)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "background 150ms",
                }}
              >
                <Icon src="img/shuffle.png" size={20} style={{ background: "var(--text-secondary)" }} />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1" style={{ minHeight: 0, padding: "0 12px 12px" }}>
        <TrackTable
          key={mix.id}
          tracks={mix.tracks}
          loading={false}
          viewKey="album_detail"
          defaultSort={null}
          persistSort={false}
          numColSource="position"
          filterableCols={["genre", "year"]}
          onFilterChange={(col, values) => {
            const value = [...values][0];
            if (value) navigateTo({ tab: "tracks", trackFilter: { col, value } });
          }}
        />
      </div>
    </div>
  );
}
