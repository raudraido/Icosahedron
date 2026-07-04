import { useEffect, useState } from "react";
import { api, ArtistDetail as ArtistDetailData, Album, Track } from "../lib/api";
import { CoverArt } from "../components/CoverArt";
import { useStore } from "../store";
import { fmtDuration } from "../lib/api";

interface Props {
  artistId: string;
  onBack: () => void;
}

export function ArtistDetail({ artistId, onBack }: Props) {
  const [data, setData] = useState<ArtistDetailData | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const playTrack = useStore((s) => s.playTrack);

  useEffect(() => {
    setData(null);
    setSelectedAlbum(null);
    api.getArtist(artistId).then(setData);
  }, [artistId]);

  function openAlbum(album: Album) {
    setSelectedAlbum(album);
    setTracksLoading(true);
    api.getAlbumTracks(album.id).then((t) => {
      setTracks(t);
      setTracksLoading(false);
    });
  }

  if (!data) {
    return <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--text-primary)", opacity: 0.3 }}>Loading…</div>;
  }

  if (selectedAlbum) {
    return (
      <div className="flex flex-col h-full overflow-y-auto scroll-overlay">
        <div className="flex gap-6 p-6 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <CoverArt coverId={selectedAlbum.cover_id} size={160} className="w-36 h-36 rounded-lg shrink-0" />
          <div className="flex flex-col justify-end gap-1">
            <p className="text-xs tracking-wider uppercase" style={{ color: "var(--text-primary)", opacity: 0.4 }}>Album</p>
            <h1 className="text-2xl font-bold" style={{ color: "var(--accent)" }}>{selectedAlbum.name}</h1>
            <p style={{ color: "var(--text-secondary)" }}>{selectedAlbum.artist}</p>
            <p className="text-sm" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{selectedAlbum.year} · {selectedAlbum.song_count} tracks</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => tracks[0] && playTrack(tracks[0], tracks)}
                className="px-4 py-1.5 rounded-full text-sm font-medium"
                style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: "var(--text-secondary)" }}
              >
                Play
              </button>
              <button
                onClick={() => { setSelectedAlbum(null); setTracks([]); }}
                className="px-4 py-1.5 rounded-full text-sm"
                style={{ background: "var(--hover-bg)", color: "var(--text-primary)" }}
              >
                Back
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scroll-overlay" style={{ borderColor: "var(--border)" }}>
          {tracksLoading && <p className="p-6 text-sm" style={{ color: "var(--text-primary)", opacity: 0.3 }}>Loading…</p>}
          {tracks.map((t, i) => (
            <button
              key={t.id}
              onClick={() => playTrack(t, tracks)}
              className="w-full flex items-center gap-4 px-6 py-3 text-left transition-colors"
              style={{ background: "transparent" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span className="w-6 text-center text-xs tabular-nums" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{t.track_number || i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: "var(--accent)" }}>{t.title}</p>
                {t.artist !== data.artist.name && (
                  <p className="text-xs truncate" style={{ color: "var(--text-secondary)", opacity: 0.7 }}>{t.artist}</p>
                )}
              </div>
              <span className="text-xs tabular-nums shrink-0" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{fmtDuration(t.duration_secs)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const bio = data.biography?.replace(/<[^>]+>/g, ""); // strip HTML tags from Last.fm bio

  return (
    <div className="flex flex-col h-full overflow-y-auto scroll-overlay">
      {/* Artist header */}
      <div className="flex gap-6 p-6 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <CoverArt coverId={data.artist.cover_id} size={160} className="w-36 h-36 rounded-full shrink-0" />
        <div className="flex flex-col justify-end gap-2 min-w-0">
          <p className="text-xs tracking-wider uppercase" style={{ color: "var(--text-primary)", opacity: 0.4 }}>Artist</p>
          <h1 className="text-3xl font-bold truncate" style={{ color: "var(--accent)" }}>{data.artist.name}</h1>
          <p className="text-sm" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{data.artist.album_count} albums</p>
          {bio && (
            <div>
              <p
                className="text-sm leading-relaxed"
                style={{
                  color: "var(--text-secondary)",
                  opacity: 0.7,
                  display: "-webkit-box",
                  WebkitLineClamp: bioExpanded ? "unset" : 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {bio}
              </p>
              {bio.length > 200 && (
                <button
                  onClick={() => setBioExpanded(!bioExpanded)}
                  className="text-xs mt-1"
                  style={{ color: "var(--text-primary)", opacity: 0.4 }}
                >
                  {bioExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}
          <button
            onClick={onBack}
            className="self-start px-4 py-1.5 rounded-full text-sm mt-1"
            style={{ background: "var(--hover-bg)", color: "var(--text-primary)" }}
          >
            Back
          </button>
        </div>
      </div>

      {/* Albums grid */}
      <div className="p-6">
        <p className="text-xs tracking-widest uppercase mb-4" style={{ color: "var(--text-primary)", opacity: 0.4 }}>Albums</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(185px,1fr))] gap-4">
          {data.albums.map((a) => (
            <button key={a.id} onClick={() => openAlbum(a)} className="text-left group grid-card">
              <CoverArt
                coverId={a.cover_id}
                size={200}
                className="w-full aspect-square rounded-lg mb-2 group-hover:brightness-75 transition-all"
              />
              <p className="text-sm font-medium truncate" style={{ color: "var(--accent)" }}>{a.name}</p>
              <p className="text-xs truncate" style={{ color: "var(--text-primary)", opacity: 0.4 }}>{a.year ?? ""}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Similar artists */}
      {data.similar_artists.length > 0 && (
        <div className="px-6 pb-6">
          <p className="text-xs tracking-widest uppercase mb-4" style={{ color: "var(--text-primary)", opacity: 0.4 }}>Similar Artists</p>
          <div className="flex gap-4 flex-wrap">
            {data.similar_artists.slice(0, 8).map((a) => (
              <div key={a.id} className="text-center w-24">
                <CoverArt coverId={a.cover_id} size={96} className="w-20 h-20 rounded-full mx-auto mb-1.5" />
                <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{a.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
