import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { api, ArtistDetail, TourEvent } from "../lib/api";
import { ARTIST_SEP_RE } from "./ArtistTokens";
import { ScrollThumb } from "./ScrollThumb";

const TOUR_LIMIT = 5;
const LS_BIT_ENABLED = "bandsintown_enabled";
const BIO_TRUNCATE = 240;

function loadBitEnabled(): boolean {
  try { return localStorage.getItem(LS_BIT_ENABLED) === "1"; } catch { return false; }
}
function saveBitEnabled(v: boolean) {
  try { localStorage.setItem(LS_BIT_ENABLED, v ? "1" : "0"); } catch { /* best-effort */ }
}

interface ArtistPage { id: string | null; name: string }

// Splits a multi-artist string into pages the same way the old app's
// ArtistInfoPanel.load_track does (artist_info_panel.py:276-287) — only the
// first page carries the track's own known artist_id; later pages are
// resolved by name lookup on demand (see loadPage below).
function splitArtists(name: string, knownId: string | null): ArtistPage[] {
  const parts = name.split(ARTIST_SEP_RE).filter((p) => p.trim() && !ARTIST_SEP_RE.test(p));
  const names = parts.length ? parts.map((p) => p.trim()) : [name];
  return names.map((n, i) => ({ id: i === 0 ? knownId : null, name: n }));
}

function truncateBio(bio: string, expanded: boolean): string {
  if (expanded || bio.length <= BIO_TRUNCATE) return bio;
  const short = bio.slice(0, BIO_TRUNCATE);
  const cut = short.lastIndexOf(" ");
  return (cut > 0 ? short.slice(0, cut) : short) + "…";
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
      style={{ gap: 10, padding: "6px 8px", borderRadius: 6, cursor: event.url ? "pointer" : "default", background: hov ? "var(--hover-bg)" : "transparent" }}
    >
      <div
        className="flex flex-col items-center justify-center shrink-0"
        style={{ width: 38, height: 42, borderRadius: 6, background: "var(--card-bg)" }}
      >
        <span style={{ color: "var(--accent)", fontSize: 9, fontWeight: 700 }}>{month}</span>
        <span style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 700 }}>{day}</span>
      </div>
      <div className="min-w-0" style={{ flex: 1 }}>
        <p className="truncate" style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>
          {event.venue.name || place}
        </p>
        {place && event.venue.name && (
          <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "calc(var(--fs-secondary) - 2px)" }}>{place}</p>
        )}
      </div>
    </div>
  );
}

