import { createHash } from "node:crypto";
import type {
  Artist, Album, Track, Playlist, ArtistDetail, SearchResult, Starred, ScanStatus, TrackFullInfo,
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

export class SubsonicClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private nativeJwt: string | null = null;
  private nativeJwtPromise: Promise<void> | null = null;

  constructor(baseUrl: string, username: string, password: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.username = username;
    this.password = password;
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
    const bytes = Buffer.from(await resp.arrayBuffer());
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

  async createPlaylist(name: string): Promise<Playlist> {
    const root = await this.get("createPlaylist", { name });
    if (!root.playlist) throw new Error("missing playlist in createPlaylist response");
    return parsePlaylist(root.playlist);
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
      `${this.baseUrl}/api/artist?${new URLSearchParams({
        _start: "0", _end: "100000", _sort: nativeSort, _order: "ASC",
      })}`,
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
      `${this.baseUrl}/api/album?${new URLSearchParams({
        _start: "0", _end: "100000", _sort: "name", _order: "ASC", compilation: "true",
      })}`,
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

  /** Standard Subsonic getLyrics — tried first (old app's LyricsPanel source
   *  priority: server, then LRCLib/NetEase/SimpMusic) since Navidrome/Subsonic
   *  servers can surface embedded or provider-configured lyrics directly. */
  async getServerLyrics(artist: string, title: string): Promise<string | null> {
    const root = await this.get("getLyrics", { artist, title }).catch(() => null);
    const value = root?.lyrics?.value;
    return typeof value === "string" && value ? value : null;
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
   *  unlike the standard Subsonic API which has no arbitrary-sort-field pagination for a flat track list. */
  async getTracksNativePage(
    sortBy: string, order: "ASC" | "DESC", start: number, end: number, query?: string,
  ): Promise<{ tracks: Track[]; total: number }> {
    await this.authenticateNative();
    const params: Record<string, string> = { _start: String(start), _end: String(end), _sort: sortBy, _order: order };
    if (query) params.title = query;
    const resp = await fetch(`${this.baseUrl}/api/song?${new URLSearchParams(params)}`, {
      headers: { "x-nd-authorization": `Bearer ${this.nativeJwt}` },
    });
    const data = await resp.json();
    if (!Array.isArray(data)) throw new Error("expected array");
    const total = Number(resp.headers.get("x-total-count") ?? data.length);
    return { tracks: data.map((s) => this.parseNativeTrack(s)), total };
  }

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

  // --- Parsers ---

  private parseTrack(s: any): Track {
    const id = strField(s, "id");
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
      genre: s.genre ?? null,
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
  };
}
