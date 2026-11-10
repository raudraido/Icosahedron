@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import cloud.icosahedron.tv.App
import cloud.icosahedron.tv.BuildConfig

@Composable
fun SettingsScreen() {
    val app = App.instance
    val session = app.session ?: return
    Column(Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 16.dp)) {
        Row(Modifier.padding(bottom = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            ProfileAvatar(72.dp)
            Text(session.user, fontSize = 30.sp, modifier = Modifier.padding(start = 20.dp))
        }
        Field("Version", BuildConfig.VERSION_NAME)
        Field("Server", session.url)
        Field("User", session.user)
        Field("This TV", app.sync?.name ?: "—")
        Field("Sync", when (app.sync?.status) { "online" -> "Connected"; "connecting" -> "Connecting…"; else -> "Not connected" })
        Text(
            "Rename this TV from the Sync Server settings of another Icosahedron app.",
            color = Dim, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp, bottom = 24.dp),
        )
        ActionButton("Sign out", onClick = { app.signOut() })
    }
}

@Composable
private fun Field(label: String, value: String) {
    Row(Modifier.padding(vertical = 4.dp)) {
        Text(label, color = Dim, modifier = Modifier.width(140.dp))
        Text(value)
    }
}
