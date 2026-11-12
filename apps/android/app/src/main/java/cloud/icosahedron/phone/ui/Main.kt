package cloud.icosahedron.phone.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
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
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Phone
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
import cloud.icosahedron.phone.data.Playlist
import cloud.icosahedron.phone.data.Track
import cloud.icosahedron.phone.player.Playback
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private sealed interface Route {
    data class AlbumR(val id: String) : Route
    data class ArtistR(val id: String) : Route
    data class PlaylistR(val id: String, val name: String) : Route
    data class AlbumList(val type: String, val title: String) : Route
    data class OfflineR(val kind: String, val id: String) : Route
}

private enum class Dest { Home, Library, Search, Devices, Settings }

@Composable
fun MainScreen() {
    val app = App.instance
    val session = app.session ?: return
    val client = remember(session) { session.client() }
    var tab by rememberSaveable { mutableStateOf(Dest.Home) }
    var libraryTab by rememberSaveable { mutableIntStateOf(0) }
    val stack = remember { mutableStateListOf<Route>() }
    var showPlayer by remember { mutableStateOf(false) }

    LaunchedEffect(client) { cloud.icosahedron.phone.data.Avatar.refresh(client) }
    LaunchedEffect(Control.remote) { while (Control.remote) { delay(500); Control.tick = System.currentTimeMillis() } }

    val opener = remember {
        object : Opener {
            override fun album(id: String) { stack.add(Route.AlbumR(id)) }
            override fun artist(id: String) { stack.add(Route.ArtistR(id)) }
            override fun back() { if (stack.isNotEmpty()) stack.removeLast() }
        }
    }

    CompositionLocalProvider(LocalClient provides client, LocalOpener provides opener) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            // A wide screen (a tablet, a phone on its side, a car): the tabs go to a rail at the left, not a bar at the bottom
            val wide = maxWidth > maxHeight && maxWidth >= 600.dp
            val bottomInset = if (wide && Control.track != null) 156.dp else 0.dp
            val destinations = listOf(Dest.Home to Icons.Filled.Home, Dest.Library to Icons.Filled.List, Dest.Search to Icons.Filled.Search, Dest.Devices to Icons.Filled.Phone, Dest.Settings to Icons.Filled.Settings)
            val body: @Composable (PaddingValues) -> Unit = { pad ->
                Box(Modifier.padding(pad).fillMaxSize()) {
                    val top = stack.lastOrNull()
                    val push = { r: Route -> stack.add(r); Unit }
                    when (top) {
                        is Route.AlbumR -> AlbumScreen(top.id, onBack = { stack.removeLast() }, push = push)
                        is Route.ArtistR -> ArtistScreen(top.id, onBack = { stack.removeLast() }, push = push)
                        is Route.PlaylistR -> PlaylistScreen(top.id, top.name, onBack = { stack.removeLast() })
                        is Route.OfflineR -> OfflineCollectionScreen(top.kind, top.id, onBack = { stack.removeLast() })
                        is Route.AlbumList -> AlbumListScreen(top.type, top.title, onBack = { stack.removeLast() }, push = push)
                        null -> when (tab) {
                            Dest.Home -> HomeScreen(
                                push = push,
                                allPlaylists = { libraryTab = 2; tab = Dest.Library },
                                onProfile = { tab = Dest.Settings },
                            )
                            Dest.Library -> LibraryScreen(libraryTab, { libraryTab = it }, push)
                            Dest.Search -> SearchScreen(push)
                            Dest.Devices -> DevicesScreen()
                            Dest.Settings -> SettingsScreen()
                        }
                    }
                }
            }
            CompositionLocalProvider(LocalBottomInset provides bottomInset) {
            if (wide) {
                Row(Modifier.fillMaxSize()) {
                    Column(Modifier.fillMaxHeight().width(88.dp).background(Panel).padding(vertical = 8.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                        destinations.forEach { (t, icon) ->
                            NavigationRailItem(
                                selected = tab == t, onClick = { tab = t; stack.clear() },
                                icon = { Icon(icon, t.name) }, label = { Text(t.name, fontSize = 11.sp) },
                                colors = NavigationRailItemDefaults.colors(selectedIconColor = Accent, selectedTextColor = Accent, indicatorColor = PanelHi, unselectedIconColor = Dim, unselectedTextColor = Dim),
                            )
                        }
                    }
                    Box(Modifier.weight(1f).fillMaxHeight()) {
                        Scaffold(containerColor = Bg) { body(it) }
                        FloatingPlayer(onOpen = { showPlayer = true }, Modifier.align(Alignment.BottomEnd).padding(16.dp))
                    }
                }
            } else {
                Scaffold(
                    containerColor = Bg,
                    bottomBar = {
                        Column {
                            MiniPlayer(onOpen = { showPlayer = true })
                            NavigationBar(containerColor = Panel) {
                                destinations.forEach { (t, icon) ->
                                    NavigationBarItem(
                                        selected = tab == t, onClick = { tab = t; stack.clear() },
                                        icon = { Icon(icon, t.name) }, label = { Text(t.name) },
                                        colors = NavigationBarItemDefaults.colors(selectedIconColor = Accent, selectedTextColor = Accent, indicatorColor = PanelHi, unselectedIconColor = Dim, unselectedTextColor = Dim),
                                    )
                                }
                            }
                        }
                    },
                ) { body(it) }
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

// ── Floating player (wide screens): a small card in the corner, so it does not take a bar's worth of width ──
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun FloatingPlayer(onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val t = Control.track ?: return
    var expanded by remember { mutableStateOf(false) } // a long press on the cover shows the song's name
    val progress = if (Control.durationMs > 0) (Control.positionMs.toFloat() / Control.durationMs).coerceIn(0f, 1f) else 0f
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(22.dp)
    Column(
        modifier.width(if (expanded) 220.dp else 148.dp).background(Panel.copy(alpha = 0.96f), shape).border(1.dp, PanelHi, shape).padding(horizontal = 8.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(72.dp).combinedClickable(onClick = onOpen, onLongClick = { expanded = !expanded }), contentAlignment = Alignment.Center) {
            Cover(t.coverArt, 60.dp, round = true)
            androidx.compose.material3.CircularProgressIndicator(progress = { progress }, modifier = Modifier.size(72.dp), color = Accent, trackColor = PanelHi, strokeWidth = 3.dp)
        }
        if (expanded) {
            Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
            Text(if (Control.remote) "on ${targetName()}" else t.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 11.sp, color = if (Control.remote) Accent else Dim)
        }
        Row(horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { Control.previous() }, modifier = Modifier.size(40.dp)) { Icon(painterResource(R.drawable.ic_prev), "Previous", Modifier.size(22.dp)) }
            IconButton(onClick = { Control.toggle() }, modifier = Modifier.size(44.dp)) { Icon(painterResource(if (Control.isPlaying) R.drawable.ic_pause else R.drawable.ic_play), "Play / pause", Modifier.size(28.dp)) }
            IconButton(onClick = { Control.next() }, modifier = Modifier.size(40.dp)) { Icon(painterResource(R.drawable.ic_next), "Next", Modifier.size(22.dp)) }
        }
    }
}

// ── Mini player ──
@Composable
private fun MiniPlayer(onOpen: () -> Unit) {
    val t = Control.track ?: return
    Column(Modifier.fillMaxWidth().clickable(onClick = onOpen).background(Panel)) {
        if (Control.durationMs > 0) LinearProgressIndicator(progress = { (Control.positionMs.toFloat() / Control.durationMs).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().height(2.dp), color = Accent, trackColor = PanelHi)
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Cover(t.coverArt, 44.dp)
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (Control.remote) "on ${targetName()}" else t.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = if (Control.remote) Accent else Dim)
            }
            IconButton(onClick = { Control.toggle() }) {
                Icon(painterResource(if (Control.isPlaying) R.drawable.ic_pause else R.drawable.ic_play), "Play / pause")
            }
            IconButton(onClick = { Control.next() }) { Icon(painterResource(R.drawable.ic_next), "Next") }
        }
    }
}


// ── Home ──
@Composable
private fun HomeScreen(push: (Route) -> Unit, allPlaylists: () -> Unit, onProfile: () -> Unit) {
    val client = LocalClient.current
    val scope = rememberCoroutineScope()
    val discover by load("discover") { client.albums("random", 20) }
    val recent by load("recent") { client.albums("recent", 20) }
    val newest by load("newest") { client.albums("newest", 20) }
    val frequent by load("frequent") { client.albums("frequent", 20) }
    val playlists by load("playlists" to Library.playlistsRevision) { client.playlists() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp + LocalBottomInset.current)) {
        item {
            // Quick buttons (more can be added next to Random mix) and the profile picture
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { scope.launch { runCatching { client.randomSongs(100) }.getOrNull()?.let { Control.playTracks(it, 0) } } },
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 0.dp), modifier = Modifier.height(36.dp),
                    ) { Text("Random mix", fontSize = 14.sp) }
                }
                AvatarView(36.dp, Modifier.padding(start = 12.dp).clickable(onClick = onProfile))
            }
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
    val openOffline = { k: String, i: String -> push(Route.OfflineR(k, i)) }
    Column(Modifier.fillMaxSize()) {
        TabRow(selected, containerColor = Bg, contentColor = Accent) {
            listOf("Albums", "Artists", "Playlists", "Downloads").forEachIndexed { i, s -> Tab(selected == i, { onSelect(i) }, text = { Text(s) }) }
        }
        when (selected) {
            0 -> AlbumsBrowser(AlbumSort.Name, onAlbum = { push(Route.AlbumR(it.id)) })
            1 -> ArtistsBrowser(onArtist = { push(Route.ArtistR(it.id)) })
            2 -> PlaylistsList(push)
            else -> OfflineList(open = openOffline)
        }
    }
}

