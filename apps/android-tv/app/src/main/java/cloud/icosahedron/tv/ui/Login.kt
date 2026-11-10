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
import cloud.icosahedron.tv.data.Session
import cloud.icosahedron.tv.data.SessionStore
import kotlinx.coroutines.launch

/** The address of the web engine (or a Navidrome server), the user and the password; typed with the TV's keyboard. */
@Composable
fun LoginScreen(onSignedIn: (Session) -> Unit) {
    var url by remember { mutableStateOf("") }
    var user by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun submit() {
        if (busy || url.isBlank() || user.isBlank() || pass.isBlank()) return
        busy = true
        error = null
        scope.launch {
            try {
                onSignedIn(SessionStore.login(url, user, pass))
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
        Text("Sign in to your server", color = Dim)
        OutlinedTextField(
            value = url, onValueChange = { url = it }, singleLine = true, modifier = Modifier.width(520.dp),
            label = { Text("Server (https://music.example.com)") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
            colors = fieldColors(),
        )
        OutlinedTextField(
            value = user, onValueChange = { user = it }, singleLine = true, modifier = Modifier.width(520.dp),
            label = { Text("Username") },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            colors = fieldColors(),
        )
        OutlinedTextField(
            value = pass, onValueChange = { pass = it }, singleLine = true, modifier = Modifier.width(520.dp),
            label = { Text("Password") },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            colors = fieldColors(),
        )
        error?.let { Text(it, color = Accent) }
        ActionButton(if (busy) "Signing in…" else "Sign in", onClick = { submit() })
    }
}

@Composable
private fun fieldColors() = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
    focusedTextColor = androidx.compose.ui.graphics.Color.White,
    unfocusedTextColor = androidx.compose.ui.graphics.Color.White,
    focusedBorderColor = Accent,
    unfocusedBorderColor = Dim,
    focusedLabelColor = Accent,
    unfocusedLabelColor = Dim,
    cursorColor = Accent,
)
