@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Card
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import cloud.icosahedron.tv.data.Album
import cloud.icosahedron.tv.data.Artist
import cloud.icosahedron.tv.data.Track
import cloud.icosahedron.tv.player.Playback
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun HomeScreen(go: (Screen) -> Unit) {
    val client = LocalClient.current
    val scope = rememberCoroutineScope()
    val rows = listOf("Recently played" to "recent", "Newest" to "newest", "Most played" to "frequent", "Random" to "random")
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Row(Modifier.padding(horizontal = 48.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ActionButton("Shuffle all songs", onClick = {
                    scope.launch { runCatching { client.randomSongs(100) }.getOrNull()?.let { Playback.playTracks(it, 0) } }
                })
                ActionButton("Favourites", onClick = {
                    scope.launch { runCatching { client.starred() }.getOrNull()?.shuffled()?.let { Playback.playTracks(it, 0) } }
                })
            }
        }
        rows.forEach { (title, type) ->
            item(key = type) {
                val result by load(type) { client.albums(type, 24) }
                SectionTitle(title)
                val r = result
                when {
                    r == null -> Message("Loading…")
                    r.isFailure -> Message(r.exceptionOrNull()?.message ?: "Could not load")
                    else -> LazyRow(contentPadding = PaddingValues(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        items(r.getOrThrow().size) { i ->
                            val a = r.getOrThrow()[i]
                            AlbumCard(a) { go(Screen.AlbumDetail(a.id)) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun AlbumsScreen(go: (Screen) -> Unit) {
    val client = LocalClient.current
    val result by load("albums") { client.albums("alphabeticalByName", 500) }
    val r = result
    when {
        r == null -> Message("Loading…")
        r.isFailure -> Message(r.exceptionOrNull()?.message ?: "Could not load")
        else -> LazyVerticalGrid(
            columns = GridCells.Adaptive(176.dp),
            contentPadding = PaddingValues(horizontal = 48.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(r.getOrThrow(), key = { it.id }) { a -> AlbumCard(a) { go(Screen.AlbumDetail(a.id)) } }
        }
    }
}

@Composable
fun ArtistsScreen(go: (Screen) -> Unit) {
    val client = LocalClient.current
    val result by load("artists") { client.artists() }
    val r = result
    when {
        r == null -> Message("Loading…")
        r.isFailure -> Message(r.exceptionOrNull()?.message ?: "Could not load")
        else -> LazyVerticalGrid(
            columns = GridCells.Adaptive(220.dp),
            contentPadding = PaddingValues(horizontal = 48.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(r.getOrThrow(), key = { it.id }) { a -> ArtistCard(a) { go(Screen.ArtistDetail(a.id)) } }
        }
    }
}

@Composable
private fun ArtistCard(artist: Artist, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Text(artist.name, maxLines = 1, fontSize = 16.sp)
            Text("${artist.albumCount} albums", fontSize = 12.sp, color = Dim)
        }
    }
}

@Composable
fun PlaylistsScreen(go: (Screen) -> Unit) {
    val client = LocalClient.current
    val result by load("playlists") { client.playlists() }
    val r = result
    when {
        r == null -> Message("Loading…")
        r.isFailure -> Message(r.exceptionOrNull()?.message ?: "Could not load")
        r.getOrThrow().isEmpty() -> Message("No playlists yet")
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 12.dp)) {
            items(r.getOrThrow().size) { i ->
                val p = r.getOrThrow()[i]
                androidx.tv.material3.Button(
                    onClick = { go(Screen.PlaylistDetail(p.id, p.name)) },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 48.dp, vertical = 2.dp),
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Cover(p.coverArt, 56.dp, px = 120)
                        Column {
                            Text(p.name, fontSize = 18.sp)
                            Text("${p.songCount} songs", fontSize = 12.sp, color = Dim)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun SearchScreen(go: (Screen) -> Unit) {
    val client = LocalClient.current
    var query by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<Result<Triple<List<Artist>, List<Album>, List<Track>>>?>(null) }
    LaunchedEffect(query) {
        if (query.trim().length < 2) { result = null; return@LaunchedEffect }
        delay(450) // wait for the typing to stop
        result = runCatching { client.search(query.trim()) }
    }
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            OutlinedTextField(
                value = query, onValueChange = { query = it }, singleLine = true,
                label = { Text("Search artists, albums, songs") },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 48.dp, vertical = 8.dp),
                colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                    focusedTextColor = androidx.compose.ui.graphics.Color.White,
                    unfocusedTextColor = androidx.compose.ui.graphics.Color.White,
                    focusedBorderColor = Accent, unfocusedBorderColor = Dim,
                    focusedLabelColor = Accent, unfocusedLabelColor = Dim, cursorColor = Accent,
                ),
            )
        }
        val r = result
        if (r != null && r.isFailure) item { Message(r.exceptionOrNull()?.message ?: "Search failed") }
        val found = r?.getOrNull()
        if (found != null) {
            val (artists, albums, songs) = found
            if (artists.isNotEmpty()) item {
                SectionTitle("Artists")
                LazyRow(contentPadding = PaddingValues(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(artists.size) { i -> ArtistCard(artists[i]) { go(Screen.ArtistDetail(artists[i].id)) } }
                }
            }
            if (albums.isNotEmpty()) item {
                SectionTitle("Albums")
                LazyRow(contentPadding = PaddingValues(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(albums.size) { i -> AlbumCard(albums[i]) { go(Screen.AlbumDetail(albums[i].id)) } }
                }
            }
            if (songs.isNotEmpty()) {
                item { SectionTitle("Songs") }
                itemsIndexed(songs) { i, t ->
                    TrackRow(t, null, Playback.current?.id == t.id) { Playback.playTracks(songs, i) }
                }
            }
            if (artists.isEmpty() && albums.isEmpty() && songs.isEmpty()) item { Message("Nothing found") }
        }
    }
}

/** Play / shuffle plus the track list; used by albums and playlists. */
@Composable
private fun TrackList(header: @Composable () -> Unit, tracks: List<Track>, numbered: Boolean) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            header()
            Row(Modifier.padding(horizontal = 48.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ActionButton("Play", onClick = { Playback.playTracks(tracks, 0) })
                ActionButton("Shuffle", onClick = { Playback.playTracks(tracks.shuffled(), 0) })
                ActionButton("Play next", onClick = { tracks.reversed().forEach { Playback.playNext(it) } })
                ActionButton("Add to queue", onClick = { Playback.addToQueue(tracks) })
            }
        }
        itemsIndexed(tracks) { i, t ->
            TrackRow(t, if (numbered) (t.trackNumber.takeIf { it > 0 } ?: (i + 1)) else null, Playback.current?.id == t.id) {
                Playback.playTracks(tracks, i)
            }
        }
    }
}

@Composable
fun AlbumDetailScreen(id: String, go: (Screen) -> Unit) {
    val client = LocalClient.current
    val result by load(id) { client.album(id) }
    val r = result
    when {
        r == null -> Message("Loading…")
        r.isFailure -> Message(r.exceptionOrNull()?.message ?: "Could not load")
        else -> {
            val (album, tracks) = r.getOrThrow()
            TrackList(
                header = {
                    Row(Modifier.padding(horizontal = 48.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        Cover(album?.coverArt, 200.dp)
                        Column(Modifier.padding(top = 8.dp)) {
                            Text(album?.name ?: "", fontSize = 30.sp)
                            Text(listOfNotNull(album?.artist, album?.year?.toString()).joinToString(" · "), color = Dim)
                            Text("${tracks.size} songs", color = Dim)
                        }
                    }
                },
                tracks = tracks, numbered = true,
            )
        }
    }
}

@Composable
fun PlaylistDetailScreen(id: String, name: String) {
    val client = LocalClient.current
    val result by load(id) { client.playlistTracks(id) }
    val r = result
    when {
        r == null -> Message("Loading…")
        r.isFailure -> Message(r.exceptionOrNull()?.message ?: "Could not load")
        else -> TrackList(
            header = { Text(name, fontSize = 30.sp, modifier = Modifier.padding(horizontal = 48.dp, vertical = 8.dp)) },
            tracks = r.getOrThrow(), numbered = false,
        )
    }
}

@Composable
fun ArtistDetailScreen(id: String, go: (Screen) -> Unit) {
    val client = LocalClient.current
    val result by load(id) { client.artist(id) }
    val r = result
    when {
        r == null -> Message("Loading…")
        r.isFailure -> Message(r.exceptionOrNull()?.message ?: "Could not load")
        else -> {
            val (artist, albums) = r.getOrThrow()
            LazyVerticalGrid(
                columns = GridCells.Adaptive(176.dp),
                contentPadding = PaddingValues(horizontal = 48.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                    Text(artist?.name ?: "", fontSize = 30.sp, modifier = Modifier.padding(bottom = 8.dp))
                }
                items(albums, key = { it.id }) { a -> AlbumCard(a) { go(Screen.AlbumDetail(a.id)) } }
            }
        }
    }
}
