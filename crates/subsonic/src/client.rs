use std::collections::HashMap;
use rand::Rng;
use serde_json::Value;
use tokio::sync::Mutex;

use crate::error::SubsonicError;
use crate::models::*;

const API_VERSION: &str = "1.16.1";
const CLIENT_NAME: &str = "Icoshahedron";

pub struct SubsonicClient {
    base_url: String,
    username: String,
    password: String,
    http: reqwest::Client,
    native_jwt: Mutex<Option<String>>,
}

impl SubsonicClient {
    pub fn new(base_url: impl Into<String>, username: impl Into<String>, password: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            username: username.into(),
            password: password.into(),
            http: reqwest::Client::new(),
            native_jwt: Mutex::new(None),
        }
    }

    // --- Auth ---

    fn auth_params(&self) -> HashMap<String, String> {
        let salt: String = rand::rng()
            .sample_iter(&rand::distr::Alphanumeric)
            .take(8)
            .map(char::from)
            .collect();
        let token = format!("{:x}", md5::compute(format!("{}{}", self.password, salt)));
        HashMap::from([
            ("u".into(), self.username.clone()),
            ("t".into(), token),
            ("s".into(), salt),
            ("v".into(), API_VERSION.into()),
            ("c".into(), CLIENT_NAME.into()),
            ("f".into(), "json".into()),
        ])
    }

    pub fn stream_url(&self, song_id: &str) -> String {
        let mut params = self.auth_params();
        params.insert("id".into(), song_id.to_owned());
        let qs = params.iter().map(|(k, v)| format!("{}={}", k, v)).collect::<Vec<_>>().join("&");
        format!("{}/rest/stream?{}", self.base_url, qs)
    }

    pub async fn fetch_cover_art(&self, cover_id: &str, size: Option<u32>) -> Result<(Vec<u8>, String), SubsonicError> {
        let url = self.cover_art_url(cover_id, size);
        let resp = self.http.get(&url).send().await?;
        let content_type = resp.headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("image/jpeg")
            .to_owned();
        let bytes = resp.bytes().await?.to_vec();
        Ok((bytes, content_type))
    }

    pub fn cover_art_url(&self, cover_id: &str, size: Option<u32>) -> String {
        let mut params = self.auth_params();
        params.remove("f"); // image endpoint, no json flag
        params.insert("id".into(), cover_id.to_owned());
        if let Some(s) = size {
            params.insert("size".into(), s.to_string());
        }
        let qs = params.iter().map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v))).collect::<Vec<_>>().join("&");
        format!("{}/rest/getCoverArt?{}", self.base_url, qs)
    }

    // --- Low-level request ---

    async fn get(&self, endpoint: &str, extra: &[(&str, &str)]) -> Result<Value, SubsonicError> {
        let mut params = self.auth_params();
        for (k, v) in extra {
            params.insert((*k).into(), (*v).into());
        }
        let resp = self.http
            .get(format!("{}/rest/{}", self.base_url, endpoint))
            .query(&params.iter().collect::<Vec<_>>())
            .send()
            .await?
            .json::<Value>()
            .await?;

        let root = resp.get("subsonic-response")
            .ok_or_else(|| SubsonicError::Parse("missing subsonic-response".into()))?;

        if root.get("status").and_then(|s| s.as_str()) != Some("ok") {
            let err = root.get("error").unwrap_or(&Value::Null);
            let code = err.get("code").and_then(|c| c.as_u64()).unwrap_or(0) as u32;
            let message = err.get("message").and_then(|m| m.as_str()).unwrap_or("unknown").to_owned();
            return Err(SubsonicError::Api { code, message });
        }

        Ok(root.clone())
    }

    // --- Navidrome native auth (JWT) ---

    pub async fn authenticate_native(&self) -> Result<(), SubsonicError> {
        let mut guard = self.native_jwt.lock().await;
        if guard.is_some() {
            return Ok(());
        }
        let resp = self.http
            .post(format!("{}/auth/login", self.base_url))
            .json(&serde_json::json!({ "username": self.username, "password": self.password }))
            .send()
            .await?;
        if resp.status().is_success() {
            let body: Value = resp.json().await?;
            let token = body.get("token")
                .and_then(|t| t.as_str())
                .ok_or_else(|| SubsonicError::Auth("no token in response".into()))?
                .to_owned();
            *guard = Some(token);
            Ok(())
        } else {
            Err(SubsonicError::Auth(format!("HTTP {}", resp.status())))
        }
    }

    // --- API methods ---

    pub async fn ping(&self) -> Result<bool, SubsonicError> {
        self.get("ping", &[]).await.map(|_| true)
    }

    pub async fn get_scan_status(&self) -> Result<ScanStatus, SubsonicError> {
        let root = self.get("getScanStatus", &[]).await?;
        let s = root.get("scanStatus")
            .ok_or_else(|| SubsonicError::Parse("missing scanStatus".into()))?;
        Ok(ScanStatus {
            scanning: s.get("scanning").and_then(|v| v.as_bool()).unwrap_or(false),
            count: s.get("count").and_then(|v| v.as_u64()).unwrap_or(0),
            folder_count: s.get("folderCount").and_then(|v| v.as_u64()),
            last_scan: s.get("lastScan").and_then(|v| v.as_str()).map(str::to_owned),
        })
    }

    pub async fn get_playlists(&self) -> Result<Vec<Playlist>, SubsonicError> {
        let root = self.get("getPlaylists", &[]).await?;
        let items = root
            .pointer("/playlists/playlist")
            .and_then(|v| if v.is_array() { Some(v.as_array().unwrap().clone()) } else { Some(vec![v.clone()]) })
            .unwrap_or_default();
        Ok(items.iter().map(parse_playlist).collect())
    }

    pub async fn get_playlist_tracks(&self, playlist_id: &str) -> Result<Vec<Track>, SubsonicError> {
        let root = self.get("getPlaylist", &[("id", playlist_id)]).await?;
        let entries = root
            .pointer("/playlist/entry")
            .and_then(|v| if v.is_array() { Some(v.as_array().unwrap().clone()) } else { Some(vec![v.clone()]) })
            .unwrap_or_default();
        Ok(entries.iter().map(|s| self.parse_track(s)).collect())
    }

    pub async fn get_all_artists(&self) -> Result<Vec<Artist>, SubsonicError> {
        let root = self.get("search3", &[
            ("query", ""),
            ("artistCount", "100000"),
            ("albumCount", "0"),
            ("songCount", "0"),
        ]).await?;
        let artists = root
            .pointer("/searchResult3/artist")
            .and_then(|v| if v.is_array() { v.as_array().cloned() } else { Some(vec![v.clone()]) })
            .unwrap_or_default();
        Ok(artists.iter().map(parse_artist).collect())
    }

    pub async fn get_all_albums(&self, sort_type: &str) -> Result<Vec<Album>, SubsonicError> {
        let mut all = Vec::new();
        let mut offset = 0u32;
        const SIZE: u32 = 500;
        loop {
            let batch = self.get_album_list(sort_type, SIZE, offset).await?;
            let done = batch.len() < SIZE as usize;
            all.extend(batch);
            if done { break; }
            offset += SIZE;
        }
        Ok(all)
    }

    pub async fn get_compilations(&self) -> Result<Vec<Album>, SubsonicError> {
        self.authenticate_native().await?;
        let jwt = {
            let guard = self.native_jwt.lock().await;
            guard.clone().ok_or_else(|| SubsonicError::Auth("no JWT".into()))?
        };
        let resp = self.http
            .get(format!("{}/api/album", self.base_url))
            .header("x-nd-authorization", format!("Bearer {}", jwt))
            .query(&[("_start", "0"), ("_end", "100000"), ("_sort", "name"), ("_order", "ASC"), ("compilation", "true")])
            .send()
            .await?;
        let data: Value = resp.json().await?;
        let albums = data.as_array().ok_or_else(|| SubsonicError::Parse("expected array".into()))?;
        Ok(albums.iter().map(parse_native_album).collect())
    }

    pub async fn get_artists(&self) -> Result<Vec<Artist>, SubsonicError> {
        let root = self.get("getArtists", &[]).await?;
        let mut out = Vec::new();
        if let Some(indices) = root.pointer("/artists/index").and_then(|v| v.as_array()) {
            for idx in indices {
                let artists = idx.get("artist")
                    .and_then(|a| if a.is_array() { a.as_array().cloned() } else { Some(vec![a.clone()]) })
                    .unwrap_or_default();
                for a in &artists {
                    out.push(parse_artist(a));
                }
            }
        }
        Ok(out)
    }

    pub async fn get_artist(&self, artist_id: &str) -> Result<ArtistDetail, SubsonicError> {
        let root = self.get("getArtist", &[("id", artist_id)]).await?;
        let a = root.get("artist")
            .ok_or_else(|| SubsonicError::Parse("missing artist".into()))?;
        let albums = a.get("album")
            .and_then(|v| if v.is_array() { v.as_array().cloned() } else { Some(vec![v.clone()]) })
            .unwrap_or_default()
            .iter()
            .map(parse_album)
            .collect();

        // fetch info2 for biography/similar in parallel
        let info = self.get("getArtistInfo2", &[("id", artist_id)]).await.ok();
        let bio = info.as_ref().and_then(|r| r.pointer("/artistInfo2/biography")).and_then(|v| v.as_str()).map(str::to_owned);
        let mbid = info.as_ref().and_then(|r| r.pointer("/artistInfo2/musicBrainzId")).and_then(|v| v.as_str()).map(str::to_owned);
        let lfm = info.as_ref().and_then(|r| r.pointer("/artistInfo2/lastFmUrl")).and_then(|v| v.as_str()).map(str::to_owned);
        let similar = info.as_ref()
            .and_then(|r| r.pointer("/artistInfo2/similarArtist"))
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().map(parse_artist).collect())
            .unwrap_or_default();

        Ok(ArtistDetail {
            artist: parse_artist(a),
            albums,
            biography: bio,
            music_brainz_id: mbid,
            last_fm_url: lfm,
            similar_artists: similar,
        })
    }

    pub async fn get_album_tracks(&self, album_id: &str) -> Result<Vec<Track>, SubsonicError> {
        let root = self.get("getAlbum", &[("id", album_id)]).await?;
        let entries = root
            .pointer("/album/song")
            .and_then(|v| if v.is_array() { v.as_array().cloned() } else { Some(vec![v.clone()]) })
            .unwrap_or_default();
        Ok(entries.iter().map(|s| self.parse_track(s)).collect())
    }

    pub async fn get_album_list(&self, sort_type: &str, size: u32, offset: u32) -> Result<Vec<Album>, SubsonicError> {
        let size_s = size.to_string();
        let offset_s = offset.to_string();
        let root = self.get("getAlbumList2", &[
            ("type", sort_type),
            ("size", &size_s),
            ("offset", &offset_s),
        ]).await?;
        let items = root
            .pointer("/albumList2/album")
            .and_then(|v| if v.is_array() { v.as_array().cloned() } else { Some(vec![v.clone()]) })
            .unwrap_or_default();
        Ok(items.iter().map(parse_album).collect())
    }

    pub async fn get_tracks(&self, size: u32, offset: u32) -> Result<Vec<Track>, SubsonicError> {
        let size_s = size.to_string();
        let offset_s = offset.to_string();
        let root = self.get("search3", &[
            ("query", ""),
            ("artistCount", "0"),
            ("albumCount", "0"),
            ("songCount", &size_s),
            ("songOffset", &offset_s),
        ]).await?;
        let entries = root
            .pointer("/searchResult3/song")
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default();
        Ok(entries.iter().map(|s| self.parse_track(s)).collect())
    }

    pub async fn search3(&self, query: &str, artist_count: u32, album_count: u32, song_count: u32) -> Result<SearchResult, SubsonicError> {
        let ac = artist_count.to_string();
        let alc = album_count.to_string();
        let sc = song_count.to_string();
        let root = self.get("search3", &[
            ("query", query),
            ("artistCount", &ac),
            ("albumCount", &alc),
            ("songCount", &sc),
        ]).await?;
        let r = root.get("searchResult3").unwrap_or(&Value::Null);
        Ok(SearchResult {
            artists: r.get("artist").and_then(|v| v.as_array()).map(|a| a.iter().map(parse_artist).collect()).unwrap_or_default(),
            albums:  r.get("album").and_then(|v| v.as_array()).map(|a| a.iter().map(parse_album).collect()).unwrap_or_default(),
            tracks:  r.get("song").and_then(|v| v.as_array()).map(|a| a.iter().map(|s| self.parse_track(s)).collect()).unwrap_or_default(),
        })
    }

    pub async fn get_starred(&self) -> Result<Starred, SubsonicError> {
        let root = self.get("getStarred2", &[]).await?;
        let s = root.get("starred2").unwrap_or(&Value::Null);
        Ok(Starred {
            artists: s.get("artist").and_then(|v| v.as_array()).map(|a| a.iter().map(parse_artist).collect()).unwrap_or_default(),
            albums:  s.get("album").and_then(|v| v.as_array()).map(|a| a.iter().map(parse_album).collect()).unwrap_or_default(),
            tracks:  s.get("song").and_then(|v| v.as_array()).map(|a| a.iter().map(|s| self.parse_track(s)).collect()).unwrap_or_default(),
        })
    }

    pub async fn get_random_songs(&self, count: u32) -> Result<Vec<Track>, SubsonicError> {
        let count_s = count.to_string();
        let root = self.get("getRandomSongs", &[("size", &count_s)]).await?;
        let entries = root
            .pointer("/randomSongs/song")
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default();
        Ok(entries.iter().map(|s| self.parse_track(s)).collect())
    }

    pub async fn scrobble(&self, track_id: &str, submission: bool) -> Result<(), SubsonicError> {
        let sub = if submission { "true" } else { "false" };
        self.get("scrobble", &[("id", track_id), ("submission", sub)]).await?;
        Ok(())
    }

    pub async fn set_favorite(&self, item_id: &str, active: bool, id_param: &str) -> Result<(), SubsonicError> {
        let endpoint = if active { "star" } else { "unstar" };
        self.get(endpoint, &[(id_param, item_id)]).await?;
        Ok(())
    }

    pub async fn get_lyrics(&self, artist: &str, title: &str) -> Result<Option<String>, SubsonicError> {
        let root = self.get("getLyrics", &[("artist", artist), ("title", title)]).await?;
        Ok(root.pointer("/lyrics/#text").and_then(|v| v.as_str()).map(str::to_owned))
    }

    pub async fn get_top_songs(&self, artist_name: &str, count: u32) -> Result<Vec<Track>, SubsonicError> {
        let count_s = count.to_string();
        let root = self.get("getTopSongs", &[("artist", artist_name), ("count", &count_s)]).await?;
        let entries = root
            .pointer("/topSongs/song")
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default();
        Ok(entries.iter().map(|s| self.parse_track(s)).collect())
    }

    pub async fn get_similar_songs(&self, artist_id: &str, count: u32) -> Result<Vec<Track>, SubsonicError> {
        let count_s = count.to_string();
        let root = self.get("getSimilarSongs2", &[("id", artist_id), ("count", &count_s)]).await?;
        let entries = root
            .pointer("/similarSongs2/song")
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default();
        Ok(entries.iter().map(|s| self.parse_track(s)).collect())
    }

    pub async fn start_scan(&self) -> Result<(), SubsonicError> {
        self.get("startScan", &[]).await?;
        Ok(())
    }

    pub async fn create_playlist(&self, name: &str) -> Result<String, SubsonicError> {
        let root = self.get("createPlaylist", &[("name", name)]).await?;
        root.pointer("/playlist/id")
            .and_then(|v| v.as_str())
            .map(str::to_owned)
            .ok_or_else(|| SubsonicError::Parse("missing playlist id".into()))
    }

    pub async fn delete_playlist(&self, playlist_id: &str) -> Result<(), SubsonicError> {
        self.get("deletePlaylist", &[("id", playlist_id)]).await?;
        Ok(())
    }

    pub async fn update_playlist(&self, playlist_id: &str, song_ids_to_add: &[String], indices_to_remove: &[u32]) -> Result<(), SubsonicError> {
        let mut params: Vec<(&str, String)> = vec![("playlistId", playlist_id.to_owned())];
        for id in song_ids_to_add {
            params.push(("songIdToAdd", id.clone()));
        }
        for idx in indices_to_remove {
            params.push(("songIndexToRemove", idx.to_string()));
        }
        // build query manually since we have repeated keys
        let auth = self.auth_params();
        let mut all: Vec<(String, String)> = auth.into_iter().collect();
        for (k, v) in params {
            all.push((k.to_owned(), v));
        }
        self.http
            .get(format!("{}/rest/updatePlaylist", self.base_url))
            .query(&all)
            .send()
            .await?;
        Ok(())
    }

    // --- Parsers ---

    fn parse_track(&self, s: &Value) -> Track {
        let id = str_field(s, "id");
        Track {
            stream_url: self.stream_url(&id),
            cover_id: s.get("coverArt").and_then(|v| v.as_str()).map(str::to_owned),
            id,
            title: str_field(s, "title"),
            artist: str_field(s, "artist"),
            artist_id: s.get("artistId").and_then(|v| v.as_str()).map(str::to_owned),
            album: s.get("album").and_then(|v| v.as_str()).map(str::to_owned),
            album_id: s.get("albumId").and_then(|v| v.as_str()).map(str::to_owned),
            track_number: s.get("track").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            disc_number: s.get("discNumber").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
            duration_secs: s.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0) as u32,
            starred: s.get("starred").is_some(),
            genre: s.get("genre").and_then(|v| v.as_str()).map(str::to_owned),
            year: s.get("year").and_then(|v| v.as_u64()).map(|y| y as u32),
            play_count: s.get("playCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            bitrate: s.get("bitRate").and_then(|v| v.as_u64()).map(|b| b as u32),
        }
    }
}

