@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Button
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import cloud.icosahedron.tv.data.Album
import cloud.icosahedron.tv.data.Artist
import cloud.icosahedron.tv.data.Playlist

// The Albums, Artists and Playlists tabs with a Sort and a Filter button over the list, like the phones. A remote has no menus:
// a button opens a list of the choices over the screen, OK picks one, Back closes it.

/** The last choice on each page, kept while the app runs (leaving the tab and coming back finds the list as it was left). */
private object BrowseMemory {
    var albumSort = AlbumSort.Name
    var albumFilter: AlbumFilter = AlbumFilter.All
    var artistSort = ArtistSort.Name
    var artistFavorites = false
    var playlistSort = PlaylistSort.Name
}

private enum class AlbumSort(val type: String, val title: String, val worksFiltered: Boolean = false) {
    Name("alphabeticalByName", "Name", true),
    AlbumArtist("alphabeticalByArtist", "Album Artist", true),
    Added("newest", "Date Added"),
    MostPlayed("frequent", "Most Played"),
    RecentlyPlayed("recent", "Recently Played"),
    Random("random", "Random", true),
    Year("byYear", "Release Year", true),
}

private sealed class AlbumFilter(val key: String, val label: String?) {
    data object All : AlbumFilter("all", null)
    data object Favorites : AlbumFilter("fav", "Favorites")
    data class Genre(val g: String) : AlbumFilter("genre:$g", g)
    data class Years(val name: String, val from: Int, val to: Int) : AlbumFilter("years:$from-$to", name)
}

private val decades = listOf(
    AlbumFilter.Years("2020s", 2020, 2029), AlbumFilter.Years("2010s", 2010, 2019), AlbumFilter.Years("2000s", 2000, 2009),
    AlbumFilter.Years("1990s", 1990, 1999), AlbumFilter.Years("1980s", 1980, 1989), AlbumFilter.Years("1970s", 1970, 1979),
    AlbumFilter.Years("1960s", 1960, 1969), AlbumFilter.Years("1950s", 1950, 1959), AlbumFilter.Years("Earlier", 1, 1949),
)

private enum class ArtistSort(val title: String) { Name("Name"), MostAlbums("Most albums"), Random("Random") }
private enum class PlaylistSort(val title: String) { Name("Name"), MostSongs("Most songs"), FewestSongs("Fewest songs") }

/** The line over a list: what it shows, and the buttons that open the choices. */
@Composable
private fun BrowseBar(summary: String, loading: Boolean, sort: String?, onSort: (() -> Unit)?, filter: String?, onFilter: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 48.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(summary + if (loading) " …" else "", color = Dim, fontSize = 14.sp, modifier = Modifier.weight(1f))
        if (onSort != null) ActionButton("Sort: $sort", onSort)
        if (onFilter != null) ActionButton("Filter: $filter", onFilter)
    }
}

