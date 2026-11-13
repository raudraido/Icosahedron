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
import androidx.compose.ui.draw.clip
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
    data class Lib(val section: LibSection) : Route
    data class Dir(val id: String?, val title: String) : Route
}

private enum class Dest { Home, Library, Search, Devices, Settings }

@Composable
fun MainScreen() {
    val app = App.instance
    val session = app.session ?: return
    val client = remember(session) { session.client() }
    var tab by rememberSaveable { mutableStateOf(Dest.Home) }
    var libraryTab by rememberSaveable { mutableIntStateOf(cloud.icosahedron.phone.data.Prefs.libraryTab) }
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
            val compact = maxHeight < 440.dp // a low screen: no labels under the tab icons
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
                        is Route.Lib -> LibrarySectionScreen(top.section, onBack = { stack.removeLast() }, push = push)
                        is Route.Dir -> Column(Modifier.fillMaxSize()) {
                            TopBar(top.title, onBack = { stack.removeLast() })
                            DirectoryScreen(top.id) { id, title -> push(Route.Dir(id, title)) }
                        }
                        null -> when (tab) {
                            Dest.Home -> HomeScreen(
                                push = push,
                                allPlaylists = { if (wide) { libraryTab = 2; tab = Dest.Library } else push(Route.Lib(LibSection.Playlists)) },
                                onProfile = { tab = Dest.Settings },
                            )
                            Dest.Library -> if (wide) LibraryScreen(libraryTab, { libraryTab = it; cloud.icosahedron.phone.data.Prefs.libraryTab = it }, push)
                                else LibraryHome { s -> push(sectionRoute(s)) }
                            Dest.Search -> SearchScreen(push)
                            Dest.Devices -> DevicesScreen()
                            Dest.Settings -> SettingsScreen()
                        }
                    }
                }
            }
            if (wide) {
                Row(Modifier.fillMaxSize()) {
                    // The tabs start at the top and are big: in a car that shakes a small target is easy to miss
                    Column(Modifier.fillMaxHeight().width(112.dp).background(Panel).padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                      Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        destinations.forEach { (t, icon) ->
                            RailTab(icon, t.name, selected = tab == t, compact = compact) { tab = t; stack.clear() }
                        }
                      }
                        RailPlayer(compact, onOpen = { showPlayer = true })
                    }
                    Scaffold(modifier = Modifier.weight(1f), containerColor = Bg) { body(it) }
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
            BackHandler(enabled = stack.isNotEmpty()) { stack.removeLast() }
            BackHandler(enabled = stack.isEmpty() && tab != Dest.Home) { tab = Dest.Home }
            AnimatedVisibility(showPlayer, enter = slideInVertically { it }, exit = slideOutVertically { it }) {
                NowPlayingScreen(onClose = { showPlayer = false })
            }
        }
    }
}

// A tab in the side rail: the whole rounded block is the target (tall and wide), icon above the name
@Composable
private fun RailTab(icon: androidx.compose.ui.graphics.vector.ImageVector, name: String, selected: Boolean, compact: Boolean, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp).height(if (compact) 60.dp else 84.dp)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(18.dp))
            .background(if (selected) PanelHi else androidx.compose.ui.graphics.Color.Transparent)
            .clickable(onClick = onClick),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, name, Modifier.size(if (compact) 30.dp else 34.dp), tint = if (selected) Accent else Dim)
        if (!compact) Text(name, fontSize = 13.sp, color = if (selected) Accent else Dim, modifier = Modifier.padding(top = 4.dp))
    }
}

