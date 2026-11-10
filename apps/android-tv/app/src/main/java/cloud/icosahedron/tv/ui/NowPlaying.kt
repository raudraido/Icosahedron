@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import cloud.icosahedron.tv.App
import cloud.icosahedron.tv.player.Playback
import kotlinx.coroutines.delay

/**
 * The progress bar you can move: focus it and press Left / Right to scrub (10 seconds a press, faster when
 * the key is held; the fast-forward and rewind keys of the remote jump 30 seconds). The new position is
 * shown while you press and applied a moment after the last press, not for every press.
 */
@Composable
fun SeekBar(positionMs: Long, durationMs: Long, onSeek: (Long) -> Unit, modifier: Modifier = Modifier) {
    var focused by remember { mutableStateOf(false) }
    var target by remember { mutableStateOf<Long?>(null) }
    LaunchedEffect(target) {
        val t = target ?: return@LaunchedEffect
        delay(500)
        onSeek(t)
        target = null
    }
    val shown = target ?: positionMs
    val frac = if (durationMs > 0) (shown.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
    fun scrub(by: Long) {
        if (durationMs <= 0) return
        target = ((target ?: positionMs) + by).coerceIn(0L, durationMs)
    }
    Column(modifier.fillMaxWidth()) {
        val shape = RoundedCornerShape(6.dp)
        Box(
            Modifier.fillMaxWidth().height(if (focused) 12.dp else 6.dp).clip(shape).background(PanelHi)
                .then(if (focused) Modifier.border(2.dp, Color.White, shape) else Modifier)
                .onFocusChanged { focused = it.isFocused }
                .onKeyEvent { e ->
                    if (e.type != KeyEventType.KeyDown) return@onKeyEvent false
                    val held = e.nativeKeyEvent.repeatCount
                    val step = 10_000L * (1 + held / 4)
                    when (e.key) {
                        Key.DirectionLeft -> { scrub(-step); true }
                        Key.DirectionRight -> { scrub(step); true }
                        Key.MediaRewind -> { scrub(-30_000L); true }
                        Key.MediaFastForward -> { scrub(30_000L); true }
                        else -> false
                    }
                }
                .focusable(),
        ) {
            Box(Modifier.fillMaxWidth(frac).fillMaxHeight().background(Accent))
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(fmt(shown), color = Dim, fontSize = 13.sp)
            Text(if (focused) "◄ ► to seek" else "-" + fmt((durationMs - shown).coerceAtLeast(0)), color = Dim, fontSize = 13.sp)
        }
    }
}

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
            SeekBar(Playback.positionMs, Playback.durationMs, onSeek = { Playback.seekTo(it) }, modifier = Modifier.padding(top = 16.dp))
            Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                ActionButton("Prev", onClick = { Playback.previous() })
                ActionButton(if (Playback.isPlaying) "Pause" else "Play", onClick = { Playback.toggle() })
                ActionButton("Next", onClick = { Playback.next() })
            }
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionButton("-10 s", onClick = { Playback.seekTo(Playback.positionMs - 10_000) })
                ActionButton("+10 s", onClick = { Playback.seekTo(Playback.positionMs + 10_000) })
                ActionButton(if (Playback.shuffle) "Shuffle: on" else "Shuffle: off", onClick = { Playback.shuffleTo(!Playback.shuffle) })
                ActionButton(if (Playback.repeatAll) "Repeat: on" else "Repeat: off", onClick = { Playback.repeatTo(!Playback.repeatAll) })
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
