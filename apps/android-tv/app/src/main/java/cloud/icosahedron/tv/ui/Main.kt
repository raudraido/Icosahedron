@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Button
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import cloud.icosahedron.tv.App
import cloud.icosahedron.tv.player.Playback

sealed interface Screen {
    data object Home : Screen
    data object Albums : Screen
    data object Artists : Screen
    data object Playlists : Screen
    data object Search : Screen
    data object NowPlaying : Screen
    data object Settings : Screen
    data class AlbumDetail(val id: String) : Screen
    data class ArtistDetail(val id: String) : Screen
    data class PlaylistDetail(val id: String, val name: String) : Screen
}

private val tabs = listOf(
    "Home" to Screen.Home, "Albums" to Screen.Albums, "Artists" to Screen.Artists, "Playlists" to Screen.Playlists,
    "Search" to Screen.Search, "Playing" to Screen.NowPlaying, "Settings" to Screen.Settings,
)

/** Navigation: a stack of screens under a row of tabs; Back pops the stack. */
@Composable
fun MainScreen() {
    val session = App.instance.session ?: return
    val client = remember(session) { session.client() }
    var stack by remember { mutableStateOf<List<Screen>>(listOf(Screen.Home)) }
    val screen = stack.last()
    fun go(s: Screen) { stack = stack + s }
    fun tab(s: Screen) { stack = listOf(s) }
    BackHandler(enabled = stack.size > 1) { stack = stack.dropLast(1) }

    CompositionLocalProvider(LocalClient provides client) {
        Column(Modifier.fillMaxSize().background(Bg)) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 40.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                tabs.forEach { (label, target) ->
                    Button(onClick = { tab(target) }) {
                        Text(label, color = if (screen == target) Accent else androidx.compose.ui.graphics.Color.White)
                    }
                }
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (screen) {
                    Screen.Home -> HomeScreen(::go)
                    Screen.Albums -> AlbumsScreen(::go)
                    Screen.Artists -> ArtistsScreen(::go)
                    Screen.Playlists -> PlaylistsScreen(::go)
                    Screen.Search -> SearchScreen(::go)
                    Screen.NowPlaying -> NowPlayingScreen()
                    Screen.Settings -> SettingsScreen()
                    is Screen.AlbumDetail -> AlbumDetailScreen(screen.id, ::go)
                    is Screen.ArtistDetail -> ArtistDetailScreen(screen.id, ::go)
                    is Screen.PlaylistDetail -> PlaylistDetailScreen(screen.id, screen.name)
                }
            }
            if (screen != Screen.NowPlaying) MiniPlayer(onOpen = { tab(Screen.NowPlaying) })
        }
    }
}

/** What is playing on this TV, one click from the full player. */
@Composable
private fun MiniPlayer(onOpen: () -> Unit) {
    val t = Playback.current ?: return
    Row(
        Modifier.fillMaxWidth().background(Panel).padding(horizontal = 40.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(onClick = onOpen, modifier = Modifier.weight(1f)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Cover(t.coverArt, 48.dp, px = 100)
                Column {
                    Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 16.sp)
                    Text(t.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = Dim)
                }
            }
        }
        ActionButton(if (Playback.isPlaying) "Pause" else "Play", onClick = { Playback.toggle() })
        ActionButton("Next", onClick = { Playback.next() })
    }
}
