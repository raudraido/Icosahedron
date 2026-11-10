@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme

val Accent = Color(0xFFE8593C)
val Bg = Color(0xFF111319)
val Panel = Color(0xFF1C1E27)
val PanelHi = Color(0xFF2A2D38)
val Dim = Color(0xFFA0A4B0)

@Composable
fun IcoTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Accent,
            onPrimary = Color.White,
            background = Bg,
            onBackground = Color.White,
            surface = Panel,
            onSurface = Color.White,
            surfaceVariant = PanelHi,
            onSurfaceVariant = Dim,
        ),
        content = content,
    )
}
