// cargo run --example ping -- <url> <user> <password>
use subsonic::SubsonicClient;

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("Usage: ping <url> <user> <password>");
        std::process::exit(1);
    }
    let client = SubsonicClient::new(&args[1], &args[2], &args[3]);

    print!("ping ... ");
    match client.ping().await {
        Ok(_) => println!("OK"),
        Err(e) => { println!("FAIL: {e}"); std::process::exit(1); }
    }

    print!("get_artists ... ");
    match client.get_artists().await {
        Ok(artists) => println!("OK — {} artists", artists.len()),
        Err(e) => println!("FAIL: {e}"),
    }

    print!("get_album_list (newest, 5) ... ");
    match client.get_album_list("newest", 5, 0).await {
        Ok(albums) => {
            println!("OK — {} albums", albums.len());
            for a in &albums {
                println!("  {} — {} ({})", a.name, a.artist, a.year.unwrap_or(0));
            }
        }
        Err(e) => println!("FAIL: {e}"),
    }

    print!("get_random_songs (3) ... ");
    match client.get_random_songs(3).await {
        Ok(tracks) => {
            println!("OK — {} tracks", tracks.len());
            for t in &tracks {
                println!("  {} — {} [{} s]", t.title, t.artist, t.duration_secs);
            }
        }
        Err(e) => println!("FAIL: {e}"),
    }

    print!("search3 ('') ... ");
    match client.search3("", 3, 3, 3).await {
        Ok(r) => println!("OK — {} artists, {} albums, {} tracks", r.artists.len(), r.albums.len(), r.tracks.len()),
        Err(e) => println!("FAIL: {e}"),
    }
}
