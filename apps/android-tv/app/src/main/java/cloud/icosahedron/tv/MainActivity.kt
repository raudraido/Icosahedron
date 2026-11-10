package cloud.icosahedron.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import cloud.icosahedron.tv.ui.Bg
import cloud.icosahedron.tv.ui.IcoTheme
import cloud.icosahedron.tv.ui.LoginScreen
import cloud.icosahedron.tv.ui.MainScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            IcoTheme {
                Box(Modifier.fillMaxSize().background(Bg)) {
                    val app = App.instance
                    if (app.session == null) LoginScreen(onSignedIn = { app.signedIn(it) }) else MainScreen()
                }
            }
        }
    }
}
