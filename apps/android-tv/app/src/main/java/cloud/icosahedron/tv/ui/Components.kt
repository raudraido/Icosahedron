@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import androidx.compose.foundation.background
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import cloud.icosahedron.tv.player.Playback
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.Surface
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Button
import androidx.tv.material3.Card
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import cloud.icosahedron.tv.data.Album
import cloud.icosahedron.tv.data.SubsonicClient
import cloud.icosahedron.tv.data.Track
import coil.compose.AsyncImage
import coil.compose.SubcomposeAsyncImage
import coil.request.ImageRequest
import java.net.URLEncoder

val LocalClient = compositionLocalOf<SubsonicClient> { error("no client") }

/** Goes to another screen (an album, an artist); set by the main screen, used by the song menu. */
val LocalNavigate = compositionLocalOf<(Screen) -> Unit> { {} }

/** Runs `block` when `key` changes; null while loading, then the result or the failure. */
@Composable
fun <T> load(key: Any?, block: suspend () -> T): State<Result<T>?> =
    produceState<Result<T>?>(null, key) { value = runCatching { block() } }

@Composable
fun Cover(coverId: String?, size: Dp, modifier: Modifier = Modifier, px: Int = 400, round: Boolean = false) {
    val url = LocalClient.current.coverUrl(coverId, px)
    AsyncImage(
        model = url,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = modifier.size(size).clip(if (round) CircleShape else RoundedCornerShape(8.dp)).background(PanelHi),
    )
}

@Composable
fun AlbumCard(album: Album, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.width(176.dp)) {
        Cover(album.coverArt, 176.dp)
        Column(Modifier.padding(horizontal = 8.dp, vertical = 6.dp)) {
            Text(album.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp)
            Text(album.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = dim())
        }
    }
}

@Composable
fun SectionTitle(text: String) {
    Text(text, fontSize = 22.sp, modifier = Modifier.padding(start = 48.dp, top = 20.dp, bottom = 10.dp))
}

@Composable
fun Message(text: String) {
    Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) { Text(text, color = Dim) }
}

fun fmt(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(s / 60, s % 60)
}

/**
 * One track of a list. No background at rest (a list is not a stack of grey bars); the one that has the focus gets a soft light
 * background, a little growth and an accent mark at its left. At the left the track's cover (the playing one has the dancing bars on
 * it), or its number when the cover is the same for every row (an album); the title, "artist · album" under it, the length at the right.
 */
@Composable
fun TrackRow(
    track: Track, number: Int?, playing: Boolean, horizontalPadding: Dp = 48.dp,
    showCover: Boolean = true, showAlbum: Boolean = showCover, showNumber: Boolean = !showCover, modifier: Modifier = Modifier, onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    if (menu) TrackMenu(track) { menu = false }
    Surface(
        onClick = onClick,
        // Holding OK opens the menu of the song (queue, go to the album or the artist, playlist, favorite)
        onLongClick = { menu = true },
        modifier = modifier.fillMaxWidth().padding(horizontal = horizontalPadding, vertical = 2.dp).onFocusChanged { focused = it.hasFocus },
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(12.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Color.Transparent, contentColor = Color.White,
            focusedContainerColor = Color(0x2EFFFFFF), focusedContentColor = Color.White,
            pressedContainerColor = Color(0x45FFFFFF), pressedContentColor = Color.White,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.02f),
    ) {
        Row(Modifier.padding(end = 14.dp).height(68.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(4.dp).height(36.dp).clip(RoundedCornerShape(2.dp)).background(if (focused) Accent else Color.Transparent))
            Spacer(Modifier.width(10.dp))
            if (showCover && showNumber) Text(number?.toString() ?: "", color = dim(), modifier = Modifier.width(32.dp), fontSize = 15.sp)
            if (showCover) {
                Box(Modifier.size(56.dp), contentAlignment = Alignment.Center) {
                    Cover(track.coverArt, 56.dp, px = 160)
                    if (playing) Box(Modifier.size(56.dp).clip(RoundedCornerShape(8.dp)).background(Color(0x99000000)), contentAlignment = Alignment.Center) {
                        EqualizerBars(Playback.isPlaying, Accent, Modifier.size(24.dp))
                    }
                }
            } else {
                // The playing track is marked with a note in the accent colour
                Text(if (playing) "♪" else (number?.toString() ?: ""), color = if (playing) Accent else dim(), modifier = Modifier.width(44.dp), fontSize = 18.sp)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 18.sp, color = if (playing) Accent else Color.White)
                val line = listOfNotNull(track.artist.takeIf { it.isNotBlank() }, track.album?.takeIf { showAlbum && it.isNotBlank() }).joinToString(" · ")
                if (line.isNotEmpty()) Text(line, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp, color = Dim)
            }
            Spacer(Modifier.width(12.dp))
            Text(fmt(track.duration * 1000L), color = Dim, fontSize = 14.sp)
        }
    }
}

