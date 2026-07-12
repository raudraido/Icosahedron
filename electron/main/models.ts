export interface Artist {
  id: string;
  name: string;
  album_count: number;
  song_count: number;
  cover_id: string | null;
  starred: boolean;
  play_count: number;
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  artist_id: string | null;
  year: number | null;
  cover_id: string | null;
  song_count: number;
  duration_secs: number;
  starred: boolean;
  genre: string | null;
  release_types: string[] | null;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  artist_id: string | null;
  album: string | null;
  album_id: string | null;
  track_number: number;
  disc_number: number;
  duration_secs: number;
  cover_id: string | null;
  stream_url: string;
  starred: boolean;
  genre: string | null;
  year: number | null;
  play_count: number;
  bitrate: number | null;
  bpm: number | null;
  created: string | null;
  format: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  comment: string | null;
  song_count: number;
  duration_secs: number;
  cover_id: string | null;
  public: boolean;
  owner: string | null;
}

export interface ArtistDetail {
  artist: Artist;
  albums: Album[];
  biography: string | null;
  music_brainz_id: string | null;
  last_fm_url: string | null;
  similar_artists: Artist[];
  image_url: string | null;
}

export interface SearchResult {
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
}

export interface Starred {
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
}

export interface ScanStatus {
  scanning: boolean;
  count: number;
  folder_count: number | null;
  last_scan: string | null;
}

/** Server-side play queue (Subsonic's savePlayQueue/getPlayQueue) — lets the
 *  current queue + position sync across devices/sessions, distinct from the
 *  local-only localStorage session restore in src/store/index.ts. */
export interface PlayQueue {
  tracks: Track[];
  /** -1 if the server reported no `current` track (or it's no longer in `tracks`). */
  currentIndex: number;
  positionSecs: number;
}

/** Extra fields for the "Get Info" dialog — deliberately not part of `Track` since
 *  no list endpoint reliably returns all of these; fetched on demand per-track by
 *  merging Navidrome's native `/api/song/{id}` (has the real filesystem path) with
 *  the standard Subsonic `getSong` (has extra audio fields) — same two-call
 *  approach the old app's TrackInfoDialog used. */
export interface TrackFullInfo {
  path: string | null;
  album_artist: string | null;
  is_compilation: boolean;
  codec: string | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channel_count: number | null;
  size_bytes: number | null;
}

/** One word/syllable's karaoke timing — OpenSubsonic's `enhanced=true`
 *  getLyricsBySongId cueLine/cue data (see subsonic.ts's getServerLyricsById). */
export interface LyricsWordCue {
  text: string;
  startMs: number;
  endMs: number | null;
}
