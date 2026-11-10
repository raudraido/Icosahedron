@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import cloud.icosahedron.tv.App
import cloud.icosahedron.tv.player.Playback

/** The full player: what plays on this TV, the controls and the queue. */
@Composable
fun NowPlayingScreen() {
    val t = Playback.current
    if (t == null) {
        Message("Nothing playing. Pick something from Home, Albums or Search, or play to this TV from another device.")
        return
    }
    Row(Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(40.dp)) {
        Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.Center) {
            Cover(t.coverArt, 300.dp, px = 700)
            Text(t.title, fontSize = 32.sp, maxLines = 2, modifier = Modifier.padding(top = 16.dp))
            Text(listOfNotNull(t.artist, t.album).joinToString(" · "), color = Dim, maxLines = 1)
            val dur = Playback.durationMs
            val frac = if (dur > 0) (Playback.positionMs.toFloat() / dur).coerceIn(0f, 1f) else 0f
            Box(Modifier.fillMaxWidth().padding(top = 16.dp).height(6.dp).clip(RoundedCornerShape(3.dp)).background(PanelHi)) {
                Box(Modifier.fillMaxWidth(frac).fillMaxHeight().background(Accent))
            }
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(fmt(Playback.positionMs), color = Dim, fontSize = 13.sp)
                Text("-" + fmt((dur - Playback.positionMs).coerceAtLeast(0)), color = Dim, fontSize = 13.sp)
            }
            Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                ActionButton("Prev", onClick = { Playback.previous() })
                ActionButton(if (Playback.isPlaying) "Pause" else "Play", onClick = { Playback.toggle() })
                ActionButton("Next", onClick = { Playback.next() })
            }
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionButton("-10 s", onClick = { Playback.seekTo(Playback.positionMs - 10_000) })
                ActionButton("+10 s", onClick = { Playback.seekTo(Playback.positionMs + 10_000) })
                ActionButton(if (Playback.shuffle) "Shuffle: on" else "Shuffle: off", onClick = { Playback.setShuffle(!Playback.shuffle) })
                ActionButton(if (Playback.repeatAll) "Repeat: on" else "Repeat: off", onClick = { Playback.setRepeat(!Playback.repeatAll) })
            }
            Text(
                "Playing on this TV" + (App.instance.sync?.name?.let { " ($it)" } ?: ""),
                color = Accent, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp),
            )
        }
        Column(Modifier.width(520.dp).fillMaxHeight()) {
            Text("Queue", fontSize = 20.sp, modifier = Modifier.padding(bottom = 8.dp))
            LazyColumn(Modifier.fillMaxSize()) {
                itemsIndexed(Playback.queue) { i, track ->
                    TrackRow(track, i + 1, i == Playback.index) { Playback.jump(i) }
                }
            }
        }
    }
}
