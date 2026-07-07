import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Album, Track, fmtDuration } from "../lib/api";
import { CoverArt } from "../components/CoverArt";
import { CoverZoomOverlay } from "../components/CoverZoomOverlay";
import { PlayRingButton } from "../components/PlayRingButton";
import { Icon } from "../components/Icon";
import { AlbumCard, CARD_MIN, GAP } from "./Albums";
import { ARTIST_SEP_RE, matchesArtistCredit } from "../components/ArtistTokens";
import { useStore } from "../store";
import { FAVORITE_PINK, PLAY_ICON_DARK } from "../lib/theme";
import { ContextMenu, MenuEntry } from "../components/ContextMenu";
import { PromptDialog } from "../components/PromptDialog";
import { TrackInfoDialog } from "../components/TrackInfoDialog";
import { ScrollThumb } from "../components/ScrollThumb";

// Ported from the old app's ArtistPlayWorker/search_artist_tracks — "Play all
// tracks" isn't just the first album: it's every track matching this artist
// (as primary artist OR, once multi-artist strings are split on the same
// separators ArtistTokens uses, a token match), found via a broad search3
// (up to 2000 songs) rather than only the artist's own album list — this is
// what catches compilation-only/featured tracks a plain "artist's albums"
// walk would miss. Sorted by (album, disc, track) to play back in a sane
// order, same as the old app.
function tokenize(name: string): Set<string> {
  return new Set(name.split(ARTIST_SEP_RE).map((p) => p.trim().toLowerCase()).filter(Boolean));
}

export async function fetchArtistPlaybackTracks(artistId: string, artistName: string): Promise<Track[]> {
  const result = await api.search(artistName, 0, 0, 2000);
  const target = artistName.trim().toLowerCase();
  const matches = result.tracks.filter((t) => t.artist_id === artistId || tokenize(t.artist).has(target));
  return matches.sort((a, b) =>
    (a.album ?? "").localeCompare(b.album ?? "")
    || a.disc_number - b.disc_number
    || a.track_number - b.track_number);
}

// Ported from artist_detail_page.qml / artists_browser.py's ArtistRichDetailView —
// header (photo, stats, play/like/last.fm/wikipedia), bio, popular tracks,
// discography (Albums / Singles & EPs, split by release_types the same way
// the old app's releaseTypes/albumType substring check does), and a
// related-artists strip. Simplifications from the old app:
//  - "Appears On" is approximated client-side via a broad search3 (500
//    albums) filtered to albums not owned by this artist — same idea as the
//    old app's own search3-based fallback (artists_browser.py:210-242), just
//    without a dedicated server-side endpoint.
//  - No chunked GridView pagination (old app's 80-albums/chunk GPU-texture
//    workaround) — this is a plain CSS grid, not a GPU-batched QML view, so
//    that limit doesn't apply here.
//  - No keyboard nav chain across sections — mouse/click only, matching how
//    every other screen in this app already works.

interface Props {
  artistId: string;
  onBack: () => void;
}

const BIO_TRUNCATE = 400;

// Related-artists strip — matches artist_detail_page.qml's relCellWidth/
// relCellHeight (220×270) and its arrow-paged (not free-scroll) ListView,
// reusing the same paged-carousel approach Home.tsx's album rows use.
const REL_CELL_WIDTH = 220;
const REL_GAP = 12;

function PageArrow({ dir, disabled, onClick }: { dir: "left" | "right"; disabled: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={dir === "left" ? "Previous" : "Next"}
      style={{
        width: 26, height: 26, borderRadius: "50%", border: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: disabled ? "transparent" : hov ? "var(--hover-bg)" : "transparent",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <Icon
        src={dir === "left" ? "img/home_back.png" : "img/home_next.png"}
        size={13}
        style={{ background: disabled ? "#444444" : "var(--accent)" }}
      />
    </button>
  );
}

function truncateBio(bio: string, expanded: boolean): string {
  if (expanded || bio.length <= BIO_TRUNCATE) return bio;
  const short = bio.slice(0, BIO_TRUNCATE);
  const cut = short.lastIndexOf(" ");
  return (cut > 0 ? short.slice(0, cut) : short) + "…";
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 28, ...style }}>
      {children}
    </div>
  );
}

