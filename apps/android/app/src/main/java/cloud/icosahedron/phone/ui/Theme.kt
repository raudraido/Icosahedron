package cloud.icosahedron.phone.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import cloud.icosahedron.phone.data.SubsonicClient

val Accent = Color(0xFFE8593C)
val Bg = Color(0xFF111319)
val Panel = Color(0xFF1C1E27)
val PanelHi = Color(0xFF2A2D38)
val Dim = Color(0xFFA0A4B0)

/** The signed-in server connection, for covers and lists. */
val LocalClient = compositionLocalOf<SubsonicClient> { error("not signed in") }

@Composable
fun IcoTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Accent, onPrimary = Color.White, background = Bg, onBackground = Color.White,
            surface = Panel, onSurface = Color.White, surfaceVariant = PanelHi, onSurfaceVariant = Dim,
            secondaryContainer = PanelHi, onSecondaryContainer = Color.White,
        ),
        content = content,
    )
}
