import { app, BrowserWindow, ipcMain, Menu, protocol, shell } from "electron";
import { join } from "node:path";
import { SubsonicClient } from "./subsonic";
import { registerCoverProtocol } from "./coverProtocol";
import { applyWindowState, loadWindowState } from "./windowState";
import {
  searchLyrics, fetchLyrics, lrclibDirect, loadLocalLyrics, saveLocalLyrics,
  removeLocalLyrics, getBandsintownEvents,
} from "./lyrics";

protocol.registerSchemesAsPrivileged([
  { scheme: "cover", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let client: SubsonicClient | null = null;

function createWindow(): void {
  const state = loadWindowState();
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    title: "icosahedron",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  applyWindowState(win, state);

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

function registerIpcHandlers(): void {
  ipcMain.handle("connect", async (_e, { url, username, password }) => {
    const c = new SubsonicClient(url, username, password);
    await c.ping();
    client = c;
    return true;
  });
  ipcMain.handle("ping", () => requireClient().ping());

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
  ipcMain.handle("get_tracks_native_page", (_e, { sortBy, order, start, end, query }) =>
    requireClient().getTracksNativePage(sortBy, order, start, end, query));
  ipcMain.handle("start_scan", () => requireClient().startScan());
  ipcMain.handle("get_track_info", (_e, { id }) => requireClient().getTrackInfo(id));

  ipcMain.handle("get_playlists", () => requireClient().getPlaylists());
  ipcMain.handle("get_playlist_tracks", (_e, { id }) => requireClient().getPlaylistTracks(id));
  ipcMain.handle("create_playlist", (_e, { name }) => requireClient().createPlaylist(name));
  ipcMain.handle("add_tracks_to_playlist", (_e, { playlistId, trackIds }) => requireClient().addTracksToPlaylist(playlistId, trackIds));

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
