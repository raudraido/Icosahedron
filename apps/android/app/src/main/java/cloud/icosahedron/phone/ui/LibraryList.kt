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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.style.TextOverflow
import cloud.icosahedron.phone.data.NativeApi
import cloud.icosahedron.phone.data.Prefs
import cloud.icosahedron.phone.data.SongFilter
import cloud.icosahedron.phone.data.SongQuery
import cloud.icosahedron.phone.data.SongSort
import cloud.icosahedron.phone.data.range
import kotlinx.coroutines.delay
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

/** Every song in the library, loaded a page at a time (no sort or filter: the fallback when the server's own API is not reachable). */
@Composable
private fun BasicSongs() {
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

// ── Songs: search, sort, filters and quick views; the server does the work (Navidrome's own API) ──

private val decades = listOf(
    SongFilter.Decade(1950, 1959, "1950s"), SongFilter.Decade(1960, 1969, "1960s"), SongFilter.Decade(1970, 1979, "1970s"),
    SongFilter.Decade(1980, 1989, "1980s"), SongFilter.Decade(1990, 1999, "1990s"), SongFilter.Decade(2000, 2009, "2000s"),
    SongFilter.Decade(2010, 2019, "2010s"), SongFilter.Decade(2020, 2029, "2020s"),
)
private val bpmRanges = listOf(
    SongFilter.Bpm(1, 89, "BPM under 90"), SongFilter.Bpm(90, 109, "BPM 90–110"), SongFilter.Bpm(110, 129, "BPM 110–130"),
    SongFilter.Bpm(130, 149, "BPM 130–150"), SongFilter.Bpm(150, 169, "BPM 150–170"), SongFilter.Bpm(170, 180, "BPM 170–180"),
    SongFilter.Bpm(181, null, "BPM over 180"),
)

@Composable
fun SongsScreen() {
    val client = LocalClient.current
    var state by remember { mutableStateOf<NativeApi.State?>(null) }
    LaunchedEffect(client) { state = NativeApi.ensure(client) }
    when (state) {
        null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Accent) }
        NativeApi.State.Ready -> NativeSongs()
        NativeApi.State.NeedPassword -> Column(Modifier.fillMaxSize()) {
            PasswordCard { pw -> NativeApi.usePassword(client, pw).also { ok -> if (ok) state = NativeApi.State.Ready } }
            BasicSongs()
        }
        NativeApi.State.Unavailable -> Column(Modifier.fillMaxSize()) {
            Text("Sorting and filters need the server's own API, which is not reachable here. This is the plain list.", color = Dim, fontSize = 13.sp, modifier = Modifier.padding(16.dp))
            BasicSongs()
        }
    }
}

