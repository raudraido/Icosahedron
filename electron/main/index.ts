import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, protocol, shell, Tray } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SubsonicClient } from "./subsonic";
import { AudioEngineClient } from "./audioEngine";
import { registerCoverProtocol } from "./coverProtocol";
import { applyWindowState, loadWindowState } from "./windowState";
import { loadTraySettings, saveTraySettings, TraySettings } from "./traySettings";
import {
  searchLyrics, fetchLyrics, lrclibDirect, loadLocalLyrics, saveLocalLyrics,
  removeLocalLyrics, getBandsintownEvents,
} from "./lyrics";
import {
  listServers, saveServer, deleteServer, getActiveServerId, setActiveServerId, loadServerCredentials,
} from "./credentials";
import { getCachedBpm, setCachedBpm, getAllCachedBpm } from "./bpmCache";
import { checkForUpdate, downloadAndInstallUpdate } from "./updater";
import * as lastfm from "./lastfm";
import {
  saveSession as saveLastFmSession, loadSessionForDisplay as loadLastFmSession, getSessionKey as getLastFmSessionKey,
  clearSession as clearLastFmSession, setToggle as setLastFmToggle,
} from "./lastfmSession";

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

// Single-instance lock — a second launch (double-clicking the exe again,
// clicking a desktop shortcut while it's already running, etc.) would
// otherwise open a second native audio-engine connection against the same
// server, fight over the same window-state/credentials files, and generally
// behave as two independent apps rather than one. requestSingleInstanceLock
// returns false in whichever process loses the race; that one just quits
// immediately and hands off to the 'second-instance' event fired in the
// original, which brings the existing window forward instead (see below —
// registered once mainWindow exists, after app.whenReady()).
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let client: SubsonicClient | null = null;
let audioEngine: AudioEngineClient | null = null;
// Tracked separately from the AudioEngineClient's own copy so the
// download_and_install_update handler (registered outside createWindow) can
// push progress events without needing to reach back into that closure.
let mainWindow: BrowserWindow | null = null;

let traySettings: TraySettings = loadTraySettings();
let tray: Tray | null = null;
// Flips true on an actual quit (tray "Quit", Cmd+Q, OS shutdown, etc.) so
// the window's 'close' handler can tell that apart from a plain click on
// the titlebar's X button — only the latter should be interceptable by
// "Exit to tray".
let isQuitting = false;

// `build/icon.png` (used for the BrowserWindow `icon` option below) is a
// build-time-only asset — electron-builder reads it to embed the OS-level
// exe/AppImage icon, but it's never copied into the packaged app itself
// (package.json's build.files only ships "out/**/*"). A Tray icon has no
// exe/AppImage fallback to lean on, so unlike the window icon, resolving to
// a path that doesn't exist in a packaged build means no tray icon ever
// appears at all — silently, since `new Tray()` doesn't throw on a bad path.
// `public/img/icon.png` is a renderer asset instead, which Vite always
// copies into `out/renderer/img/` on every build (dev or packaged), so it
// reliably exists either way; falls back to the dev-only build/ copy just
// in case `npm run dev` is being used before `out/renderer` has ever been
// generated on disk.
function resolveTrayIconPath(): string {
  const rendererIcon = join(__dirname, "../renderer/img/icon.png");
  if (existsSync(rendererIcon)) return rendererIcon;
  return join(__dirname, "../../build/icon.png");
}

