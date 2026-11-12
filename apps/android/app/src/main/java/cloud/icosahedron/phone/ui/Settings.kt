package cloud.icosahedron.phone.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cloud.icosahedron.phone.App
import cloud.icosahedron.phone.BuildConfig
import cloud.icosahedron.phone.data.LastFm
import cloud.icosahedron.phone.data.Prefs
import cloud.icosahedron.phone.data.Quality
import cloud.icosahedron.phone.data.SecureSignIn
import cloud.icosahedron.phone.player.Eq
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

private enum class Page { Main, Sync, LastFm, Equalizer, Devices, Offline }

@Composable
fun SettingsScreen() {
    var page by remember { mutableStateOf(Page.Main) }
    BackHandler(enabled = page != Page.Main) { page = Page.Main }
    when (page) {
        Page.Main -> MainSettings(open = { page = it })
        Page.Sync -> Sub("Sync Server", { page = Page.Main }) { SyncPage() }
        Page.LastFm -> Sub("Last.fm", { page = Page.Main }) { LastFmPage() }
        Page.Equalizer -> Sub("Equalizer", { page = Page.Main }) { EqualizerPage() }
        Page.Devices -> Sub("Secure sign-in", { page = Page.Main }) { DevicesPage() }
        Page.Offline -> Sub("Offline", { page = Page.Main }) { OfflinePage() }
    }
}

@Composable
private fun Sub(title: String, back: () -> Unit, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        TopBar(title, back)
        Column(Modifier.padding(horizontal = 16.dp)) { content() }
    }
}

@Composable
private fun Header(text: String) = Text(text, color = Accent, fontSize = 13.sp, modifier = Modifier.padding(top = 20.dp, bottom = 6.dp))

@Composable
private fun Note(text: String) = Text(text, color = Dim, fontSize = 12.sp, modifier = Modifier.padding(vertical = 4.dp))

@Composable
private fun LinkRow(label: String, value: String = "", onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        if (value.isNotEmpty()) Text(value, color = Dim, fontSize = 13.sp)
        Text("  ›", color = Dim)
    }
}

@Composable
private fun ToggleRow(label: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(on, onChange, colors = SwitchDefaults.colors(checkedTrackColor = Accent))
    }
}

@Composable
private fun ChoiceRow(label: String, value: String, options: List<String>, text: (String) -> String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clickable { open = true }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        androidx.compose.foundation.layout.Box {
            Text(text(value) + " ▾", color = Dim, fontSize = 13.sp)
            DropdownMenu(open, { open = false }) {
                options.forEach { o -> DropdownMenuItem(text = { Text((if (o == value) "✓ " else "") + text(o)) }, onClick = { onPick(o); open = false }) }
            }
        }
    }
}

@Composable
private fun MainSettings(open: (Page) -> Unit) {
    val app = App.instance
    val client = LocalClient.current
    val sync = app.sync
    var lyrics by remember { mutableStateOf(Prefs.lyricsOnline) }
    var bpm by remember { mutableStateOf(Prefs.showBpm) }
    var wifi by remember { mutableStateOf(Prefs.qualityWifi) }
    var cell by remember { mutableStateOf(Prefs.qualityCellular) }
    val secure by load("secure") { SecureSignIn.isOn(client) }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        item {
            Text("Settings", fontSize = 28.sp, color = Accent, modifier = Modifier.padding(vertical = 16.dp))
            Header("About")
            Row { Text("Version", Modifier.weight(1f)); Text(BuildConfig.VERSION_NAME, color = Dim) }
            Header("Account")
            Row { Text("Server", Modifier.weight(1f)); Text(client.baseUrl.substringAfter("://"), color = Dim) }
            Row(Modifier.padding(top = 6.dp)) { Text("User", Modifier.weight(1f)); Text(client.user, color = Dim) }
            Header("Connections")
            LinkRow("Sync Server", when (sync?.status) { "online" -> "Connected"; "connecting" -> "Connecting…"; else -> "Not reachable" }) { open(Page.Sync) }
            LinkRow("Last.fm") { open(Page.LastFm) }
            LinkRow("Secure sign-in", when (secure) { true -> "On"; false -> "Off"; null -> "" }) { open(Page.Devices) }
            Header("Sound")
            LinkRow("Equalizer", if (Eq.enabled) "On" else "Off") { open(Page.Equalizer) }
            Header("Offline")
            LinkRow("Cache and kept songs", "${cloud.icosahedron.phone.player.Offline.kept.size} kept") { open(Page.Offline) }
            Header("Lists")
            ToggleRow("Show BPM in song lists", bpm) { bpm = it; Prefs.showBpm = it }
            Header("Lyrics")
            ToggleRow("Look up lyrics online (LRCLIB)", lyrics) { lyrics = it; Prefs.lyricsOnline = it }
            Header("Playback quality")
            ChoiceRow("Wi-Fi", wifi, Quality.options, Quality::label) { wifi = it; Prefs.qualityWifi = it }
            ChoiceRow("Cellular", cell, Quality.options, Quality::label) { cell = it; Prefs.qualityCellular = it }
            Note("Wi-Fi and wired use the Wi-Fi profile, mobile data the Cellular one. Transcoding is done by your Navidrome server. It applies to the songs you start from now on.")
            Note("Right now: ${if (Quality.onCellular()) "Cellular" else "Wi-Fi"} · ${Quality.label(Quality.current())}")
            OutlinedButton(onClick = { app.signOut() }, modifier = Modifier.padding(top = 24.dp, bottom = 24.dp).fillMaxWidth()) { Text("Sign out") }
        }
    }
}