// ── The player in the side rail (wide screens): only the cover with a ring for the progress ──
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun RailPlayer(compact: Boolean, onOpen: () -> Unit) {
    val t = Control.track ?: return
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    val progress = if (Control.durationMs > 0) (Control.positionMs.toFloat() / Control.durationMs).coerceIn(0f, 1f) else 0f
    val outer = if (compact) 56.dp else 68.dp
    // A tap opens Now Playing, a long press pauses or plays
    Box(
        Modifier.padding(bottom = 12.dp).size(outer).combinedClickable(
            onClick = onOpen,
            onLongClick = { haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress); Control.toggle() },
        ),
        contentAlignment = Alignment.Center,
    ) {
        Cover(t.coverArt, outer - 12.dp, round = true)
        if (!Control.isPlaying) Box(Modifier.size(outer - 12.dp).background(androidx.compose.ui.graphics.Color(0x88000000), androidx.compose.foundation.shape.CircleShape), contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.ic_play), "Paused", Modifier.size(22.dp))
        }
        androidx.compose.material3.CircularProgressIndicator(progress = { progress }, modifier = Modifier.size(outer), color = Accent, trackColor = PanelHi, strokeWidth = 3.dp)
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
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
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
        androidx.compose.material3.ScrollableTabRow(selected, containerColor = Bg, contentColor = Accent, edgePadding = 8.dp) {
            listOf("Albums", "Artists", "Playlists", "Favorite Songs", "Downloads").forEachIndexed { i, s -> Tab(selected == i, { onSelect(i) }, text = { Text(s) }) }
        }
        when (selected) {
            0 -> AlbumsBrowser(AlbumSort.Name, onAlbum = { push(Route.AlbumR(it.id)) }, persist = true)
            1 -> ArtistsBrowser(onArtist = { push(Route.ArtistR(it.id)) })
            2 -> PlaylistsList(push)
            3 -> FavoriteSongs()
            else -> OfflineList(open = openOffline)
        }
    }
}

/** Newest and Recently Played are the album lists; the rest are pages of their own. */
private fun sectionRoute(s: LibSection): Route = when (s) {
    LibSection.Newest -> Route.AlbumList("newest", s.title)
    LibSection.Recent -> Route.AlbumList("recent", s.title)
    LibSection.Directories -> Route.Dir(null, s.title)
    else -> Route.Lib(s)
}

@Composable
private fun LibrarySectionScreen(s: LibSection, onBack: () -> Unit, push: (Route) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        TopBar(s.title, onBack)
        when (s) {
            LibSection.Artists -> ArtistsBrowser(onArtist = { push(Route.ArtistR(it.id)) })
            LibSection.Albums -> AlbumsBrowser(AlbumSort.Name, onAlbum = { push(Route.AlbumR(it.id)) }, persist = true)
            LibSection.Songs -> SongsScreen()
            LibSection.Favorites -> FavoriteSongs()
            LibSection.Downloads -> OfflineList(open = { k, i -> push(Route.OfflineR(k, i)) })
            LibSection.Playlists -> PlaylistsList(push)
            LibSection.Radios -> RadiosScreen()
            else -> {}
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
    LazyColumn(Modifier.fillMaxSize()) {
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
        LazyColumn(Modifier.fillMaxSize()) {
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
                LazyColumn(Modifier.weight(1f).fillMaxHeight()) { songs() }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
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
        LazyVerticalGrid(GridCells.Adaptive(160.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
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

/** The songs marked as favorites (the heart), the same list as Favorite Songs in the iOS app. */
@Composable
private fun FavoriteSongs() {
    val client = LocalClient.current
    // reload when a heart is changed anywhere
    val changes = Favorites.over.entries.joinToString(",") { it.key + it.value }
    val songs by load(changes) { client.starred() }
    val list = songs ?: emptyList()
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Text(if (songs == null) "Loading…" else "${list.size} songs", fontSize = 13.sp, color = Dim, modifier = Modifier.padding(16.dp))
            if (songs != null && list.isEmpty()) Text("Nothing here yet. Mark songs with the heart.", color = Dim, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp))
            if (list.isNotEmpty()) PlayShuffle(list, Target("list", "favorites", "Favorite Songs", "${list.size} songs", list.firstOrNull()?.coverArt, preloaded = list))
        }
        itemsIndexed(list, key = { _, t -> t.id }) { i, t -> TrackRow(t) { Control.playTracks(list, i) } }
    }
}

/** The songs kept on the phone: they play without a network. */
@Composable
private fun OfflineList(open: (String, String) -> Unit) {
    val songs = cloud.icosahedron.phone.player.Offline.kept
    val pending = cloud.icosahedron.phone.player.Offline.pending
    LazyColumn(Modifier.fillMaxSize()) {
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
