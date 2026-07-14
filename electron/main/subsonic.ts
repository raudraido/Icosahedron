import { createHash } from "node:crypto";
import type {
  Artist, Album, Track, Playlist, ArtistDetail, SearchResult, Starred, ScanStatus, TrackFullInfo, PlayQueue, LyricsWordCue,
} from "./models";

const API_VERSION = "1.16.1";
const CLIENT_NAME = "Icosahedron";

function randomSalt(len = 8): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function md5(s: string): string {
  return createHash("md5").update(s, "utf8").digest("hex");
}

function strField(v: any, key: string): string {
  return typeof v?.[key] === "string" ? v[key] : "";
}

function asArray(v: any): any[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

export class SubsonicApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

// Subsonic endpoints that accept a musicFolderId filter (per the spec /
// OpenSubsonic) — the per-server library selection is injected into exactly
// these in get(); anything else (detail lookups by id, playlists, scrobble…)
// is id-addressed and unaffected by the folder.
const MUSIC_FOLDER_ENDPOINTS = new Set([
  "getArtists", "getIndexes", "getAlbumList2", "search3", "getStarred2", "getRandomSongs",
]);

export class SubsonicClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private nativeJwt: string | null = null;
  private nativeJwtPromise: Promise<void> | null = null;
  /** Selected libraries (Subsonic music folders / Navidrome library ids),
   *  empty = all — set from the server profile, changeable live via
   *  setMusicFolders. */
  private musicFolderIds: string[];

  constructor(baseUrl: string, username: string, password: string, musicFolderIds: string[] = []) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.username = username;
    this.password = password;
    this.musicFolderIds = musicFolderIds;
  }

  setMusicFolders(ids: string[]): void {
    this.musicFolderIds = ids;
  }

  /** Navidrome's native API expresses the same filter as `library_id` —
   *  appended (repeated per selected library, which Navidrome resolves to
   *  an IN clause) to the native list endpoints the same way get() injects
   *  musicFolderId. */
  private applyNativeLibrary(params: URLSearchParams): URLSearchParams {
    for (const id of this.musicFolderIds) params.append("library_id", id);
    return params;
  }

  // --- Auth ---

  private authParams(): Record<string, string> {
    const salt = randomSalt();
    const token = md5(this.password + salt);
    return {
      u: this.username,
      t: token,
      s: salt,
      v: API_VERSION,
      c: CLIENT_NAME,
      f: "json",
    };
  }

  streamUrl(songId: string): string {
    const params = this.authParams();
    params.id = songId;
    const qs = new URLSearchParams(params).toString();
    return `${this.baseUrl}/rest/stream?${qs}`;
  }

  async fetchCoverArt(coverId: string, size?: number, signal?: AbortSignal): Promise<{ bytes: Buffer; contentType: string }> {
    const url = this.coverArtUrl(coverId, size);
    const resp = await fetch(url, { signal });
    const contentType = resp.headers.get("content-type") ?? "image/jpeg";
    // A missing/invalid cover id doesn't necessarily 404 — some Subsonic
    // servers respond 200 with a JSON error body instead. Either way, that's
    // not image bytes: throwing here (instead of returning it as if it were
    // a valid cover) matters because coverProtocol.ts's disk cache only ever
    // writes on the success path — if this returned "successfully" with junk
    // bytes, that junk would get cached to disk *permanently*, and every
    // future load would keep re-serving the same poisoned file forever
    // without ever hitting the network (or this validation) again.
    if (!resp.ok || !contentType.startsWith("image/")) {
      throw new Error(`cover art fetch failed: HTTP ${resp.status}, content-type ${contentType}`);
    }
    const bytes = Buffer.from(await resp.arrayBuffer());
    if (bytes.length === 0) {
      throw new Error("cover art fetch returned empty body");
    }
    return { bytes, contentType };
  }

  coverArtUrl(coverId: string, size?: number): string {
    const params = this.authParams();
    delete params.f; // image endpoint, no json flag
    params.id = coverId;
    if (size) params.size = String(size);
    const qs = new URLSearchParams(params).toString();
    return `${this.baseUrl}/rest/getCoverArt?${qs}`;
  }

  // --- Low-level request ---

  private async get(endpoint: string, extra: Record<string, string> = {}): Promise<any> {
    const params = { ...this.authParams(), ...extra };
    // The Subsonic param only carries a single folder — applied when exactly
    // one library is selected. A multi-library subset can only be filtered
    // on the native endpoints (see applyNativeLibrary); Subsonic endpoints
    // then fall back to all libraries rather than picking one arbitrarily.
    if (this.musicFolderIds.length === 1 && MUSIC_FOLDER_ENDPOINTS.has(endpoint)) params.musicFolderId = this.musicFolderIds[0];
    const qs = new URLSearchParams(params).toString();
    const resp = await fetch(`${this.baseUrl}/rest/${endpoint}?${qs}`);
    const body = await resp.json();
    const root = body?.["subsonic-response"];
    if (!root) throw new Error("missing subsonic-response");
    if (root.status !== "ok") {
      const err = root.error ?? {};
      throw new SubsonicApiError(err.code ?? 0, err.message ?? "unknown");
    }
    return root;
  }

  // --- Navidrome native auth (JWT) ---

  private async authenticateNative(): Promise<void> {
    if (this.nativeJwt) return;
    if (!this.nativeJwtPromise) {
      this.nativeJwtPromise = (async () => {
        const resp = await fetch(`${this.baseUrl}/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: this.username, password: this.password }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const body = await resp.json();
        if (typeof body?.token !== "string") throw new Error("no token in response");
        this.nativeJwt = body.token;
      })();
    }
    return this.nativeJwtPromise;
  }

  // --- API methods ---

  async ping(): Promise<boolean> {
    await this.get("ping");
    return true;
  }

  /** Subsonic getMusicFolders — Navidrome exposes its libraries here, so
   *  this backs the per-server library picker in Settings > Servers. */
  async getMusicFolders(): Promise<{ id: string; name: string }[]> {
    const root = await this.get("getMusicFolders");
    return asArray(root.musicFolders?.musicFolder).map((f: any) => ({ id: String(f.id), name: String(f.name ?? f.id) }));
  }

  async getScanStatus(): Promise<ScanStatus> {
    const root = await this.get("getScanStatus");
    const s = root.scanStatus ?? {};
    return {
      scanning: !!s.scanning,
      count: s.count ?? 0,
      folder_count: s.folderCount ?? null,
      last_scan: s.lastScan ?? null,
    };
  }

  async getPlaylists(): Promise<Playlist[]> {
    const root = await this.get("getPlaylists");
    return asArray(root.playlists?.playlist).map(parsePlaylist);
  }

  async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    const root = await this.get("getPlaylist", { id: playlistId });
    return asArray(root.playlist?.entry).map((s) => this.parseTrack(s));
  }

  async createPlaylist(name: string, isPublic = false): Promise<Playlist> {
    const root = await this.get("createPlaylist", { name });
    if (!root.playlist) throw new Error("missing playlist in createPlaylist response");
    const created = parsePlaylist(root.playlist);
    if (isPublic) {
      await this.get("updatePlaylist", { playlistId: created.id, public: "true" });
      created.public = true;
    }
    return created;
  }

  async renamePlaylist(playlistId: string, name: string): Promise<void> {
    await this.get("updatePlaylist", { playlistId, name });
  }

  async setPlaylistPublic(playlistId: string, isPublic: boolean): Promise<void> {
    await this.get("updatePlaylist", { playlistId, public: String(isPublic) });
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    await this.get("deletePlaylist", { id: playlistId });
  }

  /** Removes a single track by its 0-based playlist position — a real POST,
   *  same reason as addTracksToPlaylist/reorderPlaylistTracks below: the
   *  flat-Record `get()` GET helper doesn't reliably apply updatePlaylist
   *  mutations. */
  async removeTrackFromPlaylist(playlistId: string, songIndex: number): Promise<void> {
    const params = new URLSearchParams(this.authParams());
    params.set("playlistId", playlistId);
    params.append("songIndexToRemove", String(songIndex));
    const resp = await fetch(`${this.baseUrl}/rest/updatePlaylist`, { method: "POST", body: params });
    const body = await resp.json();
    const root = body?.["subsonic-response"];
    if (!root || root.status !== "ok") {
      throw new SubsonicApiError(root?.error?.code ?? 0, root?.error?.message ?? "updatePlaylist failed");
    }
  }

  /** Appends tracks to an existing playlist — uses songIdToAdd only, doesn't touch existing entries.
   *  Needs a real POST with repeated songIdToAdd params, which the flat-Record `get()` helper can't express. */
  async addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<void> {
    if (!trackIds.length) return;
    const params = new URLSearchParams(this.authParams());
    params.set("playlistId", playlistId);
    for (const id of trackIds) params.append("songIdToAdd", id);
    const resp = await fetch(`${this.baseUrl}/rest/updatePlaylist`, { method: "POST", body: params });
    const body = await resp.json();
    const root = body?.["subsonic-response"];
    if (!root || root.status !== "ok") {
      throw new SubsonicApiError(root?.error?.code ?? 0, root?.error?.message ?? "updatePlaylist failed");
    }
  }

  /** Replaces the entire playlist content with a new track order — Subsonic has no
   *  "move" verb, so this removes every existing index (highest-first, to avoid
   *  index-shift bugs on older servers) then re-adds the full id list in the new
   *  order, all in one POST. Matches the old app's update_playlist_tracks exactly. */
  async reorderPlaylistTracks(playlistId: string, currentLength: number, newTrackIds: string[]): Promise<void> {
    const params = new URLSearchParams(this.authParams());
    params.set("playlistId", playlistId);
    for (let i = currentLength - 1; i >= 0; i--) params.append("songIndexToRemove", String(i));
    for (const id of newTrackIds) params.append("songIdToAdd", id);
    const resp = await fetch(`${this.baseUrl}/rest/updatePlaylist`, { method: "POST", body: params });
    const body = await resp.json();
    const root = body?.["subsonic-response"];
    if (!root || root.status !== "ok") {
      throw new SubsonicApiError(root?.error?.code ?? 0, root?.error?.message ?? "updatePlaylist failed");
    }
  }

  /** Similar-artist songs for "Start Radio" — requires a Last.fm/AudioMuse-backed Navidrome server;
   *  callers should treat failure as "no similar songs available" rather than a hard error. */
  async getSimilarSongs(artistId: string, count = 50): Promise<Track[]> {
    const root = await this.get("getSimilarSongs2", { id: artistId, count: String(count) });
    return asArray(root.similarSongs2?.song).map((s) => this.parseTrack(s));
  }

  async getTopSongs(artistName: string, count = 10): Promise<Track[]> {
    const root = await this.get("getTopSongs", { artist: artistName, count: String(count) });
    return asArray(root.topSongs?.song).map((s) => this.parseTrack(s));
  }

  async getAllArtists(): Promise<Artist[]> {
    const root = await this.get("search3", { query: "", artistCount: "100000", albumCount: "0", songCount: "0" });
    return asArray(root.searchResult3?.artist).map(parseArtist);
  }

  /** Navidrome's native /api/artist — sorted by name/albumCount/playCount, unlike the
   *  standard Subsonic API which has no server-side sort for a flat artist list. */
  async getAllArtistsSorted(sortType: string): Promise<Artist[]> {
    const nativeSort = sortType === "albums_count" ? "albumCount" : sortType === "most_played" ? "playCount" : "name";
    await this.authenticateNative();
    const resp = await fetch(
      `${this.baseUrl}/api/artist?${this.applyNativeLibrary(new URLSearchParams({
        _start: "0", _end: "100000", _sort: nativeSort, _order: "ASC",
      }))}`,
      { headers: { "x-nd-authorization": `Bearer ${this.nativeJwt}` } },
    );
    const data = await resp.json();
    if (!Array.isArray(data)) throw new Error("expected array");
    return data.map(parseNativeArtist);
  }

  async getAllAlbums(sortType: string): Promise<Album[]> {
    const all: Album[] = [];
    let offset = 0;
    const SIZE = 500;
    for (;;) {
      const batch = await this.getAlbumList(sortType, SIZE, offset);
      all.push(...batch);
      if (batch.length < SIZE) break;
      offset += SIZE;
    }
    return all;
  }

  async getCompilations(): Promise<Album[]> {
    await this.authenticateNative();
    const resp = await fetch(
      `${this.baseUrl}/api/album?${this.applyNativeLibrary(new URLSearchParams({
        _start: "0", _end: "100000", _sort: "name", _order: "ASC", compilation: "true",
      }))}`,
      { headers: { "x-nd-authorization": `Bearer ${this.nativeJwt}` } },
    );
    const data = await resp.json();
    if (!Array.isArray(data)) throw new Error("expected array");
    return data.map(parseNativeAlbum);
  }

  async getArtists(): Promise<Artist[]> {
    const root = await this.get("getArtists");
    const out: Artist[] = [];
    for (const idx of asArray(root.artists?.index)) {
      for (const a of asArray(idx.artist)) out.push(parseArtist(a));
    }
    return out;
  }

  async getArtist(artistId: string): Promise<ArtistDetail> {
    const root = await this.get("getArtist", { id: artistId });
    const a = root.artist;
    if (!a) throw new Error("missing artist");
    const albums = asArray(a.album).map(parseAlbum);

    const info = await this.get("getArtistInfo2", { id: artistId }).catch(() => null);
    const info2 = info?.artistInfo2;
    return {
      artist: parseArtist(a),
      albums,
      biography: info2?.biography ?? null,
      music_brainz_id: info2?.musicBrainzId ?? null,
      last_fm_url: info2?.lastFmUrl ?? null,
      similar_artists: asArray(info2?.similarArtist).map(parseArtist),
      image_url: info2?.largeImageUrl || info2?.mediumImageUrl || info2?.smallImageUrl || null,
    };
  }

  /** Standard Subsonic getLyrics — old-app-compatible fallback for servers
   *  that don't implement the OpenSubsonic extension above (non-Navidrome
   *  Subsonic servers, or Navidrome versions before it existed). */
  async getServerLyrics(artist: string, title: string): Promise<string | null> {
    const root = await this.get("getLyrics", { artist, title }).catch(() => null);
    const value = root?.lyrics?.value;
    return typeof value === "string" && value ? value : null;
  }

  /** OpenSubsonic's structured getLyricsBySongId — tried before the classic
   *  getLyrics above now that Navidrome (0.63+) surfaces real per-line
   *  timestamps and multiple sidecar formats (TTML/ELRC/SRT/YAML/LRC)
   *  through it, rather than the classic endpoint's single plain-text blob
   *  which only carries sync data if a provider happens to embed LRC tags
   *  in it by convention. `raw` is reconstructed as an LRC string (synced)
   *  or plain text (unsynced) so it flows through the exact same
   *  parseLrc()-based pipeline everything else already uses, rather than a
   *  separate code path. A server that doesn't implement this extension at
   *  all (non-Navidrome, or an older Navidrome) just fails the call, caught
   *  the same way getServerLyrics is above.
   *
   *  Requests `enhanced=true` for word-level karaoke timing too (Navidrome
   *  0.63+'s `cueLine`/`cue`) — most tracks won't have it (it needs a
   *  karaoke-capable TTML/ELRC sidecar specifically, not just any synced
   *  lyrics), in which case `wordsByMs` is just null, same as before this
   *  was added. Keyed by each line's own start-ms (not array index) since
   *  parseLrc() can drop/reorder lines relative to the raw API array (e.g.
   *  a leading empty-text line) — matching on the timestamp instead of
   *  position is immune to that. Multi-voice tracks (duets, backing
   *  vocals — `agents`) only ever use the "main" agent's cueLine; rendering
   *  every layer side-by-side is real scope beyond a single-voice karaoke
   *  line and isn't attempted here. */
  async getServerLyricsById(songId: string): Promise<{ raw: string; wordsByMs: Record<number, LyricsWordCue[]> | null } | null> {
    const root = await this.get("getLyricsBySongId", { id: songId, enhanced: "true" }).catch(() => null);
    const entries = asArray(root?.lyricsList?.structuredLyrics);
    if (!entries.length) return null;
    // Prefer a synced, main-track entry — a server can legitimately return
    // more than one language/variant (or, with enhanced=true, a separate
    // translation/pronunciation track) for the same song.
    const best = entries.find((e: any) => e?.synced && (!e?.kind || e.kind === "main"))
      ?? entries.find((e: any) => e?.synced) ?? entries[0];
    const lines = asArray(best?.line);
    if (!lines.length) return null;
    if (!best.synced) return { raw: lines.map((l: any) => l?.value ?? "").join("\n"), wordsByMs: null };

    const lineMs = lines.map((l: any) => Math.max(0, Number(l?.start) || 0));
    const raw = lines
      .map((l: any, i: number) => {
        const totalMs = lineMs[i];
        const m = Math.floor(totalMs / 60_000);
        const s = Math.floor((totalMs % 60_000) / 1000);
        const ms = totalMs % 1000;
        return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}]${l?.value ?? ""}`;
      })
      .join("\n");

    const agents = asArray(best.agents);
    const mainAgentId = agents.find((a: any) => a?.role === "main")?.id;
    // First cueLine per index wins if a server ever sent duplicates —
    // there's exactly one "main" layer per line, so any further entries at
    // the same index are other voices being deliberately skipped above.
    const cueLinesByIndex = new Map<number, any>();
    for (const cl of asArray(best.cueLine)) {
      if (agents.length && mainAgentId && cl?.agentId && cl.agentId !== mainAgentId) continue;
      if (!cueLinesByIndex.has(cl.index)) cueLinesByIndex.set(cl.index, cl);
    }
    let wordsByMs: Record<number, LyricsWordCue[]> | null = null;
    for (const [index, cueLine] of cueLinesByIndex) {
      const cues = asArray(cueLine?.cue);
      if (!cues.length) continue;
      const words: LyricsWordCue[] = cues.map((c: any) => ({
        text: String(c?.value ?? ""),
        startMs: Math.max(0, Number(c?.start) || 0),
        endMs: Number.isFinite(c?.end) ? Number(c.end) : null,
      }));
      (wordsByMs ??= {})[lineMs[index]] = words;
    }
    return { raw, wordsByMs };
  }

  async getAlbumTracks(albumId: string): Promise<Track[]> {
    const root = await this.get("getAlbum", { id: albumId });
    return asArray(root.album?.song).map((s) => this.parseTrack(s));
  }

  async getAlbum(albumId: string): Promise<Album> {
    const root = await this.get("getAlbum", { id: albumId });
    if (!root.album) throw new Error("missing album");
    return parseAlbum(root.album);
  }

  async getAlbumList(sortType: string, size: number, offset: number): Promise<Album[]> {
    const root = await this.get("getAlbumList2", { type: sortType, size: String(size), offset: String(offset) });
    return asArray(root.albumList2?.album).map(parseAlbum);
  }

  async getTracks(size: number, offset: number): Promise<Track[]> {
    const root = await this.get("search3", {
      query: "", artistCount: "0", albumCount: "0", songCount: String(size), songOffset: String(offset),
    });
    return asArray(root.searchResult3?.song).map((s) => this.parseTrack(s));
  }

  /** Navidrome's native /api/song — true server-side sort + pagination + exact total (X-Total-Count),
   *  unlike the standard Subsonic API which has no arbitrary-sort-field pagination for a flat track list.
   *  `filters` backs the Tracks tab's Excel-style column filters (tracks_browser.py's
   *  _build_server_filters): artist_id/album_id/genre_id are Navidrome's native ID-list filters
   *  (repeated query params, ANDed as an IN-list) — `year` is NOT: repeated `year` params were
   *  tried and empirically return zero results (Navidrome treats it as a single scalar column,
   *  not a many-valued relation), so unlike the ID filters it only ever takes one value
   *  server-side, matching the old app's `next(iter(allowed))` behavior. Do not "fix" this to
   *  multi-value again without confirming the server actually supports it. */
  async getTracksNativePage(
    sortBy: string, order: "ASC" | "DESC", start: number, end: number, query?: string,
    filters?: { artistIds?: string[]; albumIds?: string[]; genreIds?: string[]; year?: string; starred?: boolean },
  ): Promise<{ tracks: Track[]; total: number }> {
    await this.authenticateNative();
    const params = new URLSearchParams({ _start: String(start), _end: String(end), _sort: sortBy, _order: order });
    // Despite the param name, Navidrome resolves `title` as a combined
    // search across title/artist/album server-side (not a literal
    // title-only column match) — same behavior Feishin relies on for its
    // own /api/song search box.
    if (query) params.set("title", query);
    if (filters?.artistIds) for (const id of filters.artistIds) params.append("artist_id", id);
    if (filters?.albumIds) for (const id of filters.albumIds) params.append("album_id", id);
    if (filters?.genreIds) for (const id of filters.genreIds) params.append("genre_id", id);
    if (filters?.year) params.set("year", filters.year);
    if (filters?.starred !== undefined) params.set("starred", filters.starred ? "true" : "false");
    this.applyNativeLibrary(params);
    const resp = await fetch(`${this.baseUrl}/api/song?${params}`, {
      headers: { "x-nd-authorization": `Bearer ${this.nativeJwt}` },
    });
    const data = await resp.json();
    if (!Array.isArray(data)) throw new Error("expected array");
    const total = Number(resp.headers.get("x-total-count") ?? data.length);
    return { tracks: data.map((s) => this.parseNativeTrack(s)), total };
  }

  /** name→id maps backing the filter popup's checklist for Artist/Album/Genre columns
   *  (tracks_browser.py's get_all_artists_native/get_all_albums_native/get_genres_native) —
   *  display values come from the track list itself, but applying the filter server-side
   *  needs each checked name resolved back to Navidrome's internal id.
   *  `filters` narrows the map to what's reachable under another column's already-active
   *  filter (e.g. Album options when Genre is filtered) — Navidrome's /api/artist,
   *  /api/album, /api/genre accept the same artist_id/album_id/genre_id/year params as
   *  /api/song, so this reuses getTracksNativePage's filter-building convention instead of
   *  scanning only the currently-loaded page of tracks client-side. */
  private async nativeIdMap(
    endpoint: "artist" | "album" | "genre",
    filters?: { artistIds?: string[]; albumIds?: string[]; genreIds?: string[]; year?: string },
  ): Promise<Record<string, string>> {
    await this.authenticateNative();
    const params = new URLSearchParams({ _start: "0", _end: "100000", _sort: "name", _order: "ASC" });
    if (filters?.artistIds) for (const id of filters.artistIds) params.append("artist_id", id);
    if (filters?.albumIds) for (const id of filters.albumIds) params.append("album_id", id);
    if (filters?.genreIds) for (const id of filters.genreIds) params.append("genre_id", id);
    if (filters?.year) params.set("year", filters.year);
    this.applyNativeLibrary(params);
    const resp = await fetch(`${this.baseUrl}/api/${endpoint}?${params}`, {
      headers: { "x-nd-authorization": `Bearer ${this.nativeJwt}` },
    });
    const data = await resp.json();
    if (!Array.isArray(data)) return {};
    const out: Record<string, string> = {};
    for (const item of data) {
      if (item && typeof item.name === "string" && typeof item.id === "string") out[item.name] = item.id;
    }
    return out;
  }
  getArtistIdMap(filters?: { artistIds?: string[]; albumIds?: string[]; genreIds?: string[]; year?: string }): Promise<Record<string, string>> { return this.nativeIdMap("artist", filters); }
  getAlbumIdMap(filters?: { artistIds?: string[]; albumIds?: string[]; genreIds?: string[]; year?: string }): Promise<Record<string, string>> { return this.nativeIdMap("album", filters); }
  getGenreIdMap(filters?: { artistIds?: string[]; albumIds?: string[]; genreIds?: string[]; year?: string }): Promise<Record<string, string>> { return this.nativeIdMap("genre", filters); }

  /** For the "Get Info" dialog: no single endpoint has everything — the standard Subsonic
   *  `getSong` has extra audio fields, Navidrome's native `/api/song/{id}` has the real
   *  filesystem path, so both are fetched and merged (native wins on overlap when it has a
   *  non-empty value), matching the old app's TrackInfoDialog._fetch_full_data exactly. */
  async getTrackInfo(songId: string): Promise<TrackFullInfo> {
    const [subsonic, native] = await Promise.all([
      this.get("getSong", { id: songId }).then((r) => r.song ?? {}).catch(() => ({} as any)),
      this.getSongNative(songId).catch(() => ({} as any)),
    ]);
    const merged: any = { ...subsonic };
    for (const [k, v] of Object.entries(native)) {
      if (v !== null && v !== undefined && v !== "") merged[k] = v;
    }
    return {
      path: merged.path ?? null,
      album_artist: merged.albumArtist ?? null,
      is_compilation: !!(merged.isCompilation ?? merged.compilation ?? false),
      codec: merged.suffix ?? merged.codec ?? null,
      sample_rate: merged.samplingRate ?? null,
      bit_depth: merged.bitDepth ?? null,
      channel_count: merged.channelCount ?? null,
      size_bytes: merged.size ? Number(merged.size) : null,
    };
  }

  private async getSongNative(songId: string): Promise<any> {
    await this.authenticateNative();
    const resp = await fetch(`${this.baseUrl}/api/song/${songId}`, {
      headers: { "x-nd-authorization": `Bearer ${this.nativeJwt}` },
    });
    if (!resp.ok) return {};
    return resp.json();
  }

  async startScan(): Promise<void> {
    await this.get("startScan");
  }

  async search3(query: string, artistCount: number, albumCount: number, songCount: number): Promise<SearchResult> {
    const root = await this.get("search3", {
      query, artistCount: String(artistCount), albumCount: String(albumCount), songCount: String(songCount),
    });
    const r = root.searchResult3 ?? {};
    return {
      artists: asArray(r.artist).map(parseArtist),
      albums: asArray(r.album).map(parseAlbum),
      tracks: asArray(r.song).map((s) => this.parseTrack(s)),
    };
  }

  async getStarred(): Promise<Starred> {
    const root = await this.get("getStarred2");
    const s = root.starred2 ?? {};
    return {
      artists: asArray(s.artist).map(parseArtist),
      albums: asArray(s.album).map(parseAlbum),
      tracks: asArray(s.song).map((t) => this.parseTrack(t)),
    };
  }

  async getRandomSongs(count: number): Promise<Track[]> {
    const root = await this.get("getRandomSongs", { size: String(count) });
    return asArray(root.randomSongs?.song).map((s) => this.parseTrack(s));
  }

  async scrobble(trackId: string, submission: boolean): Promise<void> {
    await this.get("scrobble", { id: trackId, submission: submission ? "true" : "false" });
  }

  async setFavorite(itemId: string, active: boolean, idParam: string): Promise<void> {
    await this.get(active ? "star" : "unstar", { [idParam]: itemId });
  }

  /** Create a public share and return its URL. Requires sharing to be
   *  enabled server-side (Navidrome 0.63+ defaults EnableSharing to true).
   *
   *  Tries Navidrome's native POST /api/share first because the Subsonic
   *  createShare endpoint has no `downloadable` concept at all — the
   *  ShareDialog's "allow download" toggle only exists natively. Field names
   *  match Navidrome's model.Share JSON tags (resourceIds/resourceType/
   *  expiresAt/downloadable). Falls back to Subsonic createShare (which does
   *  honor `expires`, ms epoch, but ignores downloadable) for non-Navidrome
   *  servers. */
  async createShare(itemId: string, resourceType: "song" | "album" | "playlist", expiresDays: number | null, downloadable: boolean): Promise<string> {
    const expiresMs = expiresDays ? Date.now() + expiresDays * 86_400_000 : null;
    try {
      await this.authenticateNative();
      const body: Record<string, unknown> = { resourceIds: itemId, resourceType, downloadable };
      if (expiresMs) body.expiresAt = new Date(expiresMs).toISOString();
      const resp = await fetch(`${this.baseUrl}/api/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-nd-authorization": `Bearer ${this.nativeJwt}` },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.id) return `${this.baseUrl}/share/${data.id}`;
      }
    } catch { /* not Navidrome (or native auth failed) — fall through */ }
    const params: Record<string, string> = { id: itemId };
    if (expiresMs) params.expires = String(expiresMs);
    const root = await this.get("createShare", params);
    const url = asArray(root.shares?.share)[0]?.url;
    if (typeof url !== "string" || !url) throw new Error("Server did not return a share URL — is sharing enabled?");
    return url;
  }

  /** Server-side queue sync (upload/download icons in QueuePanel) — lets the
   *  queue + position be picked up from another device/session. `null` means
   *  no queue has ever been saved server-side (Subsonic omits `playQueue`
   *  entirely rather than returning an empty one). */
  async getPlayQueue(): Promise<PlayQueue | null> {
    const root = await this.get("getPlayQueue");
    const pq = root.playQueue;
    if (!pq) return null;
    const tracks = asArray(pq.entry).map((s: any) => this.parseTrack(s));
    const currentIndex = pq.current ? tracks.findIndex((t) => t.id === String(pq.current)) : -1;
    const positionMs = typeof pq.position === "number" ? pq.position : 0;
    return { tracks, currentIndex, positionSecs: positionMs / 1000 };
  }

  /** Real POST (repeated `id` params, one per queued track) — same reason as
   *  addTracksToPlaylist/reorderPlaylistTracks above: the flat-Record `get()`
   *  GET helper can't express repeated keys. */
  async savePlayQueue(trackIds: string[], currentTrackId: string | null, positionSecs: number): Promise<void> {
    const params = new URLSearchParams(this.authParams());
    for (const id of trackIds) params.append("id", id);
    if (currentTrackId) params.set("current", currentTrackId);
    params.set("position", String(Math.round(positionSecs * 1000)));
    const resp = await fetch(`${this.baseUrl}/rest/savePlayQueue`, { method: "POST", body: params });
    const body = await resp.json();
    const root = body?.["subsonic-response"];
    if (!root || root.status !== "ok") {
      throw new SubsonicApiError(root?.error?.code ?? 0, root?.error?.message ?? "savePlayQueue failed");
    }
  }

  // --- Parsers ---

  private parseTrack(s: any): Track {
    const id = strField(s, "id");
    const genres: any[] = Array.isArray(s.genres) ? s.genres : [];
    const genre = genres.length
      ? genres.map((g) => (typeof g === "object" ? g?.name : g)).filter(Boolean).join(" • ")
      : (s.genre ?? null);
    return {
      stream_url: this.streamUrl(id),
      cover_id: s.coverArt ?? null,
      id,
      title: strField(s, "title"),
      artist: strField(s, "artist"),
      artist_id: s.artistId ?? null,
      album: s.album ?? null,
      album_id: s.albumId ?? null,
      track_number: s.track ?? 0,
      disc_number: s.discNumber ?? 1,
      duration_secs: Math.floor(s.duration ?? 0),
      starred: s.starred !== undefined,
      genre,
      year: s.year ?? null,
      play_count: s.playCount ?? 0,
      bitrate: s.bitRate ?? null,
      bpm: s.bpm ?? null,
      created: s.created ?? null,
      format: s.suffix ? String(s.suffix).toUpperCase() : null,
    };
  }

  // Navidrome's native /api/song shape differs from the standard Subsonic song
  // element: genres is an array of {name} objects (or absent), the timestamp
  // field is createdAt (not created), and cover art id is coverArtId.
  private parseNativeTrack(s: any): Track {
    const id = strField(s, "id");
    const genres: any[] = Array.isArray(s.genres) ? s.genres : [];
    const genre = genres.length
      ? genres.map((g) => (typeof g === "object" ? g?.name : g)).filter(Boolean).join(" • ")
      : (s.genre ?? null);
    return {
      stream_url: this.streamUrl(id),
      // Navidrome's native /api/song response doesn't reliably include a cover
      // art reference — fall back to the song's own id, which Navidrome's
      // getCoverArt endpoint also accepts and resolves to that track's
      // embedded/album art (same fix the old Python app and Feishin both use).
      cover_id: s.coverArtId ?? s.coverArt ?? id ?? null,
      id,
      title: strField(s, "title"),
      artist: strField(s, "artist"),
      artist_id: s.artistId ?? null,
      album: s.album ?? null,
      album_id: s.albumId ?? null,
      track_number: s.trackNumber ?? s.track ?? 0,
      disc_number: s.discNumber ?? 1,
      duration_secs: Math.floor(s.duration ?? 0),
      starred: !!s.starred,
      genre,
      year: s.year ?? null,
      play_count: s.playCount ?? 0,
      bitrate: s.bitRate ?? null,
      bpm: s.bpm ?? null,
      created: s.createdAt ?? s.created ?? null,
      format: s.suffix ? String(s.suffix).toUpperCase() : null,
    };
  }
}

function parseArtist(a: any): Artist {
  return {
    id: strField(a, "id"),
    name: strField(a, "name"),
    album_count: a.albumCount ?? 0,
    song_count: a.songCount ?? 0,
    cover_id: a.coverArt ?? null,
    starred: a.starred !== undefined,
    play_count: a.playCount ?? 0,
  };
}

function parseNativeArtist(a: any): Artist {
  const id = strField(a, "id");
  const stats = a.stats ?? {};
  const songCount = Math.max(
    stats.albumartist?.songCount ?? 0,
    stats.artist?.songCount ?? 0,
    a.songCount ?? 0,
  );
  return {
    id,
    name: strField(a, "name"),
    album_count: a.albumCount ?? 0,
    song_count: songCount,
    cover_id: a.coverArtId ?? a.coverArt ?? id,
    starred: !!(a.starredAt || a.starred),
    play_count: a.playCount ?? 0,
  };
}

function parseAlbum(a: any): Album {
  return {
    id: strField(a, "id"),
    name: strField(a, "name"),
    artist: strField(a, "artist"),
    artist_id: a.artistId ?? null,
    year: a.year ?? null,
    cover_id: a.coverArt ?? null,
    song_count: a.songCount ?? 0,
    duration_secs: a.duration ?? 0,
    starred: a.starred !== undefined,
    genre: a.genre ?? null,
    release_types: a.releaseTypes ? asArray(a.releaseTypes).map(String) : null,
  };
}

function parseNativeAlbum(a: any): Album {
  const id = strField(a, "id");
  return {
    cover_id: a.coverArtId ?? a.coverArt ?? id,
    id,
    name: strField(a, "name"),
    artist: a.albumArtist ?? strField(a, "artist"),
    artist_id: a.albumArtistId ?? a.artistId ?? null,
    year: a.originalYear ?? a.year ?? null,
    song_count: a.songCount ?? 0,
    duration_secs: a.duration ?? (a.durationMs !== undefined ? Math.floor(a.durationMs / 1000) : 0),
    starred: !!a.starred,
    genre: a.genre ?? null,
    release_types: a.releaseTypes ? asArray(a.releaseTypes).map(String) : null,
  };
}

function parsePlaylist(p: any): Playlist {
  return {
    id: strField(p, "id"),
    name: strField(p, "name"),
    comment: p.comment ?? null,
    song_count: p.songCount ?? 0,
    duration_secs: p.duration ?? 0,
    cover_id: p.coverArt ?? null,
    public: !!p.public,
    owner: p.owner ?? null,
  };
}