// Matches artist_detail_page.qml's section headers exactly ("About {name}",
// "Popular", each album section, "Related Artists") — plain textPrimary,
// 20px bold, no accent color/uppercase/letter-spacing (unlike NowPlaying.tsx's
// small ALL-CAPS card labels, a different convention from a different page).
// The item count (when present) is its own bordered pill next to the title,
// not baked into the title text — same pill both album sections and the
// related-artists strip use (sectionCountText/relatedCountText).
function SectionLabel({ text, count }: { text: string; count?: number }) {
  return (
    <div className="flex items-center" style={{ gap: 10 }}>
      <h2 style={{ color: "var(--text-primary)", fontSize: "var(--fs-title)", fontWeight: 700 }}>
        {text}
      </h2>
      {count != null && (
        <div
          className="flex items-center justify-center"
          style={{ height: 22, padding: "0 8px", borderRadius: 4, border: "1px solid var(--border)" }}
        >
          <span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 700 }}>{count}</span>
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon, tint, onClick, title }: { icon: string; tint?: string; onClick: () => void; title: string }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 40, height: 40, borderRadius: 8, border: "none", cursor: "pointer",
        background: hov ? "var(--hover-bg)" : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <Icon src={icon} size={22} style={{ background: tint ?? "var(--text-secondary)" }} />
    </button>
  );
}

// Matches artist_detail_page.qml's popularList delegate exactly: fixed
// 44px rows, a 45px-wide centered index column, 40x40 cover (4px radius,
// 5px gap from the index), title, then a separately-clickable album name
// (its own hover/underline, navigating to the album — trackListBridge's
// albumClicked, not the row's own click), and a right-aligned duration.
// The row itself only reacts to a double-click (trackClicked → the old
// app's add_and_play_from_browser: append this one track after whatever's
// already playing and jump to it — not replace the queue with the whole
// Popular list), matching TrackTable's insertAfterCurrentAndPlay convention.
const POPULAR_ROW_HEIGHT = 44;

