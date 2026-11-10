@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import android.app.Activity
import android.os.SystemClock
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Button
import androidx.tv.material3.Border
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import cloud.icosahedron.tv.App
import cloud.icosahedron.tv.R
import cloud.icosahedron.tv.player.Playback
import kotlinx.coroutines.delay

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

/** The tabs of the top bar; Now Playing and the profile (Settings) have their own buttons at the right end. */
private val tabs = listOf(
    "Home" to Screen.Home, "Albums" to Screen.Albums, "Artists" to Screen.Artists, "Playlists" to Screen.Playlists,
    "Search" to Screen.Search,
)

private const val EXIT_WINDOW_MS = 2000L
private const val IDLE_MS = 20_000L

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
    var refocusBar by remember { mutableStateOf(false) } // after Back to Home: focus the Home tab
    // Now Playing: after twenty seconds without a key press only the cover stays (nothing else is lit up all night on
    // an OLED screen); the first key press then only wakes the screen and does nothing else.
    var idle by remember { mutableStateOf(false) }
    var keyCount by remember { mutableIntStateOf(0) }
    var swallowUp by remember { mutableStateOf(false) }
    LaunchedEffect(screen == Screen.NowPlaying, keyCount) {
        idle = false
        if (screen == Screen.NowPlaying) {
            delay(IDLE_MS)
            idle = true
        }
    }
    fun go(s: Screen) { stack = stack + s }
    fun tab(s: Screen) { stack = listOf(s) }

    BackHandler {
        when {
            stack.size > 1 -> stack = stack.dropLast(1)
            contentHasFocus -> runCatching { bar.requestFocus() }
            screen != Screen.Home -> { tab(Screen.Home); refocusBar = true }
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

    LaunchedEffect(screen) {
        if (refocusBar) {
            refocusBar = false
            runCatching { bar.requestFocus() }
        }
    }

    CompositionLocalProvider(LocalClient provides client) {
        // Now Playing takes its background colour from the cover of the playing song.
        val tint = rememberCoverTint(Playback.current?.coverArt)
        val tintColor by animateColorAsState(tint ?: Bg, tween(800), label = "tint")
        val barAlpha by animateFloatAsState(if (screen == Screen.NowPlaying && idle) 0f else 1f, tween(600), label = "barAlpha")
        Column(
            Modifier.fillMaxSize()
                .background(if (screen == Screen.NowPlaying) Brush.verticalGradient(listOf(tintColor, Bg)) else SolidColor(Bg))
                .onPreviewKeyEvent { e ->
                    if (e.type == KeyEventType.KeyDown) {
                        keyCount++
                        if (idle && screen == Screen.NowPlaying) { swallowUp = true; return@onPreviewKeyEvent true }
                    }
                    if (e.type == KeyEventType.KeyUp && swallowUp) { swallowUp = false; return@onPreviewKeyEvent true }
                    if (e.key == Key.Menu && e.type == KeyEventType.KeyUp) { tab(Screen.NowPlaying); true } else false
                },
        ) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 10.dp).alpha(barAlpha),
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
                NowPlayingCard(
                    selected = screen == Screen.NowPlaying,
                    modifier = if (screen == Screen.NowPlaying) Modifier.focusRequester(bar) else Modifier,
                    onClick = { tab(Screen.NowPlaying) },
                )
                // Only the round picture: a ring in the accent colour when it is the page you are on, a white one
                // and a little growth when it has the focus.
                Surface(
                    onClick = { tab(Screen.Settings) },
                    shape = ClickableSurfaceDefaults.shape(CircleShape),
                    colors = ClickableSurfaceDefaults.colors(
                        containerColor = Color.Transparent, contentColor = Color.White,
                        focusedContainerColor = Color.Transparent, focusedContentColor = Color.White,
                        pressedContainerColor = Color.Transparent, pressedContentColor = Color.White,
                    ),
                    scale = ClickableSurfaceDefaults.scale(focusedScale = 1.14f),
                    border = ClickableSurfaceDefaults.border(
                        border = if (screen == Screen.Settings) Border(BorderStroke(2.dp, Accent), shape = CircleShape) else Border.None,
                        focusedBorder = Border(BorderStroke(2.dp, Color.White), shape = CircleShape),
                    ),
                    modifier = Modifier.padding(start = 14.dp).then(if (screen == Screen.Settings) Modifier.focusRequester(bar) else Modifier),
                ) { ProfileAvatar(44.dp) }
            }
            Box(Modifier.weight(1f).fillMaxWidth().onFocusChanged { contentHasFocus = it.hasFocus }) {
                when (screen) {
                    Screen.Home -> HomeScreen(::go)
                    Screen.Albums -> AlbumsScreen(::go)
                    Screen.Artists -> ArtistsScreen(::go)
                    Screen.Playlists -> PlaylistsScreen(::go)
                    Screen.Search -> SearchScreen(::go)
                    Screen.NowPlaying -> NowPlayingScreen(idle)
                    Screen.Settings -> SettingsScreen()
                    is Screen.AlbumDetail -> AlbumDetailScreen(screen.id, ::go)
                    is Screen.ArtistDetail -> ArtistDetailScreen(screen.id, ::go)
                    is Screen.PlaylistDetail -> PlaylistDetailScreen(screen.id, screen.name)
                }
            }
        }
    }
}

/**
 * Top right, always there: a small card with the cover, the song and the artist on two lines, and bars that
 * dance while it plays; one click opens the player. Without a song it only says "Now Playing".
 */
@Composable
private fun NowPlayingCard(selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val t = Playback.current
    Button(
        onClick = onClick,
        colors = chipColors(selected),
        shape = ButtonDefaults.shape(RoundedCornerShape(10.dp)),
        contentPadding = PaddingValues(6.dp),
        modifier = modifier,
    ) {
        if (t == null) {
            Text("Now Playing", modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Cover(t.coverArt, 44.dp, px = 100)
                Column(Modifier.widthIn(min = 110.dp, max = 220.dp)) {
                    Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Text(t.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = dim())
                }
                EqualizerBars(Playback.isPlaying, Accent, Modifier.padding(end = 6.dp))
            }
        }
    }
}
