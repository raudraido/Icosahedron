@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.Arrangement
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
        // The name the other devices see for this TV (the sync server keeps it)
        var editing by remember { mutableStateOf(false) }
        var text by remember(app.sync?.name) { mutableStateOf(app.sync?.name ?: "") }
        if (editing) {
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                androidx.compose.material3.OutlinedTextField(
                    value = text, onValueChange = { text = it }, singleLine = true, label = { Text("Name of this TV") },
                    modifier = Modifier.width(420.dp),
                    colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                        focusedBorderColor = Accent, unfocusedBorderColor = Dim, focusedLabelColor = Accent, unfocusedLabelColor = Dim, cursorColor = Accent,
                    ),
                )
                ActionButton("Save", onClick = { app.sync?.rename(text); editing = false })
                ActionButton("Cancel", onClick = { text = app.sync?.name ?: ""; editing = false })
            }
        } else if (app.sync?.status == "online") {
            ActionButton("Rename this TV", onClick = { editing = true }, modifier = Modifier.padding(top = 8.dp))
        } else {
            Text("Connect to the sync server to rename this TV.", color = Dim, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
        }
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Screensaver", color = Dim, modifier = Modifier.width(140.dp))
            ActionButton(if (ScreenSaverPrefs.enabled) "On" else "Off", onClick = { ScreenSaverPrefs.turn(!ScreenSaverPrefs.enabled) })
            if (ScreenSaverPrefs.enabled) {
                ActionButton(ScreenSaverPrefs.style.label, onClick = { ScreenSaverPrefs.nextStyle() })
                ActionButton("−", onClick = { ScreenSaverPrefs.after(ScreenSaverPrefs.minutes - 1) })
                Text("${ScreenSaverPrefs.minutes} min", modifier = Modifier.width(70.dp))
                ActionButton("+", onClick = { ScreenSaverPrefs.after(ScreenSaverPrefs.minutes + 1) })
            }
        }
        Text("Click the style to change it. Starts after no key press; not while the lyrics are open.", color = Dim, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
        Spacer(Modifier.height(24.dp))
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
