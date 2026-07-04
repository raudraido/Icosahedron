import { createHash } from "node:crypto";
import type {
  Artist, Album, Track, Playlist, ArtistDetail, SearchResult, Starred, ScanStatus,
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

  async fetchCoverArt(coverId: string, size?: number): Promise<{ bytes: Buffer; contentType: string }> {
    const url = this.coverArtUrl(coverId, size);
    const resp = await fetch(url);
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

  async getAllArtists(): Promise<Artist[]> {
    const root = await this.get("search3", { query: "", artistCount: "100000", albumCount: "0", songCount: "0" });
    return asArray(root.searchResult3?.artist).map(parseArtist);
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
    };
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
      duration_secs: s.duration ?? 0,
      starred: s.starred !== undefined,
      genre: s.genre ?? null,
      year: s.year ?? null,
      play_count: s.playCount ?? 0,
      bitrate: s.bitRate ?? null,
      bpm: s.bpm ?? null,
      created: s.created ?? null,
    };
  }
}

function parseArtist(a: any): Artist {
  return {
    id: strField(a, "id"),
    name: strField(a, "name"),
    album_count: a.albumCount ?? 0,
    cover_id: a.coverArt ?? null,
    starred: a.starred !== undefined,
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
