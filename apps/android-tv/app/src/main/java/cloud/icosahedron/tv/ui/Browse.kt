@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.res.painterResource
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.Icon
import cloud.icosahedron.tv.R
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.runtime.produceState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Card
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import cloud.icosahedron.tv.data.Album
import cloud.icosahedron.tv.data.NativeApi
import cloud.icosahedron.tv.data.ArtistInfo
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
internal fun ArtistCard(artist: Artist, modifier: Modifier = Modifier.fillMaxWidth(), onClick: () -> Unit) {
    Card(onClick = onClick, modifier = modifier) {
        Column(Modifier.fillMaxWidth().padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            ArtistPicture(artist, 120.dp)
            Text(artist.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 16.sp, modifier = Modifier.padding(top = 10.dp))
            Text("${artist.albumCount} albums", fontSize = 12.sp, color = dim())
        }
    }
}

@Composable
fun SearchScreen(go: (Screen) -> Unit) {
    val client = LocalClient.current
    var query by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<Result<Triple<List<Artist>, List<Album>, List<Track>>>?>(null) }
    // Voice search with the app's own screen (VoiceSearch.kt); the words become the search text.
    val voice = rememberVoiceSearch { query = it }
    BackHandler(enabled = voice.listening) { voice.cancel() }
    // The microphone has the focus when Search opens: the text field would open the keyboard at once, and with
    // it open the Left key moves the cursor, so the microphone could not be reached any more.
    val micFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { micFocus.requestFocus() } }
    LaunchedEffect(query) {
        if (query.trim().length < 2) { result = null; return@LaunchedEffect }
        delay(450) // wait for the typing to stop
        result = runCatching { client.search(query.trim()) }
    }
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 48.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(
                    onClick = { voice.toggle() },
                    modifier = Modifier.focusRequester(micFocus),
                    shape = ButtonDefaults.shape(CircleShape),
                    contentPadding = PaddingValues(14.dp),
                    colors = chipColors(false),
                ) { Icon(painterResource(R.drawable.ic_mic), contentDescription = "Search by voice", modifier = Modifier.size(24.dp)) }
                OutlinedTextField(
                    value = query, onValueChange = { query = it }, singleLine = true,
                    label = { Text("Search artists, albums, songs") },
                    modifier = Modifier.weight(1f),
                    colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                        focusedTextColor = androidx.compose.ui.graphics.Color.White,
                        unfocusedTextColor = androidx.compose.ui.graphics.Color.White,
                        focusedBorderColor = Accent, unfocusedBorderColor = Dim,
                        focusedLabelColor = Accent, unfocusedLabelColor = Dim, cursorColor = Accent,
                    ),
                )
            }
        }
        if (voice.listening) item { ListeningPanel(voice.heard) }
        voice.message?.let { m -> item { Message(m) } }
        val r = result
        if (r != null && r.isFailure) item { Message(r.exceptionOrNull()?.message ?: "Search failed") }
        val found = r?.getOrNull()
        if (found != null) {
            val (artists, albums, songs) = found
            if (artists.isNotEmpty()) item {
                SectionTitle("Artists")
                LazyRow(contentPadding = PaddingValues(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(artists.size) { i -> ArtistCard(artists[i], Modifier.width(176.dp)) { go(Screen.ArtistDetail(artists[i].id)) } }
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

/**
 * A page of songs in two parts: at the left, staying in place, what this is (the cover, the name, the buttons); at the right,
 * the songs, which are the only thing that scrolls. [numbered]: the songs of one album show their numbers instead of the cover.
 */
@Composable
private fun TrackList(title: String, subtitle: String?, meta: String?, coverId: String?, tracks: List<Track>, numbered: Boolean) {
    Row(Modifier.fillMaxSize()) {
        Column(
            Modifier.width(380.dp).fillMaxHeight().verticalScroll(rememberScrollState()).padding(start = 48.dp, end = 24.dp, top = 12.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (coverId != null) Cover(coverId, 200.dp)
            Text(title, fontSize = 26.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
            subtitle?.let { Text(it, color = Dim) }
            meta?.let { Text(it, color = Dim, fontSize = 13.sp) }
            Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionButton("Play", onClick = { Playback.playTracks(tracks, 0) }, modifier = Modifier.weight(1f))
                ActionButton("Shuffle", onClick = { Playback.playTracks(tracks.shuffled(), 0) }, modifier = Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionButton("Play next", onClick = { tracks.reversed().forEach { Playback.playNext(it) } }, modifier = Modifier.weight(1f))
                ActionButton("Queue", onClick = { Playback.addToQueue(tracks) }, modifier = Modifier.weight(1f))
            }
        }
        LazyColumn(Modifier.weight(1f).fillMaxHeight(), contentPadding = PaddingValues(end = 40.dp, top = 8.dp, bottom = 24.dp)) {
            itemsIndexed(tracks) { i, t ->
                TrackRow(t, if (numbered) (t.trackNumber.takeIf { it > 0 } ?: (i + 1)) else null, Playback.current?.id == t.id, horizontalPadding = 0.dp, showCover = !numbered) {
                    Playback.playTracks(tracks, i)
                }
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
                title = album?.name ?: "", subtitle = listOfNotNull(album?.artist, album?.year?.toString()).joinToString(" · "),
                meta = "${tracks.size} songs", coverId = album?.coverArt, tracks = tracks, numbered = true,
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
            title = name, subtitle = null, meta = "${r.getOrThrow().size} songs",
            coverId = r.getOrThrow().firstOrNull()?.coverArt, tracks = r.getOrThrow(), numbered = false,
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
        else -> ArtistPage(id, r.getOrThrow().first, r.getOrThrow().second, go)
    }
}

/**
 * An artist: the picture, play / shuffle / the queue for all the songs (the compilations and guest appearances too), the
 * biography, the popular songs, the albums, the singles and EPs, the compilations, where the artist only appears, and the similar
 * artists that are in the library. The text, the popular songs and the similar artists come from what Navidrome is set up to use
 * (Last.fm, Spotify) and are left out when it has none; the whole-artist songs and "Appears on" need the Icosahedron server (see
 * NativeApi), without it the artist's own albums are shown.
 */
@Composable
private fun ArtistPage(id: String, artist: Artist?, own: List<Album>, go: (Screen) -> Unit) {
    val client = LocalClient.current
    val scope = rememberCoroutineScope()
    val name = artist?.name ?: ""
    val info by produceState<ArtistInfo?>(null, id) { value = runCatching { client.artistInfo(id) }.getOrNull() }
    val top by produceState(emptyList<Track>(), name) { if (name.isNotEmpty()) value = runCatching { client.topSongs(name, 5) }.getOrDefault(emptyList()) }
    val native by produceState(false, id) { value = NativeApi.ensure(client) }
    val others by produceState(emptyList<Album>(), native, id) {
        if (native) value = runCatching { NativeApi.artistAlbums(client, id) }.getOrDefault(emptyList()).filter { it.second != id }.map { it.first }
    }
    var busy by remember { mutableStateOf(false) }
    var bioOpen by remember { mutableStateOf(false) }

    suspend fun allSongs(): List<Track> {
        if (native) runCatching { NativeApi.allArtistSongs(client, id) }.getOrNull()?.takeIf { it.isNotEmpty() }?.let { return it }
        // Without the server's own API: the songs of the artist's own albums
        return own.take(60).flatMap { runCatching { client.album(it.id).second }.getOrDefault(emptyList()) }
    }
    fun run(block: suspend (List<Track>) -> Unit) { if (!busy) { busy = true; scope.launch { val l = allSongs(); if (l.isNotEmpty()) block(l); busy = false } } }

    val byYear = compareByDescending<Album> { it.year ?: 0 }.thenBy { it.name }
    val albums = own.filter { !it.isSingleOrEp && !it.isCompilation }.sortedWith(byYear)
    val singles = own.filter { it.isSingleOrEp && !it.isCompilation }.sortedWith(byYear)
    val compilations = (own.filter { it.isCompilation } + others.filter { it.isCompilation }).distinctBy { it.id }.sortedWith(byYear)
    val appears = others.filter { !it.isCompilation }.sortedWith(byYear)
    val similar = info?.similar ?: emptyList()
    val bio = info?.biography ?: ""

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
        item {
            Row(Modifier.padding(horizontal = 48.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
                Cover(artist?.coverArt, 160.dp, round = true)
                Column {
                    Text(name, fontSize = 34.sp, maxLines = 2)
                    Text(listOfNotNull("${maxOf(own.size, artist?.albumCount ?: 0)} albums", own.sumOf { it.songCount }.takeIf { it > 0 }?.let { "$it songs" }).joinToString(" · "), color = Dim)
                }
            }
            Row(Modifier.padding(horizontal = 48.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ActionButton("Play", onClick = { run { Playback.playTracks(it, 0) } })
                ActionButton("Shuffle", onClick = { run { Playback.playTracks(it.shuffled(), 0) } })
                ActionButton("Play next", onClick = { run { l -> l.reversed().forEach { Playback.playNext(it) } } })
                ActionButton("Add to queue", onClick = { run { Playback.addToQueue(it) } })
            }
        }
        if (bio.isNotBlank()) item {
            SectionTitle("About")
            // OK opens and closes the whole text (a remote cannot scroll a paragraph)
            Card(onClick = { bioOpen = !bioOpen }, modifier = Modifier.fillMaxWidth().padding(horizontal = 48.dp)) {
                Text(bio, fontSize = 16.sp, maxLines = if (bioOpen) Int.MAX_VALUE else 4, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(14.dp))
            }
        }
        if (top.isNotEmpty()) {
            item { SectionTitle("Popular") }
            itemsIndexed(top) { i, t -> TrackRow(t, i + 1, Playback.current?.id == t.id) { Playback.playTracks(top, i) } }
        }
        if (native) item {
            Row(Modifier.padding(horizontal = 48.dp, vertical = 8.dp)) { ActionButton("All songs", onClick = { go(Screen.ArtistSongs(id, name)) }) }
        }
        item { AlbumRow("Albums", albums, go) }
        item { AlbumRow("Singles & EPs", singles, go) }
        item { AlbumRow("Compilations", compilations, go) }
        item { AlbumRow("Appears on", appears, go) }
        if (similar.isNotEmpty()) item {
            SectionTitle("Similar artists")
            LazyRow(contentPadding = PaddingValues(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                items(similar.size) { i ->
                    val a = similar[i]
                    Card(onClick = { go(Screen.ArtistDetail(a.id)) }, modifier = Modifier.width(140.dp)) {
                        Column(Modifier.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Cover(a.coverArt, 100.dp, round = true, px = 300)
                            Text(a.name, maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AlbumRow(title: String, albums: List<Album>, go: (Screen) -> Unit) {
    if (albums.isEmpty()) return
    SectionTitle(title)
    LazyRow(contentPadding = PaddingValues(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        items(albums.size) { i -> AlbumCard(albums[i]) { go(Screen.AlbumDetail(albums[i].id)) } }
    }
}

/** Every song of the artist in album order (through the server's own API), with Play and Shuffle. */
@Composable
fun ArtistSongsScreen(id: String, name: String) {
    val client = LocalClient.current
    val result by load(id) { NativeApi.allArtistSongs(client, id, 1500) }
    val r = result
    when {
        r == null -> Message("Loading…")
        r.isFailure -> Message(r.exceptionOrNull()?.message ?: "Could not load")
        else -> TrackList(
            title = name, subtitle = "All songs", meta = "${r.getOrThrow().size} songs", coverId = null, tracks = r.getOrThrow(), numbered = false,
        )
    }
}