// ── Sync ──
@Composable
private fun SyncPage() {
    val sync = App.instance.sync
    val scope = rememberCoroutineScope()
    if (sync == null) { Note("Not signed in."); return }
    var name by remember(sync.name) { mutableStateOf(sync.name ?: "") }
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Header("Connection")
            Row { Text("Status", Modifier.weight(1f)); Text(sync.status, color = Dim) }
            Note("The sync server is the address you signed in with. To use a different one, sign out and sign in with it.")
            if (sync.status == "online") {
                Header("This phone")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    androidx.compose.material3.OutlinedTextField(name, { name = it }, singleLine = true, modifier = Modifier.weight(1f), label = { Text("Name") })
                    TextButton(onClick = { sync.rename(sync.myId, name.trim()) }, enabled = name.isNotBlank() && name != sync.name) { Text("Save", color = Accent) }
                }
                Header("Registered players")
            }
        }
        if (sync.status == "online") {
            items(sync.registry, key = { it.id }) { d ->
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(d.name + if (d.id == sync.myId) " (this phone)" else "")
                        Text("${d.kind} · ${if (d.online) "online" else "last seen " + DateFormat.getDateInstance(DateFormat.SHORT).format(Date(d.lastSeen))}", fontSize = 12.sp, color = if (d.online) Accent else Dim)
                    }
                    if (!d.online && d.id != sync.myId) TextButton(onClick = { sync.forget(d.id) }) { Text("Forget", color = Accent) }
                }
            }
            item { Note("Every player signed in with your account. Players that stay offline for 90 days are removed automatically.") }
        }
    }
}

// ── Last.fm ──
@Composable
private fun LastFmPage() {
    val client = LocalClient.current
    val context = LocalContext.current
    val fm = remember { LastFm() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { fm.refresh(client) }
    when (fm.state) {
        LastFm.State.UNKNOWN -> Note("Not available (needs the sync server).")
        LastFm.State.NOT_CONFIGURED -> Note("The sync server has no Last.fm API key yet (LASTFM_API_KEY and LASTFM_API_SECRET on it).")
        LastFm.State.DISCONNECTED ->
            if (fm.pendingToken == null) {
                OutlinedButton(onClick = { scope.launch { fm.begin(client)?.let { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) } } }, modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) { Text("Connect to Last.fm") }
            } else {
                Note("Approve the connection in the browser, then come back and finish.")
                OutlinedButton(onClick = { scope.launch { fm.finish(client) } }, modifier = Modifier.fillMaxWidth()) { Text("Finish connecting") }
                TextButton(onClick = { fm.pendingToken = null }) { Text("Cancel") }
            }
        LastFm.State.CONNECTED -> {
            Header("Account")
            Text(fm.username)
            ToggleRow("Scrobble", fm.scrobble) { on -> scope.launch { fm.setScrobbling(on, client) } }
            TextButton(onClick = { scope.launch { fm.disconnect(client) } }) { Text("Disconnect", color = Accent) }
        }
    }
    fm.message?.let { Text(it, color = Accent, fontSize = 13.sp) }
    Note("Scrobbles go through your server, so one connection covers all your devices.")
}

// ── Equalizer ──
@Composable
private fun EqualizerPage() {
    if (!Eq.available) { Note("This phone has no equalizer for the player."); return }
    Column {
        ToggleRow("Equalizer", Eq.enabled) { Eq.turn(it) }
        Eq.freqs.forEachIndexed { b, hz ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (hz >= 1000) "${hz / 1000} kHz" else "$hz Hz", fontSize = 12.sp, color = Dim, modifier = Modifier.padding(end = 8.dp).fillMaxWidth(0.2f))
                Slider(
                    Eq.levels[b].toFloat(), { Eq.setLevel(b, it.toInt()) }, valueRange = Eq.minLevel.toFloat()..Eq.maxLevel.toFloat(),
                    colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = Accent), enabled = Eq.enabled,
                )
            }
        }
        TextButton(onClick = { Eq.reset() }) { Text("Reset", color = Accent) }
    }
}

