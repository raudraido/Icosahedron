package cloud.icosahedron.phone.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
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
    val t = Playback.current
    val tint = rememberCoverTint(t?.coverArt)
    val bg by animateColorAsState(tint ?: Panel, label = "tint")
    var panel by remember { mutableStateOf(0) } // 0 cover, 1 lyrics, 2 queue
    var dragging by remember { mutableStateOf<Float?>(null) }

    Column(Modifier.fillMaxSize().background(bg).padding(horizontal = 20.dp, vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Filled.KeyboardArrowDown, "Close") }
            Text("Now playing", modifier = Modifier.weight(1f), textAlign = TextAlign.Center, color = Dim)
            Box(Modifier.size(48.dp))
        }
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            when {
                t == null -> Text("Nothing is playing", color = Dim)
                panel == 1 -> LyricsPanel(t)
                panel == 2 -> QueuePanel()
                else -> Cover(t.coverArt, 320.dp, modifier = Modifier.aspectRatio(1f))
            }
        }
        if (t != null) {
            Text(t.title, fontSize = 22.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 12.dp))
            Text(t.artist, fontSize = 15.sp, color = Dim, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val dur = Playback.durationMs.coerceAtLeast(1)
            val shown = dragging ?: (Playback.positionMs.toFloat() / dur)
            Slider(
                value = shown.coerceIn(0f, 1f),
                onValueChange = { dragging = it },
                onValueChangeFinished = { dragging?.let { Playback.seekTo((it * dur).toLong()) }; dragging = null },
                colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = Accent, inactiveTrackColor = Color(0x44FFFFFF)),
            )
            Row(Modifier.fillMaxWidth()) {
                Text(fmt((shown * dur).toLong()), fontSize = 12.sp, color = Dim, modifier = Modifier.weight(1f))
                Text(fmt(Playback.durationMs), fontSize = 12.sp, color = Dim)
            }
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { Playback.shuffleTo(!Playback.shuffle) }) { Icon(painterResource(R.drawable.ic_shuffle), "Shuffle", tint = if (Playback.shuffle) Accent else Color.White) }
            IconButton(onClick = { Playback.previous() }) { Icon(painterResource(R.drawable.ic_prev), "Previous", Modifier.size(34.dp)) }
            IconButton(onClick = { Playback.toggle() }, modifier = Modifier.size(68.dp)) {
                Icon(painterResource(if (Playback.isPlaying) R.drawable.ic_pause else R.drawable.ic_play), "Play / pause", Modifier.size(52.dp))
            }
            IconButton(onClick = { Playback.next() }) { Icon(painterResource(R.drawable.ic_next), "Next", Modifier.size(34.dp)) }
            IconButton(onClick = { Playback.repeatTo(!Playback.repeatAll) }) { Icon(painterResource(R.drawable.ic_repeat), "Repeat", tint = if (Playback.repeatAll) Accent else Color.White) }
        }
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            IconButton(onClick = { panel = if (panel == 1) 0 else 1 }) { Icon(painterResource(R.drawable.ic_lyrics), "Lyrics", tint = if (panel == 1) Accent else Color.White) }
            IconButton(onClick = { panel = if (panel == 2) 0 else 2 }) { Icon(painterResource(R.drawable.ic_queue), "Queue", tint = if (panel == 2) Accent else Color.White) }
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
    val now = if (list.first().timeMs == null) -1 else list.indexOfLast { (it.timeMs ?: Long.MAX_VALUE) <= Playback.positionMs }
    val state = rememberLazyListState()
    LaunchedEffect(now) { if (now >= 0) state.animateScrollToItem((now - 2).coerceAtLeast(0)) }
    LazyColumn(Modifier.fillMaxSize(), state = state, horizontalAlignment = Alignment.CenterHorizontally) {
        itemsIndexed(list) { i, l ->
            Text(
                l.text.ifBlank { "♪" }, fontSize = 20.sp, textAlign = TextAlign.Center,
                color = if (i == now) Color.White else Color(0x99FFFFFF),
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp).clickable(enabled = l.timeMs != null) { Playback.seekTo(l.timeMs ?: 0) },
            )
        }
    }
}

@Composable
private fun QueuePanel() {
    val state = rememberLazyListState()
    LaunchedEffect(Unit) { if (Playback.index > 0) state.scrollToItem(Playback.index) }
    LazyColumn(Modifier.fillMaxSize(), state = state) {
        itemsIndexed(Playback.queue) { i, t ->
            Row(Modifier.fillMaxWidth().clickable { Playback.jump(i) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Cover(t.coverArt, 40.dp, modifier = Modifier.padding(end = 10.dp))
                Column(Modifier.weight(1f)) {
                    Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, color = if (i == Playback.index) Accent else Color.White)
                    Text(t.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = Dim)
                }
                IconButton(onClick = { Playback.remove(i) }) { Icon(Icons.Filled.Close, "Remove", tint = Dim) }
            }
        }
    }
}
