package cloud.icosahedron.phone

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import cloud.icosahedron.phone.ui.ApprovalDialog
import cloud.icosahedron.phone.ui.Bg
import cloud.icosahedron.phone.ui.IcoTheme
import cloud.icosahedron.phone.ui.LoginScreen
import cloud.icosahedron.phone.ui.MainScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            IcoTheme {
                val asker = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
                LaunchedEffect(Unit) { if (Build.VERSION.SDK_INT >= 33) asker.launch(Manifest.permission.POST_NOTIFICATIONS) }
                Box(Modifier.fillMaxSize().background(Bg)) {
                    val app = App.instance
                    if (app.session == null) LoginScreen(onSignedIn = { app.signedIn(it) }) else {
                        MainScreen()
                        app.sync?.let { ApprovalDialog(it) }
                        cloud.icosahedron.phone.ui.SecretsDialog(app.secretsToShow) { app.secretsToShow = null }
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        App.instance.foreground = true
        App.instance.sync?.appVisible(true)
        App.instance.sync?.refreshApprovals()
    }

    override fun onStop() {
        App.instance.foreground = false
        App.instance.sync?.appVisible(false)
        super.onStop()
    }
}