@Composable
private fun AlbumListScreen(type: String, title: String, onBack: () -> Unit, push: (Route) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        TopBar(title, onBack)
        AlbumsBrowser(AlbumSort.values().firstOrNull { it.type == type } ?: AlbumSort.Name, onAlbum = { push(Route.AlbumR(it.id)) })
    }
}

@Composable
private fun PlaylistsList(push: (Route) -> Unit) {
    val client = LocalClient.current
    val lists by load("playlists-all" to Library.playlistsRevision) { client.playlists() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = LocalBottomInset.current)) {
        items(lists ?: emptyList(), key = { it.id }) { p ->
            CollectionBox("playlist", p.id, p.name, "${p.songCount} songs", p.coverArt, { push(Route.PlaylistR(p.id, p.name)) }, Modifier.fillMaxWidth(), playlist = p) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Cover(p.coverArt, 52.dp)
                    Column(Modifier.padding(start = 12.dp)) { Text((if (cloud.icosahedron.phone.player.Offline.isCollectionKept("playlist", p.id)) "↓ " else "") + p.name, maxLines = 1, overflow = TextOverflow.Ellipsis); Text("${p.songCount} songs", fontSize = 12.sp, color = Dim) }
                }
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
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = LocalBottomInset.current)) {
            if (r != null) {
                if (r.first.isNotEmpty()) { item { SectionHeader("Artists") }; items(r.first, key = { "ar" + it.id }) { a -> ArtistRow(a) { push(Route.ArtistR(a.id)) } } }
                if (r.second.isNotEmpty()) item { AlbumShelf("Albums", r.second, null) { push(Route.AlbumR(it.id)) } }
                if (r.third.isNotEmpty()) {
                    item { SectionHeader("Songs") }
                    itemsIndexed(r.third, key = { _, t -> "t" + t.id }) { i, t -> TrackRow(t) { Control.playTracks(r.third, i) } }
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
private fun PlayShuffle(tracks: List<Track>, target: Target? = null) {
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Button(onClick = { Control.playTracks(tracks, 0) }, modifier = Modifier.weight(1f)) { Text("Play") }
        OutlinedButton(onClick = { Control.playTracks(tracks.shuffled(), 0) }, modifier = Modifier.weight(1f)) { Text("Shuffle") }
        if (target != null) Box {
            OutlinedButton(onClick = { menu = true }, contentPadding = PaddingValues(horizontal = 12.dp)) { Icon(Icons.Filled.MoreVert, "More") }
            TargetMenu(target, menu) { menu = false }
        }
    }
}

/**
 * A page for one album or playlist. On a wide screen (a tablet, a phone on its side, a car) the cover, the names and
 * the buttons stay at the left and only the songs scroll at the right, like Now Playing; on a narrow screen
 * everything scrolls in one column.
 */
@Composable
private fun DetailLayout(
    title: String, coverId: String?, line1: String, onLine1: (() -> Unit)?, line2: String?,
    onBack: () -> Unit, showCoverNarrow: Boolean, actions: @Composable () -> Unit,
    songs: androidx.compose.foundation.lazy.LazyListScope.() -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth > maxHeight && maxWidth >= 560.dp
        if (wide) {
            val pane = maxWidth * 0.4f
            val cover = minOf(pane - 32.dp, maxHeight - 250.dp).coerceIn(120.dp, 340.dp)
            Row(Modifier.fillMaxSize()) {
                Column(Modifier.width(pane).fillMaxHeight().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
                    TopBar("", onBack)
                    Cover(coverId, cover)
                    Text(title, fontSize = 18.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(top = 10.dp, start = 16.dp, end = 16.dp))
                    if (line1.isNotEmpty()) Text(line1, color = Accent, fontSize = 14.sp, modifier = Modifier.clickable(enabled = onLine1 != null) { onLine1?.invoke() })
                    if (line2 != null) Text(line2, color = Dim, fontSize = 12.sp)
                    actions()
                }
                LazyColumn(Modifier.weight(1f).fillMaxHeight(), contentPadding = PaddingValues(bottom = LocalBottomInset.current)) { songs() }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = LocalBottomInset.current)) {
                item {
                    TopBar(title, onBack)
                    if (showCoverNarrow) Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                        Cover(coverId, 220.dp)
                        Text(title, fontSize = 20.sp, modifier = Modifier.padding(top = 12.dp, start = 16.dp, end = 16.dp))
                        if (line1.isNotEmpty()) Text(line1, color = Accent, fontSize = 14.sp, modifier = Modifier.clickable(enabled = onLine1 != null) { onLine1?.invoke() })
                        if (line2 != null) Text(line2, color = Dim, fontSize = 12.sp)
                    }
                    actions()
                }
                songs()
            }
        }
    }
}