// ── Secure sign-in ──
@Composable
private fun DevicesPage() {
    val app = App.instance
    val client = LocalClient.current
    val scope = rememberCoroutineScope()
    var reload by remember { mutableIntStateOf(0) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirmOff by remember { mutableStateOf(false) }
    var appName by remember { mutableStateOf("") }
    val secure by load(reload) { SecureSignIn.isOn(client) }
    val devices by load(reload to secure) { if (secure == true) SecureSignIn.devices(client) else null }
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Text("Secure sign-in: ${when (secure) { true -> "on"; false -> "off"; null -> "…" }}", modifier = Modifier.padding(top = 12.dp))
            Note("With it on, a new device can only sign in when a device that is already trusted approves it. A password alone is not enough.")
            message?.let { Text(it, color = Accent, fontSize = 13.sp, modifier = Modifier.padding(vertical = 6.dp)) }
            if (secure == false) {
                OutlinedButton(enabled = !busy, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), onClick = {
                    busy = true; message = null
                    scope.launch {
                        when (val r = SecureSignIn.turnOn(client)) {
                            is SecureSignIn.TurnOn.On -> { app.secretsToShow = "Secure sign-in is on. Save these recovery codes: each works once, for a new device when none of your trusted devices is at hand." to r.recoveryCodes; app.signedIn(r.session) }
                            is SecureSignIn.TurnOn.Failed -> message = r.message
                        }
                        busy = false
                    }
                }) { Text(if (busy) "Switching on…" else "Turn on (administrator)") }
            }
            if (secure == true) {
                Header("Trusted devices")
            }
        }
        if (secure == true) {
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
            item {
                Header("Recovery codes")
                OutlinedButton(modifier = Modifier.fillMaxWidth(), onClick = {
                    scope.launch { SecureSignIn.newRecoveryCodes(client)?.let { app.secretsToShow = "New recovery codes. The old ones no longer work." to it } ?: run { message = "Could not make new codes." } }
                }) { Text("Make new recovery codes") }
                Header("App password (for other Subsonic apps)")
                Note("Other apps (Symfonium, DSub …) cannot ask for approval. This makes a password for one of them; it is shown once.")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    androidx.compose.material3.OutlinedTextField(appName, { appName = it }, singleLine = true, modifier = Modifier.weight(1f), label = { Text("App name") })
                    TextButton(enabled = appName.isNotBlank(), onClick = {
                        scope.launch { SecureSignIn.appPassword(client, appName.trim())?.let { app.secretsToShow = "App password for ${appName.trim()}. Use it as the password in that app; it is shown only now." to listOf(it); appName = ""; reload++ } ?: run { message = "Could not make it." } }
                    }) { Text("Make", color = Accent) }
                }
                TextButton(onClick = { confirmOff = true }, modifier = Modifier.padding(top = 16.dp)) { Text("Turn secure sign-in off", color = Accent) }
                if (confirmOff) androidx.compose.material3.AlertDialog(
                    onDismissRequest = { confirmOff = false },
                    title = { Text("Turn it off?") },
                    text = { Text("Then a password is enough again to sign in on a new device.") },
                    confirmButton = { TextButton(onClick = { confirmOff = false; scope.launch { SecureSignIn.turnOff(client); reload++ } }) { Text("Turn off", color = Accent) } },
                    dismissButton = { TextButton(onClick = { confirmOff = false }) { Text("Cancel") } },
                )
            }
        }
    }
}

// ── Offline ──
@Composable
private fun OfflinePage() {
    val offline = cloud.icosahedron.phone.player.Offline
    var limit by remember { mutableIntStateOf(Prefs.cacheLimitMb) }
    var cellular by remember { mutableStateOf(Prefs.cacheOnCellular) }
    var used by remember { mutableStateOf(offline.cacheBytes()) }
    var keptBytes by remember { mutableStateOf(offline.keptBytes()) }
    LaunchedEffect(offline.kept.size, offline.pending) { used = offline.cacheBytes(); keptBytes = offline.keptBytes() }
    fun mb(b: Long) = if (b >= 1024L * 1024 * 1024) "%.1f GB".format(b / 1073741824.0) else "%d MB".format(b / 1048576)
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Header("Cache")
            Note("Songs you play are kept for next time and the next song is fetched while this one plays, so they start at once and play without a network. The oldest are removed when the limit is reached.")
            ChoiceRow("Limit", limit.toString(), listOf(256, 512, 1024, 2048, 5120, 10240).map { it.toString() }, { mb(it.toLong() * 1048576) }) { limit = it.toInt(); offline.setLimitMb(limit) }
            Row { Text("In the cache now", Modifier.weight(1f)); Text(mb(used), color = Dim) }
            TextButton(onClick = { offline.clearCache(); used = 0 }) { Text("Clear the cache", color = Accent) }
            ToggleRow("Cache and download on mobile data", cellular) { cellular = it; Prefs.cacheOnCellular = it }
            Header("Kept on this phone")
            Row { Text("${offline.kept.size} songs", Modifier.weight(1f)); Text(mb(keptBytes), color = Dim) }
            if (offline.pending > 0) Note("Downloading: ${offline.pending} left")
            Note("Use \"Keep offline\" in a song's menu or on an album or playlist. Kept songs are never removed by the cache.")
            if (offline.kept.isNotEmpty()) TextButton(onClick = { offline.unkeepAll() }) { Text("Remove all kept songs", color = Accent) }
        }
    }
}
