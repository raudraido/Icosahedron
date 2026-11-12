package cloud.icosahedron.phone.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cloud.icosahedron.phone.data.Album
import cloud.icosahedron.phone.data.Artist
import kotlinx.coroutines.launch
import java.text.Normalizer

// Albums and Artists in the Library, like the iOS app: sort, filter, grid or list, a letter index.
// The server sorts what it can (getAlbumList2 types); a filtered list is loaded whole and sorted here.

enum class AlbumSort(val type: String, val title: String, val hasIndex: Boolean = false, val worksFiltered: Boolean = false) {
    Name("alphabeticalByName", "Name", true, true),
    AlbumArtist("alphabeticalByArtist", "Album Artist", true, true),
    Added("newest", "Date Added"),
    MostPlayed("frequent", "Most Played"),
    RecentlyPlayed("recent", "Recently Played"),
    Random("random", "Random", false, true),
    Year("byYear", "Release Year", false, true),
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

private fun letterOf(s: String): String {
    val f = Normalizer.normalize(s.trim(), Normalizer.Form.NFD).firstOrNull()?.uppercaseChar() ?: return "#"
    return if (f.isLetter()) f.toString() else "#"
}

private fun orderLetters(set: Set<String>) = set.sortedWith { a, b -> if (a == "#") -1 else if (b == "#") 1 else a.compareTo(b) }

@Composable
private fun LetterIndex(letters: List<String>, onPick: (String) -> Unit) {
    Column(Modifier.fillMaxHeight().padding(end = 2.dp), verticalArrangement = Arrangement.SpaceEvenly, horizontalAlignment = Alignment.CenterHorizontally) {
        letters.forEach { l -> Text(l, fontSize = 11.sp, color = Accent, textAlign = TextAlign.Center, modifier = Modifier.width(22.dp).clickable { onPick(l) }) }
    }
}

@Composable
private fun MenuButton(label: String, content: @Composable (close: () -> Unit) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }) { Text(label, color = Accent) }
        DropdownMenu(open, { open = false }) { content { open = false } }
    }
}

@Composable
fun AlbumsBrowser(initial: AlbumSort, onAlbum: (Album) -> Unit) {
    val client = LocalClient.current
    var sort by rememberSaveable { mutableStateOf(initial) }
    var filter by remember { mutableStateOf<AlbumFilter>(AlbumFilter.All) }
    var grid by rememberSaveable { mutableStateOf(true) }
    var albums by remember { mutableStateOf<List<Album>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    val genres by load("genres") { client.genres() }
    val state = rememberLazyGridState()
    val scope = rememberCoroutineScope()

    fun sorted(list: List<Album>): List<Album> = when (sort) {
        AlbumSort.AlbumArtist -> list.sortedWith(compareBy<Album, String>(String.CASE_INSENSITIVE_ORDER) { it.artist }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name })
        AlbumSort.Year -> list.sortedWith(compareByDescending<Album> { it.year ?: 0 }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name })
        AlbumSort.Random -> list.shuffled()
        else -> list.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
    }

    LaunchedEffect(sort, filter.key) {
        albums = emptyList(); loading = true
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
        } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { }
        loading = false
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(listOfNotNull(filter.label, "${albums.size} albums").joinToString(" · "), fontSize = 13.sp, color = Dim, modifier = Modifier.weight(1f))
            if (loading) CircularProgressIndicator(Modifier.padding(end = 8.dp).width(16.dp), strokeWidth = 2.dp, color = Accent)
            MenuButton("Sort") { close ->
                AlbumSort.values().forEach { s ->
                    DropdownMenuItem(
                        text = { Text((if (sort == s) "✓ " else "") + s.title) }, enabled = filter is AlbumFilter.All || s.worksFiltered,
                        onClick = { sort = s; close() },
                    )
                }
            }
            MenuButton("Filter") { close ->
                fun item(label: String, f: AlbumFilter, selected: Boolean) = @Composable {
                    DropdownMenuItem(text = { Text((if (selected) "✓ " else "") + label) }, onClick = {
                        filter = f; if (f !is AlbumFilter.All && !sort.worksFiltered) sort = AlbumSort.Name; close()
                    })
                }
                item("All albums", AlbumFilter.All, filter is AlbumFilter.All)()
                item("Favorites", AlbumFilter.Favorites, filter is AlbumFilter.Favorites)()
                decades.forEach { d -> item(d.name, d, filter == d)() }
                (genres ?: emptyList()).forEach { g -> item(g, AlbumFilter.Genre(g), filter == AlbumFilter.Genre(g))() }
            }
            TextButton(onClick = { grid = !grid }) { Text(if (grid) "List" else "Grid", color = Accent) }
        }
        val letters = if (sort.hasIndex && filter.let { it is AlbumFilter.All || true }) orderLetters(albums.map { letterOf(if (sort == AlbumSort.AlbumArtist) it.artist else it.name) }.toSet()) else emptyList()
        Row(Modifier.fillMaxSize()) {
            LazyVerticalGrid(
                if (grid) GridCells.Adaptive(160.dp) else GridCells.Fixed(1), Modifier.weight(1f), state = state,
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(if (grid) 14.dp else 4.dp),
            ) {
                items(albums, key = { it.id }) { a ->
                    if (grid) AlbumCard(a, size = 160.dp) { onAlbum(a) }
                    else CollectionBox("album", a.id, a.name, a.artist, a.coverArt, { onAlbum(a) }, Modifier.fillMaxWidth(), album = a) { Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Cover(a.coverArt, 56.dp)
                        Column(Modifier.padding(start = 12.dp)) {
                            Text((if (cloud.icosahedron.phone.player.Offline.isCollectionKept("album", a.id)) "↓ " else "") + a.name, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(listOfNotNull(a.artist, a.year?.toString()).joinToString(" · "), fontSize = 12.sp, color = Dim, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    } }
                }
            }
            if (letters.size > 1) LetterIndex(letters) { l ->
                val i = albums.indexOfFirst { letterOf(if (sort == AlbumSort.AlbumArtist) it.artist else it.name) == l }
                if (i >= 0) scope.launch { state.scrollToItem(i) }
            }
        }
    }
}

