package cloud.icosahedron.phone.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cloud.icosahedron.phone.sync.SyncClient
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

/**
 * "Someone is signing in": shown over everything (a Dialog is a window of its own, so it also covers the
 * player). Three numbers are offered, the one the other device shows approves, any other denies.
 */
@Composable
fun ApprovalDialog(sync: SyncClient) {
    val p = sync.approvals.firstOrNull() ?: return
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = {},
        title = { Text("Sign-in attempt") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("${p.deviceName}\n${p.address} · ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(p.at))}")
                Text("Pick the number you see on that device. If you do not know it, deny.")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    p.choices.forEach { n ->
                        Button(onClick = { scope.launch { sync.answer(p, true, n) } }, modifier = Modifier.weight(1f).padding(vertical = 4.dp)) {
                            Text(n.toString(), fontSize = 26.sp)
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { OutlinedButton(onClick = { scope.launch { sync.answer(p, false, null) } }) { Text("Deny") } },
    )
}

/** Codes or a password that are shown only once. */
@Composable
fun SecretsDialog(content: Pair<String, List<String>>?, onClose: () -> Unit) {
    val (text, lines) = content ?: return
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    AlertDialog(
        onDismissRequest = {},
        title = { Text("Save this now") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(text)
                lines.forEach { Text(it, fontSize = 18.sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace) }
            }
        },
        confirmButton = { Button(onClick = onClose) { Text("I saved them") } },
        dismissButton = { TextButton(onClick = { clipboard.setText(androidx.compose.ui.text.AnnotatedString(lines.joinToString("\n"))) }) { Text("Copy") } },
    )
}
