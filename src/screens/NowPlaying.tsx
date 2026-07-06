import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { api, Track, TourEvent, TrackFullInfo } from "../lib/api";
import { fmtDuration } from "../lib/api";
import { ArtistTokens, ARTIST_SEP_RE } from "../components/ArtistTokens";
import { CoverArt } from "../components/CoverArt";
import { CoverZoomOverlay } from "../components/CoverZoomOverlay";
import { Icon } from "../components/Icon";
import { FAVORITE_PINK, PLAY_ICON_DARK } from "../lib/theme";

// Ported from now_playing.qml / now_playing_info.py — the rich "Now Playing"
// info page (track hero, from-this-album, most-played-by-artist, about-the-
// artist, on-tour). See UI_MANIFEST.md.

const ALBUM_SHOW_N  = 5;
const TOUR_LIMIT    = 5;
const BIO_TRUNCATE  = 240;
const LS_BIT_ENABLED = "bandsintown_enabled";

const GENRE_SEP_RE = /( \/\/\/ | • | \/ |,\s*|;\s*)/;

// Only fetches while the tab is actually visible — matches ArtistInfoPanel's
// established "defer until active" rationale (no point hitting the Subsonic/
// Last.fm/Bandsintown APIs for a track the user isn't looking at). Re-runs as
// soon as the tab becomes active again if `key` changed while it was hidden.
function useDeferredKeyEffect(active: boolean, key: string, run: () => void) {
  const lastRef = useRef<string | null>(null);
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!active || key === lastRef.current) return;
    lastRef.current = key;
    runRef.current();
  }, [key, active]);
}

function loadBitEnabled(): boolean {
  try { return localStorage.getItem(LS_BIT_ENABLED) === "1"; } catch { return false; }
}
function saveBitEnabled(v: boolean) {
  try { localStorage.setItem(LS_BIT_ENABLED, v ? "1" : "0"); } catch { /* best-effort */ }
}

function truncateBio(bio: string, expanded: boolean): string {
  if (expanded || bio.length <= BIO_TRUNCATE) return bio;
  const short = bio.slice(0, BIO_TRUNCATE);
  const cut = short.lastIndexOf(" ");
  return (cut > 0 ? short.slice(0, cut) : short) + "…";
}

interface ArtistPage { id: string | null; name: string }

// Same splitting behavior as ArtistInfoPanel.tsx's splitArtists — kept as a
// separate small copy since that one isn't exported (self-contained card).
function splitArtists(name: string, knownId: string | null): ArtistPage[] {
  const parts = name.split(ARTIST_SEP_RE).filter((p) => p.trim() && !ARTIST_SEP_RE.test(p));
  const names = parts.length ? parts.map((p) => p.trim()) : [name];
  return names.map((n, i) => ({ id: i === 0 ? knownId : null, name: n }));
}

function fmtTotal(totalSecs: number): string {
  const totalMin = Math.floor(totalSecs / 60);
  if (totalMin >= 60) return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
  return `${totalMin}m`;
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, ...style }}>
      {children}
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <span style={{ color: "var(--accent)", fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>
      {text}
    </span>
  );
}

function LinkText({ text, onClick }: { text: string; onClick?: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <span
      onClick={onClick}
      onMouseEnter={() => onClick && setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        color: onClick && hov ? "var(--accent)" : "var(--text-secondary)",
        cursor: onClick ? "pointer" : "default",
        textDecorationLine: onClick && hov ? "underline" : "none",
        textUnderlineOffset: 2,
      }}
    >
      {text}
    </span>
  );
}

function PageNav({ idx, count, onNav }: { idx: number; count: number; onNav: (i: number) => void }) {
  if (count <= 1) return null;
  return (
    <div className="flex items-center" style={{ gap: 2 }}>
      <button
        onClick={() => onNav(idx - 1)}
        disabled={idx === 0}
        style={{ width: 20, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: idx === 0 ? "default" : "pointer", color: idx === 0 ? "#444444" : "var(--accent)", fontSize: 14, lineHeight: 1 }}
      >‹</button>
      <span style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: 700, lineHeight: 1 }}>{idx + 1}/{count}</span>
      <button
        onClick={() => onNav(idx + 1)}
        disabled={idx === count - 1}
        style={{ width: 20, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: idx === count - 1 ? "default" : "pointer", color: idx === count - 1 ? "#444444" : "var(--accent)", fontSize: 14, lineHeight: 1 }}
      >›</button>
    </div>
  );
}

