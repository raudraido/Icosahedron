@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Icon
import androidx.tv.material3.LocalContentColor
import androidx.tv.material3.Text
import cloud.icosahedron.tv.R
import cloud.icosahedron.tv.data.LyricLine
import cloud.icosahedron.tv.data.Lyrics
import cloud.icosahedron.tv.data.Track
import cloud.icosahedron.tv.player.Playback
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The progress bar you can move: focus it and press Left / Right to scrub (10 seconds a press, faster when
 * the key is held; the fast-forward and rewind keys of the remote jump 30 seconds), OK pauses and resumes.
 * The new position is shown while you press and applied a moment after the last press, not for every press.
 */
@Composable
fun SeekBar(
    positionMs: Long, durationMs: Long, onSeek: (Long) -> Unit, onSelect: () -> Unit,
    modifier: Modifier = Modifier, barModifier: Modifier = Modifier,
) {
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
            barModifier.fillMaxWidth().height(if (focused) 10.dp else 5.dp).clip(shape).background(Color.White.copy(alpha = 0.22f))
                .then(if (focused) Modifier.border(1.5.dp, Color.White, shape) else Modifier)
                .onFocusChanged { focused = it.isFocused }
                .onKeyEvent { e ->
                    if (e.type == KeyEventType.KeyUp) {
                        return@onKeyEvent if (e.key == Key.DirectionCenter || e.key == Key.Enter || e.key == Key.NumPadEnter) { onSelect(); true } else false
                    }
                    if (e.type != KeyEventType.KeyDown) return@onKeyEvent false
                    val held = e.nativeKeyEvent.repeatCount
                    val step = 10_000L * (1 + held / 4)
                    when (e.key) {
                        Key.DirectionLeft -> { scrub(-step); true }
                        Key.DirectionRight -> { scrub(step); true }
                        Key.MediaRewind -> { scrub(-30_000L); true }
                        Key.MediaFastForward -> { scrub(30_000L); true }
                        Key.DirectionCenter, Key.Enter, Key.NumPadEnter -> true // handled on key up
                        else -> false
                    }
                }
                .focusable(),
        ) {
            Box(Modifier.fillMaxWidth(frac).fillMaxHeight().background(Accent))
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(fmt(shown), color = Color.White.copy(alpha = 0.75f), fontSize = 12.sp)
            Text("-" + fmt((durationMs - shown).coerceAtLeast(0)), color = Color.White.copy(alpha = 0.75f), fontSize = 12.sp)
        }
    }
}

private enum class Panel { None, Queue, Lyrics }

/**
 * The player: an almost empty screen, the cover in the middle on a background taken from its colours, the
 * song under it, a progress bar across the screen and a row of controls. Lyrics and the queue open as a
 * panel at the right. After [idle] (twenty seconds without a key press) everything goes but the cover (and
 * lyrics, if you are reading them), so a still picture of controls never sits on the screen.
 */
@Composable
fun NowPlayingScreen(idle: Boolean) {
    val t = Playback.current
    if (t == null) {
        Message("Nothing playing. Pick something from Home, Albums or Search, or play to this TV from another device.")
        return
    }
    var panel by remember { mutableStateOf(Panel.None) }
    val seekFocus = remember { FocusRequester() }
    val chrome by animateFloatAsState(if (idle) 0f else 1f, tween(600), label = "chrome")
    LaunchedEffect(Unit) { runCatching { seekFocus.requestFocus() } }
    BackHandler(enabled = panel != Panel.None) { panel = Panel.None } // Back closes the panel before it leaves the screen

    // The picture drifts a few pixels over minutes, so that it never rests on the same pixels of an OLED screen.
    val drift = rememberInfiniteTransition(label = "drift")
    val dx by drift.animateFloat(-6f, 6f, infiniteRepeatable(tween(150_000, easing = LinearEasing), RepeatMode.Reverse), label = "dx")
    val dy by drift.animateFloat(-4f, 4f, infiniteRepeatable(tween(110_000, easing = LinearEasing), RepeatMode.Reverse), label = "dy")

    Column(Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 8.dp)) {
        Row(Modifier.weight(1f).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Cover(t.coverArt, if (panel == Panel.None) 240.dp else 190.dp, px = 700, modifier = Modifier.offset(dx.dp, dy.dp))
                Column(Modifier.padding(top = 10.dp).alpha(chrome), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(t.title, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                    Text(
                        listOfNotNull(t.artist, t.album).joinToString(" · "),
                        fontSize = 14.sp, color = Color.White.copy(alpha = 0.75f), maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                    )
                }
            }
            when (panel) {
                Panel.None -> {}
                Panel.Queue -> Box(Modifier.width(330.dp).fillMaxHeight().alpha(chrome)) { QueuePanel() }
                Panel.Lyrics -> Box(Modifier.width(330.dp).fillMaxHeight()) { LyricsPanel(t) }
            }
        }
        Column(Modifier.alpha(chrome)) {
            SeekBar(
                Playback.positionMs, Playback.durationMs,
                onSeek = { Playback.seekTo(it) }, onSelect = { Playback.toggle() },
                barModifier = Modifier.focusRequester(seekFocus),
            )
            Row(
                Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RoundButton(R.drawable.ic_shuffle, "Shuffle", on = Playback.shuffle) { Playback.shuffleTo(!Playback.shuffle) }
                RoundButton(R.drawable.ic_prev, "Previous") { Playback.previous() }
                RoundButton(if (Playback.isPlaying) R.drawable.ic_pause else R.drawable.ic_play, if (Playback.isPlaying) "Pause" else "Play", big = true) { Playback.toggle() }
                RoundButton(R.drawable.ic_next, "Next") { Playback.next() }
                RoundButton(R.drawable.ic_repeat, "Repeat", on = Playback.repeatAll) { Playback.repeatTo(!Playback.repeatAll) }
                Spacer(Modifier.width(28.dp))
                RoundButton(R.drawable.ic_lyrics, "Lyrics", on = panel == Panel.Lyrics) { panel = if (panel == Panel.Lyrics) Panel.None else Panel.Lyrics }
                RoundButton(R.drawable.ic_queue, "Queue", on = panel == Panel.Queue) { panel = if (panel == Panel.Queue) Panel.None else Panel.Queue }
            }
        }
    }
}

