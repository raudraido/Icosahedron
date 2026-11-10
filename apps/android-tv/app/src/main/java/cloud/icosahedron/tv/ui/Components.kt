@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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

val LocalClient = compositionLocalOf<SubsonicClient> { error("no client") }

/** Runs `block` when `key` changes; null while loading, then the result or the failure. */
@Composable
fun <T> load(key: Any?, block: suspend () -> T): State<Result<T>?> =
    produceState<Result<T>?>(null, key) { value = runCatching { block() } }

@Composable
fun Cover(coverId: String?, size: Dp, modifier: Modifier = Modifier, px: Int = 400) {
    val url = LocalClient.current.coverUrl(coverId, px)
    AsyncImage(
        model = url,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = modifier.size(size).clip(RoundedCornerShape(8.dp)).background(PanelHi),
    )
}

@Composable
fun AlbumCard(album: Album, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.width(176.dp)) {
        Cover(album.coverArt, 176.dp)
        Column(Modifier.padding(horizontal = 8.dp, vertical = 6.dp)) {
            Text(album.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp)
            Text(album.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = Dim)
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

/** One track of a list: number, title and artist, length; the playing one in the accent colour. */
@Composable
fun TrackRow(track: Track, number: Int?, playing: Boolean, onClick: () -> Unit) {
    Button(onClick = onClick, modifier = Modifier.fillMaxWidth().padding(horizontal = 48.dp, vertical = 2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(number?.toString() ?: "", color = Dim, modifier = Modifier.width(36.dp))
            Column(Modifier.weight(1f)) {
                Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis, color = if (playing) Accent else androidx.compose.ui.graphics.Color.White)
                Text(track.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = Dim)
            }
            Text(fmt(track.duration * 1000L), color = Dim)
        }
    }
}

@Composable
fun ActionButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Button(onClick = onClick, modifier = modifier) { Text(text, modifier = Modifier.padding(horizontal = 8.dp)) }
}