// ── Track hero card ─────────────────────────────────────────────────────────

function TrackHeroCard({ track, active, onCoverClick }: { track: Track; active: boolean; onCoverClick: () => void }) {
  const setQueuePanelTab = useStore((s) => s.setQueuePanelTab);
  const coverUrl = useStore((s) => s.coverUrl);
  const [hov, setHov] = useState(false);
  const [starred, setStarred] = useState(track.starred);
  const [extra, setExtra] = useState<TrackFullInfo | null>(null);

  useEffect(() => setStarred(track.starred), [track.id, track.starred]);
  useDeferredKeyEffect(active, track.id, () => {
    setExtra(null);
    api.getTrackInfo(track.id).then(setExtra).catch(() => setExtra(null));
  });

  async function toggleFavorite() {
    const next = !starred;
    setStarred(next);
    try { await api.setFavorite(track.id, next, "id"); } catch { setStarred(!next); }
  }

  const genreTokens = (track.genre ?? "").split(GENRE_SEP_RE).filter((p) => p.trim());
  const infoParts: string[] = [];
  if (extra?.codec || track.format) infoParts.push((extra?.codec || track.format || "").toUpperCase());
  if (track.bitrate) infoParts.push(`${track.bitrate} kbps`);
  if (extra?.sample_rate) infoParts.push(`${(extra.sample_rate / 1000).toFixed(1).replace(/\.0$/, "")} kHz`);
  if (extra?.bit_depth) infoParts.push(`${extra.bit_depth}-bit`);
  if (track.duration_secs) infoParts.push(fmtDuration(track.duration_secs));

  const firstArtist = track.artist ? track.artist.split(ARTIST_SEP_RE)[0].trim() : "";
  const lastfmUrl = firstArtist ? `https://www.last.fm/music/${encodeURIComponent(firstArtist)}` : "";
  const wikiUrl = firstArtist ? `https://en.wikipedia.org/wiki/${encodeURIComponent(firstArtist.replace(/ /g, "_"))}` : "";

  async function openAlbum() {
    if (!track.album_id) return;
    const album = await api.getAlbum(track.album_id);
    useStore.getState().navigateTo({ tab: "albums", album });
  }

  return (
    <Card style={{ display: "flex", gap: 28, padding: 28 }}>
      <div style={{ position: "relative", width: 264, height: 264, flexShrink: 0 }}>
        {track.cover_id && (
          <div
            aria-hidden
            style={{
              position: "absolute", inset: -1,
              backgroundImage: `url(${coverUrl(track.cover_id, 264)})`,
              backgroundSize: "cover", backgroundPosition: "center",
              filter: "blur(10px)", opacity: 0.9, borderRadius: 10,
            }}
          />
        )}
        <div
          onClick={() => track.cover_id && onCoverClick()}
          onMouseEnter={() => setHov(true)}
          onMouseLeave={() => setHov(false)}
          style={{
            position: "relative", width: 264, height: 264, borderRadius: 10, overflow: "hidden", cursor: "pointer",
            transform: hov ? "scale(1.08)" : "scale(1)", transition: "transform 200ms",
          }}
        >
          <CoverArt coverId={track.cover_id} size={264} className="w-full h-full" />
        </div>
      </div>

      <div className="flex flex-col" style={{ flex: 1, minWidth: 0, paddingTop: 16, gap: 6 }}>
        <h1 style={{ color: "var(--accent)", fontSize: "var(--fs-hero)", fontWeight: 700 }}>{track.title}</h1>

        {(track.album || track.year) && (
          <div className="flex items-center" style={{ gap: 6, fontSize: "var(--fs-primary)", fontWeight: 700 }}>
            {track.album && <LinkText text={track.album} onClick={openAlbum} />}
            {track.album && track.year && <span style={{ color: "var(--text-secondary)" }}>•</span>}
            {track.year && <span style={{ color: "var(--text-secondary)" }}>{track.year}</span>}
          </div>
        )}

        <ArtistTokens name={track.artist} artistId={track.artist_id} fontSize="var(--fs-primary)" alwaysAccent={false} />

        {genreTokens.length > 0 && (
          <div className="flex flex-wrap" style={{ gap: 4 }}>
            {genreTokens.map((g, i) => (
              <span key={i} style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>
                {g}{i < genreTokens.length - 1 ? " •" : ""}
              </span>
            ))}
          </div>
        )}

        {infoParts.length > 0 && (
          <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{infoParts.join("   ")}</p>
        )}

        <div className="flex items-center" style={{ gap: 8, marginTop: 4 }}>
          <ActionButton
            icon={starred ? "img/heart_filled.png" : "img/heart.png"}
            tint={starred ? FAVORITE_PINK : undefined}
            onClick={toggleFavorite}
            title={starred ? "Remove from Favorites" : "Add to Favorites"}
          />
          <ActionButton icon="img/lyrics.png" onClick={() => setQueuePanelTab("lyrics")} title="Lyrics" />
          {lastfmUrl && <ActionButton icon="img/lastfm.png" onClick={() => window.open(lastfmUrl, "_blank")} title="Last.fm" />}
          {wikiUrl && <ActionButton icon="img/wikipedia.png" onClick={() => window.open(wikiUrl, "_blank")} title="Wikipedia" />}
        </div>
      </div>
    </Card>
  );
}

