package cloud.icosahedron.phone.ui

import android.graphics.drawable.BitmapDrawable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.core.graphics.ColorUtils
import androidx.palette.graphics.Palette
import coil.imageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * A colour taken from the cover of the playing song, for the Now Playing background. It is darkened and
 * toned down so white text stays readable on it; null when there is no cover (or until it is read). The
 * previous colour is kept while the next cover loads, so the background changes smoothly, not through black.
 */
@Composable
fun rememberCoverTint(coverId: String?): Color? {
    val client = LocalClient.current
    val context = LocalContext.current
    var tint by remember { mutableStateOf<Color?>(null) }
    LaunchedEffect(coverId) {
        if (coverId == null) { tint = null; return@LaunchedEffect }
        val url = client.coverUrl(coverId, 128) ?: return@LaunchedEffect
        val request = ImageRequest.Builder(context).data(url).allowHardware(false).size(128).build()
        val bitmap = ((context.imageLoader.execute(request) as? SuccessResult)?.drawable as? BitmapDrawable)?.bitmap ?: return@LaunchedEffect
        val rgb = withContext(Dispatchers.Default) {
            val p = Palette.from(bitmap).maximumColorCount(16).generate()
            (p.darkVibrantSwatch ?: p.vibrantSwatch ?: p.darkMutedSwatch ?: p.mutedSwatch ?: p.dominantSwatch)?.rgb
        } ?: return@LaunchedEffect
        val hsl = FloatArray(3)
        ColorUtils.colorToHSL(rgb, hsl)
        hsl[1] = minOf(hsl[1], 0.65f)
        hsl[2] = hsl[2].coerceIn(0.14f, 0.30f)
        tint = Color(ColorUtils.HSLToColor(hsl))
    }
    return tint
}
