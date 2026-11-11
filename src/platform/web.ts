// Browser/PWA host. Replaces what Electron's main process does: the Subsonic
// client runs here (talking to Navidrome through the web engine's same-origin
// proxy), audio is an <audio> element, profiles live in localStorage. Features
// that need a native host (cast, EQ, BPM, Last.fm, update) answer with inert
// defaults so the shared UI still works.
import { SubsonicClient } from "../lib/subsonic/client";
import type { AudioEventPayload } from "../lib/api";
import type { Platform, Unsubscribe } from "./index";
import { createEngine } from "./engineApi";
import { useAudioBlocked } from "../lib/audioBlocked";

// Defined by vite.web.config.ts from package.json.
declare const __APP_VERSION__: string | undefined;

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

// ── Audio: ONE persistent <audio> element, in the DOM ───────────────────────
// iOS/Safari ties lock-screen info, background playback and the autoplay
// unlock to a single media element: once a user gesture has started it, it may
// keep going to the next track in the background and own the Now Playing card.
// A fresh element per track loses all of that, so the element is reused and
// tracks change by swapping `src`. (The cost is a short gap between tracks —
// no gapless in the browser.)
class WebAudio {
  private el: HTMLAudioElement;
  private chainUrl: string | null = null;
  private ticker: number | null = null;
  private announceSwitch = false;

  // ── Equalizer (same bands as the desktop engine: ISO octaves, Q 1.1, RBJ peaking) ──
  // The audio element is only routed through WebAudio once the EQ is actually switched on, so the
  // default playback path stays the plain element. iOS Safari is left alone: WebAudio output stops
  // when the page goes to the background there.
  private static readonly EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  private ctx: AudioContext | null = null;
  private eqSrc: MediaElementAudioSourceNode | null = null;
  private eqPre: GainNode | null = null;
  private eqBands: BiquadFilterNode[] = [];
  private eqRouted: boolean | null = null;

  constructor(private emit: (p: AudioEventPayload) => void) {
    const el = (this.el = document.createElement("audio"));
    el.preload = "auto";
    el.setAttribute("playsinline", "");
    el.style.display = "none";
    el.onended = () => {
      if (this.chainUrl) {
        const next = this.chainUrl;
        this.chainUrl = null;
        this.announceSwitch = true;
        el.src = next;
        el.play().catch(() => this.emit({ kind: "error", message: "next track could not start" }));
      } else {
        this.emit({ kind: "ended" });
      }
    };
    // Duration is only known once the new source's metadata arrives.
    el.onloadedmetadata = () => {
      if (this.announceSwitch) {
        this.announceSwitch = false;
        this.emit({ kind: "track_switched", duration: Number.isFinite(el.duration) ? el.duration : 0 });
      }
    };
    el.onerror = () => { if (el.getAttribute("src")) this.emit({ kind: "error", message: el.error?.message || "audio error" }); };
    document.body.appendChild(el);
  }

