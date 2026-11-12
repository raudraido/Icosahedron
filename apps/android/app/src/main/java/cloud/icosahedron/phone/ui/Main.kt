package cloud.icosahedron.phone.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cloud.icosahedron.phone.App
import cloud.icosahedron.phone.R
import cloud.icosahedron.phone.data.Album
import cloud.icosahedron.phone.data.Artist
import cloud.icosahedron.phone.data.Track
import cloud.icosahedron.phone.player.Playback
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private sealed interface Route {
    data class AlbumR(val id: String) : Route
    data class ArtistR(val id: String) : Route
    data class PlaylistR(val id: String, val name: String) : Route
    data class AlbumList(val type: String, val title: String) : Route
}

private enum class Dest { Home, Library, Search, Settings }

@Composable
fun MainScreen() {
    val app = App.instance
    val session = app.session ?: return
    val client = remember(session) { session.client() }
    var tab by rememberSaveable { mutableStateOf(Dest.Home) }
    var libraryTab by rememberSaveable { mutableIntStateOf(0) }
    val stack = remember { mutableStateListOf<Route>() }
    var showPlayer by remember { mutableStateOf(false) }

    CompositionLocalProvider(LocalClient provides client) {
        Box(Modifier.fillMaxSize()) {
            Scaffold(
                containerColor = Bg,
                bottomBar = {
                    Column {
                        MiniPlayer(onOpen = { showPlayer = true })
                        NavigationBar(containerColor = Panel) {
                            listOf(Dest.Home to Icons.Filled.Home, Dest.Library to Icons.Filled.List, Dest.Search to Icons.Filled.Search, Dest.Settings to Icons.Filled.Settings).forEach { (t, icon) ->
                                NavigationBarItem(
                                    selected = tab == t, onClick = { tab = t; stack.clear() },
                                    icon = { Icon(icon, t.name) }, label = { Text(t.name) },
                                    colors = NavigationBarItemDefaults.colors(selectedIconColor = Accent, selectedTextColor = Accent, indicatorColor = PanelHi, unselectedIconColor = Dim, unselectedTextColor = Dim),
                                )
                            }
                        }
                    }
                },
            ) { pad ->
                Box(Modifier.padding(pad).fillMaxSize()) {
                    val top = stack.lastOrNull()
                    val push = { r: Route -> stack.add(r); Unit }
                    when (top) {
                        is Route.AlbumR -> AlbumScreen(top.id, onBack = { stack.removeLast() }, push = push)
                        is Route.ArtistR -> ArtistScreen(top.id, onBack = { stack.removeLast() }, push = push)
                        is Route.PlaylistR -> PlaylistScreen(top.id, top.name, onBack = { stack.removeLast() })
                        is Route.AlbumList -> AlbumListScreen(top.type, top.title, onBack = { stack.removeLast() }, push = push)
                        null -> when (tab) {
                            Dest.Home -> HomeScreen(
                                push = push,
                                allPlaylists = { libraryTab = 2; tab = Dest.Library },
                            )
                            Dest.Library -> LibraryScreen(libraryTab, { libraryTab = it }, push)
                            Dest.Search -> SearchScreen(push)
                            Dest.Settings -> SettingsScreen()
                        }
                    }
                }
            }
            BackHandler(enabled = stack.isNotEmpty()) { stack.removeLast() }
            BackHandler(enabled = stack.isEmpty() && tab != Dest.Home) { tab = Dest.Home }
            AnimatedVisibility(showPlayer, enter = slideInVertically { it }, exit = slideOutVertically { it }) {
                NowPlayingScreen(onClose = { showPlayer = false })
            }
        }
    }
}

// ── Mini player ──
@Composable
private fun MiniPlayer(onOpen: () -> Unit) {
    val t = Playback.current ?: return
    Column(Modifier.fillMaxWidth().clickable(onClick = onOpen).background(Panel)) {
        if (Playback.durationMs > 0) LinearProgressIndicator(progress = { (Playback.positionMs.toFloat() / Playback.durationMs).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().height(2.dp), color = Accent, trackColor = PanelHi)
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Cover(t.coverArt, 44.dp)
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(t.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = Dim)
            }
            IconButton(onClick = { Playback.toggle() }) {
                Icon(painterResource(if (Playback.isPlaying) R.drawable.ic_pause else R.drawable.ic_play), "Play / pause")
            }
            IconButton(onClick = { Playback.next() }) { Icon(painterResource(R.drawable.ic_next), "Next") }
        }
    }
}


