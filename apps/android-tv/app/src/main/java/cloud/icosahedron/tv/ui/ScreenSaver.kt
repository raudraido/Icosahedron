@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import android.content.Context
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import android.media.MediaPlayer
import android.view.SurfaceHolder
import android.view.SurfaceView
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import cloud.icosahedron.tv.App
import cloud.icosahedron.tv.R
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.layout.Box
import androidx.compose.animation.core.animateFloat
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import cloud.icosahedron.tv.player.Playback
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.delay
import kotlin.random.Random

/** The screensaver settings (kept in the app's preferences) and whether the lyrics are on the screen right now. */
object ScreenSaverPrefs {
    const val MIN_MINUTES = 1
    const val MAX_MINUTES = 10

    private val prefs get() = App.instance.getSharedPreferences("icosahedron", Context.MODE_PRIVATE)

    var enabled by mutableStateOf(prefs.getBoolean("saverOn", true))
        private set
    var minutes by mutableIntStateOf(prefs.getInt("saverMinutes", 5).coerceIn(MIN_MINUTES, MAX_MINUTES))
        private set

    /** Set by Now Playing: with the lyrics open nobody is idle, so the screensaver waits. */
    enum class Style(val label: String) { Logo("Logo"), Clock("Clock"), Cover("Playing cover"), Mosaic("Cover mosaic"), Pulse("Pulsing logo"), Song("Song text") }

    var style by mutableStateOf(runCatching { Style.valueOf(prefs.getString("saverStyle", "Logo")!!) }.getOrDefault(Style.Logo))
        private set
    fun nextStyle() { style = Style.entries[(style.ordinal + 1) % Style.entries.size]; prefs.edit().putString("saverStyle", style.name).apply() }

    var lyricsOpen by mutableStateOf(false)

    fun turn(on: Boolean) { enabled = on; prefs.edit().putBoolean("saverOn", on).apply() }
    fun after(m: Int) { minutes = m.coerceIn(MIN_MINUTES, MAX_MINUTES); prefs.edit().putInt("saverMinutes", minutes).apply() }
}

/** A black screen; every half minute the picture moves to another place (nothing burns into an OLED screen). */
@Composable
fun ScreenSaver() {
    val playing = Playback.current
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when (ScreenSaverPrefs.style) {
            ScreenSaverPrefs.Style.Logo -> Mover(96.dp, 96.dp) { Logo() }
            ScreenSaverPrefs.Style.Pulse -> Mover(140.dp, 140.dp) {
                val t = rememberInfiniteTransition(label = "pulse")
                val k by t.animateFloat(1f, 1.25f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "k")
                Box(Modifier.size(140.dp), contentAlignment = Alignment.Center) {
                    Logo(Modifier.size(96.dp).scale(if (Playback.isPlaying) k else 1f))
                }
            }
            ScreenSaverPrefs.Style.Clock -> Mover(300.dp, 110.dp) {
                var now by remember { mutableStateOf(Date()) }
                LaunchedEffect(Unit) { while (true) { now = Date(); delay(10_000) } }
                Text(SimpleDateFormat("HH:mm", Locale.getDefault()).format(now), fontSize = 88.sp, fontWeight = FontWeight.Light, color = Color.White.copy(alpha = 0.6f))
            }
            ScreenSaverPrefs.Style.Cover ->
                if (playing == null) Mover(96.dp, 96.dp) { Logo() }
                else Mover(340.dp, 340.dp) { Cover(playing.coverArt, 340.dp, px = 700, modifier = Modifier.alpha(0.5f)) }
            ScreenSaverPrefs.Style.Song ->
                if (playing == null) Mover(96.dp, 96.dp) { Logo() }
                else Mover(520.dp, 90.dp) {
                    Column(Modifier.width(520.dp)) {
                        Text(playing.title, fontSize = 28.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.6f))
                        Text(playing.artist, fontSize = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.4f))
                    }
                }
            ScreenSaverPrefs.Style.Mosaic -> Mosaic()
        }
        HdrKeeper(Modifier.align(Alignment.BottomEnd))
    }
}