function ActionButton({ icon, onClick, title, tint }: { icon: string; onClick: () => void; title: string; tint?: string }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer",
        background: hov ? "var(--hover-bg)" : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <Icon src={icon} size={18} style={{ background: tint ?? "var(--text-secondary)" }} />
    </button>
  );
}

// ── From This Album card ─────────────────────────────────────────────────────

function AlbumTracksCard({ track, active }: { track: Track; active: boolean }) {
  const playTrack = useStore((s) => s.playTrack);
  const navigateTo = useStore((s) => s.navigateTo);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  useDeferredKeyEffect(active, track.album_id ?? "", () => {
    setTracks(null);
    setShowAll(false);
    if (!track.album_id) return;
    api.getAlbumTracks(track.album_id).then(setTracks).catch(() => setTracks([]));
  });

  async function openAlbum() {
    if (!track.album_id) return;
    const album = await api.getAlbum(track.album_id);
    navigateTo({ tab: "albums", album });
  }

  const sorted = (tracks ?? []).slice().sort((a, b) =>
    (a.disc_number || 1) - (b.disc_number || 1) || (a.track_number || 0) - (b.track_number || 0));
  const currentIdx = sorted.findIndex((t) => t.id === track.id);
  const totalSecs = sorted.reduce((s, t) => s + (t.duration_secs || 0), 0);

  let start = 0, end = Math.min(ALBUM_SHOW_N, sorted.length);
  if (currentIdx >= 0 && sorted.length > ALBUM_SHOW_N) {
    const half = Math.floor(ALBUM_SHOW_N / 2);
    start = Math.max(0, currentIdx - half);
    end = start + ALBUM_SHOW_N;
    if (end > sorted.length) { end = sorted.length; start = Math.max(0, end - ALBUM_SHOW_N); }
  }

  const metaParts = [
    currentIdx >= 0 ? `Track ${sorted[currentIdx].track_number || currentIdx + 1} of ${sorted.length}` : `${sorted.length} tracks`,
    totalSecs ? fmtTotal(totalSecs) : "",
  ].filter(Boolean);

  return (
    <Card>
      <div className="flex items-start justify-between" style={{ gap: 6 }}>
        <div style={{ minWidth: 0 }}>
          <SectionLabel text="From This Album" />
          {metaParts.length > 0 && (
            <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{metaParts.join("  ·  ")}</p>
          )}
        </div>
        {(track.album_id || track.album) && <LinkText text="Go to Album ↗" onClick={openAlbum} />}
      </div>

      {tracks === null ? (
        <p style={{ color: "var(--text-secondary)", fontSize: 11, marginTop: 6 }}>Loading…</p>
      ) : sorted.length === 0 ? null : (
        <>
          <div style={{ height: 1, background: "var(--border)", margin: "8px 0 4px" }} />
          {sorted.map((t, i) => {
            if (!(showAll || (i >= start && i < end))) return null;
            const isCurrent = t.id === track.id;
            return (
              <AlbumTrackRow
                key={t.id} track={t} num={String(t.track_number || i + 1)}
                isCurrent={isCurrent}
                onClick={() => playTrack(t, sorted)}
              />
            );
          })}
          {end - start < sorted.length && (
            <button
              onClick={() => setShowAll((v) => !v)}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 11, padding: "4px 0" }}
            >
              {showAll ? "Show less" : `Show ${sorted.length - (end - start)} more`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function AlbumTrackRow({ track, num, isCurrent, onClick }: { track: Track; num: string; isCurrent: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="flex items-center"
      style={{ height: 34, borderRadius: 4, cursor: "pointer", background: hov ? "var(--hover-bg)" : "transparent", padding: "0 8px 0 6px", gap: 6 }}
    >
      <span style={{ width: 22, textAlign: "center", color: isCurrent ? "var(--accent)" : "var(--text-secondary)", fontWeight: isCurrent ? 700 : 400, fontSize: "var(--fs-secondary)" }}>{num}</span>
      <span className="truncate" style={{ flex: 1, color: isCurrent || hov ? "var(--accent)" : "var(--text-secondary)", fontWeight: isCurrent ? 700 : 400, fontSize: "var(--fs-secondary)" }}>{track.title}</span>
      <span style={{ width: 38, textAlign: "right", color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{fmtDuration(track.duration_secs)}</span>
    </div>
  );
}

// ── Most Played By card ──────────────────────────────────────────────────────

function TopSongsCard({ pages, pageIdx, onNav, currentTrackId, active }: {
  pages: ArtistPage[]; pageIdx: number; onNav: (i: number) => void; currentTrackId: string; active: boolean;
}) {
  const playTrack = useStore((s) => s.playTrack);
  const navigateTo = useStore((s) => s.navigateTo);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const genRef = useRef(0);
  const name = pages[pageIdx]?.name ?? "";

  useDeferredKeyEffect(active, `${pageIdx}:${name}`, () => {
    const gen = ++genRef.current;
    setTracks(null);
    if (!name) return;
    api.getTopSongs(name, 5).then((t) => { if (gen === genRef.current) setTracks(t); }).catch(() => { if (gen === genRef.current) setTracks([]); });
  });

  async function goToArtist() {
    const page = pages[pageIdx];
    if (!page) return;
    if (page.id) { navigateTo({ tab: "artists", artistId: page.id }); return; }
    navigateTo({ tab: "artists", artistQuery: page.name });
  }

  return (
    <Card>
      <div className="flex items-start justify-between" style={{ gap: 6 }}>
        <p className="truncate" style={{ flex: 1 }}>
          <SectionLabel text={name ? `Most Played by ${name}` : "Most Played by This Artist"} />
        </p>
        <div className="flex items-center" style={{ gap: 6, flexShrink: 0 }}>
          <PageNav idx={pageIdx} count={pages.length} onNav={onNav} />
          {name && <LinkText text="Go to Artist ↗" onClick={goToArtist} />}
        </div>
      </div>

      {tracks === null ? (
        <p style={{ color: "var(--text-secondary)", fontSize: 11, marginTop: 6 }}>Loading…</p>
      ) : tracks.length === 0 ? null : (
        <>
          <div style={{ height: 1, background: "var(--border)", margin: "8px 0 4px" }} />
          {tracks.map((t, i) => (
            <TopSongRow key={t.id + i} track={t} index={i} isCurrent={t.id === currentTrackId} onClick={() => playTrack(t, tracks)} />
          ))}
          <p style={{ color: "var(--text-secondary)", fontSize: 10, marginTop: 4 }}>Top tracks from {name} via Last.fm</p>
        </>
      )}
    </Card>
  );
}

function TopSongRow({ track, index, isCurrent, onClick }: { track: Track; index: number; isCurrent: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="flex items-center"
      style={{ minHeight: 46, borderRadius: 4, cursor: "pointer", background: hov ? "var(--hover-bg)" : "transparent", padding: "4px 8px 4px 6px", gap: 6 }}
    >
      <span style={{ width: 22, textAlign: "center", color: isCurrent ? "var(--accent)" : "var(--text-secondary)", fontWeight: isCurrent ? 700 : 400, fontSize: "var(--fs-secondary)" }}>{index + 1}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="truncate" style={{ color: isCurrent || hov ? "var(--accent)" : "var(--text-primary)", fontWeight: isCurrent ? 700 : 400, fontSize: "var(--fs-secondary)" }}>{track.title}</p>
        {track.album && <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "calc(var(--fs-secondary) - 2px)" }}>{track.album}</p>}
      </div>
      <span style={{ width: 38, textAlign: "right", color: "var(--text-secondary)", fontSize: "calc(var(--fs-secondary) - 2px)" }}>{fmtDuration(track.duration_secs)}</span>
    </div>
  );
}

// ── About the Artist card ────────────────────────────────────────────────────

function ArtistCard({ pages, pageIdx, onNav, imageUrl, bio, similar, loading }: {
  pages: ArtistPage[]; pageIdx: number; onNav: (i: number) => void;
  imageUrl: string | null; bio: string; similar: string[]; loading: boolean;
}) {
  const navigateTo = useStore((s) => s.navigateTo);
  const [bioExpanded, setBioExpanded] = useState(false);
  useEffect(() => setBioExpanded(false), [pageIdx, pages[pageIdx]?.name]);

  const name = pages[pageIdx]?.name ?? "";

  function goToSimilar(n: string) {
    navigateTo({ tab: "artists", artistQuery: n });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionLabel text="About the Artist" />
        <div className="flex items-center" style={{ gap: 6 }}>
          <PageNav idx={pageIdx} count={pages.length} onNav={onNav} />
          {name && <LinkText text="Go to Artist ↗" onClick={() => navigateTo(pages[pageIdx].id ? { tab: "artists", artistId: pages[pageIdx].id! } : { tab: "artists", artistQuery: name })} />}
        </div>
      </div>

      <div className="flex items-center" style={{ gap: 10, marginTop: 8 }}>
        <div style={{ width: 88, height: 88, borderRadius: 44, overflow: "hidden", flexShrink: 0, background: "var(--skeleton)" }}>
          {imageUrl && <img src={imageUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
        <p style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 700 }}>{name || "Unknown Artist"}</p>
      </div>

      {loading ? (
        <p style={{ color: "var(--text-secondary)", fontSize: 11, marginTop: 8 }}>Loading…</p>
      ) : (
        <>
          {bio && (
            <>
              <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", lineHeight: 1.5, marginTop: 8 }}>{truncateBio(bio, bioExpanded)}</p>
              {bio.length > BIO_TRUNCATE && (
                <button onClick={() => setBioExpanded((v) => !v)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 11, padding: "4px 0" }}>
                  {bioExpanded ? "Show less" : "Read more"}
                </button>
              )}
            </>
          )}
          {similar.length > 0 && (
            <div className="flex flex-wrap" style={{ gap: 5, marginTop: 6 }}>
              {similar.map((n, i) => (
                <SimilarChip key={i} name={n} onClick={() => goToSimilar(n)} />
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function SimilarChip({ name, onClick }: { name: string; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <span
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: "3px 8px", borderRadius: 4, cursor: "pointer",
        background: hov ? "var(--hover-bg)" : "color-mix(in srgb, white 8%, transparent)",
        border: "1px solid var(--border)",
        color: "var(--text-secondary)", fontSize: "var(--fs-secondary)",
      }}
    >
      {name}
    </span>
  );
}

// ── On Tour card ─────────────────────────────────────────────────────────────

function TourCard({ pageIdx, events, loading }: { pageIdx: number; events: TourEvent[] | null; loading: boolean }) {
  const [bitEnabled, setBitEnabled] = useState(loadBitEnabled);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [pageIdx]);

  function enable() {
    saveBitEnabled(true);
    setBitEnabled(true);
  }

  const visible = events ? (showAll ? events : events.slice(0, TOUR_LIMIT)) : [];

  return (
    <Card>
      <SectionLabel text="On Tour" />
      {!bitEnabled ? (
        <div style={{ marginTop: 6 }}>
          <p style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 700 }}>See upcoming shows?</p>
          <p style={{ color: "var(--text-secondary)", fontSize: 11, marginTop: 2 }}>Loads tour dates from Bandsintown. Only the artist name leaves your device.</p>
          <button
            onClick={enable}
            style={{ marginTop: 8, height: 30, padding: "0 16px", background: "var(--accent)", color: PLAY_ICON_DARK, fontWeight: 700, fontSize: 12, border: "none", borderRadius: 6, cursor: "pointer" }}
          >
            Enable tour dates
          </button>
        </div>
      ) : loading ? (
        <p style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 8 }}>Loading…</p>
      ) : !events || events.length === 0 ? (
        <p style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 8 }}>No upcoming shows</p>
      ) : (
        <>
          <div className="flex flex-col" style={{ gap: 4, marginTop: 8 }}>
            {visible.map((ev, i) => <TourEventRow key={i} event={ev} />)}
          </div>
          {events.length > TOUR_LIMIT && (
            <button onClick={() => setShowAll((v) => !v)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 11, padding: "4px 0" }}>
              {showAll ? "Show less" : `Show ${events.length - TOUR_LIMIT} more`}
            </button>
          )}
          <p style={{ color: "var(--text-secondary)", opacity: 0.6, fontSize: 10, marginTop: 4 }}>Tour data via Bandsintown</p>
        </>
      )}
    </Card>
  );
}

function TourEventRow({ event }: { event: TourEvent }) {
  const [hov, setHov] = useState(false);
  let month = "", day = "";
  try {
    const d = new Date(event.datetime);
    month = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
    day = String(d.getDate());
  } catch { /* leave blank */ }
  const place = [event.venue.city, event.venue.region, event.venue.country].filter(Boolean).join(", ");

  return (
    <div
      onClick={() => event.url && window.open(event.url, "_blank")}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="flex items-center"
      style={{ gap: 10, padding: "4px 6px", borderRadius: 6, cursor: event.url ? "pointer" : "default", background: hov ? "var(--hover-bg)" : "transparent" }}
    >
      <div className="flex flex-col items-center justify-center shrink-0" style={{ width: 38, height: 42, borderRadius: 6, background: "var(--panel-bg)" }}>
        <span style={{ color: "var(--accent)", fontSize: 9, fontWeight: 700 }}>{month}</span>
        <span style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 700 }}>{day}</span>
      </div>
      <div className="min-w-0" style={{ flex: 1 }}>
        <p className="truncate" style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>{event.venue.name || "TBA"}</p>
        {place && <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "calc(var(--fs-secondary) - 2px)" }}>{place}</p>}
      </div>
    </div>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export function NowPlaying({ active }: { active: boolean }) {
  const queue = useStore((s) => s.queue);
  const currentIndex = useStore((s) => s.currentIndex);
  const track = queue[currentIndex] ?? null;

  const [pages, setPages] = useState<ArtistPage[]>([]);
  const [artistPageIdx, setArtistPageIdx] = useState(0);
  const [topPageIdx, setTopPageIdx] = useState(0);

  const [artistLoading, setArtistLoading] = useState(false);
  const [artistImage, setArtistImage] = useState<string | null>(null);
  const [artistBio, setArtistBio] = useState("");
  const [similar, setSimilar] = useState<string[]>([]);

  const [tourLoading, setTourLoading] = useState(false);
  const [tourEvents, setTourEvents] = useState<TourEvent[] | null>(null);

  const genRef = useRef(0);

  async function loadArtistPage(pageList: ArtistPage[], idx: number) {
    const gen = ++genRef.current;
    setArtistLoading(true);
    setArtistImage(null);
    setArtistBio("");
    setSimilar([]);
    setTourEvents(null);
    const page = pageList[idx];
    if (!page) { setArtistLoading(false); return; }

    let id = page.id;
    if (!id) {
      const result = await api.search(page.name, 5, 0, 0).catch(() => null);
      if (gen !== genRef.current) return;
      const match = result?.artists.find((a) => a.name.toLowerCase() === page.name.toLowerCase());
      id = match?.id ?? result?.artists[0]?.id ?? null;
      if (id) setPages((prev) => prev.map((p, i) => (i === idx ? { ...p, id } : p)));
    }
    if (id) {
      const d = await api.getArtist(id).catch(() => null);
      if (gen !== genRef.current) return;
      if (d) {
        setArtistImage(d.image_url);
        const bio = d.biography ? d.biography.replace(/<a [^>]*>.*?<\/a>\.?/gs, "").trim() : "";
        setArtistBio(bio);
        setSimilar(d.similar_artists.slice(0, 6).map((a) => a.name));
      }
    }
    setArtistLoading(false);

    if (loadBitEnabled() && page.name) {
      setTourLoading(true);
      const evs = await api.bandsintownEvents(page.name).catch(() => []);
      if (gen !== genRef.current) return;
      setTourEvents(evs);
      setTourLoading(false);
    }
  }

  // Splitting the artist string into pages is free (no network), so that
  // always happens immediately; the actual bio/top-songs/tour-date fetch is
  // deferred until the tab is visible (see useDeferredKeyEffect below) — no
  // point hitting the Subsonic/Last.fm/Bandsintown APIs for a track the user
  // never looks at Now Playing for.
  useEffect(() => {
    if (!track?.artist) { setPages([]); return; }
    const split = splitArtists(track.artist, track.artist_id);
    setPages(split);
    setArtistPageIdx(0);
    setTopPageIdx(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.artist]);

  useDeferredKeyEffect(active, track?.artist ?? "", () => {
    if (!track?.artist) return;
    loadArtistPage(splitArtists(track.artist, track.artist_id), 0);
  });

  function navArtistPage(idx: number) {
    if (idx < 0 || idx >= pages.length) return;
    setArtistPageIdx(idx);
    loadArtistPage(pages, idx);
  }

  const [zoomOpen, setZoomOpen] = useState(false);

  if (!track) {
    return (
      <div className="flex-1 overflow-y-auto scroll-clean" style={{ padding: 12 }}>
        <Card style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>No track playing</p>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* Rendered as a sibling of the scroll-clean container, not a descendant —
          `.scroll-clean`'s `will-change: transform` creates a new containing
          block for `position: fixed` descendants, which would otherwise confine
          this overlay to the Now Playing area instead of the whole window. */}
      {zoomOpen && track.cover_id && <CoverZoomOverlay coverId={track.cover_id} onClose={() => setZoomOpen(false)} />}
      <div className="flex-1 overflow-y-auto scroll-clean" style={{ padding: 12 }}>
      <div className="flex flex-col" style={{ gap: 10 }}>
        <TrackHeroCard track={track} active={active} onCoverClick={() => setZoomOpen(true)} />

        <div className="flex" style={{ gap: 10 }}>
          <div className="flex flex-col" style={{ flex: 1, minWidth: 0, gap: 10 }}>
            <AlbumTracksCard track={track} active={active} />
            <TopSongsCard pages={pages} pageIdx={topPageIdx} onNav={setTopPageIdx} currentTrackId={track.id} active={active} />
          </div>
          <div className="flex flex-col" style={{ flex: 1, minWidth: 0, gap: 10 }}>
            <ArtistCard pages={pages} pageIdx={artistPageIdx} onNav={navArtistPage} imageUrl={artistImage} bio={artistBio} similar={similar} loading={artistLoading} />
            <TourCard pageIdx={artistPageIdx} events={tourEvents} loading={tourLoading} />
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