// ── Home ──
@Composable
private fun HomeScreen(push: (Route) -> Unit, allPlaylists: () -> Unit) {
    val client = LocalClient.current
    val scope = rememberCoroutineScope()
    val discover by load("discover") { client.albums("random", 20) }
    val recent by load("recent") { client.albums("recent", 20) }
    val newest by load("newest") { client.albums("newest", 20) }
    val frequent by load("frequent") { client.albums("frequent", 20) }
    val playlists by load("playlists") { client.playlists() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
        item {
            Text("Icosahedron", fontSize = 28.sp, color = Accent, modifier = Modifier.padding(16.dp))
            Button(
                onClick = { scope.launch { runCatching { client.randomSongs(100) }.getOrNull()?.let { Playback.playTracks(it, 0) } } },
                modifier = Modifier.padding(horizontal = 16.dp).fillMaxWidth(),
            ) { Text("Random mix") }
        }
        item { AlbumShelf("Discover", discover, { push(Route.AlbumList("random", "Discover")) }) { push(Route.AlbumR(it.id)) } }
        item { AlbumShelf("Recently played", recent, { push(Route.AlbumList("recent", "Recently played")) }) { push(Route.AlbumR(it.id)) } }
        item { AlbumShelf("Newest", newest, { push(Route.AlbumList("newest", "Newest")) }) { push(Route.AlbumR(it.id)) } }
        item { AlbumShelf("Most played", frequent, { push(Route.AlbumList("frequent", "Most played")) }) { push(Route.AlbumR(it.id)) } }
        item { PlaylistShelf(playlists, allPlaylists) { push(Route.PlaylistR(it.id, it.name)) } }
    }
}

// ── Library ──
@Composable
private fun LibraryScreen(selected: Int, onSelect: (Int) -> Unit, push: (Route) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        TabRow(selected, containerColor = Bg, contentColor = Accent) {
            listOf("Albums", "Artists", "Playlists").forEachIndexed { i, s -> Tab(selected == i, { onSelect(i) }, text = { Text(s) }) }
        }
        when (selected) {
            0 -> AlbumGrid("alphabeticalByName", push)
            1 -> ArtistsList(push)
            else -> PlaylistsList(push)
        }
    }
}

@Composable
private fun AlbumGrid(type: String, push: (Route) -> Unit) {
    val client = LocalClient.current
    val albums = remember(type) { mutableStateListOf<Album>() }
    var done by remember(type) { mutableStateOf(false) }
    var loading by remember(type) { mutableStateOf(false) }
    suspend fun more() {
        if (loading || done) return
        loading = true
        val page = runCatching { client.albums(type, 60, albums.size) }.getOrDefault(emptyList())
        if (page.isEmpty()) done = true else albums.addAll(page.filter { n -> albums.none { it.id == n.id } })
        loading = false
    }
    LaunchedEffect(type) { more() }
    LazyVerticalGrid(GridCells.Fixed(2), Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        items(albums, key = { it.id }) { a -> AlbumCard(a, size = 170.dp) { push(Route.AlbumR(a.id)) } }
        if (!done) item { LaunchedEffect(albums.size) { more() }; Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) { CircularProgressIndicator(color = Accent) } }
    }
}

@Composable
private fun AlbumListScreen(type: String, title: String, onBack: () -> Unit, push: (Route) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        TopBar(title, onBack)
        AlbumGrid(type, push)
    }
}

@Composable
private fun ArtistsList(push: (Route) -> Unit) {
    val client = LocalClient.current
    val artists by load("artists") { client.artists() }
    LazyColumn(Modifier.fillMaxSize()) { items(artists ?: emptyList(), key = { it.id }) { a -> ArtistRow(a) { push(Route.ArtistR(a.id)) } } }
}

@Composable
private fun PlaylistsList(push: (Route) -> Unit) {
    val client = LocalClient.current
    val lists by load("playlists-all") { client.playlists() }
    LazyColumn(Modifier.fillMaxSize()) {
        items(lists ?: emptyList(), key = { it.id }) { p ->
            Row(Modifier.fillMaxWidth().clickable { push(Route.PlaylistR(p.id, p.name)) }.padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Cover(p.coverArt, 52.dp)
                Column(Modifier.padding(start = 12.dp)) { Text(p.name, maxLines = 1, overflow = TextOverflow.Ellipsis); Text("${p.songCount} songs", fontSize = 12.sp, color = Dim) }
            }
        }
    }
}