function PopularTrackRow({ track, index, onPlay, onOpenAlbum, onContextMenu }: {
  track: Track; index: number; onPlay: () => void; onOpenAlbum: () => void; onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [hov, setHov] = useState(false);
  const [albumHov, setAlbumHov] = useState(false);
  return (
    <div
      onDoubleClick={onPlay}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ position: "relative", height: POPULAR_ROW_HEIGHT, display: "flex", alignItems: "center", cursor: "pointer" }}
    >
      <div
        aria-hidden
        style={{ position: "absolute", inset: "0 8px", borderRadius: 6, background: "var(--hover-bg)", opacity: hov ? 1 : 0 }}
      />
      <span className="tabular-nums" style={{ position: "relative", width: 45, textAlign: "center", color: "var(--text-secondary)", fontSize: "var(--fs-primary)" }}>
        {index + 1}
      </span>
      <div style={{ position: "relative", width: 40, height: 40, borderRadius: 4, marginLeft: 5, flexShrink: 0, overflow: "hidden" }}>
        <CoverArt coverId={track.cover_id} size={40} className="w-full h-full" />
      </div>
      <p
        className="truncate"
        style={{ position: "relative", flex: 1, minWidth: 0, marginLeft: 15, marginRight: 10, color: hov ? "var(--accent)" : "var(--text-primary)", fontSize: "var(--fs-primary)" }}
      >
        {track.title}
      </p>
      {track.album ? (
        <span
          className="truncate"
          onClick={(e) => { e.stopPropagation(); onOpenAlbum(); }}
          onMouseEnter={(e) => { e.stopPropagation(); setAlbumHov(true); }}
          onMouseLeave={(e) => { e.stopPropagation(); setAlbumHov(false); }}
          style={{
            position: "relative", flexBasis: "30%", minWidth: 80, marginRight: 10,
            color: albumHov ? "var(--accent)" : "var(--text-secondary)",
            textDecoration: albumHov ? "underline" : "none",
            fontSize: "var(--fs-secondary)", cursor: "pointer",
          }}
        >
          {track.album}
        </span>
      ) : <span style={{ flexBasis: "30%", minWidth: 80, marginRight: 10 }} />}
      <span className="tabular-nums" style={{ position: "relative", width: 70, textAlign: "right", marginRight: 8, color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>
        {fmtDuration(track.duration_secs)}
      </span>
    </div>
  );
}

function RelatedArtistCard({ artist, onOpen }: { artist: { id: string; name: string; cover_id: string | null }; onOpen: () => void }) {
  const [hov, setHov] = useState(false);
  const [playHov, setPlayHov] = useState(false);
  const qc = useQueryClient();
  const playTrack = useStore((s) => s.playTrack);

  async function handlePlay(e: React.MouseEvent) {
    e.stopPropagation();
    const tracks = await qc.fetchQuery({
      queryKey: ["artist-play-all", artist.id],
      queryFn: () => fetchArtistPlaybackTracks(artist.id, artist.name),
    });
    if (tracks.length) playTrack(tracks[0], tracks);
  }

  return (
    <button
      onClick={onOpen}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="text-left shrink-0"
      style={{ width: REL_CELL_WIDTH }}
    >
      <div style={{ position: "relative", width: 200, height: 200, margin: "10px auto 0" }}>
        <CoverArt coverId={artist.cover_id} size={200} className="w-[200px] h-[200px] rounded-full" />
        <div
          aria-hidden
          style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            background: "#000", opacity: hov ? 0.4 : 0, transition: "opacity 150ms",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            border: `2px solid ${hov ? "var(--accent)" : "transparent"}`,
          }}
        />
        <div
          onClick={handlePlay}
          onMouseEnter={() => setPlayHov(true)}
          onMouseLeave={() => setPlayHov(false)}
          style={{
            position: "absolute", top: "50%", left: "50%",
            width: 40, height: 40, borderRadius: "50%",
            transform: `translate(-50%, -50%) scale(${playHov ? 1 : 0.8})`,
            background: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: playHov ? 1 : hov ? 0.8 : 0,
            transition: "opacity 150ms, transform 150ms",
            cursor: "pointer",
          }}
        >
          <Icon src="img/play.png" size={16} style={{ background: PLAY_ICON_DARK, marginLeft: 1 }} />
        </div>
      </div>
      <p className="truncate text-center" style={{ marginTop: 10, color: hov ? "var(--accent)" : "var(--text-primary)", fontSize: "var(--fs-secondary)", fontWeight: 600 }}>
        {artist.name}
      </p>
    </button>
  );
}

interface SimilarArtist { id: string; name: string; cover_id: string | null }

