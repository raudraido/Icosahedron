@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import android.app.Activity
import android.os.SystemClock
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Button
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import cloud.icosahedron.tv.App
import cloud.icosahedron.tv.R
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

/** The tabs of the top bar; Now Playing has its own button at the right end. */
private val tabs = listOf(
    "Home" to Screen.Home, "Albums" to Screen.Albums, "Artists" to Screen.Artists, "Playlists" to Screen.Playlists,
    "Search" to Screen.Search, "Settings" to Screen.Settings,
)

private const val EXIT_WINDOW_MS = 2000L

/**
 * Navigation: a stack of screens under a top bar that is always on screen (logo, tabs, Now Playing).
 *
 * Back never leaves the app at once. It goes one step at a time: out of an album / artist / playlist to
 * the list before it; from the content (however far down a long list) up to the top bar; from another
 * tab to Home; and on Home only a second Back within two seconds closes the app. The Menu key opens
 * Now Playing from anywhere.
 */
@Composable
fun MainScreen() {
    val session = App.instance.session ?: return
    val client = remember(session) { session.client() }
    val context = LocalContext.current
    var stack by remember { mutableStateOf<List<Screen>>(listOf(Screen.Home)) }
    val screen = stack.last()
    val bar = remember { FocusRequester() } // the button of the tab you are on
    var contentHasFocus by remember { mutableStateOf(false) }
    var lastBack by remember { mutableLongStateOf(0L) }
    fun go(s: Screen) { stack = stack + s }
    fun tab(s: Screen) { stack = listOf(s) }

    BackHandler {
        when {
            stack.size > 1 -> stack = stack.dropLast(1)
            contentHasFocus -> runCatching { bar.requestFocus() }
            screen != Screen.Home -> tab(Screen.Home)
            else -> {
                val now = SystemClock.elapsedRealtime()
                if (now - lastBack < EXIT_WINDOW_MS) {
                    (context as? Activity)?.finish()
                } else {
                    lastBack = now
                    Toast.makeText(context, "Press Back again to exit", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    CompositionLocalProvider(LocalClient provides client) {
        Column(
            Modifier.fillMaxSize().background(Bg).onPreviewKeyEvent { e ->
                if (e.key == Key.Menu && e.type == KeyEventType.KeyUp) { tab(Screen.NowPlaying); true } else false
            },
        ) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Image(painterResource(R.drawable.logo), contentDescription = "Icosahedron", modifier = Modifier.padding(end = 16.dp).size(48.dp))
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    tabs.forEach { (label, target) ->
                        val selected = screen == target
                        Button(
                            onClick = { tab(target) },
                            colors = navColors(selected),
                            modifier = if (selected) Modifier.focusRequester(bar) else Modifier,
                        ) { Text(label) }
                    }
                }
                NowPlayingButton(
                    selected = screen == Screen.NowPlaying,
                    modifier = if (screen == Screen.NowPlaying) Modifier.focusRequester(bar) else Modifier,
                    onClick = { tab(Screen.NowPlaying) },
                )
            }
            Box(Modifier.weight(1f).fillMaxWidth().onFocusChanged { contentHasFocus = it.hasFocus }) {
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

/** Top right, always there: opens the player, and says what plays. */
@Composable
private fun NowPlayingButton(selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val t = Playback.current
    Button(onClick = onClick, colors = navColors(selected), modifier = modifier) {
        Text(
            if (t != null) (if (Playback.isPlaying) "♪  " else "❚❚  ") + t.title else "Now Playing",
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 320.dp),
        )
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
                    Text(t.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = dim())
                }
            }
        }
        ActionButton(if (Playback.isPlaying) "Pause" else "Play", onClick = { Playback.toggle() })
        ActionButton("Next", onClick = { Playback.next() })
    }
}
