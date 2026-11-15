package cloud.icosahedron.tv.ui

import android.content.Context
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
    var lyricsOpen by mutableStateOf(false)

    fun turn(on: Boolean) { enabled = on; prefs.edit().putBoolean("saverOn", on).apply() }
    fun after(m: Int) { minutes = m.coerceIn(MIN_MINUTES, MAX_MINUTES); prefs.edit().putInt("saverMinutes", minutes).apply() }
}

/** A black screen with the small logo; every half minute it moves to another place (nothing burns into an OLED screen). */
@Composable
fun ScreenSaver() {
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black)) {
        val size = 96.dp
        val maxX = (maxWidth - size).value.coerceAtLeast(1f)
        val maxY = (maxHeight - size).value.coerceAtLeast(1f)
        var fx by remember { mutableFloatStateOf(Random.nextFloat()) }
        var fy by remember { mutableFloatStateOf(Random.nextFloat()) }
        LaunchedEffect(Unit) {
            while (true) {
                delay(30_000)
                fx = Random.nextFloat(); fy = Random.nextFloat()
            }
        }
        val x by animateFloatAsState(fx * maxX, tween(4000), label = "saverX")
        val y by animateFloatAsState(fy * maxY, tween(4000), label = "saverY")
        Image(
            painterResource(R.drawable.logo), contentDescription = null,
            modifier = Modifier.offset(x.dp, y.dp).size(size),
            alpha = 0.6f,
        )
    }
}