function RelatedArtistsCarousel({ artists, onOpen }: { artists: SimilarArtist[]; onOpen: (id: string) => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const step = REL_CELL_WIDTH + REL_GAP;
  const perPage = viewportWidth > 0 ? Math.max(1, Math.floor((viewportWidth + REL_GAP) / step)) : 4;
  const pageCount = Math.max(1, Math.ceil(artists.length / perPage));

  useEffect(() => { setPageIndex(0); }, [artists, perPage]);

  const offset = pageIndex * perPage * step;

  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      <div className="flex items-center" style={{ gap: 8 }}>
        <SectionLabel text="Related Artists" count={artists.length} />
        {pageCount > 1 && (
          <div className="flex items-center" style={{ marginLeft: "auto", gap: 2 }}>
            <PageArrow dir="left" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => Math.max(0, p - 1))} />
            <PageArrow dir="right" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))} />
          </div>
        )}
      </div>
      <div ref={viewportRef} style={{ overflow: "hidden" }}>
        <div
          style={{
            display: "flex", gap: REL_GAP,
            transform: `translateX(-${offset}px)`,
            transition: "transform 300ms cubic-bezier(0.65, 0, 0.35, 1)",
          }}
        >
          {artists.map((a) => (
            <RelatedArtistCard key={a.id} artist={a} onOpen={() => onOpen(a.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ArtistDetail({ artistId }: Props) {
  const navigateTo = useStore((s) => s.navigateTo);
  const coverUrl = useStore((s) => s.coverUrl);
  const playTrack = useStore((s) => s.playTrack);
  const addTrackNext = useStore((s) => s.addTrackNext);
  const addTrackToQueue = useStore((s) => s.addTrackToQueue);
  const startRadio = useStore((s) => s.startRadio);
  const qc = useQueryClient();
  const [bioExpanded, setBioExpanded] = useState(false);
  const [starred, setStarred] = useState<boolean | null>(null);
  const [photoHov, setPhotoHov] = useState(false);
  const [photoZoomOpen, setPhotoZoomOpen] = useState(false);

  // Popular-tracks row right-click menu — same shared ContextMenu/
  // PromptDialog/TrackInfoDialog components and standard action set as
  // TrackTable's buildTrackMenu (Play Now/Next/Add to Queue, Open Album,
  // Start Radio, Add to Playlist, Get Info, Favorite toggle). No "Go to
  // Artist" here since it'd just point back at this same page.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; track: Track } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [infoTrack, setInfoTrack] = useState<Track | null>(null);
  const [newPlaylistFor, setNewPlaylistFor] = useState<Track | null>(null);
  const { data: playlists = [] } = useQuery({ queryKey: ["playlists"], queryFn: api.getPlaylists });

  const { data, isLoading } = useQuery({
    queryKey: ["artist-detail", artistId],
    queryFn: () => api.getArtist(artistId),
  });

  const { data: topSongs } = useQuery({
    queryKey: ["artist-top-songs", data?.artist.name],
    queryFn: () => api.getTopSongs(data!.artist.name, 5),
    enabled: !!data?.artist.name,
  });

  // "Appears On" — approximated client-side via a broad search rather than a
  // dedicated server endpoint (see file header comment). Searches *songs*
  // (not albums) and checks each track's own artist credit (tokenized on
  // ARTIST_SEP_RE, since a track can list several artists) for an exact
  // match — searching albums directly (as this used to) matches on album
  // *title* text too, so e.g. an artist named "Exit" would wrongly pull in
  // any compilation whose title merely contains the word "Exit", not just
  // ones it actually has a track on.
  const { data: appearsOn } = useQuery({
    queryKey: ["artist-appears-on", data?.artist.name],
    queryFn: async () => {
      const result = await api.search(data!.artist.name, 0, 0, 500);
      const ownAlbumIds = new Set((data?.albums ?? []).map((a) => a.id));
      const matchingAlbumIds = new Set<string>();
      for (const t of result.tracks) {
        if (!t.album_id || ownAlbumIds.has(t.album_id) || matchingAlbumIds.has(t.album_id)) continue;
        if (matchesArtistCredit(t.artist, data!.artist.name)) matchingAlbumIds.add(t.album_id);
      }
      const albums = await Promise.all([...matchingAlbumIds].map((id) => api.getAlbum(id).catch(() => null)));
      return albums.filter((a): a is Album => a !== null);
    },
    enabled: !!data?.artist.name,
  });

  useEffect(() => {
    setBioExpanded(false);
    setStarred(null);
  }, [artistId]);

  useEffect(() => {
    if (data) setStarred(data.artist.starred);
  }, [data]);

  function openAlbum(album: Album) {
    navigateTo({ tab: "albums", album });
  }

  function openArtist(id: string) {
    navigateTo({ tab: "artists", artistId: id });
  }

  async function openTrackAlbum(t: Track) {
    if (!t.album_id) return;
    const album = await api.getAlbum(t.album_id);
    navigateTo({ tab: "albums", album });
  }

  // Matches the old app's double-click behavior on a Popular row
  // (add_and_play_from_browser): append this one track after whatever's
  // currently playing and jump to it, rather than replacing the queue with
  // the whole 5-track Popular list.
  function insertAfterCurrentAndPlay(track: Track) {
    const { queue, currentIndex } = useStore.getState();
    const newQueue = [...queue];
    newQueue.splice(currentIndex + 1, 0, track);
    playTrack(track, newQueue);
  }

  function handlePopularRowContextMenu(e: React.MouseEvent, track: Track) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, track });
  }

  async function toggleTrackFavorite(track: Track) {
    try {
      await api.setFavorite(track.id, !track.starred, "id");
      qc.invalidateQueries({ queryKey: ["artist-top-songs", data?.artist.name] });
    } catch { /* best-effort — row will just show the stale state until next fetch */ }
  }

  async function addToExistingPlaylist(playlistId: string, track: Track) {
    await api.addTracksToPlaylist(playlistId, [track.id]);
    qc.invalidateQueries({ queryKey: ["playlists"] });
  }

  async function createPlaylistAndAdd(name: string) {
    const track = newPlaylistFor;
    setNewPlaylistFor(null);
    if (!track) return;
    const playlist = await api.createPlaylist(name);
    await api.addTracksToPlaylist(playlist.id, [track.id]);
    qc.invalidateQueries({ queryKey: ["playlists"] });
  }

  function buildPopularTrackMenu(track: Track): MenuEntry[] {
    return [
      { label: "Play Now", icon: "img/sub_play.png", onClick: () => insertAfterCurrentAndPlay(track) },
      { label: "Play Next", icon: "img/sub_next.png", onClick: () => addTrackNext(track) },
      { label: "Add to Queue", icon: "img/queue.png", onClick: () => addTrackToQueue(track) },
      { label: "Open Album", icon: "img/album.png", disabled: !track.album_id, onClick: () => openTrackAlbum(track) },
      { label: "Start Radio", icon: "img/radio.png", onClick: () => startRadio(track) },
      {
        label: "Add to Playlist", icon: "img/playlist.png",
        submenu: [
          { label: "New Playlist…", icon: "img/add.png", onClick: () => setNewPlaylistFor(track) },
          ...playlists.map((p) => ({
            label: `${p.name}  (${p.song_count})`,
            icon: "img/playlist.png",
            onClick: () => addToExistingPlaylist(p.id, track),
          })),
        ],
      },
      { label: "Get Info", icon: "img/info.png", onClick: () => setInfoTrack(track) },
      {
        label: track.starred ? "Remove from Favorites" : "Add to Favorites",
        icon: track.starred ? "img/heart_filled.png" : "img/heart.png",
        color: FAVORITE_PINK,
        onClick: () => toggleTrackFavorite(track),
      },
    ];
  }

  async function handlePlayAll() {
    if (!data) return;
    const tracks = await qc.fetchQuery({
      queryKey: ["artist-play-all", data.artist.id],
      queryFn: () => fetchArtistPlaybackTracks(data.artist.id, data.artist.name),
    });
    if (tracks.length) playTrack(tracks[0], tracks);
  }

  // Hold-to-shuffle for the header's PlayRingButton — same 600ms MouseArea
  // gesture as the grid cards' hover play circle (AlbumCard/ArtistCard).
  async function handleShuffleAll() {
    if (!data) return;
    const tracks = await qc.fetchQuery({
      queryKey: ["artist-play-all", data.artist.id],
      queryFn: () => fetchArtistPlaybackTracks(data.artist.id, data.artist.name),
    });
    if (!tracks.length) return;
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    playTrack(shuffled[0], shuffled);
  }

  async function toggleFavorite() {
    if (!data) return;
    const next = !(starred ?? data.artist.starred);
    setStarred(next);
    try { await api.setFavorite(data.artist.id, next, "artistId"); } catch { setStarred(!next); }
  }

  if (isLoading || !data) {
    return <div className="flex-1 flex items-center justify-center" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>Loading…</div>;
  }

  const bio = data.biography ? data.biography.replace(/<a [^>]*>.*?<\/a>\.?/gs, "").replace(/<[^>]+>/g, "").trim() : "";
  const isStarred = starred ?? data.artist.starred;

  // Albums vs. Singles & EPs — matches the old app's releaseTypes/albumType
  // substring check (artists_browser.py:196-203), each sorted newest-first.
  const isSingleOrEp = (a: Album) => {
    const rtype = (a.release_types ?? []).join(" ").toLowerCase();
    return rtype.includes("single") || rtype.includes("ep");
  };
  const mainAlbums = data.albums.filter((a) => !isSingleOrEp(a)).sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const singlesEps = data.albums.filter(isSingleOrEp).sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  const releaseCount = data.albums.length;
  const appearCount = appearsOn?.length ?? 0;
  const statsLine = releaseCount > 0
    ? `${releaseCount} release${releaseCount === 1 ? "" : "s"}${appearCount ? `  ·  ${appearCount} appearance${appearCount === 1 ? "" : "s"}` : ""}`
    : appearCount > 0
      ? `Guest Artist  ·  ${appearCount} appearance${appearCount === 1 ? "" : "s"}`
      : "No releases found";

  return (
    <>
      {/* Rendered as a sibling of the scroll-clean container, not a descendant —
          .scroll-clean's will-change:transform creates a new containing block
          for position:fixed descendants, which would otherwise confine this
          overlay to this panel instead of the whole window (see NowPlaying.tsx). */}
      {photoZoomOpen && data.artist.cover_id && (
        <CoverZoomOverlay coverId={data.artist.cover_id} onClose={() => setPhotoZoomOpen(false)} />
      )}
      <div className="h-full page-fade-in" style={{ position: "relative", minHeight: 0 }}>
      <div ref={scrollRef} className="h-full overflow-y-auto scroll-clean" style={{ padding: 12 }}>
      <div className="flex flex-col" style={{ gap: 10 }}>
        {/* ── Header ── */}
        <Card>
          <div className="flex" style={{ gap: 28 }}>
            <div style={{ position: "relative", width: 264, height: 264, flexShrink: 0 }}>
              {data.artist.cover_id && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute", inset: -1,
                    backgroundImage: `url(${coverUrl(data.artist.cover_id, 264)})`,
                    backgroundSize: "cover", backgroundPosition: "center",
                    filter: "blur(10px)", opacity: 0.9, borderRadius: "50%",
                  }}
                />
              )}
              <div
                onClick={() => data.artist.cover_id && setPhotoZoomOpen(true)}
                onMouseEnter={() => setPhotoHov(true)}
                onMouseLeave={() => setPhotoHov(false)}
                style={{
                  position: "relative", width: 264, height: 264, borderRadius: "50%", overflow: "hidden",
                  cursor: data.artist.cover_id ? "pointer" : "default",
                  transform: photoHov ? "scale(1.08)" : "scale(1)", transition: "transform 200ms",
                }}
              >
                <CoverArt coverId={data.artist.cover_id} size={264} className="w-full h-full rounded-full" />
              </div>
            </div>
            <div className="flex flex-col" style={{ paddingTop: 16, gap: 8, minWidth: 0 }}>
              <h1 className="truncate" style={{ color: "var(--text-primary)", fontSize: "var(--fs-hero)", fontWeight: 700 }}>{data.artist.name}</h1>
              <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", fontWeight: 600 }}>{statsLine}</p>
              <div className="flex items-center" style={{ gap: 6, marginTop: 8 }}>
                <PlayRingButton icon="img/play.png" onClick={handlePlayAll} onHoldShuffle={handleShuffleAll} title="Play" />
                <ActionButton
                  icon={isStarred ? "img/heart_filled.png" : "img/heart.png"}
                  tint={isStarred ? FAVORITE_PINK : undefined}
                  onClick={toggleFavorite}
                  title={isStarred ? "Remove from Favorites" : "Add to Favorites"}
                />
                {data.last_fm_url && (
                  <ActionButton icon="img/lastfm.png" onClick={() => window.open(data.last_fm_url!, "_blank")} title="Last.fm" />
                )}
                <ActionButton
                  icon="img/wikipedia.png"
                  onClick={() => window.open(`https://en.wikipedia.org/wiki/${encodeURIComponent(data.artist.name.replace(/ /g, "_"))}`, "_blank")}
                  title="Wikipedia"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* ── Bio ── */}
        {bio && (
          <Card>
            <div className="flex flex-col" style={{ gap: 6 }}>
              <SectionLabel text={`About ${data.artist.name}`} />
              <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", lineHeight: 1.6 }}>{truncateBio(bio, bioExpanded)}</p>
              {bio.length > BIO_TRUNCATE && (
                <button
                  onClick={() => setBioExpanded((v) => !v)}
                  style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 11, padding: 0 }}
                >
                  {bioExpanded ? "Show less" : "Read more"}
                </button>
              )}
            </div>
          </Card>
        )}

        {/* ── Popular tracks ── */}
        {topSongs && topSongs.length > 0 && (
          <div className="flex flex-col" style={{ gap: 6 }}>
            <SectionLabel text="Popular" />
            <div className="flex flex-col">
              {topSongs.map((t, i) => (
                <PopularTrackRow
                  key={t.id}
                  track={t}
                  index={i}
                  onPlay={() => insertAfterCurrentAndPlay(t)}
                  onOpenAlbum={() => openTrackAlbum(t)}
                  onContextMenu={(e) => handlePopularRowContextMenu(e, t)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Albums ── */}
        {mainAlbums.length > 0 && (
          <div className="flex flex-col" style={{ gap: 10 }}>
            <SectionLabel text="Albums" count={mainAlbums.length} />
            <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN}px, 1fr))`, gap: GAP }}>
              {mainAlbums.map((a) => <AlbumCard key={a.id} album={a} onOpen={openAlbum} />)}
            </div>
          </div>
        )}

        {/* ── Singles & EPs ── */}
        {singlesEps.length > 0 && (
          <div className="flex flex-col" style={{ gap: 10 }}>
            <SectionLabel text="Singles & EPs" count={singlesEps.length} />
            <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN}px, 1fr))`, gap: GAP }}>
              {singlesEps.map((a) => <AlbumCard key={a.id} album={a} onOpen={openAlbum} />)}
            </div>
          </div>
        )}

        {/* ── Appears On ── */}
        {appearsOn && appearsOn.length > 0 && (
          <div className="flex flex-col" style={{ gap: 10 }}>
            <SectionLabel text="Appears On" count={appearsOn.length} />
            <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN}px, 1fr))`, gap: GAP }}>
              {appearsOn.map((a) => <AlbumCard key={a.id} album={a} onOpen={openAlbum} />)}
            </div>
          </div>
        )}

        {/* ── Related artists ── */}
        {data.similar_artists.length > 0 && (
          <div style={{ paddingBottom: 16 }}>
            <RelatedArtistsCarousel artists={data.similar_artists} onOpen={openArtist} />
          </div>
        )}
      </div>
      </div>
      <ScrollThumb scrollRef={scrollRef} />
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildPopularTrackMenu(ctxMenu.track)}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {infoTrack && <TrackInfoDialog track={infoTrack} onClose={() => setInfoTrack(null)} />}
      {newPlaylistFor && (
        <PromptDialog
          title="New Playlist"
          placeholder="Playlist name"
          confirmLabel="Create"
          onSubmit={createPlaylistAndAdd}
          onCancel={() => setNewPlaylistFor(null)}
        />
      )}
    </>
  );
}
