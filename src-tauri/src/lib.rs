use std::sync::Arc;
use tauri::{Manager, State};
use tokio::sync::Mutex;
use subsonic::{SubsonicClient, Artist, Album, Track, Playlist, SearchResult, ArtistDetail, ScanStatus};

fn percent_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut bytes = s.bytes();
    while let Some(b) = bytes.next() {
        if b == b'%' {
            let h1 = bytes.next().and_then(|c| (c as char).to_digit(16));
            let h2 = bytes.next().and_then(|c| (c as char).to_digit(16));
            if let (Some(h1), Some(h2)) = (h1, h2) {
                out.push((((h1 << 4) | h2) as u8) as char);
            }
        } else {
            out.push(b as char);
        }
    }
    out
}

pub struct AppState {
    pub client: Mutex<Option<Arc<SubsonicClient>>>,
}

fn no_client() -> String {
    "not connected".into()
}

// --- Connection ---

#[tauri::command]
async fn connect(
    url: String,
    username: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let client = SubsonicClient::new(&url, &username, &password);
    client.ping().await.map_err(|e| e.to_string())?;
    *state.client.lock().await = Some(Arc::new(client));
    Ok(true)
}

#[tauri::command]
async fn ping(state: State<'_, AppState>) -> Result<bool, String> {
    get_client(&state).await?.ping().await.map_err(|e| e.to_string())
}

// --- Artists ---

#[tauri::command]
async fn get_artists(state: State<'_, AppState>) -> Result<Vec<Artist>, String> {
    get_client(&state).await?.get_artists().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_all_artists(state: State<'_, AppState>) -> Result<Vec<Artist>, String> {
    get_client(&state).await?.get_all_artists().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_artist(id: String, state: State<'_, AppState>) -> Result<ArtistDetail, String> {
    get_client(&state).await?.get_artist(&id).await.map_err(|e| e.to_string())
}

// --- Albums ---

#[tauri::command]
async fn get_album_list(
    sort_type: String,
    size: u32,
    offset: u32,
    state: State<'_, AppState>,
) -> Result<Vec<Album>, String> {
    get_client(&state).await?.get_album_list(&sort_type, size, offset).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_all_albums(sort_type: String, state: State<'_, AppState>) -> Result<Vec<Album>, String> {
    get_client(&state).await?.get_all_albums(&sort_type).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_album_tracks(id: String, state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    get_client(&state).await?.get_album_tracks(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_compilations(state: State<'_, AppState>) -> Result<Vec<Album>, String> {
    get_client(&state).await?.get_compilations().await.map_err(|e| e.to_string())
}

// --- Tracks ---

#[tauri::command]
async fn get_random_songs(count: u32, state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    get_client(&state).await?.get_random_songs(count).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_tracks(size: u32, offset: u32, state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    get_client(&state).await?.get_tracks(size, offset).await.map_err(|e| e.to_string())
}

// --- Playlists ---

#[tauri::command]
async fn get_playlists(state: State<'_, AppState>) -> Result<Vec<Playlist>, String> {
    get_client(&state).await?.get_playlists().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_playlist_tracks(id: String, state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    get_client(&state).await?.get_playlist_tracks(&id).await.map_err(|e| e.to_string())
}

// --- Search ---

#[tauri::command]
async fn search(
    query: String,
    artist_count: u32,
    album_count: u32,
    song_count: u32,
    state: State<'_, AppState>,
) -> Result<SearchResult, String> {
    get_client(&state).await?.search3(&query, artist_count, album_count, song_count).await.map_err(|e| e.to_string())
}

// --- Starred ---

#[tauri::command]
async fn get_starred(state: State<'_, AppState>) -> Result<subsonic::Starred, String> {
    get_client(&state).await?.get_starred().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_favorite(item_id: String, active: bool, id_param: String, state: State<'_, AppState>) -> Result<(), String> {
    get_client(&state).await?.set_favorite(&item_id, active, &id_param).await.map_err(|e| e.to_string())
}

// --- Scrobble ---

#[tauri::command]
async fn scrobble(track_id: String, submission: bool, state: State<'_, AppState>) -> Result<(), String> {
    get_client(&state).await?.scrobble(&track_id, submission).await.map_err(|e| e.to_string())
}

// --- Cover art / stream URLs (sync — just URL construction) ---

#[tauri::command]
async fn cover_art_url(cover_id: String, size: Option<u32>, state: State<'_, AppState>) -> Result<String, String> {
    Ok(get_client(&state).await?.cover_art_url(&cover_id, size))
}

#[tauri::command]
async fn stream_url(song_id: String, state: State<'_, AppState>) -> Result<String, String> {
    Ok(get_client(&state).await?.stream_url(&song_id))
}

// --- Scan ---

#[tauri::command]
async fn get_scan_status(state: State<'_, AppState>) -> Result<ScanStatus, String> {
    get_client(&state).await?.get_scan_status().await.map_err(|e| e.to_string())
}

// --- Helper ---

async fn get_client(state: &State<'_, AppState>) -> Result<Arc<SubsonicClient>, String> {
    state.client.lock().await.clone().ok_or_else(no_client)
}

// --- App entry ---

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(AppState { client: Mutex::new(None) })
        .register_asynchronous_uri_scheme_protocol("cover", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let uri = request.uri();
                let cover_id = percent_decode(uri.path().trim_start_matches('/'));
                let size: Option<u32> = uri.query()
                    .unwrap_or("")
                    .split('&')
                    .find(|s| s.starts_with("size="))
                    .and_then(|s| s[5..].parse().ok());

                // Build cache path
                let cache_dir = app.path().cache_dir()
                    .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"))
                    .join("icosahedron")
                    .join("covers");
                let _ = tokio::fs::create_dir_all(&cache_dir).await;
                let safe_id: String = cover_id.chars()
                    .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' })
                    .collect();
                let cache_file = cache_dir.join(format!("{}_{}", safe_id, size.unwrap_or(200)));

                // Serve from disk cache if available
                if let Ok(bytes) = tokio::fs::read(&cache_file).await {
                    responder.respond(
                        tauri::http::Response::builder()
                            .header("Content-Type", "image/jpeg")
                            .header("Cache-Control", "max-age=604800")
                            .body(bytes)
                            .unwrap(),
                    );
                    return;
                }

                // Fetch from server
                let client: Option<Arc<SubsonicClient>> =
                    app.state::<AppState>().client.lock().await.clone();
                match client {
                    Some(c) => match c.fetch_cover_art(&cover_id, size).await {
                        Ok((bytes, content_type)) => {
                            let _ = tokio::fs::write(&cache_file, &bytes).await;
                            responder.respond(
                                tauri::http::Response::builder()
                                    .header("Content-Type", content_type)
                                    .header("Cache-Control", "max-age=604800")
                                    .body(bytes)
                                    .unwrap(),
                            );
                        }
                        Err(_) => {
                            responder.respond(
                                tauri::http::Response::builder().status(404).body(vec![]).unwrap(),
                            );
                        }
                    },
                    None => {
                        responder.respond(
                            tauri::http::Response::builder().status(503).body(vec![]).unwrap(),
                        );
                    }
                }
            });
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            ping,
            get_artists,
            get_all_artists,
            get_artist,
            get_album_list,
            get_all_albums,
            get_album_tracks,
            get_compilations,
            get_random_songs,
            get_tracks,
            get_playlists,
            get_playlist_tracks,
            search,
            get_starred,
            set_favorite,
            scrobble,
            cover_art_url,
            stream_url,
            get_scan_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
