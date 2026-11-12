package cloud.icosahedron.phone.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cloud.icosahedron.phone.App
import cloud.icosahedron.phone.BuildConfig
import cloud.icosahedron.phone.data.SecureSignIn
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

@Composable
fun SettingsScreen() {
    val app = App.instance
    val client = LocalClient.current
    val sync = app.sync
    val scope = rememberCoroutineScope()
    var reload by remember { mutableIntStateOf(0) }
    val secure by load(reload) { SecureSignIn.isOn(client) }
    val devices by load(reload to secure) { if (secure == true) SecureSignIn.devices(client) else null }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        item {
            Text("Settings", fontSize = 28.sp, color = Accent, modifier = Modifier.padding(vertical = 16.dp))
            Text("Account", color = Dim, fontSize = 13.sp)
            Text("${client.user} at ${client.baseUrl}")
            Text("Sync: ${sync?.status ?: "off"}${sync?.name?.let { " · this phone is \"$it\"" } ?: ""}", color = Dim, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
            Text("Secure sign-in: ${when (secure) { true -> "on"; false -> "off"; null -> "…" }}", color = Dim, fontSize = 13.sp)
            Text("Icosahedron Android ${BuildConfig.VERSION_NAME}", color = Dim, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp, bottom = 12.dp))
        }
        if (secure == true) {
            item { Text("Trusted devices", fontSize = 18.sp, modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)) }
            val d = devices
            items(d?.first ?: emptyList(), key = { it.id }) { dev ->
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(dev.name + if (dev.id == d?.second) " (this phone)" else "")
                        Text("${dev.kind} · ${dev.address} · ${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(dev.lastSeen))}", fontSize = 12.sp, color = Dim)
                    }
                    if (dev.id != d?.second) TextButton(onClick = { scope.launch { SecureSignIn.remove(client, dev.id); reload++ } }) { Text("Remove", color = Accent) }
                }
            }
        }
        item {
            OutlinedButton(onClick = { app.signOut() }, modifier = Modifier.padding(top = 24.dp).fillMaxWidth()) { Text("Sign out") }
        }
    }
}
