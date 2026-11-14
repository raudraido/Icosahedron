package cloud.icosahedron.phone.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cloud.icosahedron.phone.data.Album
import cloud.icosahedron.phone.data.Artist
import cloud.icosahedron.phone.data.NativeApi
import cloud.icosahedron.phone.data.Track
import kotlinx.coroutines.launch

/**
 * An artist: the picture, play / shuffle / the queue for all the songs (the compilations and guest appearances too), the
 * biography, the popular songs, the albums, the singles and EPs, the compilations, where the artist only appears, and the similar
 * artists that are in the library. Everything from the server, so it works without the Icosahedron server; the text, the
 * popular songs and the similar artists come from what Navidrome is set up to use (Last.fm, Spotify) and are left out when it has none.
 */
@Composable
fun ArtistPage(id: String, onBack: () -> Unit, onAlbum: (Album) -> Unit, onArtist: (Artist) -> Unit, onAllSongs: (Artist) -> Unit) {
    val client = LocalClient.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val data by load(id) { client.artist(id) }
    val artist = data?.first
    val own = data?.second ?: emptyList()
    val info by load("info$id") { runCatching { client.artistInfo(id) }.getOrNull() }
    val top by load("top" + artist?.name) { artist?.name?.let { runCatching { client.topSongs(it, 5) }.getOrDefault(emptyList()) } ?: emptyList() }
    // Navidrome's own API (see NativeApi) knows every song and album the artist is on; without it only the artist's own albums are shown
    var native by remember { mutableStateOf(false) }
    LaunchedEffect(client) { native = NativeApi.ensure(client) == NativeApi.State.Ready }
    val others by produceState(emptyList<Album>(), native, id) {
        if (native) value = runCatching { NativeApi.artistAlbums(client, id) }.getOrDefault(emptyList()).filter { it.second != id }.map { it.first }
    }
    var fav by remember(artist?.id) { mutableStateOf(artist?.starred == true) }
    var busy by remember { mutableStateOf(false) }
    var menuSongs by remember { mutableStateOf<List<Track>?>(null) }
    var bioOpen by remember { mutableStateOf(false) }

    suspend fun allSongs(): List<Track> {
        if (native) runCatching { NativeApi.artistSongs(client, id) }.getOrNull()?.takeIf { it.isNotEmpty() }?.let { return it }
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

    Column(Modifier.fillMaxSize()) {
        TopBar(artist?.name ?: "", onBack)
        if (artist == null) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Accent) }; return@Column }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            item {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Cover(artist.coverArt, 112.dp, round = true)
                    Column(Modifier.weight(1f).padding(start = 16.dp)) {
                        Text(artist.name, fontSize = 26.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        val count = maxOf(own.size, artist.albumCount)
                        Text(listOfNotNull("$count albums", own.sumOf { it.songCount }.takeIf { it > 0 }?.let { "$it songs" }).joinToString(" · "), fontSize = 13.sp, color = Dim)
                    }
                    IconButton(onClick = {
                        val on = !fav; fav = on
                        scope.launch { if (!runCatching { client.setArtistStarred(id, on) }.isSuccess) fav = !on }
                    }) { Icon(if (fav) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, if (fav) "Remove Favorite" else "Favorite", tint = if (fav) Accent else Color.White) }
                }
                Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Button(onClick = { run { Control.playTracks(it, 0) } }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Play") }
                    OutlinedButton(onClick = { run { Control.playTracks(it.shuffled(), 0) } }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Shuffle") }
                    Box {
                        OutlinedButton(onClick = { run { menuSongs = it } }, enabled = !busy, contentPadding = PaddingValues(horizontal = 12.dp)) { Icon(Icons.Filled.MoreVert, "Queue and more") }
                        menuSongs?.let { l -> TargetMenu(Target("list", id, artist.name, "${l.size} songs", artist.coverArt, preloaded = l), true) { menuSongs = null } }
                    }
                }
            }
            if (bio.isNotBlank()) item {
                SectionHeader("About")
                Text(bio, fontSize = 14.sp, color = Color(0xCCFFFFFF), maxLines = if (bioOpen) Int.MAX_VALUE else 4, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 16.dp).clickable { bioOpen = !bioOpen })
                Row(Modifier.padding(horizontal = 8.dp)) {
                    TextButton(onClick = { bioOpen = !bioOpen }) { Text(if (bioOpen) "Less" else "More", color = Accent) }
                    info?.lastFmUrl?.let { url -> TextButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }) { Text("Last.fm", color = Accent) } }
                }
            }
            if (top.orEmpty().isNotEmpty()) {
                item { SectionHeader("Popular", if (native) ({ onAllSongs(artist) }) else null) }
                val l = top.orEmpty()
                items(l.size) { i -> TrackRow(l[i]) { Control.playTracks(l, i) } }
            } else if (native) item { TextButton(onClick = { onAllSongs(artist) }, modifier = Modifier.padding(horizontal = 8.dp)) { Text("All songs", color = Accent) } }
            item { AlbumShelf("Albums", albums, null, onAlbum) }
            item { AlbumShelf("Singles & EPs", singles, null, onAlbum) }
            item { AlbumShelf("Compilations", compilations, null, onAlbum) }
            item { AlbumShelf("Appears on", appears, null, onAlbum) }
            if (similar.isNotEmpty()) item {
                SectionHeader("Similar artists")
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(similar, key = { it.id }) { a ->
                        Column(Modifier.width(96.dp).clickable { onArtist(a) }, horizontalAlignment = Alignment.CenterHorizontally) {
                            Cover(a.coverArt, 88.dp, round = true)
                            Text(a.name, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
                        }
                    }
                }
            }
        }
    }
}