private enum class ArtistSort(val title: String) { Name("Name"), MostAlbums("Most albums"), Random("Random") }

@Composable
fun ArtistsBrowser(onArtist: (Artist) -> Unit) {
    val client = LocalClient.current
    var sort by rememberSaveable { mutableStateOf(ArtistSort.Name) }
    var favoritesOnly by rememberSaveable { mutableStateOf(false) }
    var grid by rememberSaveable { mutableStateOf(false) }
    val all by load("artists") { client.artists() }
    val favorites by load("fav-artists") { client.starredAlbumsAndArtists().second.map { it.id }.toSet() }
    val shuffled = remember(all) { all?.shuffled() ?: emptyList() }
    val state = rememberLazyGridState()
    val scope = rememberCoroutineScope()

    val list = remember(all, sort, favoritesOnly, favorites, shuffled) {
        var l = all ?: emptyList()
        if (favoritesOnly) l = l.filter { favorites?.contains(it.id) == true }
        when (sort) {
            ArtistSort.Name -> l.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
            ArtistSort.MostAlbums -> l.sortedWith(compareByDescending<Artist> { it.albumCount }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name })
            ArtistSort.Random -> { val order = shuffled.withIndex().associate { it.value.id to it.index }; l.sortedBy { order[it.id] ?: 0 } }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(listOfNotNull(if (favoritesOnly) "Favorites" else null, "${list.size} artists").joinToString(" · "), fontSize = 13.sp, color = Dim, modifier = Modifier.weight(1f))
            MenuButton("Sort") { close -> ArtistSort.values().forEach { s -> DropdownMenuItem(text = { Text((if (sort == s) "✓ " else "") + s.title) }, onClick = { sort = s; close() }) } }
            TextButton(onClick = { favoritesOnly = !favoritesOnly }) { Text(if (favoritesOnly) "All" else "Favorites", color = Accent) }
            TextButton(onClick = { grid = !grid }) { Text(if (grid) "List" else "Grid", color = Accent) }
        }
        val letters = if (sort == ArtistSort.Name) orderLetters(list.map { letterOf(it.name) }.toSet()) else emptyList()
        Row(Modifier.fillMaxSize()) {
            LazyVerticalGrid(if (grid) GridCells.Adaptive(110.dp) else GridCells.Fixed(1), Modifier.weight(1f), state = state, contentPadding = PaddingValues(horizontal = if (grid) 12.dp else 0.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(if (grid) 14.dp else 0.dp)) {
                items(list, key = { it.id }) { a ->
                    if (grid) Column(Modifier.clickable { onArtist(a) }, horizontalAlignment = Alignment.CenterHorizontally) {
                        Cover(a.coverArt, 96.dp, round = true)
                        Text(a.name, fontSize = 13.sp, maxLines = 2, textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                    } else ArtistRow(a) { onArtist(a) }
                }
            }
            if (letters.size > 1) LetterIndex(letters) { l ->
                val i = list.indexOfFirst { letterOf(it.name) == l }
                if (i >= 0) scope.launch { state.scrollToItem(i) }
            }
        }
    }
}
