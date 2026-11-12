package cloud.icosahedron.phone.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cloud.icosahedron.phone.R
import cloud.icosahedron.phone.data.Lyrics
import cloud.icosahedron.phone.player.Playback

/** The full player: cover, seek bar, controls; lyrics and the queue replace the cover. */
@Composable
fun NowPlayingScreen(onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    val t = Control.track
    val tint = rememberCoverTint(t?.coverArt)
    val bg by animateColorAsState(tint ?: Panel, label = "tint")
    var panel by remember { mutableStateOf(0) } // 0 cover, 1 lyrics, 2 queue
    var info by remember { mutableStateOf(false) } // the cover tapped: the song's details under a smaller cover
    var dragging by remember { mutableStateOf<Float?>(null) }

    val header: @Composable () -> Unit = {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Filled.KeyboardArrowDown, "Close") }
            Text(if (Control.remote) "Playing on ${targetName()}" else "Now playing", color = if (Control.remote) Accent else Dim, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
            Box(Modifier.size(48.dp))
        }
    }
    // The cover, or what replaces it (lyrics, the queue, the song's details)
    val art: @Composable () -> Unit = {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            when {
                t == null -> Text("Nothing is playing", color = Dim)
                panel == 1 -> LyricsPanel(t)
                panel == 2 -> QueuePanel()
                info -> InfoPanel(t, onClose, onCover = { info = false })
                else -> androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Cover(t.coverArt, minOf(maxWidth, maxHeight), modifier = Modifier.clickable { info = true })
                }
            }
        }
    }
    val meta: @Composable () -> Unit = {
        if (t != null) {
            Text(t.title, fontSize = 22.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 12.dp))
            Text(t.artist, fontSize = 15.sp, color = Dim, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val dur = Control.durationMs.coerceAtLeast(1)
            val shown = dragging ?: (Control.positionMs.toFloat() / dur)
            Slider(
                value = shown.coerceIn(0f, 1f),
                onValueChange = { dragging = it },
                onValueChangeFinished = { dragging?.let { Control.seekTo((it * dur).toLong()) }; dragging = null },
                colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = Accent, inactiveTrackColor = Color(0x44FFFFFF)),
            )
            Row(Modifier.fillMaxWidth()) {
                Text(fmt((shown * dur).toLong()), fontSize = 12.sp, color = Dim, modifier = Modifier.weight(1f))
                Text(fmt(Control.durationMs), fontSize = 12.sp, color = Dim)
            }
        }
    }
    val buttons: @Composable () -> Unit = {
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { Control.shuffleTo(!Control.shuffle) }) { Icon(painterResource(R.drawable.ic_shuffle), "Shuffle", tint = if (Control.shuffle) Accent else Color.White) }
            IconButton(onClick = { Control.previous() }) { Icon(painterResource(R.drawable.ic_prev), "Previous", Modifier.size(34.dp)) }
            IconButton(onClick = { Control.toggle() }, modifier = Modifier.size(68.dp)) {
                Icon(painterResource(if (Control.isPlaying) R.drawable.ic_pause else R.drawable.ic_play), "Play / pause", Modifier.size(52.dp))
            }
            IconButton(onClick = { Control.next() }) { Icon(painterResource(R.drawable.ic_next), "Next", Modifier.size(34.dp)) }
            IconButton(onClick = { Control.repeatTo(!Control.repeatOn) }) { Icon(painterResource(R.drawable.ic_repeat), "Repeat", tint = if (Control.repeatOn) Accent else Color.White) }
        }
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            IconButton(onClick = { panel = if (panel == 1) 0 else 1; info = false }) { Icon(painterResource(R.drawable.ic_lyrics), "Lyrics", tint = if (panel == 1) Accent else Color.White) }
            if (!Control.remote) SpeedButton()
            IconButton(onClick = { panel = if (panel == 2) 0 else 2; info = false }) { Icon(painterResource(R.drawable.ic_queue), "Queue", tint = if (panel == 2) Accent else Color.White) }
        }
    }

    androidx.compose.foundation.layout.BoxWithConstraints(
        Modifier.fillMaxSize().background(bg).padding(horizontal = 20.dp, vertical = 8.dp)
            // the screen is on top of the app: a tap that nothing here uses must not reach what is under it
            .pointerInput(Unit) { detectTapGestures { } },
    ) {
        // A wide screen (a tablet, a phone on its side, a car): the cover on one side, the controls on the other
        val wide = maxWidth > maxHeight && maxWidth >= 600.dp
        if (wide) {
            Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                Box(Modifier.weight(1f).fillMaxHeight().padding(vertical = 8.dp)) { art() }
                Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.Center) { header(); meta(); buttons() }
            }
        } else {
            Column(Modifier.fillMaxSize()) {
                header()
                Box(Modifier.weight(1f).fillMaxWidth()) { art() }
                meta()
                buttons()
            }
        }
    }
}