/** A list of choices over the screen. The chosen one has the focus when it opens; Back closes it. */
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
private fun <T> Picker(title: String, options: List<T>, selected: T?, label: (T) -> String, onPick: (T) -> Unit, onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    val focus = remember { FocusRequester() }
    val start = options.indexOf(selected).coerceAtLeast(0)
    Box(Modifier.fillMaxSize().background(Color(0xCC000000)), contentAlignment = Alignment.Center) {
        // The focus stays inside the list while it is open (the page under it must not take it)
        Column(Modifier.width(460.dp).background(Panel, RoundedCornerShape(14.dp)).padding(20.dp).focusProperties { exit = { FocusRequester.Cancel } }.focusGroup()) {
            Text(title, fontSize = 22.sp, modifier = Modifier.padding(bottom = 10.dp))
            LazyColumn(Modifier.heightIn(max = 380.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                itemsIndexed(options) { i, o ->
                    Button(onClick = { onPick(o) }, modifier = Modifier.fillMaxWidth().then(if (i == start) Modifier.focusRequester(focus) else Modifier)) {
                        Text((if (o == selected) "✓  " else "") + label(o))
                    }
                }
            }
        }
    }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
}

@Composable
fun AlbumsScreen(go: (Screen) -> Unit) {
    val client = LocalClient.current
    var sort by remember { mutableStateOf(BrowseMemory.albumSort) }
    var filter by remember { mutableStateOf(BrowseMemory.albumFilter) }
    var albums by remember { mutableStateOf<List<Album>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var failure by remember { mutableStateOf<String?>(null) }
    var picker by remember { mutableStateOf<String?>(null) }
    val genres = load("genres") { client.genres() }.value?.getOrNull() ?: emptyList()
    LaunchedEffect(sort, filter.key) { BrowseMemory.albumSort = sort; BrowseMemory.albumFilter = filter }

    fun sorted(list: List<Album>): List<Album> = when (sort) {
        AlbumSort.AlbumArtist -> list.sortedWith(compareBy<Album, String>(String.CASE_INSENSITIVE_ORDER) { it.artist }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name })
        AlbumSort.Year -> list.sortedWith(compareByDescending<Album> { it.year ?: 0 }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name })
        AlbumSort.Random -> list.shuffled()
        else -> list.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
    }

    LaunchedEffect(sort, filter.key) {
        albums = emptyList(); loading = true; failure = null
        try {
            val f = filter
            when {
                f is AlbumFilter.All && sort == AlbumSort.Random -> albums = client.albums("random", 200)
                f is AlbumFilter.Favorites -> albums = sorted(client.starredAlbumsAndArtists().first)
                else -> {
                    val (type, genre, from, to) = when (f) {
                        is AlbumFilter.Genre -> listOf<Any?>("byGenre", f.g, null, null)
                        is AlbumFilter.Years -> listOf<Any?>("byYear", null, f.from, f.to)
                        else -> listOf<Any?>(sort.type, null, if (sort == AlbumSort.Year) 3000 else null, if (sort == AlbumSort.Year) 1 else null)
                    }
                    var offset = 0
                    val all = ArrayList<Album>()
                    while (offset < 10_000) {
                        val page = client.albums(type as String, 500, offset, genre as String?, from as Int?, to as Int?)
                        all += page
                        albums = if (f is AlbumFilter.All) all.toList() else sorted(all)
                        if (page.size < 500) break
                        offset += 500
                    }
                }
            }
        } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { failure = e.message ?: "Could not load" }
        loading = false
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            BrowseBar(
                listOfNotNull(filter.label, "${albums.size} albums").joinToString(" · "), loading,
                sort.title, { picker = "sort" }, filter.label ?: "All", { picker = "filter" },
            )
            when {
                failure != null -> Message(failure ?: "")
                !loading && albums.isEmpty() -> Message("No albums")
                else -> LazyVerticalGrid(
                    columns = GridCells.Adaptive(176.dp),
                    contentPadding = PaddingValues(horizontal = 48.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(albums, key = { it.id }) { a -> AlbumCard(a) { go(Screen.AlbumDetail(a.id)) } }
                }
            }
        }
        when (picker) {
            "sort" -> Picker("Sort albums", AlbumSort.values().filter { filter is AlbumFilter.All || it.worksFiltered }, sort, { it.title }, { sort = it; picker = null }, { picker = null })
            "filter" -> Picker(
                "Filter albums", listOf<AlbumFilter>(AlbumFilter.All, AlbumFilter.Favorites) + decades + genres.map { AlbumFilter.Genre(it) }, filter, { it.label ?: "All albums" },
                { f -> filter = f; if (f !is AlbumFilter.All && !sort.worksFiltered) sort = AlbumSort.Name; picker = null }, { picker = null },
            )
        }
    }
}