@Composable
private fun AlbumScreen(id: String, onBack: () -> Unit, push: (Route) -> Unit) {
    val client = LocalClient.current
    val data by load(id) { client.album(id) }
    val album = data?.first
    val tracks = data?.second ?: emptyList()
    DetailLayout(
        title = album?.name ?: "", coverId = album?.coverArt, line1 = album?.artist ?: "",
        onLine1 = album?.artistId?.let { aid -> { push(Route.ArtistR(aid)) } }, line2 = album?.year?.toString(),
        onBack = onBack, showCoverNarrow = true,
        actions = { if (tracks.isNotEmpty()) PlayShuffle(tracks, album?.let { Target("album", it.id, it.name, it.artist, it.coverArt, album = it, preloaded = tracks, onPage = true) }) },
    ) {
        itemsIndexed(tracks, key = { _, t -> t.id }) { i, t -> TrackRow(t, showCover = false, number = if (t.trackNumber > 0) t.trackNumber else i + 1) { Control.playTracks(tracks, i) } }
    }
}

@Composable
private fun ArtistScreen(id: String, onBack: () -> Unit, push: (Route) -> Unit) {
    val client = LocalClient.current
    val data by load(id) { client.artist(id) }
    val albums = data?.second ?: emptyList()
    Column(Modifier.fillMaxSize()) {
        TopBar(data?.first?.name ?: "", onBack)
        LazyVerticalGrid(GridCells.Adaptive(160.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 12.dp + LocalBottomInset.current), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            items(albums, key = { it.id }) { a -> AlbumCard(a, size = 160.dp) { push(Route.AlbumR(a.id)) } }
        }
    }
}