@Composable
private fun LyricsPanel(t: cloud.icosahedron.phone.data.Track) {
    val client = LocalClient.current
    val lines by load(t.id) { Lyrics.forTrack(client, t) }
    val list = lines
    if (list == null) { Text("Looking for lyrics…", color = Dim); return }
    if (list.isEmpty()) { Text("No lyrics found", color = Dim); return }
    val now = if (list.first().timeMs == null) -1 else list.indexOfLast { (it.timeMs ?: Long.MAX_VALUE) <= Control.positionMs }
    val state = rememberLazyListState()
    LaunchedEffect(now) { if (now >= 0) state.animateScrollToItem((now - 2).coerceAtLeast(0)) }
    LazyColumn(Modifier.fillMaxSize(), state = state, horizontalAlignment = Alignment.CenterHorizontally) {
        itemsIndexed(list) { i, l ->
            Text(
                l.text.ifBlank { "♪" }, fontSize = 20.sp, textAlign = TextAlign.Center,
                color = if (i == now) Color.White else Color(0x99FFFFFF),
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp).clickable(enabled = l.timeMs != null) { Control.seekTo(l.timeMs ?: 0) },
            )
        }
    }
}

@Composable
private fun QueuePanel() {
    val state = rememberLazyListState()
    LaunchedEffect(Unit) { if (Control.index > 0) state.scrollToItem(Control.index) }
    LazyColumn(Modifier.fillMaxSize(), state = state) {
        itemsIndexed(Control.queue) { i, t ->
            Row(Modifier.fillMaxWidth().clickable { Control.jump(i) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Cover(t.coverArt, 40.dp, modifier = Modifier.padding(end = 10.dp))
                Column(Modifier.weight(1f)) {
                    Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, color = if (i == Control.index) Accent else Color.White)
                    Text(t.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = Dim)
                }
                IconButton(onClick = { Control.remove(i) }) { Icon(Icons.Filled.Close, "Remove", tint = Dim) }
            }
        }
    }
}

/** The speed: a few steps and "Keep pitch" (on: the voice does not get higher or lower). */
@Composable
private fun SpeedButton() {
    var open by remember { mutableStateOf(false) }
    Box {
        androidx.compose.material3.TextButton(onClick = { open = true }) {
            Text(speedLabel(Playback.speed), color = if (Playback.speed != 1f) Accent else Color.White, fontSize = 16.sp)
        }
        androidx.compose.material3.DropdownMenu(open, { open = false }) {
            listOf(0.5f, 0.75f, 0.9f, 1f, 1.1f, 1.25f, 1.5f, 1.75f, 2f).forEach { s ->
                androidx.compose.material3.DropdownMenuItem(
                    text = { Text((if (Playback.speed == s) "✓ " else "") + speedLabel(s)) },
                    onClick = { Playback.setSpeed(s); open = false },
                )
            }
            androidx.compose.material3.DropdownMenuItem(
                text = { Text((if (Playback.keepPitch) "✓ " else "") + "Keep pitch") },
                onClick = { Playback.setSpeed(Playback.speed, !Playback.keepPitch) },
            )
        }
    }
}

