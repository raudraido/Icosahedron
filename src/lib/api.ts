function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return window.electronAPI.invoke(cmd, args);
}

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
  /** MusicBrainz-style release type tags (e.g. ["album"], ["single"], ["ep"],
   *  ["compilation"]) — used by the artist detail page to split "Albums"
   *  from "Singles & EPs", matching the old app's releaseTypes/albumType
   *  substring check. */
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

export interface LastFmTrackMeta {
  title: string;
  artist: string;
  album: string;
  duration: number;
}

export interface ScanStatus {
  scanning: boolean;
  count: number;
  folder_count: number | null;
  last_scan: string | null;
}

/** Extra "Get Info" dialog fields — see electron/main/models.ts for why these
 *  aren't just part of Track (no list endpoint reliably returns all of them). */
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

/** Server-side play queue (Subsonic's savePlayQueue/getPlayQueue) — lets the
 *  queue + position sync across devices/sessions, distinct from the
 *  local-only localStorage session restore in src/store/index.ts. */
export interface PlayQueue {
  tracks: Track[];
  /** -1 if the server reported no `current` track (or it's no longer in `tracks`). */
  currentIndex: number;
  positionSecs: number;
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

/** Server-side params for the Tracks tab's Excel-style column filters
 *  (see ColumnFilterPopup.tsx / TrackTable.tsx's filterableCols). */
export interface TrackFilters {
  artistIds?: string[];
  albumIds?: string[];
  genreIds?: string[];
  year?: string;
}

export interface LyricsSearchResult {
  id: string;
  title: string;
  artist: string;
  source: "LRCLib" | "NetEase" | "SimpMusic";
  synced: boolean | null;
}

export interface TourEvent {
  datetime: string;
  url: string;
  venue: { name: string; city: string; region: string; country: string };
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

export interface UpdateInfo {
  version: string;
  downloadUrl: string;
  releaseUrl: string;
}

/** Pushed from electron/main/updater.ts's downloadAndInstallUpdate via the
 *  `onUpdateDownloadProgress` preload channel, while UpdateBanner.tsx's own
 *  `downloadAndInstallUpdate()` invoke call is still in flight. */
export interface UpdateDownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

/** A discovered Chromecast/DLNA receiver (electron/main/castDiscovery.ts) —
 *  `id` is opaque to the renderer, only used to pass back to `castConnect`. */
export interface CastDevice {
  id: string;
  name: string;
  protocol: "chromecast" | "dlna";
  /** False when a real TCP connectivity probe to the device failed —
   *  CastPicker.tsx greys these out and disables connecting to them. */
  reachable: boolean;
}

/** Pushed from electron/main/castManager.ts via the `onCastStatus` preload
 *  channel — see src/store/index.ts's `handleCastEvent` for how each kind
 *  is handled. Mirrors castManager.ts's own `CastPush` union exactly. */
export type CastPush =
  | { kind: "connected"; device: CastDevice }
  | { kind: "status"; playing: boolean; currentTime: number; duration: number; volume: number }
  | { kind: "ended" }
  | { kind: "disconnected" }
  | { kind: "error"; message: string };

/** Pushed from the native gapless audio engine (electron/main/audioEngine.ts)
 *  via the `onAudioEvent` preload channel — see src/store/index.ts's
 *  `handleAudioEvent` for how each kind is handled. */
export interface AudioEventPayload {
  kind: "progress" | "playing" | "track_switched" | "ended" | "error";
  currentTime?: number;
  duration?: number;
  buffering?: boolean;
  message?: string;
}

export interface ServerProfile {
  id: string;
  name: string;
  url: string;
  username: string;
}

export const api = {
  connect: (url: string, username: string, password: string) =>
    invoke<boolean>("connect", { url, username, password }),
  // Validates credentials without swapping the live connection — used to
  // test a brand-new server before it's saved (Settings > Servers).
  testConnection: (url: string, username: string, password: string) =>
    invoke<boolean>("test_connection", { url, username, password }),

  // ── Multi-server profiles — password is OS-keystore-encrypted in the main
  // process (Electron safeStorage: libsecret/DPAPI/Keychain) and never
  // travels back over IPC; connectServer/tryAutoConnectSaved only ever
  // return whether the (re)connect succeeded and who/where it connected
  // to. ──
  listServers: () => invoke<ServerProfile[]>("list_servers"),
  getActiveServerId: () => invoke<string | null>("get_active_server"),
  saveServer: (profile: { id?: string; name: string; url: string; username: string; password: string }) =>
    invoke<ServerProfile>("save_server", profile),
  deleteServer: (id: string) => invoke<void>("delete_server", { id }),
  setActiveServer: (id: string | null) => invoke<void>("set_active_server", { id }),
  connectServer: (id: string) => invoke<{ url: string; username: string } | null>("connect_server", { id }),
  testServer: (id: string) => invoke<boolean>("test_server", { id }),
  tryAutoConnectSaved: () => invoke<{ url: string; username: string } | null>("try_auto_connect"),

  getArtists: () => invoke<Artist[]>("get_artists"),
  getAllArtists: () => invoke<Artist[]>("get_all_artists"),
  getAllArtistsSorted: (sortType: string) => invoke<Artist[]>("get_all_artists_sorted", { sortType }),
  getArtist: (id: string) => invoke<ArtistDetail>("get_artist", { id }),

  getAlbumList: (sortType: string, size: number, offset: number) =>
    invoke<Album[]>("get_album_list", { sortType, size, offset }),
  getAllAlbums: (sortType: string) => invoke<Album[]>("get_all_albums", { sortType }),
  getCompilations: () => invoke<Album[]>("get_compilations"),
  getAlbumTracks: (id: string) => invoke<Track[]>("get_album_tracks", { id }),
  getAlbum: (id: string) => invoke<Album>("get_album", { id }),

  getTracks: (size: number, offset: number) =>
    invoke<Track[]>("get_tracks", { size, offset }),
  getTracksNativePage: (
    sortBy: string, order: "ASC" | "DESC", start: number, end: number, query?: string,
    filters?: TrackFilters,
  ) =>
    invoke<{ tracks: Track[]; total: number }>("get_tracks_native_page", { sortBy, order, start, end, query, filters }),

  // ── Tracks tab's Excel-style column filters (Artist/Album/Genre/Year) ──
  getArtistIdMap: () => invoke<Record<string, string>>("get_artist_id_map"),
  getAlbumIdMap: () => invoke<Record<string, string>>("get_album_id_map"),
  getGenreIdMap: () => invoke<Record<string, string>>("get_genre_id_map"),

  startScan: () => invoke<void>("start_scan"),
  getScanStatus: () => invoke<ScanStatus>("get_scan_status"),
  getTrackInfo: (id: string) => invoke<TrackFullInfo>("get_track_info", { id }),
  getRandomSongs: (count: number) =>
    invoke<Track[]>("get_random_songs", { count }),

  getPlaylists: () => invoke<Playlist[]>("get_playlists"),
  getPlaylistTracks: (id: string) =>
    invoke<Track[]>("get_playlist_tracks", { id }),
  createPlaylist: (name: string, isPublic = false) => invoke<Playlist>("create_playlist", { name, isPublic }),
  addTracksToPlaylist: (playlistId: string, trackIds: string[]) =>
    invoke<void>("add_tracks_to_playlist", { playlistId, trackIds }),
  renamePlaylist: (playlistId: string, name: string) => invoke<void>("rename_playlist", { playlistId, name }),
  setPlaylistPublic: (playlistId: string, isPublic: boolean) => invoke<void>("set_playlist_public", { playlistId, isPublic }),
  deletePlaylist: (playlistId: string) => invoke<void>("delete_playlist", { playlistId }),
  removeTrackFromPlaylist: (playlistId: string, songIndex: number) =>
    invoke<void>("remove_track_from_playlist", { playlistId, songIndex }),
  reorderPlaylistTracks: (playlistId: string, currentLength: number, newTrackIds: string[]) =>
    invoke<void>("reorder_playlist_tracks", { playlistId, currentLength, newTrackIds }),

  getSimilarSongs: (artistId: string, count = 50) =>
    invoke<Track[]>("get_similar_songs", { artistId, count }),
  getTopSongs: (artistName: string, count = 10) =>
    invoke<Track[]>("get_top_songs", { artistName, count }),

  search: (query: string, artistCount = 5, albumCount = 5, songCount = 20) =>
    invoke<SearchResult>("search", { query, artistCount, albumCount, songCount }),

  getStarred: () => invoke<Starred>("get_starred"),
  setFavorite: (itemId: string, active: boolean, idParam: string) =>
    invoke<void>("set_favorite", { itemId, active, idParam }),

  scrobble: (trackId: string, submission: boolean) =>
    invoke<void>("scrobble", { trackId, submission }),

  getPlayQueue: () => invoke<PlayQueue | null>("get_play_queue"),
  savePlayQueue: (trackIds: string[], currentTrackId: string | null, positionSecs: number) =>
    invoke<void>("save_play_queue", { trackIds, currentTrackId, positionSecs }),

  // Client-side Last.fm scrobbling (independent of the Navidrome-relayed
  // `scrobble` above) — see electron/main/lastfm.ts. The session key never
  // reaches the renderer; these calls only ever carry track metadata. Scoped
  // per Navidrome server profile — `serverId` is the active profile's id, or
  // lastfmDefaultServerKey() when there's no saved profile (see store).
  lastfmConnectStart: () => invoke<{ token: string }>("lastfm_connect_start"),
  lastfmConnectPoll: (token: string, serverId: string) =>
    invoke<{ connected: boolean; username?: string }>("lastfm_connect_poll", { token, serverId }),
  lastfmGetConnection: (serverId: string) =>
    invoke<{ username: string; historyEnabled: boolean; scrobbleEnabled: boolean } | null>("lastfm_get_connection", { serverId }),
  lastfmDisconnect: (serverId: string) => invoke<void>("lastfm_disconnect", { serverId }),
  lastfmSetHistoryEnabled: (serverId: string, value: boolean) =>
    invoke<void>("lastfm_set_history_enabled", { serverId, value }),
  lastfmSetScrobbleEnabled: (serverId: string, value: boolean) =>
    invoke<void>("lastfm_set_scrobble_enabled", { serverId, value }),
  // Not a secret (sent in the clear on every Last.fm request) — safe to hand
  // to the renderer for the unauthenticated user.getrecenttracks call.
  lastfmPublicApiKey: () => invoke<string>("lastfm_public_api_key"),
  lastfmNowPlaying: (track: LastFmTrackMeta, serverId: string) => invoke<void>("lastfm_now_playing", { track, serverId }),
  lastfmScrobble: (track: LastFmTrackMeta, timestamp: number, serverId: string) =>
    invoke<void>("lastfm_scrobble", { track, timestamp, serverId }),

  coverArtUrl: (coverId: string, size?: number) =>
    invoke<string>("cover_art_url", { coverId, size: size ?? null }),
  streamUrl: (songId: string) => invoke<string>("stream_url", { songId }),

  // ── Lyrics (queue panel's Lyrics tab) ──────────────────────────────────
  lyricsServer: (artist: string, title: string) => invoke<string | null>("lyrics_server", { artist, title }),
  lyricsDirect: (artist: string, title: string, album: string, duration: number) =>
    invoke<string | null>("lyrics_direct", { artist, title, album, duration }),
  lyricsSearch: (artist: string, title: string, sources: string[]) =>
    invoke<LyricsSearchResult[]>("lyrics_search", { artist, title, sources }),
  lyricsFetch: (source: string, id: string) => invoke<string | null>("lyrics_fetch", { source, id }),
  lyricsLocalLoad: (key: string) => invoke<string | null>("lyrics_local_load", { key }),
  lyricsLocalSave: (key: string, raw: string) => invoke<void>("lyrics_local_save", { key, raw }),
  lyricsLocalRemove: (key: string) => invoke<void>("lyrics_local_remove", { key }),

  // ── Artist info tab: Bandsintown tour dates ────────────────────────────
  bandsintownEvents: (artistName: string) => invoke<TourEvent[]>("bandsintown_events", { artistName }),

  getAppVersion: () => invoke<string>("app_version"),
  setWindowTheme: (dark: boolean) => invoke<void>("set_window_theme", { dark }),

  // ── Update check (electron/main/updater.ts) — lightweight GitHub Releases
  // poll, not a full electron-updater integration (see that file's header
  // comment for why). ──────────────────────────────────────────────────────
  checkForUpdate: () => invoke<UpdateInfo | null>("check_for_update"),
  downloadAndInstallUpdate: (downloadUrl: string) => invoke<void>("download_and_install_update", { downloadUrl }),

  // ── Native gapless audio engine (electron/main/audioEngine.ts) ──────────
  // `volume` here is 0-1 (the store keeps its own volume as a 0-100 int for
  // the UI/localStorage and divides by 100 at these call sites).
  audioPlay: (url: string, volume: number, durationHint: number, manual = true, startPaused = false) =>
    invoke<void>("audio_play", { url, volume, durationHint, manual, startPaused }),
  audioChainPreload: (url: string, durationHint: number) =>
    invoke<void>("audio_chain_preload", { url, durationHint }),
  audioPause: () => invoke<void>("audio_pause"),
  audioResume: () => invoke<void>("audio_resume"),
  audioStop: () => invoke<void>("audio_stop"),
  audioSeek: (seconds: number) => invoke<void>("audio_seek", { seconds }),
  audioSetVolume: (volume: number) => invoke<void>("audio_set_volume", { volume }),

  // ── Casting (electron/main/castManager.ts) — Chromecast/DLNA, "send a URL,
  // the receiver plays it" model, not an audio relay through this app. ──────
  castDiscover: () => invoke<CastDevice[]>("cast_discover"),
  /** Explicit user-triggered rescan (a refresh button in CastPicker.tsx) —
   *  unlike castDiscover(), which now just returns the cache, this is the
   *  only thing that actually sends a network scan burst. */
  castRescan: () => invoke<void>("cast_rescan"),
  castConnect: (deviceId: string) => invoke<void>("cast_connect", { deviceId }),
  castDisconnect: () => invoke<void>("cast_disconnect"),
  castPlayTrack: (input: {
    trackId: string; title: string; artist: string; coverId: string | null; format: string | null; positionSecs: number;
  }) => invoke<void>("cast_play_track", input),
  castPause: () => invoke<void>("cast_pause"),
  castResume: () => invoke<void>("cast_resume"),
  castStop: () => invoke<void>("cast_stop"),
  castSeek: (seconds: number) => invoke<void>("cast_seek", { seconds }),
  castSetVolume: (volume: number) => invoke<void>("cast_set_volume", { volume }),

  // ── BPM detection (footer bar) — cache-first; get_bpm runs the native
  // QM-DSP analyzer on a cache miss (can take a few seconds), so callers
  // should treat this as a slow call, not fire-and-forget it per track. ────
  getBpm: (trackId: string, streamUrl: string) => invoke<number>("get_bpm", { trackId, streamUrl }),
  setBpmOverride: (trackId: string, bpm: number) => invoke<void>("set_bpm_override", { trackId, bpm }),
  getBpmCacheAll: () => invoke<Record<string, number>>("get_bpm_cache_all"),

  // ── Settings > System > Application ─────────────────────────────────────
  getTraySettings: () => invoke<TraySettings>("get_tray_settings"),
  setTraySettings: (settings: Partial<TraySettings>) => invoke<void>("set_tray_settings", settings),
  quitApp: () => invoke<void>("quit_app"),
};

export interface TraySettings {
  minimizeToTray: boolean;
  exitToTray: boolean;
}

export function fmtDuration(secs: number): string {
  const total = Math.floor(secs);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