/** Without the Icosahedron server the password is needed once, to sign in to the server's own API. It is kept encrypted on the phone. */
@Composable
private fun PasswordCard(onSubmit: suspend (String) -> Boolean) {
    val scope = rememberCoroutineScope()
    var pw by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var wrong by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Text("Sort, filter and search", fontSize = 18.sp)
        Text(
            "Your server needs the account password once for this. It is kept encrypted on this phone (in the Android Keystore) and used only to sign in to the server's own API.",
            color = Dim, fontSize = 13.sp, modifier = Modifier.padding(vertical = 8.dp),
        )
        androidx.compose.material3.OutlinedTextField(
            pw, { pw = it; wrong = false }, singleLine = true, label = { Text("Password") }, isError = wrong,
            visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
        )
        if (wrong) Text("That password was not accepted.", color = Accent, fontSize = 12.sp)
        Button(
            onClick = { busy = true; scope.launch { wrong = !onSubmit(pw); busy = false } }, enabled = pw.isNotEmpty() && !busy,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        ) { Text(if (busy) "Checking…" else "Turn on") }
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun NativeSongs() {
    val client = LocalClient.current
    val scope = rememberCoroutineScope()
    var search by rememberSaveable { mutableStateOf("") }
    var debounced by rememberSaveable { mutableStateOf("") }
    var filter by remember { mutableStateOf<SongFilter>(SongFilter.All) }
    var sort by remember { mutableStateOf(runCatching { SongSort.valueOf(Prefs.songSort) }.getOrDefault(SongSort.Title)) }
    var asc by remember { mutableStateOf(Prefs.songSortAsc) }
    LaunchedEffect(search) { delay(350); debounced = search.trim() }
    LaunchedEffect(sort, asc) { Prefs.songSort = sort.name; Prefs.songSortAsc = asc }
    val genres by load("native-genres") { runCatching { NativeApi.genres(client) }.getOrDefault(emptyList()) }

    val query = SongQuery(debounced, filter, sort, asc)
    val range = filter.range()
    val songs = remember { mutableStateListOf<Track>() }
    var total by remember { mutableStateOf(0) }
    var base by remember { mutableStateOf(0) }       // where the list starts in the server's sorted list (a range filter)
    var loading by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val pageSize = 100

    suspend fun more() {
        if (loading || songs.size >= total) return
        loading = true
        try {
            val start = base + songs.size
            val end = base + minOf(songs.size + pageSize, total)
            songs.addAll(NativeApi.page(client, query, start, end).songs)
        } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { failed = true }
        loading = false
    }
    LaunchedEffect(query.key) {
        songs.clear(); total = 0; base = 0; failed = false; loading = true
        try {
            val (from, to) = NativeApi.slice(client, query)
            if (range != null) { base = from; total = to - from } else { base = 0; total = to }
        } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { failed = true }
        loading = false
        more()
    }

    fun quick(f: SongFilter, s: SongSort, a: Boolean) { filter = f; sort = s; asc = a }
    val state = androidx.compose.foundation.lazy.rememberLazyListState()

    Column(Modifier.fillMaxSize()) {
        androidx.compose.material3.OutlinedTextField(
            search, { search = it }, singleLine = true, placeholder = { Text("Search songs, artists, albums") },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        )
        // Quick views
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            @Composable fun chip(label: String, on: Boolean, click: () -> Unit) =
                androidx.compose.material3.FilterChip(on, click, label = { Text(label) })
            chip("All", filter is SongFilter.All && sort == SongSort.Title) { quick(SongFilter.All, SongSort.Title, true) }
            chip("Recently added", filter is SongFilter.All && sort == SongSort.Added) { quick(SongFilter.All, SongSort.Added, false) }
            chip("Most played", filter is SongFilter.All && sort == SongSort.Plays) { quick(SongFilter.All, SongSort.Plays, false) }
            chip("Never played", filter is SongFilter.Unplayed) { quick(SongFilter.Unplayed, sort, asc) }
            chip("Favorites", filter is SongFilter.Favorites) { quick(SongFilter.Favorites, sort, asc) }
            chip("Random", sort == SongSort.Random) { quick(SongFilter.All, SongSort.Random, true) }
        }
        Row(Modifier.fillMaxWidth().padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            val shown = if (loading && songs.isEmpty()) "…" else java.text.NumberFormat.getIntegerInstance().format(total)
            Text(listOfNotNull(filter.label.takeIf { filter !is SongFilter.All }, "$shown songs").joinToString(" · "), fontSize = 13.sp, color = Dim, modifier = Modifier.weight(1f))
            if (loading) CircularProgressIndicator(Modifier.padding(end = 8.dp).width(16.dp), strokeWidth = 2.dp, color = Accent)
            if (range == null) MenuButton("Sort: " + sort.title + if (sort == SongSort.Random) "" else if (asc) " ↑" else " ↓") { close ->
                SongSort.values().forEach { s ->
                    DropdownMenuItem(text = { Text((if (sort == s) "✓ " else "") + s.title) }, onClick = { if (sort == s && s != SongSort.Random) asc = !asc else { sort = s; asc = s.ascByDefault }; close() })
                }
            } else Text("Sorted by " + range.field.replaceFirstChar { it.uppercase() }, fontSize = 13.sp, color = Dim, modifier = Modifier.padding(end = 8.dp))
            MenuButton("Filter") { close ->
                @Composable fun item(label: String, f: SongFilter) = DropdownMenuItem(text = { Text((if (filter == f) "✓ " else "") + label) }, onClick = { filter = f; close() })
                item("All songs", SongFilter.All)
                item("Favorites", SongFilter.Favorites)
                item("Never played", SongFilter.Unplayed)
                decades.forEach { d -> item(d.label, d) }
                bpmRanges.forEach { b -> item(b.label, b) }
                genres?.forEach { (id, name) -> item(name, SongFilter.Genre(id, name)) }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { if (songs.isNotEmpty()) Control.playTracks(songs.toList(), 0) }, enabled = songs.isNotEmpty(), modifier = Modifier.weight(1f),
            ) { Text("Play") }
            androidx.compose.material3.OutlinedButton(
                onClick = { scope.launch { runCatching { NativeApi.shuffled(client, query) }.getOrNull()?.takeIf { it.isNotEmpty() }?.let { Control.playTracks(it, 0) } } },
                enabled = total > 0, modifier = Modifier.weight(1f),
            ) { Text("Shuffle") }
        }
        if (failed) Text("Could not load the songs.", color = Accent, fontSize = 13.sp, modifier = Modifier.padding(16.dp))
        if (!loading && !failed && total == 0) Text("No songs match.", color = Dim, fontSize = 13.sp, modifier = Modifier.padding(16.dp))
        LazyColumn(Modifier.fillMaxSize(), state = state) {
            itemsIndexed(songs, key = { i, t -> t.id + i }) { i, t ->
                val field = range?.field ?: sort.field
                val trailing = when (field) {
                    "playCount" -> "${t.playCount ?: 0} plays"
                    "year" -> t.year?.toString()
                    "bpm" -> t.bpm?.let { "$it BPM" }
                    "createdAt" -> t.created?.take(10)
                    else -> null
                }
                TrackRow(t, subtitle = listOfNotNull(t.artist.takeIf { it.isNotBlank() }, t.album?.takeIf { it.isNotBlank() }).joinToString(" · "), trailing = trailing) { Control.playTracks(songs.toList(), i) }
                if (i >= songs.size - 10) LaunchedEffect(songs.size) { more() }
            }
        }
    }
}