@Composable
private fun Logo(modifier: Modifier = Modifier.size(96.dp)) =
    Image(painterResource(R.drawable.logo), contentDescription = null, modifier = modifier, alpha = 0.6f)

/** Puts [content] (about [w] x [h]) somewhere on the screen and glides it to another place every half minute. */
@Composable
private fun Mover(w: Dp, h: Dp, content: @Composable () -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val maxX = (maxWidth - w).value.coerceAtLeast(1f)
        val maxY = (maxHeight - h).value.coerceAtLeast(1f)
        var fx by remember { mutableFloatStateOf(Random.nextFloat()) }
        var fy by remember { mutableFloatStateOf(Random.nextFloat()) }
        LaunchedEffect(Unit) {
            while (true) { delay(30_000); fx = Random.nextFloat(); fy = Random.nextFloat() }
        }
        val x by animateFloatAsState(fx * maxX, tween(4000), label = "saverX")
        val y by animateFloatAsState(fy * maxY, tween(4000), label = "saverY")
        Box(Modifier.offset(x.dp, y.dp)) { content() }
    }
}

/** Covers of random albums from the library in a grid; one tile changes every few seconds and the whole grid drifts slowly. */
@Composable
private fun Mosaic() {
    val client = LocalClient.current
    var covers by remember { mutableStateOf<List<String>>(emptyList()) }
    LaunchedEffect(Unit) { covers = runCatching { client.albums("random", 60).mapNotNull { it.coverArt } }.getOrDefault(emptyList()) }
    val playing = Playback.current
    if (covers.isEmpty()) { Mover(96.dp, 96.dp) { Logo() }; return }
    val cols = 8
    val rows = 5
    val shown = remember(covers) { mutableStateListOf<String>().apply { repeat(cols * rows) { add(covers[it % covers.size]) } } }
    LaunchedEffect(covers) { while (true) { delay(4000); shown[Random.nextInt(shown.size)] = covers.random() } }
    val drift = rememberInfiniteTransition(label = "drift")
    val dx by drift.animateFloat(-30f, 30f, infiniteRepeatable(tween(60_000), RepeatMode.Reverse), label = "dx")
    val dy by drift.animateFloat(-20f, 20f, infiniteRepeatable(tween(45_000), RepeatMode.Reverse), label = "dy")
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val tile = maxWidth / cols
        Column(Modifier.offset(dx.dp, dy.dp).alpha(0.3f)) {
            repeat(rows) { r -> Row { repeat(cols) { c -> Cover(shown[r * cols + c], tile, px = 200) } } }
        }
    }
}

/**
 * A tiny silent black HDR10 video, looped. As long as an HDR picture is on the screen the TV stays in its HDR mode
 * (like YouTube does with an HDR video), and there an OLED really switches the black pixels off; in the SDR mode it
 * lifts the black a little. The square is black on black, in the corner, on top of everything.
 */
@Composable
private fun HdrKeeper(modifier: Modifier) {
    val context = LocalContext.current
    AndroidView(
        modifier = modifier.size(32.dp),
        factory = {
            val player = MediaPlayer()
            SurfaceView(it).apply {
                setZOrderOnTop(true)
                holder.addCallback(object : SurfaceHolder.Callback {
                    override fun surfaceCreated(h: SurfaceHolder) {
                        runCatching {
                            context.resources.openRawResourceFd(R.raw.hdr_black).use { fd -> player.setDataSource(fd.fileDescriptor, fd.startOffset, fd.length) }
                            player.setDisplay(h)
                            player.isLooping = true
                            player.setVolume(0f, 0f)
                            player.setOnPreparedListener { p -> p.start() }
                            player.prepareAsync()
                        }
                    }
                    override fun surfaceChanged(h: SurfaceHolder, f: Int, w: Int, hh: Int) {}
                    override fun surfaceDestroyed(h: SurfaceHolder) { runCatching { player.release() } }
                })
            }
        },
    )
}
