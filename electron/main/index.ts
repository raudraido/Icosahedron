import { app, BrowserWindow, ipcMain, Menu, nativeTheme, protocol, shell } from "electron";
import { join } from "node:path";
import { SubsonicClient } from "./subsonic";
import { AudioEngineClient } from "./audioEngine";
import { registerCoverProtocol } from "./coverProtocol";
import { applyWindowState, loadWindowState } from "./windowState";
import {
  searchLyrics, fetchLyrics, lrclibDirect, loadLocalLyrics, saveLocalLyrics,
  removeLocalLyrics, getBandsintownEvents,
} from "./lyrics";
import { saveCredentials, loadCredentials, clearCredentials } from "./credentials";
import { getCachedBpm, setCachedBpm, getAllCachedBpm } from "./bpmCache";
import { checkForUpdate, downloadAndInstallUpdate } from "./updater";

protocol.registerSchemesAsPrivileged([
  { scheme: "cover", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Electron defaults to XWayland on Linux, which on mixed-resolution
// multi-monitor Wayland setups (e.g. a 1440p + 1080p display) sizes its
// virtual screen to the lowest-resolution output, capping every window at
// 1080p regardless of which monitor it's meant for. Forcing the native
// Wayland backend avoids that.
if (process.platform === "linux" && process.env["XDG_SESSION_TYPE"] === "wayland") {
  app.commandLine.appendSwitch("ozone-platform", "wayland");
  app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations");
}

let client: SubsonicClient | null = null;
let audioEngine: AudioEngineClient | null = null;
// Tracked separately from the AudioEngineClient's own copy so the
// download_and_install_update handler (registered outside createWindow) can
// push progress events without needing to reach back into that closure.
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const state = loadWindowState();
  const win = new BrowserWindow({
    // Bounds are applied explicitly in applyWindowState() once the window is
    // ready, rather than passed here: on Wayland, Chromium clamps a
    // constructor-time width/height to whichever display it (unreliably)
    // detects as primary, silently shrinking a >1080p saved size down to
    // 1080p on a mixed-resolution multi-monitor setup. A live setBounds()
    // call after creation isn't subject to that clamp.
    show: false,
    title: "icosahedron",
    // Packaged AppImage/.exe already get their icon baked in via
    // electron-builder's build.linux/build.win config — this just covers
    // `npm run dev`/`npm run preview`, where no .desktop entry exists yet to
    // supply one.
    icon: join(__dirname, "../../build/icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  applyWindowState(win, state);
  audioEngine = new AudioEngineClient(win);
  mainWindow = win;

  // Tour-date links (Info tab) and any other window.open() call should go to
  // the OS's default browser — matches the old app's webbrowser.open(url) —
  // rather than opening inside a new Electron BrowserWindow.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });

  // Removing the application menu also removes its default DevTools
  // accelerator, so wire the shortcut up independently.
  win.webContents.on("before-input-event", (_event, input) => {
    const isToggle = (input.control || input.meta) && input.shift && input.key.toLowerCase() === "i";
    if (isToggle || input.key === "F12") {
      win.webContents.toggleDevTools();
    }
  });

  if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function requireClient(): SubsonicClient {
  if (!client) throw new Error("not connected");
  return client;
}

function requireAudio(): AudioEngineClient {
  if (!audioEngine) throw new Error("audio engine not ready");
  return audioEngine;
}

function registerIpcHandlers(): void {
  ipcMain.handle("connect", async (_e, { url, username, password }) => {
    const c = new SubsonicClient(url, username, password);
    await c.ping();
    client = c;
    return true;
  });
  ipcMain.handle("ping", () => requireClient().ping());

  // ── Saved-credentials (see credentials.ts) ──────────────────────────────
  // The password never travels back over IPC on auto-connect — it's read,
  // decrypted, and handed straight to a new SubsonicClient entirely inside
  // this process; the renderer only ever learns whether it worked.
  ipcMain.handle("save_credentials", (_e, { url, username, password }) => saveCredentials(url, username, password));
  ipcMain.handle("clear_credentials", () => clearCredentials());
  ipcMain.handle("try_auto_connect", async () => {
    const creds = await loadCredentials();
    if (!creds) return null;
    try {
      const c = new SubsonicClient(creds.url, creds.username, creds.password);
      await c.ping();
      client = c;
      return { url: creds.url, username: creds.username };
    } catch {
      return null;
    }
  });

  ipcMain.handle("get_artists", () => requireClient().getArtists());
  ipcMain.handle("get_all_artists", () => requireClient().getAllArtists());
  ipcMain.handle("get_all_artists_sorted", (_e, { sortType }) => requireClient().getAllArtistsSorted(sortType));
  ipcMain.handle("get_artist", (_e, { id }) => requireClient().getArtist(id));

  ipcMain.handle("get_album_list", (_e, { sortType, size, offset }) => requireClient().getAlbumList(sortType, size, offset));
  ipcMain.handle("get_all_albums", (_e, { sortType }) => requireClient().getAllAlbums(sortType));
  ipcMain.handle("get_album_tracks", (_e, { id }) => requireClient().getAlbumTracks(id));
  ipcMain.handle("get_album", (_e, { id }) => requireClient().getAlbum(id));
  ipcMain.handle("get_compilations", () => requireClient().getCompilations());

  ipcMain.handle("get_random_songs", (_e, { count }) => requireClient().getRandomSongs(count));
  ipcMain.handle("get_tracks", (_e, { size, offset }) => requireClient().getTracks(size, offset));
  ipcMain.handle("get_tracks_native_page", (_e, { sortBy, order, start, end, query, filters }) =>
    requireClient().getTracksNativePage(sortBy, order, start, end, query, filters));

  // ── Column-filter id maps (Tracks tab's Excel-style filters) ────────────
  ipcMain.handle("get_artist_id_map", () => requireClient().getArtistIdMap());
  ipcMain.handle("get_album_id_map", () => requireClient().getAlbumIdMap());
  ipcMain.handle("get_genre_id_map", () => requireClient().getGenreIdMap());
  ipcMain.handle("start_scan", () => requireClient().startScan());
  ipcMain.handle("get_track_info", (_e, { id }) => requireClient().getTrackInfo(id));

  ipcMain.handle("get_playlists", () => requireClient().getPlaylists());
  ipcMain.handle("get_playlist_tracks", (_e, { id }) => requireClient().getPlaylistTracks(id));
  ipcMain.handle("create_playlist", (_e, { name, isPublic }) => requireClient().createPlaylist(name, isPublic ?? false));
  ipcMain.handle("add_tracks_to_playlist", (_e, { playlistId, trackIds }) => requireClient().addTracksToPlaylist(playlistId, trackIds));
  ipcMain.handle("rename_playlist", (_e, { playlistId, name }) => requireClient().renamePlaylist(playlistId, name));
  ipcMain.handle("set_playlist_public", (_e, { playlistId, isPublic }) => requireClient().setPlaylistPublic(playlistId, isPublic));
  ipcMain.handle("delete_playlist", (_e, { playlistId }) => requireClient().deletePlaylist(playlistId));
  ipcMain.handle("remove_track_from_playlist", (_e, { playlistId, songIndex }) => requireClient().removeTrackFromPlaylist(playlistId, songIndex));
  ipcMain.handle("reorder_playlist_tracks", (_e, { playlistId, currentLength, newTrackIds }) =>
    requireClient().reorderPlaylistTracks(playlistId, currentLength, newTrackIds));

  ipcMain.handle("get_similar_songs", (_e, { artistId, count }) => requireClient().getSimilarSongs(artistId, count));
  ipcMain.handle("get_top_songs", (_e, { artistName, count }) => requireClient().getTopSongs(artistName, count));

  ipcMain.handle("search", (_e, { query, artistCount, albumCount, songCount }) =>
    requireClient().search3(query, artistCount, albumCount, songCount));

  ipcMain.handle("get_starred", () => requireClient().getStarred());
  ipcMain.handle("set_favorite", (_e, { itemId, active, idParam }) => requireClient().setFavorite(itemId, active, idParam));

  ipcMain.handle("scrobble", (_e, { trackId, submission }) => requireClient().scrobble(trackId, submission));

  ipcMain.handle("cover_art_url", (_e, { coverId, size }) => requireClient().coverArtUrl(coverId, size ?? undefined));
  ipcMain.handle("stream_url", (_e, { songId }) => requireClient().streamUrl(songId));

  ipcMain.handle("get_scan_status", () => requireClient().getScanStatus());

  // ── Lyrics + artist tour dates (see lyrics.ts) ──────────────────────────
  ipcMain.handle("lyrics_server", (_e, { artist, title }) => requireClient().getServerLyrics(artist, title));
  ipcMain.handle("lyrics_direct", (_e, { artist, title, album, duration }) => lrclibDirect(artist, title, album, duration));
  ipcMain.handle("lyrics_search", (_e, { artist, title, sources }) => searchLyrics(artist, title, sources));
  ipcMain.handle("lyrics_fetch", (_e, { source, id }) => fetchLyrics(source, id));
  ipcMain.handle("lyrics_local_load", (_e, { key }) => loadLocalLyrics(key));
  ipcMain.handle("lyrics_local_save", (_e, { key, raw }) => saveLocalLyrics(key, raw));
  ipcMain.handle("lyrics_local_remove", (_e, { key }) => removeLocalLyrics(key));
  ipcMain.handle("bandsintown_events", (_e, { artistName }) => getBandsintownEvents(artistName));

  ipcMain.handle("app_version", () => app.getVersion());
  ipcMain.handle("check_for_update", () => checkForUpdate());
  ipcMain.handle("download_and_install_update", (_e, { downloadUrl }: { downloadUrl: string }) =>
    downloadAndInstallUpdate(
      downloadUrl,
      (progress) => mainWindow?.webContents.send("update_download_progress", progress),
      () => mainWindow?.webContents.send("update_installer_launching"),
    ));

  // Native OS window-frame/titlebar dark-vs-light mode — ports the old app's
  // enable_dark_title_bar (DwmSetWindowAttribute 20/19 on Windows), which
  // toggled the native titlebar independent of the in-app theme since Qt's
  // own chrome didn't know about it. Electron's nativeTheme.themeSource
  // does the same job cross-platform (Windows titlebar/controls, GTK theme
  // on Linux) without needing raw DWM calls — set once per theme change from
  // applyTheme() in the renderer, driven by the theme's own titleBarDark flag.
  ipcMain.handle("set_window_theme", (_e, { dark }: { dark: boolean }) => {
    nativeTheme.themeSource = dark ? "dark" : "light";
  });

  // ── Native gapless audio engine (see audioEngine.ts) ────────────────────
  ipcMain.handle("audio_play", (_e, { url, volume, durationHint, manual, startPaused }) =>
    requireAudio().play(url, volume, durationHint, manual ?? true, startPaused ?? false));
  ipcMain.handle("audio_chain_preload", (_e, { url, durationHint }) => requireAudio().chainPreload(url, durationHint));
  ipcMain.handle("audio_pause", () => requireAudio().pause());
  ipcMain.handle("audio_resume", () => requireAudio().resume());
  ipcMain.handle("audio_stop", () => requireAudio().stop());
  ipcMain.handle("audio_seek", (_e, { seconds }) => requireAudio().seek(seconds));
  ipcMain.handle("audio_set_volume", (_e, { volume }) => requireAudio().setVolume(volume));

  // ── BPM detection (footer bar) — cache-first, falls back to the native
  // QM-DSP analyzer (audio_engine.rs's analyze_bpm) on a cache miss. ────────
  ipcMain.handle("get_bpm", async (_e, { trackId, streamUrl }) => {
    const cached = await getCachedBpm(trackId);
    if (cached != null) return cached;
    const bpm = await requireAudio().analyzeBpm(streamUrl);
    await setCachedBpm(trackId, bpm);
    return bpm;
  });
  ipcMain.handle("set_bpm_override", async (_e, { trackId, bpm }) => {
    await setCachedBpm(trackId, bpm);
  });
  ipcMain.handle("get_bpm_cache_all", () => getAllCachedBpm());
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const cacheDir = join(app.getPath("userData"), "covers");
  registerCoverProtocol(cacheDir, () => client);
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  audioEngine?.stop();
});
