import { invoke } from "@tauri-apps/api/core";

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

export const api = {
  connect: (url: string, username: string, password: string) =>
    invoke<boolean>("connect", { url, username, password }),

  getArtists: () => invoke<Artist[]>("get_artists"),
  getAllArtists: () => invoke<Artist[]>("get_all_artists"),
  getArtist: (id: string) => invoke<ArtistDetail>("get_artist", { id }),

  getAlbumList: (sortType: string, size: number, offset: number) =>
    invoke<Album[]>("get_album_list", { sortType, size, offset }),
  getAllAlbums: (sortType: string) => invoke<Album[]>("get_all_albums", { sortType }),
  getCompilations: () => invoke<Album[]>("get_compilations"),
  getAlbumTracks: (id: string) => invoke<Track[]>("get_album_tracks", { id }),

  getTracks: (size: number, offset: number) =>
    invoke<Track[]>("get_tracks", { size, offset }),
  getRandomSongs: (count: number) =>
    invoke<Track[]>("get_random_songs", { count }),

  getPlaylists: () => invoke<Playlist[]>("get_playlists"),
  getPlaylistTracks: (id: string) =>
    invoke<Track[]>("get_playlist_tracks", { id }),

  search: (query: string, artistCount = 5, albumCount = 5, songCount = 20) =>
    invoke<SearchResult>("search", { query, artistCount, albumCount, songCount }),

  getStarred: () => invoke<Starred>("get_starred"),
  setFavorite: (itemId: string, active: boolean, idParam: string) =>
    invoke<void>("set_favorite", { itemId, active, idParam }),

  scrobble: (trackId: string, submission: boolean) =>
    invoke<void>("scrobble", { trackId, submission }),

  coverArtUrl: (coverId: string, size?: number) =>
    invoke<string>("cover_art_url", { coverId, size: size ?? null }),
  streamUrl: (songId: string) => invoke<string>("stream_url", { songId }),
};

export function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