// ── Search ──
@Composable
private fun SearchScreen(push: (Route) -> Unit) {
    val client = LocalClient.current
    var q by rememberSaveable { mutableStateOf("") }
    var result by remember { mutableStateOf<Triple<List<Artist>, List<Album>, List<Track>>?>(null) }
    LaunchedEffect(q) {
        if (q.trim().length < 2) { result = null; return@LaunchedEffect }
        delay(300)
        result = runCatching { client.search(q.trim()) }.getOrNull()
    }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(q, { q = it }, singleLine = true, label = { Text("Search songs, albums, artists") }, modifier = Modifier.fillMaxWidth().padding(16.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions())
        val r = result
        LazyColumn(Modifier.fillMaxSize()) {
            if (r != null) {
                if (r.first.isNotEmpty()) { item { SectionHeader("Artists") }; items(r.first, key = { "ar" + it.id }) { a -> ArtistRow(a) { push(Route.ArtistR(a.id)) } } }
                if (r.second.isNotEmpty()) item { AlbumShelf("Albums", r.second, null) { push(Route.AlbumR(it.id)) } }
                if (r.third.isNotEmpty()) {
                    item { SectionHeader("Songs") }
                    itemsIndexed(r.third, key = { _, t -> "t" + t.id }) { i, t -> TrackRow(t) { Playback.playTracks(r.third, i) } }
                }
            }
        }
    }
}

// ── Details ──
@Composable
fun TopBar(title: String, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, "Back") }
        Text(title, fontSize = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun PlayShuffle(tracks: List<Track>) {
    Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Button(onClick = { Playback.playTracks(tracks, 0) }, modifier = Modifier.weight(1f)) { Text("Play") }
        OutlinedButton(onClick = { Playback.playTracks(tracks.shuffled(), 0) }, modifier = Modifier.weight(1f)) { Text("Shuffle") }
    }
}

@Composable
private fun AlbumScreen(id: String, onBack: () -> Unit, push: (Route) -> Unit) {
    val client = LocalClient.current
    val data by load(id) { client.album(id) }
    val album = data?.first
    val tracks = data?.second ?: emptyList()
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            TopBar(album?.name ?: "", onBack)
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Cover(album?.coverArt, 220.dp)
                Text(album?.name ?: "", fontSize = 20.sp, modifier = Modifier.padding(top = 12.dp, start = 16.dp, end = 16.dp))
                Text(
                    album?.artist ?: "", color = Accent, fontSize = 14.sp,
                    modifier = Modifier.clickable(enabled = album?.artistId != null) { push(Route.ArtistR(album!!.artistId!!)) },
                )
                if (album?.year != null) Text(album.year.toString(), color = Dim, fontSize = 12.sp)
            }
            if (tracks.isNotEmpty()) PlayShuffle(tracks)
        }
        itemsIndexed(tracks, key = { _, t -> t.id }) { i, t -> TrackRow(t, showCover = false, number = if (t.trackNumber > 0) t.trackNumber else i + 1) { Playback.playTracks(tracks, i) } }
    }
}

@Composable
private fun ArtistScreen(id: String, onBack: () -> Unit, push: (Route) -> Unit) {
    val client = LocalClient.current
    val data by load(id) { client.artist(id) }
    val albums = data?.second ?: emptyList()
    Column(Modifier.fillMaxSize()) {
        TopBar(data?.first?.name ?: "", onBack)
        LazyVerticalGrid(GridCells.Fixed(2), Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            items(albums, key = { it.id }) { a -> AlbumCard(a, size = 170.dp) { push(Route.AlbumR(a.id)) } }
        }
    }
}

@Composable
private fun PlaylistScreen(id: String, name: String, onBack: () -> Unit) {
    val client = LocalClient.current
    val tracks by load(id) { client.playlistTracks(id) }
    val list = tracks ?: emptyList()
    LazyColumn(Modifier.fillMaxSize()) {
        item { TopBar(name, onBack); if (list.isNotEmpty()) PlayShuffle(list) }
        itemsIndexed(list) { i, t -> TrackRow(t) { Playback.playTracks(list, i) } }
    }
}