private fun speedLabel(s: Float) = (if (s == s.toInt().toFloat()) s.toInt().toString() else s.toString().trimEnd('0')) + "×"

/**
 * The details of the playing song, under a smaller cover (tap the cover to go back). The queue's songs can come
 * from another device with only the basics, so the full song is fetched once.
 */
@Composable
private fun InfoPanel(track: cloud.icosahedron.phone.data.Track, onClose: () -> Unit, onCover: () -> Unit) {
    val client = LocalClient.current
    val opener = LocalOpener.current
    val full by load(track.id) { client.song(track.id) }
    val t = full ?: track
    fun row(label: String, value: String, small: Boolean = false, onClick: (() -> Unit)? = null): @Composable () -> Unit = {
        Row(
            Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, color = Color(0xA6FFFFFF))
            Text(value, fontSize = if (small) 12.sp else 16.sp, textAlign = TextAlign.End, color = if (onClick != null) Accent else Color.White, modifier = Modifier.weight(1f).padding(start = 12.dp))
        }
    }
    val sizeText = t.size?.let { "%.1f MB".format(it / 1048576.0) }
    val rate = t.samplingRate?.let { hz -> (hz / 1000.0).let { k -> if (k == Math.rint(k)) "%.0f kHz".format(k) else "%.1f kHz".format(k) } }
    val channelText = t.channels?.let { when (it) { 1 -> "Mono"; 2 -> "Stereo"; else -> "$it channels" } }
    val added = t.created?.take(10)
    LazyColumn(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        item { Cover(t.coverArt, 110.dp, modifier = Modifier.clickable(onClick = onCover).padding(bottom = 12.dp)) }
        val cards = listOf(
            listOfNotNull<@Composable () -> Unit>(
                row("Title", t.title),
                t.artistId?.let { id -> row("Artist", t.artist) { onClose(); opener.artist(id) } } ?: row("Artist", t.artist),
                t.album?.takeIf { it.isNotEmpty() }?.let { name -> t.albumId?.let { id -> row("Album", name) { onClose(); opener.album(id) } } ?: row("Album", name) },
                if (t.trackNumber > 0) row("Track", if (t.discNumber > 1) "${t.discNumber}-${t.trackNumber}" else "${t.trackNumber}") else null,
                t.year?.let { row("Year", it.toString()) },
                t.genre?.takeIf { it.isNotEmpty() }?.let { row("Genre", it) },
            ),
            listOfNotNull<@Composable () -> Unit>(
                t.format?.takeIf { it.isNotEmpty() }?.let { row("Format", it.uppercase()) },
                t.bitrate?.let { row("Bitrate", "$it kbps") },
                rate?.let { row("Sample rate", it) },
                t.bitDepth?.takeIf { it > 0 }?.let { row("Bit depth", "$it-bit") },
                channelText?.let { row("Channels", it) },
                row("Length", fmt(t.duration * 1000L)),
                sizeText?.let { row("File size", it) },
                t.path?.takeIf { it.isNotEmpty() }?.let { row("Path", it, small = true) },
            ),
            listOfNotNull<@Composable () -> Unit>(
                t.bpm?.let { row("BPM", it.toString()) },
                t.playCount?.let { row("Plays", it.toString()) },
                added?.let { row("Added", it) },
            ),
        ).filter { it.isNotEmpty() }
        items(cards) { rows ->
            androidx.compose.foundation.layout.Column(Modifier.fillMaxWidth().padding(vertical = 6.dp).background(Color(0x22000000), androidx.compose.foundation.shape.RoundedCornerShape(14.dp))) {
                rows.forEach { it() }
            }
        }
    }
}
