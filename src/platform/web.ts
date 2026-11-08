// Browser/PWA host. Replaces what Electron's main process does: the Subsonic
// client runs here (talking to Navidrome through the web engine's same-origin
// proxy), audio is an <audio> element, profiles live in localStorage. Features
// that need a native host (cast, EQ, BPM, Last.fm, update) answer with inert
// defaults so the shared UI still works.
import { SubsonicClient } from "../lib/subsonic/client";
import type { AudioEventPayload } from "../lib/api";
import type { Platform, Unsubscribe } from "./index";

const LS_SERVERS = "ico.servers";
const LS_LYRICS = "ico.lyrics.";

interface StoredProfile {
  id: string; name: string; url: string; username: string; password: string;
  musicFolderIds: string[]; musicFolderNames: string[];
}
interface StoredData { servers: StoredProfile[]; active: string | null }

function readData(): StoredData {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SERVERS) ?? "null");
    if (raw && Array.isArray(raw.servers)) return { servers: raw.servers, active: raw.active ?? null };
  } catch { /* fall through */ }
  return { servers: [], active: null };
}
function writeData(d: StoredData) { localStorage.setItem(LS_SERVERS, JSON.stringify(d)); }
const publicProfile = ({ password: _p, ...rest }: StoredProfile) => rest;

// The web engine proxies Navidrome on its own origin, so every profile talks
// to location.origin regardless of what URL was typed into the form.
const ORIGIN = () => location.origin;

// ── Audio: one active <audio> plus one preloaded for gapless-ish chaining ──
class WebAudio {
  private cur: HTMLAudioElement | null = null;
  private chain: HTMLAudioElement | null = null;
  private volume = 1;
  private ticker: number | null = null;
  constructor(private emit: (p: AudioEventPayload) => void) {}

  private mk(url: string): HTMLAudioElement {
    const el = new Audio();
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    el.src = url;
    el.volume = this.volume;
    return el;
  }

  private attach(el: HTMLAudioElement) {
    el.onended = () => {
      if (this.chain) {
        const next = this.chain;
        this.chain = null;
        this.cur = next;
        this.attach(next);
        next.play().catch(() => {});
        this.emit({ kind: "track_switched", duration: next.duration || 0 });
      } else {
        this.emit({ kind: "ended" });
      }
    };
    el.onerror = () => this.emit({ kind: "error", message: el.error?.message || "audio error" });
  }

  private startTicker() {
    if (this.ticker != null) return;
    this.ticker = window.setInterval(() => {
      const el = this.cur;
      if (!el) return;
      this.emit({
        kind: "progress", currentTime: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : 0,
        buffering: el.readyState < 3 && !el.paused,
      });
    }, 250);
  }

  private teardown(el: HTMLAudioElement | null) {
    if (!el) return;
    el.onended = null; el.onerror = null; el.pause(); el.removeAttribute("src"); el.load();
  }

  async play(url: string, volume: number, durationHint: number, _manual: boolean, startPaused: boolean) {
    this.teardown(this.cur); this.teardown(this.chain); this.chain = null;
    this.volume = volume;
    const el = (this.cur = this.mk(url));
    this.attach(el);
    this.startTicker();
    this.emit({ kind: "playing", duration: durationHint });
    if (!startPaused) await el.play();
  }
  chainPreload(url: string) { this.teardown(this.chain); this.chain = this.mk(url); }
  pause() { this.cur?.pause(); }
  resume() { this.cur?.play().catch(() => {}); }
  stop() {
    this.teardown(this.cur); this.teardown(this.chain); this.cur = this.chain = null;
    if (this.ticker != null) { clearInterval(this.ticker); this.ticker = null; }
  }
  seek(s: number) { if (this.cur) this.cur.currentTime = s; }
  setVolume(v: number) { this.volume = v; if (this.cur) this.cur.volume = v; if (this.chain) this.chain.volume = v; }
}

