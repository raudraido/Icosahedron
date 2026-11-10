@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import cloud.icosahedron.tv.App
import cloud.icosahedron.tv.data.Discovery
import cloud.icosahedron.tv.data.FoundServer
import cloud.icosahedron.tv.data.QuickConnectClient
import cloud.icosahedron.tv.data.Session
import cloud.icosahedron.tv.data.SessionStore
import cloud.icosahedron.tv.sync.SyncClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private sealed interface Mode {
    data object Server : Mode
    data object Password : Mode
    data class Code(val url: String, val code: String, val secret: String, val expiresInSeconds: Int) : Mode
}

/**
 * Sign in. The server is found on the network (or typed once); then Quick Connect: this TV shows a
 * six-digit code and a signed-in app authorizes it. Typing user and password is the fallback.
 */
@Composable
fun LoginScreen(onSignedIn: (Session) -> Unit) {
    var mode by remember { mutableStateOf<Mode>(Mode.Server) }
    val remembered = remember { App.instance.store.lastServer() }
    var url by remember { mutableStateOf(remembered) }
    var user by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var found by remember { mutableStateOf<List<FoundServer>>(emptyList()) }
    var searching by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()

    // Ask the network which servers are there.
    LaunchedEffect(Unit) {
        found = Discovery.find(App.instance)
        searching = false
        // One server found, and the field still holds nothing or what was remembered: use the found one.
        if (found.size == 1 && (url.isBlank() || url == remembered)) url = found[0].address
    }

    fun startQuickConnect() {
        if (busy || url.isBlank()) return
        busy = true
        error = null
        scope.launch {
            try {
                val base = SessionStore.normalizeUrl(url)
                val qc = QuickConnectClient(base)
                if (!qc.enabled()) {
                    error = "Quick Connect is not switched on on this server (QUICK_CONNECT=true). You can sign in with a password."
                } else {
                    val i = qc.initiate(App.instance.store.deviceId(), SyncClient.defaultName())
                    App.instance.store.saveLastServer(base)
                    mode = Mode.Code(base, i.code, i.secret, i.expiresInSeconds)
                }
            } catch (e: Exception) {
                error = e.message ?: "Could not reach the server"
            }
            busy = false
        }
    }

    fun signInWithPassword() {
        if (busy || url.isBlank() || user.isBlank() || pass.isBlank()) return
        busy = true
        error = null
        scope.launch {
            try {
                val session = SessionStore.login(url, user, pass)
                App.instance.store.saveLastServer(session.url)
                onSignedIn(session)
            } catch (e: Exception) {
                error = e.message ?: "Could not sign in"
            }
            busy = false
        }
    }

    Column(
        Modifier.fillMaxSize().padding(48.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Icosahedron", fontSize = 40.sp, color = Accent)
        when (val m = mode) {
            is Mode.Code -> CodeStep(m, onSignedIn, onCancel = { mode = Mode.Server })
            Mode.Password -> {
                Text("Sign in with your account", color = Dim)
                Field("Server (https://music.example.com)", url, { url = it }, KeyboardType.Uri, ImeAction.Next)
                Field("Username", user, { user = it }, KeyboardType.Text, ImeAction.Next)
                Field("Password", pass, { pass = it }, KeyboardType.Password, ImeAction.Done, secret = true)
                error?.let { Text(it, color = Accent) }
                ActionButton(if (busy) "Signing in…" else "Sign in", onClick = { signInWithPassword() })
                ActionButton("Back", onClick = { mode = Mode.Server; error = null })
            }
            Mode.Server -> {
                Text("Where is your server?", color = Dim)
                if (found.isNotEmpty()) {
                    Text("Found on your network:", color = Dim, fontSize = 13.sp)
                    found.forEach { f -> ActionButton("${f.name}  ·  ${f.address}", onClick = { url = f.address }) }
                } else {
                    Text(if (searching) "Looking for servers on your network…" else "No server found. If this TV is on another network than the server (a VLAN), switch on mDNS forwarding in your router, or type the address once: it is remembered.", color = Dim, fontSize = 13.sp)
                }
                Field("Server (https://music.example.com)", url, { url = it }, KeyboardType.Uri, ImeAction.Done)
                error?.let { Text(it, color = Accent) }
                ActionButton(if (busy) "Connecting…" else "Quick Connect (sign in from your phone)", onClick = { startQuickConnect() })
                ActionButton("Sign in with a password instead", onClick = { mode = Mode.Password; error = null })
            }
        }
    }
}

/** Shows the code and waits until a signed-in app has authorized it. */
@Composable
private fun CodeStep(m: Mode.Code, onSignedIn: (Session) -> Unit, onCancel: () -> Unit) {
    var status by remember(m.secret) { mutableStateOf("Waiting for you…") }
    LaunchedEffect(m.secret) {
        val qc = QuickConnectClient(m.url)
        val deadline = System.currentTimeMillis() + m.expiresInSeconds * 1000L
        try {
            while (System.currentTimeMillis() < deadline) {
                delay(2000)
                val ok = qc.authenticated(m.secret)
                if (ok == null) { status = "The code expired. Go back and start again."; return@LaunchedEffect }
                if (ok) {
                    val session = qc.claim(m.secret)
                    session.client().ping() // the account works against this server
                    onSignedIn(session)
                    return@LaunchedEffect
                }
            }
            status = "The code expired. Go back and start again."
        } catch (e: Exception) {
            status = e.message ?: "Something went wrong. Go back and try again."
        }
    }
    Text("On your phone or computer, open Icosahedron, then", color = Dim)
    Text("Settings → Sync Server → Quick Connect, and enter:", color = Dim)
    Text(m.code.chunked(3).joinToString(" "), fontSize = 72.sp, color = Accent, modifier = Modifier.padding(vertical = 12.dp))
    Text(status, color = Dim)
    ActionButton("Cancel", onClick = onCancel)
}

@Composable
private fun Field(label: String, value: String, onChange: (String) -> Unit, type: KeyboardType, ime: ImeAction, secret: Boolean = false) {
    OutlinedTextField(
        value = value, onValueChange = onChange, singleLine = true, modifier = Modifier.width(520.dp),
        label = { Text(label) },
        visualTransformation = if (secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = type, imeAction = ime),
        colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
            focusedTextColor = androidx.compose.ui.graphics.Color.White,
            unfocusedTextColor = androidx.compose.ui.graphics.Color.White,
            focusedBorderColor = Accent, unfocusedBorderColor = Dim,
            focusedLabelColor = Accent, unfocusedLabelColor = Dim, cursorColor = Accent,
        ),
    )
}
