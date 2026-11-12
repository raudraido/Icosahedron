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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.runtime.CompositionLocalProvider
import kotlinx.coroutines.launch
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
import androidx.compose.ui.draw.clip
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
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun NowPlayingScreen(onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    val t = Control.track
    val tint = rememberCoverTint(t?.coverArt)
    // The colour of the cover fades into the dark of the app (top to bottom) and changes smoothly with the song, like on the TV
    val bg by animateColorAsState(tint ?: Panel, androidx.compose.animation.core.tween(800), label = "tint")
    var panel by remember { mutableStateOf(0) } // 0 cover, 1 lyrics, 2 queue
    var info by remember { mutableStateOf(false) } // the cover tapped: the song's details under a smaller cover
    var dragging by remember { mutableStateOf<Float?>(null) }
    val client = LocalClient.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }

    // ── Pull the screen down from anywhere to close it ──
    // Lists (lyrics, queue, details) scroll first; only a pull at their top closes the screen.
    val offset = remember { androidx.compose.animation.core.Animatable(0f) }
    val threshold = with(androidx.compose.ui.platform.LocalDensity.current) { 200.dp.toPx() }
    fun release(velocityY: Float) {
        if (offset.value > threshold || velocityY > 1800f) onClose() else scope.launch { offset.animateTo(0f) }
    }
    val connection = remember {
        object : androidx.compose.ui.input.nestedscroll.NestedScrollConnection {
            override fun onPreScroll(available: androidx.compose.ui.geometry.Offset, source: androidx.compose.ui.input.nestedscroll.NestedScrollSource): androidx.compose.ui.geometry.Offset {
                if (offset.value > 0f && available.y < 0f) {
                    val next = (offset.value + available.y).coerceAtLeast(0f)
                    val used = next - offset.value
                    scope.launch { offset.snapTo(next) }
                    return androidx.compose.ui.geometry.Offset(0f, used)
                }
                return androidx.compose.ui.geometry.Offset.Zero
            }
            override fun onPostScroll(consumed: androidx.compose.ui.geometry.Offset, available: androidx.compose.ui.geometry.Offset, source: androidx.compose.ui.input.nestedscroll.NestedScrollSource): androidx.compose.ui.geometry.Offset {
                if (available.y > 0f && source == androidx.compose.ui.input.nestedscroll.NestedScrollSource.UserInput) {
                    scope.launch { offset.snapTo(offset.value + available.y) }
                    return androidx.compose.ui.geometry.Offset(0f, available.y)
                }
                return androidx.compose.ui.geometry.Offset.Zero
            }
            override suspend fun onPreFling(available: androidx.compose.ui.unit.Velocity): androidx.compose.ui.unit.Velocity {
                if (offset.value > 0f) { release(available.y); return available }
                return androidx.compose.ui.unit.Velocity.Zero
            }
        }
    }
    val dragState = androidx.compose.foundation.gestures.rememberDraggableState { d -> scope.launch { offset.snapTo((offset.value + d).coerceAtLeast(0f)) } }

    // A page opened from the menu (the artist, the album) sits under this screen: close it first
    val parentOpener = LocalOpener.current
    val opener = remember(parentOpener) {
        object : Opener {
            override fun album(id: String) { onClose(); parentOpener.album(id) }
            override fun artist(id: String) { onClose(); parentOpener.artist(id) }
            override fun back() { parentOpener.back() }
        }
    }

    // "big" is the wide screen (a car, a tablet): bigger text, bigger targets with room between them, words under the icons
    val header: @Composable (Boolean) -> Unit = { big ->
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose, modifier = Modifier.size(if (big) 76.dp else 48.dp)) { Icon(Icons.Filled.KeyboardArrowDown, "Close", Modifier.size(if (big) 40.dp else 28.dp)) }
            if (Control.remote) Text("Playing on ${targetName()}", color = Accent, fontSize = if (big) 18.sp else 14.sp, modifier = Modifier.weight(1f).padding(start = 8.dp))
            else Box(Modifier.weight(1f))
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
                    Cover(t.coverArt, minOf(maxWidth, maxHeight) * 0.8f, modifier = Modifier.clickable { info = true })
                }
            }
        }
    }
    // The song (the title big, the favorite heart at the right edge of the same row), the artist, the seek bar and the times
    val meta: @Composable (Boolean) -> Unit = { big ->
        if (t != null) {
            val fav = Favorites.track(t)
            Row(Modifier.fillMaxWidth().padding(top = if (big) 0.dp else 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(t.title, fontSize = if (big) 30.sp else 22.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = if (big) 36.sp else 28.sp)
                    Text(t.artist, fontSize = if (big) 22.sp else 15.sp, color = Color(0xCCFFFFFF), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    t.album?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = if (big) 17.sp else 13.sp, color = Color(0x99FFFFFF), maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
                IconButton(onClick = { Favorites.toggleTrack(client, t, scope) }, modifier = Modifier.size(if (big) 76.dp else 56.dp)) {
                    Icon(if (fav) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, if (fav) "Remove Favorite" else "Favorite", Modifier.size(if (big) 40.dp else 28.dp), tint = if (fav) Accent else Color.White)
                }
            }
            val dur = Control.durationMs.coerceAtLeast(1)
            val shown = dragging ?: (Control.positionMs.toFloat() / dur)
            // The time already played at the left end of the bar, the time left (with a minus) at the right end
            val timeStyle = androidx.compose.ui.text.TextStyle(fontFeatureSettings = "tnum")
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(fmt((shown * dur).toLong()), fontSize = if (big) 16.sp else 12.sp, style = timeStyle, color = Color(0xCCFFFFFF), modifier = Modifier.widthIn(min = if (big) 48.dp else 36.dp))
                Slider(
                    value = shown.coerceIn(0f, 1f),
                    onValueChange = { dragging = it },
                    onValueChangeFinished = { dragging?.let { Control.seekTo((it * dur).toLong()) }; dragging = null },
                    colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = Accent, inactiveTrackColor = Color(0x44FFFFFF)),
                    thumb = { SliderDefaults.Thumb(remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, thumbSize = androidx.compose.ui.unit.DpSize(if (big) 10.dp else 4.dp, if (big) 56.dp else 44.dp), colors = SliderDefaults.colors(thumbColor = Color.White)) },
                    modifier = Modifier.weight(1f).padding(horizontal = 6.dp),
                )
                Text("-" + fmt(((1f - shown.coerceIn(0f, 1f)) * dur).toLong()), fontSize = if (big) 16.sp else 12.sp, style = timeStyle, color = Color(0xCCFFFFFF), textAlign = TextAlign.End, modifier = Modifier.widthIn(min = if (big) 56.dp else 40.dp))
            }
        }
    }
    // Lyrics, speed, queue and the menu (the favorite is next to the title)
    val tools: @Composable (Boolean) -> Unit = { big ->
        if (t != null) Row(Modifier.fillMaxWidth().padding(top = 2.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            @Composable fun tool(label: String, active: Boolean, onClick: () -> Unit, icon: @Composable (Color) -> Unit) {
                val tintColor = if (active) Accent else Color.White
                if (big) ToolBlock(label, active, onClick) { icon(tintColor) } else IconButton(onClick = onClick) { icon(tintColor) }
            }
            tool("Lyrics", panel == 1, { panel = if (panel == 1) 0 else 1; info = false }) { c -> Icon(painterResource(R.drawable.ic_lyrics), "Lyrics", tint = c) }
            if (!Control.remote) SpeedButton(big)
            tool("Queue", panel == 2, { panel = if (panel == 2) 0 else 2; info = false }) { c -> Icon(painterResource(R.drawable.ic_queue), "Queue", tint = c) }
            Box {
                tool("More", false, { menu = true }) { c -> Icon(Icons.Filled.MoreVert, "More", tint = c) }
                CompositionLocalProvider(LocalOpener provides opener) {
                    TargetMenu(Target("track", t.id, t.title, t.artist, t.coverArt, track = t), menu) { menu = false }
                }
            }
        }
    }
    // The playback controls, at the very bottom: play is the biggest (a filled circle), the others are far apart
    val controls: @Composable (Boolean) -> Unit = { big ->
        Row(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = if (big) 20.dp else 16.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { Control.shuffleTo(!Control.shuffle) }, modifier = Modifier.size(if (big) 76.dp else 56.dp)) { Icon(painterResource(R.drawable.ic_shuffle), "Shuffle", Modifier.size(if (big) 36.dp else 28.dp), tint = if (Control.shuffle) Accent else Color.White) }
            IconButton(onClick = { Control.previous() }, modifier = Modifier.size(if (big) 88.dp else 64.dp)) { Icon(painterResource(R.drawable.ic_prev), "Previous", Modifier.size(if (big) 56.dp else 44.dp)) }
            Box(
                Modifier.size(if (big) 112.dp else 84.dp).clip(androidx.compose.foundation.shape.CircleShape).background(Color.White).clickable { Control.toggle() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(painterResource(if (Control.isPlaying) R.drawable.ic_pause else R.drawable.ic_play), "Play / pause", Modifier.size(if (big) 64.dp else 48.dp), tint = Bg)
            }
            IconButton(onClick = { Control.next() }, modifier = Modifier.size(if (big) 88.dp else 64.dp)) { Icon(painterResource(R.drawable.ic_next), "Next", Modifier.size(if (big) 56.dp else 44.dp)) }
            IconButton(onClick = { Control.repeatTo(!Control.repeatOn) }, modifier = Modifier.size(if (big) 76.dp else 56.dp)) { Icon(painterResource(R.drawable.ic_repeat), "Repeat", Modifier.size(if (big) 36.dp else 28.dp), tint = if (Control.repeatOn) Accent else Color.White) }
        }
    }

    androidx.compose.foundation.layout.BoxWithConstraints(
        Modifier.fillMaxSize()
            .offset { androidx.compose.ui.unit.IntOffset(0, offset.value.toInt()) }
            .nestedScroll(connection)
            .draggable(dragState, androidx.compose.foundation.gestures.Orientation.Vertical, onDragStopped = { release(it) })
            .background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(bg, Bg))).padding(horizontal = 20.dp, vertical = 8.dp)
            // the screen is on top of the app: a tap that nothing here uses must not reach what is under it
            .pointerInput(Unit) { detectTapGestures { } },
    ) {
        // A wide screen (a tablet, a phone on its side, a car): the cover on one side, the controls on the other
        val wide = maxWidth > maxHeight && maxWidth >= 600.dp
        if (wide) {
            Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                Box(Modifier.weight(1f).fillMaxHeight().padding(vertical = 8.dp)) { art() }
                // spread over the whole height instead of bunched in the middle
                Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.SpaceBetween) {
                    header(true)
                    meta(true)
                    tools(true)
                    controls(true)
                }
            }
        } else {
            Column(Modifier.fillMaxSize()) {
                header(false)
                Box(Modifier.weight(1f).fillMaxWidth()) { art() }
                meta(false)
                tools(false)
                controls(false)
            }
        }
    }
}

/** A tool under the seek bar on a wide screen: a tall block (the whole block is the target) with the icon and its name. */
@Composable
private fun ToolBlock(label: String, active: Boolean, onClick: () -> Unit, icon: @Composable () -> Unit) {
    Column(
        Modifier.widthIn(min = 92.dp).height(88.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(18.dp)).clickable(onClick = onClick).padding(horizontal = 8.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) { icon() }
        Text(label, fontSize = 15.sp, color = if (active) Accent else Color(0xCCFFFFFF))
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
private fun SpeedButton(big: Boolean = false) {
    var open by remember { mutableStateOf(false) }
    Box {
        if (big) ToolBlock("Speed", Playback.speed != 1f, { open = true }) {
            Text(speedLabel(Playback.speed), color = if (Playback.speed != 1f) Accent else Color.White, fontSize = 24.sp)
        } else androidx.compose.material3.TextButton(onClick = { open = true }) {
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