export function ArtistInfoPanel({ active }: { active: boolean }) {
  const queue = useStore((s) => s.queue);
  const currentIndex = useStore((s) => s.currentIndex);
  const track = queue[currentIndex] ?? null;

  const [pages, setPages] = useState<ArtistPage[]>([]);
  const [pageIdx, setPageIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ArtistDetail | null>(null);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [bitEnabled, setBitEnabled] = useState(loadBitEnabled);
  const [events, setEvents] = useState<TourEvent[] | null>(null);
  const [showAllTours, setShowAllTours] = useState(false);

  const lastArtistRef = useRef<string | null>(null);
  const genRef = useRef(0);
  // Splitting the artist string into pages is free (no network), so that
  // always happens immediately; the actual bio/tour-date fetch (search3,
  // getArtist, Bandsintown) is deferred until the Info tab is visible,
  // matching load_track()'s _pending_load + "only fetch once btn_info is
  // checked" behavior — no point hitting those APIs for an artist the user
  // never looks up.
  const pendingRef = useRef<{ pages: ArtistPage[]; idx: number } | null>(null);

  async function loadPage(pageList: ArtistPage[], idx: number) {
    const gen = ++genRef.current;
    setLoading(true);
    setDetail(null);
    setBioExpanded(false);
    setEvents(null);
    setShowAllTours(false);
    const page = pageList[idx];
    if (!page) { setLoading(false); return; }

    let id = page.id;
    if (!id) {
      const result = await api.search(page.name, 5, 0, 0).catch(() => null);
      if (gen !== genRef.current) return;
      const match = result?.artists.find((a) => a.name.toLowerCase() === page.name.toLowerCase());
      id = match?.id ?? result?.artists[0]?.id ?? null;
      if (id) setPages((prev) => prev.map((p, i) => (i === idx ? { ...p, id } : p)));
    }
    if (!id) { setLoading(false); return; }

    const d = await api.getArtist(id).catch(() => null);
    if (gen !== genRef.current) return;
    setDetail(d);
    setLoading(false);

    if (loadBitEnabled() && page.name) {
      const evs = await api.bandsintownEvents(page.name).catch(() => []);
      if (gen !== genRef.current) return;
      setEvents(evs);
    }
  }

  useEffect(() => {
    const name = track?.artist ?? null;
    if (name === lastArtistRef.current) return;
    lastArtistRef.current = name;
    pendingRef.current = null;
    if (!name) { setPages([]); setDetail(null); return; }
    const split = splitArtists(name, track?.artist_id ?? null);
    setPages(split);
    setPageIdx(0);
    if (active) loadPage(split, 0);
    else pendingRef.current = { pages: split, idx: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.artist]);

  useEffect(() => {
    if (active && pendingRef.current) {
      const { pages: p, idx } = pendingRef.current;
      pendingRef.current = null;
      loadPage(p, idx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function goToPage(idx: number) {
    if (idx < 0 || idx >= pages.length) return;
    setPageIdx(idx);
    loadPage(pages, idx);
  }

  function enableBandsintown() {
    saveBitEnabled(true);
    setBitEnabled(true);
    const page = pages[pageIdx];
    if (page?.name) api.bandsintownEvents(page.name).then(setEvents).catch(() => setEvents([]));
  }

  if (!track) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p style={{ color: "var(--text-secondary)", opacity: 0.4, fontSize: "var(--fs-secondary)", textAlign: "center", padding: 32 }}>
          Play something to see artist info
        </p>
      </div>
    );
  }

  const page = pages[pageIdx];
  const bio = detail?.biography ? detail.biography.replace(/<a [^>]*>.*?<\/a>\.?/gs, "").trim() : "";
  const visibleEvents = events ? (showAllTours ? events : events.slice(0, TOUR_LIMIT)) : [];

  return (
    <div className="flex-1" style={{ minHeight: 0, position: "relative" }}>
    <div ref={scrollRef} className="h-full overflow-y-auto scroll-clean" style={{ padding: 8 }}>
      {loading && !detail ? (
        <p className="text-center" style={{ color: "var(--text-secondary)", opacity: 0.4, fontSize: "var(--fs-secondary)", padding: 32 }}>Loading…</p>
      ) : (
        <>
          {detail?.image_url && (
            <img
              src={detail.image_url}
              alt=""
              style={{ width: "100%", borderRadius: 10, marginBottom: 12, display: "block" }}
            />
          )}

          <div className="flex items-center" style={{ marginBottom: 4 }}>
            <span style={{ color: "var(--text-secondary)", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Artist</span>
            {pages.length > 1 && (
              <div className="flex items-center" style={{ marginLeft: "auto", gap: 2 }}>
                <button
                  onClick={() => goToPage(pageIdx - 1)}
                  disabled={pageIdx === 0}
                  style={{ width: 26, height: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: pageIdx === 0 ? "default" : "pointer", color: pageIdx === 0 ? "#333333" : "var(--accent)", fontSize: 16, lineHeight: 1 }}
                >
                  ‹
                </button>
                <span style={{ color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, lineHeight: 1 }}>{pageIdx + 1}/{pages.length}</span>
                <button
                  onClick={() => goToPage(pageIdx + 1)}
                  disabled={pageIdx === pages.length - 1}
                  style={{ width: 26, height: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: pageIdx === pages.length - 1 ? "default" : "pointer", color: pageIdx === pages.length - 1 ? "#333333" : "var(--accent)", fontSize: 16, lineHeight: 1 }}
                >
                  ›
                </button>
              </div>
            )}
          </div>

          <h3 style={{ color: "var(--text-primary)", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            {page?.name || "Unknown Artist"}
          </h3>

          {bio && (
            <>
              <p style={{ color: "var(--text-secondary)", fontSize: "calc(var(--fs-secondary) - 1px)", lineHeight: 1.5, marginBottom: 4 }}>
                {truncateBio(bio, bioExpanded)}
              </p>
              <button
                onClick={() => setBioExpanded((v) => !v)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: "calc(var(--fs-secondary) - 1px)", padding: 0, marginBottom: 12 }}
              >
                {bioExpanded ? "Show less" : "Read more"}
              </button>
            </>
          )}

          <div style={{ height: 1, background: "var(--border)", margin: "12px 0" }} />

          <span style={{ color: "var(--text-secondary)", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>On Tour</span>

          {!bitEnabled ? (
            <div style={{ marginTop: 6 }}>
              <p style={{ color: "var(--text-secondary)", fontSize: "calc(var(--fs-secondary) - 1px)", marginBottom: 2 }}>See upcoming tour dates?</p>
              <p style={{ color: "var(--text-secondary)", opacity: 0.6, fontSize: 10, marginBottom: 8 }}>Optional. Loads concerts via Bandsintown.</p>
              <button
                onClick={enableBandsintown}
                style={{ height: 30, width: "100%", background: "var(--accent)", color: "#111111", fontWeight: 700, fontSize: "calc(var(--fs-secondary) - 1px)", border: "none", borderRadius: 4, cursor: "pointer" }}
              >
                Enable
              </button>
            </div>
          ) : events === null ? (
            <p style={{ color: "var(--text-secondary)", opacity: 0.4, fontSize: "calc(var(--fs-secondary) - 1px)", marginTop: 8 }}>Loading…</p>
          ) : events.length === 0 ? (
            <p style={{ color: "var(--text-secondary)", opacity: 0.4, fontSize: "calc(var(--fs-secondary) - 1px)", marginTop: 8 }}>No upcoming shows</p>
          ) : (
            <>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
                {visibleEvents.map((ev, i) => <TourEventRow key={i} event={ev} />)}
              </div>
              {events.length > TOUR_LIMIT && (
                <button
                  onClick={() => setShowAllTours((v) => !v)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: "calc(var(--fs-secondary) - 1px)", padding: "6px 0" }}
                >
                  {showAllTours ? "Show less" : `Show ${events.length - TOUR_LIMIT} more`}
                </button>
              )}
              <p style={{ color: "var(--text-secondary)", opacity: 0.3, fontSize: 10, marginTop: 6 }}>Tour data via Bandsintown</p>
            </>
          )}
        </>
      )}
    </div>
    <ScrollThumb scrollRef={scrollRef} />
    </div>
  );
}
