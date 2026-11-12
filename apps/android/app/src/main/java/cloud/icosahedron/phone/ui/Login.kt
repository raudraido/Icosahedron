package cloud.icosahedron.phone.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cloud.icosahedron.phone.App
import cloud.icosahedron.phone.R
import cloud.icosahedron.phone.data.Discovery
import cloud.icosahedron.phone.data.FoundServer
import cloud.icosahedron.phone.data.SecureSignIn
import cloud.icosahedron.phone.data.Session
import cloud.icosahedron.phone.data.SessionStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private class Waiting(val base: String, val user: String, val password: String, val id: String, val secret: String, val number: Int, val expiresIn: Int)

/**
 * Sign in. With secure sign-in on, the password only asks to be let in: the number shown here is picked on a
 * device that is already trusted (docs/secure-sign-in.md). A server without it takes the password as before.
 */
@Composable
fun LoginScreen(onSignedIn: (Session) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf(App.instance.store.lastServer()) }
    var user by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var found by remember { mutableStateOf<List<FoundServer>>(emptyList()) }
    var waiting by remember { mutableStateOf<Waiting?>(null) }

    LaunchedEffect(Unit) {
        found = Discovery.find(context)
        if (found.size == 1 && url.isBlank()) url = found[0].address
    }

    fun go() {
        if (busy || url.isBlank() || user.isBlank() || pass.isBlank()) return
        busy = true; error = null
        scope.launch {
            val base = SessionStore.normalizeUrl(url)
            val (engine, secure) = SecureSignIn.probe(base)
            try {
                if (engine && secure) {
                    when (val r = SecureSignIn.request(base, user.trim(), pass)) {
                        is SecureSignIn.Started.Ok -> { App.instance.store.saveLastServer(base); waiting = Waiting(base, user.trim(), pass, r.id, r.secret, r.number, r.expiresIn) }
                        is SecureSignIn.Started.Failed -> error = when (r.why) {
                            SecureSignIn.Failure.WRONG -> "Wrong user name or password."
                            SecureSignIn.Failure.NO_TRUSTED_DEVICE -> "This account has no trusted device yet. Ask the server's administrator for an invite code."
                            SecureSignIn.Failure.RATE -> "Too many attempts. Wait a few minutes."
                            SecureSignIn.Failure.BUSY -> "There are already open requests for this account. Answer them or wait 5 minutes."
                            SecureSignIn.Failure.OFFLINE -> "Could not reach the server."
                            else -> "Something went wrong."
                        }
                    }
                } else {
                    val s = SessionStore.login(base, user, pass)
                    App.instance.store.saveLastServer(s.url)
                    onSignedIn(s)
                }
            } catch (e: Exception) {
                error = e.message ?: "Could not sign in"
            }
            busy = false
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(painterResource(R.drawable.logo), null, Modifier.size(88.dp))
        Text("Icosahedron", fontSize = 32.sp, color = Accent)
        val w = waiting
        if (w != null) {
            WaitStep(w, onSignedIn, onCancel = { waiting = null })
        } else {
            found.forEach { f -> AssistChip(onClick = { url = f.address }, label = { Text("${f.name} · ${f.address}") }) }
            Field("Server (https://music.example.com)", url, { url = it }, KeyboardType.Uri)
            Field("Username", user, { user = it }, KeyboardType.Text)
            Field("Password", pass, { pass = it }, KeyboardType.Password, secret = true)
            error?.let { Text(it, color = Accent) }
            Button(onClick = { go() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "Signing in…" else "Sign in") }
        }
    }
}

@Composable
private fun WaitStep(w: Waiting, onSignedIn: (Session) -> Unit, onCancel: () -> Unit) {
    var status by remember(w.id) { mutableStateOf("Waiting for approval…") }
    var codeMode by remember { mutableStateOf(false) }
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(w.id) {
        val deadline = System.currentTimeMillis() + w.expiresIn * 1000L
        while (System.currentTimeMillis() < deadline) {
            delay(2000)
            when (val p = SecureSignIn.poll(w.base, w.id, w.secret)) {
                is SecureSignIn.Poll.Approved -> { onSignedIn(p.session); return@LaunchedEffect }
                SecureSignIn.Poll.Denied -> { status = "It was denied."; return@LaunchedEffect }
                SecureSignIn.Poll.Expired, SecureSignIn.Poll.Gone -> { status = "The request expired. Go back and try again."; return@LaunchedEffect }
                SecureSignIn.Poll.Pending -> {}
            }
        }
        status = "The request expired. Go back and try again."
    }
    Text("Approve this sign-in on one of your devices", fontSize = 16.sp)
    Text("Pick this number there:", color = Dim)
    Text(w.number.toString(), fontSize = 72.sp, color = Accent)
    Text(status, color = Dim)
    if (codeMode) {
        Field("Recovery or invite code", code, { code = it }, KeyboardType.Ascii)
        error?.let { Text(it, color = Accent) }
        Button(onClick = {
            scope.launch {
                val (s, f) = SecureSignIn.signIn(code.trim(), w.base, w.user, w.password)
                if (s != null) onSignedIn(s) else error = if (f == SecureSignIn.Failure.RATE) "Too many attempts." else "That code does not work."
            }
        }, modifier = Modifier.fillMaxWidth()) { Text("Use code") }
    } else {
        TextButton(onClick = { codeMode = true }) { Text("No device at hand? Use a recovery code") }
    }
    TextButton(onClick = onCancel) { Text("Cancel") }
}

@Composable
fun Field(label: String, value: String, onChange: (String) -> Unit, type: KeyboardType, secret: Boolean = false) {
    OutlinedTextField(
        value = value, onValueChange = onChange, singleLine = true, modifier = Modifier.fillMaxWidth(),
        label = { Text(label) },
        visualTransformation = if (secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = type),
    )
}