fn parse_artist(a: &Value) -> Artist {
    Artist {
        id: str_field(a, "id"),
        name: str_field(a, "name"),
        album_count: a.get("albumCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        cover_id: a.get("coverArt").and_then(|v| v.as_str()).map(str::to_owned),
        starred: a.get("starred").is_some(),
    }
}

fn parse_album(a: &Value) -> Album {
    Album {
        id: str_field(a, "id"),
        name: str_field(a, "name"),
        artist: str_field(a, "artist"),
        artist_id: a.get("artistId").and_then(|v| v.as_str()).map(str::to_owned),
        year: a.get("year").and_then(|v| v.as_u64()).map(|y| y as u32),
        cover_id: a.get("coverArt").and_then(|v| v.as_str()).map(str::to_owned),
        song_count: a.get("songCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        duration_secs: a.get("duration").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        starred: a.get("starred").is_some(),
        genre: a.get("genre").and_then(|v| v.as_str()).map(str::to_owned),
    }
}

fn parse_native_album(a: &Value) -> Album {
    let id = str_field(a, "id");
    Album {
        cover_id: a.get("coverArtId").and_then(|v| v.as_str()).map(str::to_owned)
            .or_else(|| a.get("coverArt").and_then(|v| v.as_str()).map(str::to_owned))
            .or_else(|| Some(id.clone())),
        id,
        name: str_field(a, "name"),
        artist: a.get("albumArtist").and_then(|v| v.as_str()).map(str::to_owned)
            .unwrap_or_else(|| str_field(a, "artist")),
        artist_id: a.get("albumArtistId").and_then(|v| v.as_str()).map(str::to_owned)
            .or_else(|| a.get("artistId").and_then(|v| v.as_str()).map(str::to_owned)),
        year: a.get("originalYear").and_then(|v| v.as_u64())
            .or_else(|| a.get("year").and_then(|v| v.as_u64()))
            .map(|y| y as u32),
        song_count: a.get("songCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        duration_secs: a.get("duration").and_then(|v| v.as_u64())
            .or_else(|| a.get("durationMs").and_then(|v| v.as_u64()).map(|ms| ms / 1000))
            .unwrap_or(0) as u32,
        starred: a.get("starred").and_then(|v| v.as_bool()).unwrap_or(false),
        genre: a.get("genre").and_then(|v| v.as_str()).map(str::to_owned),
    }
}

fn parse_playlist(p: &Value) -> Playlist {
    Playlist {
        id: str_field(p, "id"),
        name: str_field(p, "name"),
        comment: p.get("comment").and_then(|v| v.as_str()).map(str::to_owned),
        song_count: p.get("songCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        duration_secs: p.get("duration").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        cover_id: p.get("coverArt").and_then(|v| v.as_str()).map(str::to_owned),
        public: p.get("public").and_then(|v| v.as_bool()).unwrap_or(false),
    }
}

fn str_field(v: &Value, key: &str) -> String {
    v.get(key).and_then(|f| f.as_str()).unwrap_or("").to_owned()
}