@Composable
private fun PlaylistScreen(id: String, name: String, onBack: () -> Unit) {
    val client = LocalClient.current
    val tracks by load(id) { client.playlistTracks(id) }
    val list = tracks ?: emptyList()
    val cover = list.firstOrNull()?.coverArt
    DetailLayout(
        title = name, coverId = cover, line1 = "", onLine1 = null, line2 = if (list.isEmpty()) null else "${list.size} songs",
        onBack = onBack, showCoverNarrow = false,
        actions = { if (list.isNotEmpty()) PlayShuffle(list, Target("playlist", id, name, "${list.size} songs", cover, playlist = Playlist(id, name, list.size, cover), preloaded = list, onPage = true)) },
    ) {
        itemsIndexed(list) { i, t -> TrackRow(t) { Control.playTracks(list, i) } }
    }
}

/** The songs kept on the phone: they play without a network. */
@Composable
private fun OfflineList(open: (String, String) -> Unit) {
    val songs = cloud.icosahedron.phone.player.Offline.kept
    val pending = cloud.icosahedron.phone.player.Offline.pending
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = LocalBottomInset.current)) {
        item {
            Text(
                "${songs.size} songs on this phone" + if (pending > 0) " · downloading $pending" else "",
                fontSize = 13.sp, color = Dim, modifier = Modifier.padding(16.dp),
            )
            if (songs.isEmpty()) Text("Use \"Download\" on a song, an album or a playlist.", color = Dim, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp))
            else Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(onClick = { Control.playTracks(songs.toList(), 0) }, modifier = Modifier.weight(1f)) { Text("Play") }
                OutlinedButton(onClick = { Control.playTracks(songs.shuffled(), 0) }, modifier = Modifier.weight(1f)) { Text("Shuffle") }
            }
        }
        if (cloud.icosahedron.phone.player.Offline.collections.isNotEmpty()) {
            item { SectionHeader("Albums and playlists") }
            items(cloud.icosahedron.phone.player.Offline.collections.toList(), key = { it.kind + it.id }) { c ->
                Row(Modifier.fillMaxWidth().clickable { open(c.kind, c.id) }.padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Cover(c.cover, 52.dp)
                    Column(Modifier.padding(start = 12.dp)) { Text(c.name, maxLines = 1, overflow = TextOverflow.Ellipsis); Text((if (c.kind == "album") "Album" else "Playlist") + " · ${c.tracks.size} songs", fontSize = 12.sp, color = Dim) }
                }
            }
            item { SectionHeader("Songs") }
        }
        itemsIndexed(songs.toList(), key = { _, t -> t.id }) { i, t -> TrackRow(t) { Control.playTracks(songs.toList(), i) } }
    }
}

/** A kept album or playlist, from the phone: opens without a network. */
@Composable
private fun OfflineCollectionScreen(kind: String, id: String, onBack: () -> Unit) {
    val c = cloud.icosahedron.phone.player.Offline.collections.firstOrNull { it.kind == kind && it.id == id }
    if (c == null) { onBack(); return }
    DetailLayout(
        title = c.name, coverId = c.cover, line1 = c.subtitle, onLine1 = null, line2 = null,
        onBack = onBack, showCoverNarrow = false,
        actions = { PlayShuffle(c.tracks, Target(c.kind, c.id, c.name, c.subtitle, c.cover, preloaded = c.tracks)) },
    ) {
        itemsIndexed(c.tracks, key = { _, t -> t.id }) { i, t -> TrackRow(t) { Control.playTracks(c.tracks, i) } }
    }
}
