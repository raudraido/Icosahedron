export interface Artist {
  id: string;
  name: string;
  album_count: number;
  cover_id: string | null;
  starred: boolean;
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
}

export interface Playlist {
  id: string;
  name: string;
  comment: string | null;
  song_count: number;
  duration_secs: number;
  cover_id: string | null;
  public: boolean;
}

export interface ArtistDetail {
  artist: Artist;
  albums: Album[];
  biography: string | null;
  music_brainz_id: string | null;
  last_fm_url: string | null;
  similar_artists: Artist[];
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