@Composable
fun ArtistsScreen(go: (Screen) -> Unit) {
    val client = LocalClient.current
    var sort by remember { mutableStateOf(BrowseMemory.artistSort) }
    var favoritesOnly by remember { mutableStateOf(BrowseMemory.artistFavorites) }
    var picker by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(sort, favoritesOnly) { BrowseMemory.artistSort = sort; BrowseMemory.artistFavorites = favoritesOnly }
    val result by load("artists") { client.artists() }
    val favorites = load("fav-artists") { client.starredAlbumsAndArtists().second.map { it.id }.toSet() }.value?.getOrNull()
    val all = result?.getOrNull()
    val shuffled = remember(all) { all?.shuffled() ?: emptyList() }
    val list = remember(all, sort, favoritesOnly, favorites, shuffled) {
        var l = all ?: emptyList()
        if (favoritesOnly) l = l.filter { favorites?.contains(it.id) == true }
        when (sort) {
            ArtistSort.Name -> l.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
            ArtistSort.MostAlbums -> l.sortedWith(compareByDescending<Artist> { it.albumCount }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name })
            ArtistSort.Random -> { val order = shuffled.withIndex().associate { it.value.id to it.index }; l.sortedBy { order[it.id] ?: 0 } }
        }
    }
    val r = result
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            if (r != null && r.isSuccess) BrowseBar(
                listOfNotNull("Favorites".takeIf { favoritesOnly }, "${list.size} artists").joinToString(" · "), false,
                sort.title, { picker = "sort" }, if (favoritesOnly) "Favorites" else "All", { picker = "filter" },
            )
            when {
                r == null -> Message("Loading…")
                r.isFailure -> Message(r.exceptionOrNull()?.message ?: "Could not load")
                list.isEmpty() -> Message(if (favoritesOnly) "No favorite artists" else "No artists")
                else -> LazyVerticalGrid(
                    columns = GridCells.Adaptive(176.dp), // the same cells as the albums
                    contentPadding = PaddingValues(horizontal = 48.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(list, key = { it.id }) { a -> ArtistCard(a) { go(Screen.ArtistDetail(a.id)) } }
                }
            }
        }
        when (picker) {
            "sort" -> Picker("Sort artists", ArtistSort.values().toList(), sort, { it.title }, { sort = it; picker = null }, { picker = null })
            "filter" -> Picker("Filter artists", listOf(false, true), favoritesOnly, { if (it) "Favorites" else "All artists" }, { favoritesOnly = it; picker = null }, { picker = null })
        }
    }
}

@Composable
fun PlaylistsScreen(go: (Screen) -> Unit) {
    val client = LocalClient.current
    var sort by remember { mutableStateOf(BrowseMemory.playlistSort) }
    var picker by remember { mutableStateOf(false) }
    LaunchedEffect(sort) { BrowseMemory.playlistSort = sort }
    val result by load("playlists") { client.playlists() }
    val r = result
    Box(Modifier.fillMaxSize()) {
        when {
            r == null -> Message("Loading…")
            r.isFailure -> Message(r.exceptionOrNull()?.message ?: "Could not load")
            r.getOrThrow().isEmpty() -> Message("No playlists yet")
            else -> {
                val list: List<Playlist> = when (sort) {
                    PlaylistSort.Name -> r.getOrThrow().sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
                    PlaylistSort.MostSongs -> r.getOrThrow().sortedWith(compareByDescending<Playlist> { it.songCount }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name })
                    PlaylistSort.FewestSongs -> r.getOrThrow().sortedWith(compareBy<Playlist> { it.songCount }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name })
                }
                Column(Modifier.fillMaxSize()) {
                    BrowseBar("${list.size} playlists", false, sort.title, { picker = true }, null, null)
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 12.dp)) {
                        items(list.size) { i ->
                            val p = list[i]
                            Button(
                                onClick = { go(Screen.PlaylistDetail(p.id, p.name)) },
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 48.dp, vertical = 2.dp),
                            ) {
                                Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Cover(p.coverArt, 56.dp, px = 120)
                                    Column {
                                        Text(p.name, fontSize = 18.sp)
                                        Text("${p.songCount} songs", fontSize = 12.sp, color = dim())
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if (picker) Picker("Sort playlists", PlaylistSort.values().toList(), sort, { it.title }, { sort = it; picker = false }, { picker = false })
    }
}