/** An artist's picture, round; the first letter on a plain disc when the server has no picture for the artist. */
@Composable
fun ArtistPicture(artist: cloud.icosahedron.tv.data.Artist, size: Dp) {
    val url = LocalClient.current.coverUrl(artist.coverArt, 360)
    val letter: @Composable () -> Unit = {
        Box(Modifier.size(size).clip(CircleShape).background(PanelHi), contentAlignment = Alignment.Center) {
            Text((artist.name.trim().firstOrNull() ?: '?').uppercase(), fontSize = (size.value * 0.42f).sp, color = Dim)
        }
    }
    if (url == null) { letter(); return }
    SubcomposeAsyncImage(
        model = url, contentDescription = null, contentScale = ContentScale.Crop,
        modifier = Modifier.size(size).clip(CircleShape).background(PanelHi),
        loading = { Box(Modifier.size(size).background(PanelHi)) }, error = { letter() },
    )
}

@Composable
fun ActionButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Button(onClick = onClick, modifier = modifier) { Text(text, modifier = Modifier.padding(horizontal = 8.dp)) }
}


/** The first letter of the user name on the accent colour: shown while the picture loads and when there is none. */
@Composable
private fun LetterAvatar(user: String, size: Dp) {
    Box(Modifier.size(size).clip(CircleShape).background(Accent), contentAlignment = Alignment.Center) {
        Text((user.trim().firstOrNull() ?: '?').uppercase(), fontSize = (size.value * 0.5f).sp, color = Color.White)
    }
}

/**
 * The profile picture the sync server keeps (GET /avatar/<user>, the same one every Icosahedron app shows),
 * or the first letter of the name when there is none.
 */
@Composable
fun ProfileAvatar(size: Dp) {
    val client = LocalClient.current
    val context = LocalContext.current
    val request = remember(client) {
        fun enc(v: String) = URLEncoder.encode(v, "UTF-8")
        ImageRequest.Builder(context)
            .data(client.baseUrl.trimEnd('/') + "/avatar/" + enc(client.user).replace("+", "%20"))
            .addHeader("Authorization", "Subsonic u=${enc(client.user)}&t=${enc(client.token)}&s=${enc(client.salt)}")
            .build()
    }
    SubcomposeAsyncImage(
        model = request,
        contentDescription = client.user,
        contentScale = ContentScale.Crop,
        modifier = Modifier.size(size).clip(CircleShape),
        loading = { LetterAvatar(client.user, size) },
        error = { LetterAvatar(client.user, size) },
    )
}

/** Three bars that dance while music plays and rest when it does not. */
@Composable
fun EqualizerBars(playing: Boolean, color: Color, modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "equalizer")
    val bars = listOf(430 to 0.95f, 560 to 0.6f, 490 to 1f)
    Row(modifier.height(20.dp), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Bottom) {
        bars.forEachIndexed { i, (ms, peak) ->
            val h by transition.animateFloat(
                initialValue = 0.25f, targetValue = peak, label = "bar$i",
                animationSpec = infiniteRepeatable(tween(ms, easing = LinearEasing), RepeatMode.Reverse),
            )
            Box(Modifier.width(4.dp).fillMaxHeight(if (playing) h else 0.25f).clip(RoundedCornerShape(2.dp)).background(color))
        }
    }
}