export function createWebPlatform(): Platform {
  let client: SubsonicClient | null = null;
  const audioListeners = new Set<(p: AudioEventPayload) => void>();
  const audio = new WebAudio((p) => audioListeners.forEach((cb) => cb(p)));

  const need = (): SubsonicClient => {
    if (!client) throw new Error("not connected");
    return client;
  };
  const mkClient = (p: { username: string; password: string; musicFolderIds?: string[] }) =>
    new SubsonicClient(ORIGIN(), p.username, p.password, p.musicFolderIds ?? []);

  const inert = (value: unknown) => () => value;
  const unsupported = (cmd: string) => () => Promise.reject(new Error(`"${cmd}" is not available in the web app`));

  type Handler = (a: any) => any;
  const H: Record<string, Handler> = {
    // connection & profiles
    connect: async (a) => { const c = mkClient(a); await c.ping(); client = c; return true; },
    ping: () => need().ping(),
    test_connection: async (a) => { try { await mkClient(a).ping(); return true; } catch { return false; } },
    list_servers: () => readData().servers.map(publicProfile),
    get_active_server: () => readData().active,
    save_server: (a) => {
      const d = readData();
      const existing = a.id ? d.servers.find((s) => s.id === a.id) : undefined;
      const p: StoredProfile = {
        id: existing?.id ?? crypto.randomUUID(), name: a.name || location.host, url: ORIGIN(),
        username: a.username, password: a.password || existing?.password || "",
        musicFolderIds: existing?.musicFolderIds ?? [], musicFolderNames: existing?.musicFolderNames ?? [],
      };
      d.servers = existing ? d.servers.map((s) => (s.id === p.id ? p : s)) : [...d.servers, p];
      if (!d.active) d.active = p.id;
      writeData(d);
      return publicProfile(p);
    },
    delete_server: ({ id }) => { const d = readData(); d.servers = d.servers.filter((s) => s.id !== id); if (d.active === id) d.active = null; writeData(d); },
    set_active_server: ({ id }) => { const d = readData(); d.active = id; writeData(d); },
    set_server_library: ({ id, folderIds, folderNames }) => {
      const d = readData();
      const s = d.servers.find((x) => x.id === id);
      if (s) { s.musicFolderIds = folderIds; s.musicFolderNames = folderNames; writeData(d); }
      if (d.active === id && client) client.setMusicFolders(folderIds);
    },
    connect_server: async ({ id }) => {
      const s = readData().servers.find((x) => x.id === id);
      if (!s) return null;
      try {
        const c = mkClient(s); await c.ping(); client = c;
        const d = readData(); d.active = id; writeData(d);
        return { url: s.url, username: s.username };
      } catch { return null; }
    },
    test_server: async ({ id }) => {
      const s = readData().servers.find((x) => x.id === id);
      if (!s) return false;
      try { await mkClient(s).ping(); return true; } catch { return false; }
    },
    try_auto_connect: async () => {
      const d = readData();
      const s = d.servers.find((x) => x.id === d.active);
      if (!s) return null;
      try { const c = mkClient(s); await c.ping(); client = c; return { url: s.url, username: s.username }; } catch { return null; }
    },

    // library
    get_music_folders: () => need().getMusicFolders(),
    get_artists: () => need().getArtists(),
    get_all_artists: () => need().getAllArtists(),
    get_all_artists_sorted: ({ sortType }) => need().getAllArtistsSorted(sortType),
    get_artist: ({ id }) => need().getArtist(id),
    get_album_list: ({ sortType, size, offset }) => need().getAlbumList(sortType, size, offset),
    get_all_albums: ({ sortType }) => need().getAllAlbums(sortType),
    get_album_tracks: ({ id }) => need().getAlbumTracks(id),
    get_album: ({ id }) => need().getAlbum(id),
    get_compilations: () => need().getCompilations(),
    get_random_songs: ({ count }) => need().getRandomSongs(count),
    get_tracks: ({ size, offset }) => need().getTracks(size, offset),
    get_tracks_native_page: (a) => need().getTracksNativePage(a.sortBy, a.order, a.start, a.end, a.query, a.filters),
    get_artist_id_map: (a) => need().getArtistIdMap(a),
    get_album_id_map: (a) => need().getAlbumIdMap(a),
    get_genre_id_map: (a) => need().getGenreIdMap(a),
    start_scan: () => need().startScan(),
    get_scan_status: () => need().getScanStatus(),
    get_track_info: ({ id }) => need().getTrackInfo(id),
    get_playlists: () => need().getPlaylists(),
    get_playlist_tracks: ({ id }) => need().getPlaylistTracks(id),
    create_playlist: ({ name, isPublic }) => need().createPlaylist(name, isPublic ?? false),
    add_tracks_to_playlist: ({ playlistId, trackIds }) => need().addTracksToPlaylist(playlistId, trackIds),
    rename_playlist: ({ playlistId, name }) => need().renamePlaylist(playlistId, name),
    set_playlist_public: ({ playlistId, isPublic }) => need().setPlaylistPublic(playlistId, isPublic),
    delete_playlist: ({ playlistId }) => need().deletePlaylist(playlistId),
    remove_track_from_playlist: ({ playlistId, songIndex }) => need().removeTrackFromPlaylist(playlistId, songIndex),
    reorder_playlist_tracks: (a) => need().reorderPlaylistTracks(a.playlistId, a.currentLength, a.newTrackIds),
    get_similar_songs: ({ artistId, count }) => need().getSimilarSongs(artistId, count),
    get_top_songs: ({ artistName, count }) => need().getTopSongs(artistName, count),
    search: (a) => need().search3(a.query, a.artistCount, a.albumCount, a.songCount),
    get_starred: () => need().getStarred(),
    set_favorite: ({ itemId, active, idParam }) => need().setFavorite(itemId, active, idParam),
    create_share: (a) => need().createShare(a.itemId, a.resourceType, a.expiresDays, a.downloadable),
    scrobble: ({ trackId, submission }) => need().scrobble(trackId, submission),
    get_play_queue: () => need().getPlayQueue(),
    save_play_queue: (a) => need().savePlayQueue(a.trackIds, a.currentTrackId, a.positionSecs),
    cover_art_url: ({ coverId, size }) => need().coverArtUrl(coverId, size ?? undefined),
    stream_url: ({ songId }) => need().streamUrl(songId),

    // lyrics: server-side ones work, local cache in localStorage, the rest is desktop-only for now
    lyrics_server: ({ artist, title }) => need().getServerLyrics(artist, title),
    lyrics_server_by_id: ({ songId }) => need().getServerLyricsById(songId),
    lyrics_direct: inert(null),
    lyrics_search: inert([]),
    lyrics_fetch: inert(null),
    lyrics_local_load: ({ key }) => localStorage.getItem(LS_LYRICS + key),
    lyrics_local_save: ({ key, raw }) => localStorage.setItem(LS_LYRICS + key, raw),
    lyrics_local_remove: ({ key }) => localStorage.removeItem(LS_LYRICS + key),
    bandsintown_events: inert([]),

    // audio
    audio_play: (a) => audio.play(a.url, a.volume, a.durationHint, a.manual, a.startPaused),
    audio_chain_preload: ({ url }) => audio.chainPreload(url),
    audio_pause: () => audio.pause(),
    audio_resume: () => audio.resume(),
    audio_resume_at_cast_start: () => audio.resume(),
    audio_stop: () => audio.stop(),
    audio_seek: ({ seconds }) => audio.seek(seconds),
    audio_set_volume: ({ volume }) => audio.setVolume(volume),
    audio_set_eq: inert(undefined),
    get_bpm: unsupported("get_bpm"),
    set_bpm_override: inert(undefined),
    get_bpm_cache_all: inert({}),

    // casting / Last.fm / app shell — desktop-only
    cast_discover: inert([]), cast_rescan: inert([]), cast_disconnect: inert(undefined), cast_stop: inert(undefined),
    cast_pause: inert(undefined), cast_resume: inert(undefined), cast_seek: inert(undefined), cast_set_volume: inert(undefined),
    cast_connect: unsupported("cast_connect"), cast_play_track: unsupported("cast_play_track"),
    cast_calibration_start: unsupported("cast_calibration_start"), cast_calibration_stop: inert(undefined),
    lastfm_connect_start: unsupported("lastfm_connect_start"), lastfm_connect_poll: unsupported("lastfm_connect_poll"),
    lastfm_get_connection: inert(null), lastfm_public_api_key: inert(""), lastfm_disconnect: inert(undefined),
    lastfm_set_history_enabled: inert(undefined), lastfm_set_scrobble_enabled: inert(undefined),
    lastfm_now_playing: inert(undefined), lastfm_scrobble: inert(undefined),
    app_version: inert("web"), check_for_update: inert(null), download_and_install_update: unsupported("update"),
    capture_screens: inert([]), set_window_theme: inert(undefined), quit_app: inert(undefined),
    get_tray_settings: inert({ minimizeToTray: false, exitToTray: false }), set_tray_settings: inert(undefined),
  };

  const sub = <T,>(set: Set<(p: T) => void>) => (cb: (p: T) => void): Unsubscribe => {
    set.add(cb);
    return () => set.delete(cb);
  };
  const noop = (): Unsubscribe => () => {};

  return {
    kind: "web",
    invoke: async (cmd, args) => {
      const h = H[cmd];
      if (!h) throw new Error(`Unknown command "${cmd}"`);
      return h(args ?? {});
    },
    coverUrl: (coverId, size = 200) => (client && coverId ? client.coverArtUrl(coverId, size) : ""),
    isWaylandLinux: false,
    onAudioEvent: sub(audioListeners),
    onUpdateDownloadProgress: noop,
    onUpdateInstallerLaunching: noop,
    onCastDevices: noop,
    onCastStatus: noop,
    onCastScanning: noop,
  };
}
