@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.tv.material3.ButtonColors
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.LocalContentColor
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme

val Accent = Color(0xFFE8593C)
val Bg = Color(0xFF111319)
val Panel = Color(0xFF1C1E27)
val PanelHi = Color(0xFF2A2D38)
val Dim = Color(0xFFA0A4B0)

/**
 * A button's text takes its colour from the button: light on the dark button, dark on the white one a
 * focused button turns into. Never give a Text inside a button its own colour (it would be light on
 * white when focused); use [dim] for the secondary lines instead.
 */
@Composable
fun dim(): Color = LocalContentColor.current.copy(alpha = 0.68f)

/** A tab / top bar button: the one you are on is filled with the accent colour, a focused one is white. */
@Composable
fun navColors(selected: Boolean): ButtonColors = ButtonDefaults.colors(
    containerColor = if (selected) Accent else Panel,
    contentColor = Color.White,
    focusedContainerColor = Color.White,
    focusedContentColor = Bg,
    pressedContainerColor = Color.White,
    pressedContentColor = Bg,
)

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
    ) {
        // Text outside a button or card would otherwise be black on the dark background.
        CompositionLocalProvider(LocalContentColor provides Color.White, content = content)
    }
}
