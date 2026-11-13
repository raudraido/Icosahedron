package cloud.icosahedron.phone.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cloud.icosahedron.phone.R
import cloud.icosahedron.phone.data.DirEntry
import cloud.icosahedron.phone.data.Track
import kotlinx.coroutines.launch

/** The ways to browse the library, in the order and with the names of the iOS app's Library. */
enum class LibSection(val title: String, val icon: Int) {
    Artists("Artists", R.drawable.ic_lib_artists),
    Albums("Albums", R.drawable.ic_lib_albums),
    Newest("Newest Albums", R.drawable.ic_lib_newest),
    Recent("Recently Played Albums", R.drawable.ic_lib_recent),
    Songs("Songs", R.drawable.ic_lib_songs),
    Favorites("Favorite Songs", R.drawable.ic_lib_favorites),
    Downloads("Downloads", R.drawable.ic_lib_downloads),
    Directories("Directories", R.drawable.ic_lib_directories),
    Playlists("Playlists", R.drawable.ic_lib_playlists),
    Radios("Radios", R.drawable.ic_lib_radios),
}

/** Library: a plain list of the ways to browse, like the iOS app's. */
@Composable
fun LibraryHome(onOpen: (LibSection) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Text("Library", fontSize = 28.sp, modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 8.dp))
        LazyColumn(Modifier.fillMaxSize()) {
            itemsIndexed(LibSection.values().toList(), key = { _, s -> s.name }) { _, s ->
                Row(Modifier.fillMaxWidth().clickable { onOpen(s) }.padding(horizontal = 16.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(painterResource(s.icon), null, Modifier.size(26.dp), tint = Accent)
                    Text(s.title, fontSize = 20.sp, modifier = Modifier.padding(start = 18.dp))
                }
            }
        }
    }
}

/** Every song in the library, loaded a page at a time. */
@Composable
fun SongsScreen() {
    val client = LocalClient.current
    val scope = rememberCoroutineScope()
    val songs = remember { mutableStateListOf<Track>() }
    var loading by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }
    val page = 100
    suspend fun more() {
        if (loading || done) return
        loading = true
        val got = runCatching { client.songs(songs.size, page) }.getOrNull()
        if (got != null) { songs.addAll(got); if (got.size < page) done = true } else done = true
        loading = false
    }
    LaunchedEffect(Unit) { if (songs.isEmpty()) more() }
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Button(
                onClick = { scope.launch { runCatching { client.randomSongs(200) }.getOrNull()?.takeIf { it.isNotEmpty() }?.let { Control.playTracks(it, 0) } } },
                modifier = Modifier.fillMaxWidth().padding(16.dp),
            ) { Text("Shuffle all") }
        }
        itemsIndexed(songs) { i, t ->
            TrackRow(t) { Control.playTracks(songs.toList(), i) }
            if (i >= songs.size - 10) LaunchedEffect(songs.size) { more() }
        }
        if (loading) item { CircularProgressIndicator(Modifier.fillMaxWidth().padding(16.dp).size(28.dp), color = Accent) }
    }
}

/** Folder view: the folders first, then the songs in it; tapping a song plays the folder from there. */
@Composable
fun DirectoryScreen(id: String?, onFolder: (String, String) -> Unit) {
    val client = LocalClient.current
    val entries by load(id) { if (id == null) client.directoryRoot() else client.directory(id) }
    val list = entries
    val folders = list?.filter { it.isDir } ?: emptyList()
    val tracks = list?.mapNotNull { it.track } ?: emptyList()
    LazyColumn(Modifier.fillMaxSize()) {
        if (list == null) item { Text("Loading…", color = Dim, fontSize = 13.sp, modifier = Modifier.padding(16.dp)) }
        if (list != null && list.isEmpty()) item { Text("Nothing here", color = Dim, fontSize = 13.sp, modifier = Modifier.padding(16.dp)) }
        itemsIndexed(folders, key = { _, e: DirEntry -> "d" + e.id }) { _, e ->
            Row(Modifier.fillMaxWidth().clickable { onFolder(e.id, e.title) }.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(painterResource(R.drawable.ic_lib_directories), null, Modifier.size(24.dp), tint = Accent)
                Text(e.title, modifier = Modifier.padding(start = 16.dp), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            }
        }
        itemsIndexed(tracks, key = { _, t -> "t" + t.id }) { i, t -> TrackRow(t) { Control.playTracks(tracks, i) } }
    }
}

/** The server's internet radio stations. */
@Composable
fun RadiosScreen() {
    val client = LocalClient.current
    val stations by load("radios") { client.radios() }
    val list = stations
    LazyColumn(Modifier.fillMaxSize()) {
        if (list == null) item { Text("Loading…", color = Dim, fontSize = 13.sp, modifier = Modifier.padding(16.dp)) }
        if (list != null && list.isEmpty()) item { Text("No radio stations on this server", color = Dim, fontSize = 13.sp, modifier = Modifier.padding(16.dp)) }
        itemsIndexed(list ?: emptyList(), key = { _, r -> r.id }) { _, r ->
            Row(Modifier.fillMaxWidth().clickable { Control.playTracks(listOf(r.toTrack()), 0) }.padding(horizontal = 16.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(painterResource(R.drawable.ic_lib_radios), null, Modifier.size(24.dp), tint = Accent)
                Text(r.name, modifier = Modifier.padding(start = 16.dp), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            }
        }
    }
}