  setEq(enabled: boolean, preampDb: number, bandsDb: number[]) {
    if (/iP(hone|ad|od)/.test(navigator.userAgent)) return;
    if (!enabled && !this.ctx) return; // never touch the audio path unless the EQ is used
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx) {
      const ctx = (this.ctx = new Ctx());
      this.eqSrc = ctx.createMediaElementSource(this.el);
      this.eqPre = ctx.createGain();
      let prev: AudioNode = this.eqPre;
      this.eqBands = WebAudio.EQ_FREQS.map((f) => {
        const b = ctx.createBiquadFilter();
        b.type = "peaking";
        b.frequency.value = f;
        b.Q.value = 1.1;
        prev.connect(b);
        prev = b;
        return b;
      });
      prev.connect(ctx.destination);
    }
    const ctx = this.ctx;
    if (this.eqRouted !== enabled) {
      this.eqSrc!.disconnect();
      this.eqSrc!.connect(enabled ? this.eqPre! : ctx.destination);
      this.eqRouted = enabled;
    }
    this.eqPre!.gain.value = Math.pow(10, preampDb / 20);
    this.eqBands.forEach((b, i) => {
      const f = WebAudio.EQ_FREQS[i];
      // bands the sample rate cannot realise stay flat, like the desktop engine
      b.gain.value = f < ctx.sampleRate * 0.45 ? (bandsDb[i] ?? 0) : 0;
    });
    void ctx.resume();
  }

  private startTicker() {
    if (this.ticker != null) return;
    this.ticker = window.setInterval(() => {
      const el = this.el;
      if (!el.getAttribute("src")) return;
      this.emit({
        kind: "progress", currentTime: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : 0,
        buffering: el.readyState < 3 && !el.paused,
      });
    }, 250);
  }

  async play(url: string, volume: number, durationHint: number, _manual: boolean, startPaused: boolean) {
    const el = this.el;
    this.chainUrl = null;
    this.announceSwitch = false;
    el.src = url;
    el.volume = volume;
    this.startTicker();
    this.emit({ kind: "playing", duration: durationHint });
    void this.ctx?.resume();
    if (!startPaused) await this.start();
  }

  /** Starts the element. The browser refuses without a user gesture on this page (NotAllowedError):
   *  report it, so the player does not claim to be playing and the UI can ask for a click. */
  private async start() {
    try {
      await this.el.play();
      useAudioBlocked.setState({ blocked: false });
    } catch (e) {
      if ((e as Error)?.name !== "NotAllowedError") throw e;
      useAudioBlocked.setState({ blocked: true });
      this.emit({ kind: "error", message: "playback blocked by the browser: click the page once" });
    }
  }
  chainPreload(url: string) { this.chainUrl = url; }
  pause() { this.el.pause(); }
  resume() { void this.start().catch(() => {}); }
  stop() {
    this.chainUrl = null;
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
    if (this.ticker != null) { clearInterval(this.ticker); this.ticker = null; }
  }
  seek(s: number) { this.el.currentTime = s; }
  setVolume(v: number) { this.el.volume = v; }
}