@Composable
private fun RoundButton(icon: Int, label: String, on: Boolean = false, big: Boolean = false, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        shape = ButtonDefaults.shape(CircleShape),
        contentPadding = PaddingValues(if (big) 12.dp else 9.dp),
        colors = if (big) ButtonDefaults.colors(
            containerColor = Accent, contentColor = Color.White, focusedContainerColor = Color.White, focusedContentColor = Bg,
            pressedContainerColor = Color.White, pressedContentColor = Bg,
        ) else chipColors(on),
    ) {
        Icon(
            painterResource(icon), contentDescription = label, modifier = Modifier.size(if (big) 26.dp else 20.dp),
            tint = if (on && !big) Accent else LocalContentColor.current,
        )
    }
}

@Composable
private fun QueuePanel() {
    val state = rememberLazyListState()
    LaunchedEffect(Unit) { state.scrollToItem((Playback.index - 2).coerceAtLeast(0)) }
    Column(Modifier.fillMaxSize()) {
        Text("Queue", fontSize = 16.sp, modifier = Modifier.padding(start = 8.dp, bottom = 6.dp))
        LazyColumn(Modifier.fillMaxSize(), state = state) {
            itemsIndexed(Playback.queue) { i, track ->
                TrackRow(track, i + 1, i == Playback.index, horizontalPadding = 4.dp) { Playback.jump(i) }
            }
        }
    }
}

/** Lyrics at the right: the line that is sung is bright and the list follows it; not timed lyrics scroll with Up / Down. */
@Composable
private fun LyricsPanel(t: Track) {
    val client = LocalClient.current
    val lines by produceState<List<LyricLine>?>(null, t.id) {
        value = null
        value = Lyrics.forTrack(client, t)
    }
    val list = lines
    when {
        list == null -> Message("Looking for lyrics…")
        list.isEmpty() -> Message("No lyrics found for this song.")
        else -> {
            val synced = list.firstOrNull()?.timeMs != null
            val pos = Playback.positionMs
            val current = if (synced) list.indexOfLast { (it.timeMs ?: Long.MAX_VALUE) <= pos + 250 } else -1
            val state = rememberLazyListState()
            val scope = rememberCoroutineScope()
            LaunchedEffect(current) { if (current >= 0) state.animateScrollToItem((current - 2).coerceAtLeast(0)) }
            LazyColumn(
                state = state,
                contentPadding = PaddingValues(vertical = 24.dp),
                modifier = Modifier.fillMaxSize().then(
                    if (synced) Modifier else Modifier.focusable().onKeyEvent { e ->
                        if (e.type != KeyEventType.KeyDown) return@onKeyEvent false
                        when (e.key) {
                            Key.DirectionDown -> { scope.launch { state.animateScrollBy(240f) }; true }
                            Key.DirectionUp -> { scope.launch { state.animateScrollBy(-240f) }; true }
                            else -> false
                        }
                    },
                ),
            ) {
                itemsIndexed(list) { i, line ->
                    val here = i == current
                    Text(
                        line.text.ifBlank { "♪" },
                        fontSize = if (here) 20.sp else 16.sp,
                        fontWeight = if (here) FontWeight.SemiBold else FontWeight.Normal,
                        color = Color.White.copy(alpha = if (!synced || here) 1f else 0.5f),
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
                    )
                }
            }
        }
    }
}