// Tray icon only exists while at least one of the two settings could
// actually use it — a user who wants neither behavior shouldn't have a
// stray icon sitting in their tray for no reason. Re-run on every settings
// change (see set_tray_settings) so toggling either one on/off creates or
// destroys it immediately rather than needing a restart.
function syncTray(): void {
  const wantsTray = traySettings.minimizeToTray || traySettings.exitToTray;
  if (wantsTray && !tray) {
    const iconPath = resolveTrayIconPath();
    const icon = nativeImage.createFromPath(iconPath);
    // Electron's Tray never throws on a bad path — it just silently ends up
    // with an empty (0×0) image and no visible icon at all, which is
    // exactly how this broke before (build/icon.png isn't shipped in a
    // packaged build, see resolveTrayIconPath's comment). Logging here
    // means a future regression shows up in the console instead of another
    // silent "nothing appears in the tray" bug report.
    if (icon.isEmpty()) console.error(`[tray] icon failed to load from ${iconPath} — tray will be invisible`);
    tray = new Tray(icon);
    tray.setToolTip("Icosahedron");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Show Icosahedron", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { type: "separator" },
      { label: "Quit", click: () => { isQuitting = true; app.quit(); } },
    ]));
    // Left-click (Windows/Linux — macOS doesn't fire 'click' on tray icons
    // the same way and isn't a build target for this app) toggles the
    // window, matching most tray-icon apps' expected one-click behavior.
    tray.on("click", () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) mainWindow.hide();
      else { mainWindow.show(); mainWindow.focus(); }
    });
  } else if (!wantsTray && tray) {
    tray.destroy();
    tray = null;
  }
}

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

  // 'minimize' isn't cancelable in current Electron typings — hiding right
  // after it's already minimized achieves the same "gone from the taskbar"
  // result, just one step removed from intercepting the minimize itself.
  win.on("minimize", () => {
    if (!traySettings.minimizeToTray) return;
    win.hide();
  });

  // Only intercept a plain titlebar-X close — an actual quit (tray menu,
  // Cmd+Q, OS shutdown) sets isQuitting first specifically so this doesn't
  // trap the app open forever.
  win.on("close", (event) => {
    if (isQuitting || !traySettings.exitToTray) return;
    event.preventDefault();
    win.hide();
  });

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

  // Validates not-yet-saved credentials (Settings > Servers' "Add Server"
  // dialog) without touching the live `client` — unlike "connect" above,
  // testing a brand-new profile shouldn't swap out whatever server is
  // actually driving the rest of the app right now.
  ipcMain.handle("test_connection", async (_e, { url, username, password }) => {
    try {
      await new SubsonicClient(url, username, password).ping();
      return true;
    } catch {
      return false;
    }
  });

  // ── Multi-server profiles (see credentials.ts) ──────────────────────────
  // Passwords never travel back over IPC — they're read, decrypted, and
  // handed straight to a new SubsonicClient entirely inside this process;
  // the renderer only ever learns whether a connect attempt worked.
  ipcMain.handle("list_servers", () => listServers());
  ipcMain.handle("get_active_server", () => getActiveServerId());
  ipcMain.handle("save_server", (_e, profile) => saveServer(profile));
  ipcMain.handle("delete_server", (_e, { id }) => deleteServer(id));
  ipcMain.handle("set_active_server", (_e, { id }) => setActiveServerId(id));

  // Connects using a saved profile's stored (decrypted) credentials —
  // powers both "Use" in Settings > Servers and the boot-time auto-connect
  // below. Marks the profile active on success so next launch picks it back
  // up automatically.
  ipcMain.handle("connect_server", async (_e, { id }) => {
    const creds = await loadServerCredentials(id);
    if (!creds) return null;
    try {
      const c = new SubsonicClient(creds.url, creds.username, creds.password);
      await c.ping();
      client = c;
      await setActiveServerId(id);
      return { url: creds.url, username: creds.username };
    } catch {
      return null;
    }
  });

  // "Test Connection" in Settings > Servers — pings without touching the
  // live `client`, so testing a non-active saved profile can't accidentally
  // swap out the connection actually driving the rest of the app.
  ipcMain.handle("test_server", async (_e, { id }) => {
    const creds = await loadServerCredentials(id);
    if (!creds) return false;
    try {
      await new SubsonicClient(creds.url, creds.username, creds.password).ping();
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("try_auto_connect", async () => {
    const activeId = await getActiveServerId();
    if (!activeId) return null;
    const creds = await loadServerCredentials(activeId);
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

  // ── Client-side Last.fm scrobbling (electron/main/lastfm.ts) — independent
  // of the Navidrome-relayed scrobble above, for users without Last.fm
  // configured server-side. Session key never leaves the main process; see
  // lastfmSession.ts. ──────────────────────────────────────────────────────
  ipcMain.handle("lastfm_connect_start", async () => {
    const token = await lastfm.getToken();
    shell.openExternal(lastfm.authUrl(token));
    return { token };
  });
  ipcMain.handle("lastfm_connect_poll", async (_e, { token, serverId }) => {
    try {
      const { key, username } = await lastfm.getSession(token);
      await saveLastFmSession(serverId, key, username);
      return { connected: true, username };
    } catch (e) {
      if (e instanceof lastfm.LastFmApiError && e.code === 14) return { connected: false };
      throw e;
    }
  });
  ipcMain.handle("lastfm_get_connection", (_e, { serverId }) => loadLastFmSession(serverId));
  ipcMain.handle("lastfm_public_api_key", () => lastfm.getApiKey());
  ipcMain.handle("lastfm_disconnect", (_e, { serverId }) => clearLastFmSession(serverId));
  ipcMain.handle("lastfm_set_history_enabled", (_e, { serverId, value }) => setLastFmToggle(serverId, "historyEnabled", value));
  ipcMain.handle("lastfm_set_scrobble_enabled", (_e, { serverId, value }) => setLastFmToggle(serverId, "scrobbleEnabled", value));
  ipcMain.handle("lastfm_now_playing", async (_e, { track, serverId }) => {
    const sessionKey = await getLastFmSessionKey(serverId);
    if (sessionKey) await lastfm.updateNowPlaying(track, sessionKey);
  });
  ipcMain.handle("lastfm_scrobble", async (_e, { track, timestamp, serverId }) => {
    const sessionKey = await getLastFmSessionKey(serverId);
    if (sessionKey) await lastfm.scrobble(track, timestamp, sessionKey);
  });

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

  // ── Settings > System > Application ─────────────────────────────────────
  ipcMain.handle("get_tray_settings", () => traySettings);
  ipcMain.handle("set_tray_settings", (_e, settings: Partial<TraySettings>) => {
    traySettings = { ...traySettings, ...settings };
    saveTraySettings(traySettings);
    syncTray();
  });

  // Deliberate quit (logo menu's "Quit" row) — same isQuitting-first
  // sequence as the tray's own Quit item, so createWindow()'s 'close'
  // handler lets the window actually close instead of hiding it to the
  // tray even when "Exit to tray" is on.
  ipcMain.handle("quit_app", () => {
    isQuitting = true;
    app.quit();
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const cacheDir = join(app.getPath("userData"), "covers");
  registerCoverProtocol(cacheDir, () => client);
  registerIpcHandlers();
  createWindow();
  syncTray(); // in case either setting was already on from a prior launch

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else { mainWindow?.show(); mainWindow?.focus(); }
  });

  // Fired in this (the original) process when a second launch attempt hit
  // the single-instance lock above and quit itself — bring the real window
  // forward instead of silently doing nothing, since "double-click the exe
  // again" should read as "show me the app", not a no-op.
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Fires before any window's own 'close' event during a real quit sequence
// (app.quit() from the tray menu, the updater's app.quit() handoff, Cmd+Q,
// OS shutdown, …) — flip isQuitting here so createWindow()'s 'close'
// handler lets the window actually close instead of hiding it to the tray,
// no matter which path triggered the quit.
app.on("before-quit", () => {
  isQuitting = true;
  audioEngine?.stop();
});