export function createWebPlatform(): Platform {
  let client: SubsonicClient | null = null;
  const audioListeners = new Set<(p: AudioEventPayload) => void>();
  let audioEngine: WebAudio | null = null;
  const audio = new Proxy({} as WebAudio, {
    get: (_t, k) => {
      audioEngine ??= new WebAudio((p) => audioListeners.forEach((cb) => cb(p)));
      const v = (audioEngine as any)[k];
      return typeof v === "function" ? v.bind(audioEngine) : v;
    },
  });

  // The store asks for Last.fm state at startup, before auto-connect has finished
  // (the desktop main process is ready instantly, the browser client is not) —
  // those calls wait for the connection instead of failing and leaving the UI
  // thinking Last.fm is disconnected.
  const waiters: Array<(c: SubsonicClient) => void> = [];
  const setClient = (c: SubsonicClient) => { client = c; waiters.splice(0).forEach((w) => w(c)); };
  const whenConnected = (): Promise<SubsonicClient> =>
    client ? Promise.resolve(client) : new Promise((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error("not connected")), 20000);
      waiters.push((c) => { clearTimeout(t); resolve(c); });
    });

  const need = (): SubsonicClient => {
    if (!client) throw new Error("not connected");
    return client;
  };
  const mkClient = (p: { username: string; password: string; musicFolderIds?: string[] }) =>
    new SubsonicClient(ORIGIN(), p.username, p.password, p.musicFolderIds ?? []);

  const engine = createEngine(async () => (await whenConnected()).syncAuth());
  const lf = async (method: string, path: string, body?: unknown) => {
    const r = await engine(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r) throw new Error("sync server unavailable");
    if (!r.ok) throw new Error(`Last.fm: ${r.status === 503 ? "not configured on this server" : "HTTP " + r.status}`);
    return r.status === 204 ? undefined : r.json();
  };

  const inert = (value: unknown) => () => value;
  const unsupported = (cmd: string) => () => Promise.reject(new Error(`"${cmd}" is not available in the web app`));

  type Handler = (a: any) => any;
  const H: Record<string, Handler> = {
    // connection & profiles
    connect: async (a) => { const c = mkClient(a); await c.ping(); setClient(c); return true; },
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
      void navigator.storage?.persist?.(); // ask the browser not to evict the saved login under storage pressure
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
        const c = mkClient(s); await c.ping(); setClient(c);
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
      try { const c = mkClient(s); await c.ping(); setClient(c); return { url: s.url, username: s.username }; } catch { return null; }
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
    users_is_admin: () => need().isAdmin(),
    users_list: () => need().listUsers(),
    users_create: (a) => need().createUser(a.u),
    users_update: (a) => need().updateUser(a.id, a.patch, a.current),
    users_delete: (a) => need().deleteUser(a.id),
    plugins_list: () => need().listPlugins(),
    plugins_update: (a) => need().updatePlugin(a.id, a.patch),
    plugins_rescan: () => need().rescanPlugins(),
    create_share: (a) => need().createShare(a.itemId, a.resourceType, a.expiresDays, a.downloadable),
    scrobble: ({ trackId, submission }) => need().scrobble(trackId, submission),
    get_play_queue: () => need().getPlayQueue(),
    save_play_queue: (a) => need().savePlayQueue(a.trackIds, a.currentTrackId, a.positionSecs),
    cover_art_url: ({ coverId, size }) => need().coverArtUrl(coverId, size ?? undefined),
    stream_url: ({ songId }) => need().streamUrl(songId),
    sync_auth: () => need().syncAuth(),

    // lyrics: server-side ones work, local cache in localStorage, the rest is desktop-only for now
    lyrics_server: ({ artist, title }) => need().getServerLyrics(artist, title),
    lyrics_server_by_id: ({ songId }) => need().getServerLyricsById(songId),
    lyrics_direct: inert(null),
    lyrics_search: inert([]),
    lyrics_fetch: inert(null),
    lyrics_local_load: ({ key }) => localStorage.getItem(LS_LYRICS + key),
    lyrics_local_save: ({ key, raw }) => localStorage.setItem(LS_LYRICS + key, raw),
    lyrics_local_remove: ({ key }) => localStorage.removeItem(LS_LYRICS + key),
    bandsintown_events: ({ artistName }) => lf("GET", `/tour?artist=${encodeURIComponent(artistName)}`).catch(() => []),

    // audio
    audio_play: (a) => audio.play(a.url, a.volume, a.durationHint, a.manual, a.startPaused),
    audio_chain_preload: ({ url }) => audio.chainPreload(url),
    audio_pause: () => audio.pause(),
    audio_resume: () => audio.resume(),
    audio_resume_at_cast_start: () => audio.resume(),
    audio_stop: () => audio.stop(),
    audio_seek: ({ seconds }) => audio.seek(seconds),
    audio_set_volume: ({ volume }) => audio.setVolume(volume),
    audio_set_eq: (a) => audio.setEq(!!a.enabled, Number(a.preampDb) || 0, Array.isArray(a.bandsDb) ? a.bandsDb.map(Number) : []),
    get_bpm: unsupported("get_bpm"),
    set_bpm_override: inert(undefined),
    get_bpm_cache_all: inert({}),

    // Last.fm runs in the web engine (secret + session key stay server-side)
    lastfm_connect_start: async () => {
      const { token, authUrl } = await lf("POST", "/lastfm/token");
      window.open(authUrl, "_blank", "noopener");
      return { token };
    },
    lastfm_connect_poll: ({ token }) => lf("POST", "/lastfm/session", { token }),
    lastfm_get_connection: () => lf("GET", "/lastfm/connection").catch(() => null),
    lastfm_public_api_key: () => lf("GET", "/lastfm/config").then((c) => c.apiKey ?? "").catch(() => ""),
    lastfm_disconnect: () => lf("DELETE", "/lastfm/connection"),
    lastfm_set_history_enabled: ({ value }) => lf("PUT", "/lastfm/toggles", { historyEnabled: value }),
    lastfm_set_scrobble_enabled: ({ value }) => lf("PUT", "/lastfm/toggles", { scrobbleEnabled: value }),
    lastfm_now_playing: ({ track }) => lf("POST", "/lastfm/nowplaying", { track }).catch(() => undefined),
    lastfm_scrobble: ({ track, timestamp }) => lf("POST", "/lastfm/scrobble", { track, timestamp }).catch(() => undefined),

    // casting / app shell — desktop-only
    cast_discover: inert([]), cast_rescan: inert([]), cast_disconnect: inert(undefined), cast_stop: inert(undefined),
    cast_pause: inert(undefined), cast_resume: inert(undefined), cast_seek: inert(undefined), cast_set_volume: inert(undefined),
    cast_connect: unsupported("cast_connect"), cast_play_track: unsupported("cast_play_track"),
    cast_calibration_start: unsupported("cast_calibration_start"), cast_calibration_stop: inert(undefined),
    app_version: () => (typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "web"), check_for_update: inert(null), download_and_install_update: unsupported("update"),
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
