package cloud.icosahedron.phone.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cloud.icosahedron.phone.App
import cloud.icosahedron.phone.player.Playback

/** The name of the player the controls act on. */
fun targetName(): String = App.instance.sync?.devices?.firstOrNull { it.id == Control.target }?.name ?: "another device"

private fun kindLabel(k: String) = when (k) { "mobile" -> "Phone"; "tv" -> "TV"; "electron" -> "Desktop"; else -> "Browser" }

/**
 * Every device of the account and what it is doing. Tap one to make it the device the controls act on: the
 * mini player and Now Playing then show and control it, and what you play starts there. Moving music is
 * explicit: Send pushes this phone's playback there, Play here pulls it back.
 */
@Composable
fun DevicesScreen() {
    val sync = App.instance.sync
    Column(Modifier.fillMaxSize()) {
        Text("Devices", fontSize = 28.sp, color = Accent, modifier = Modifier.padding(16.dp))
        if (sync == null || sync.status != "online") {
            Text(if (sync?.status == "connecting") "Connecting…" else "Sync server not reachable", color = Dim, modifier = Modifier.padding(horizontal = 16.dp))
            return@Column
        }
        val me = sync.myId
        val chosen = sync.targetId ?: me
        LazyColumn(Modifier.fillMaxSize()) {
            items(sync.devices, key = { it.id }) { d ->
                val isMe = d.id == me
                val st = if (isMe) null else sync.stateOf(d.id)
                val track = if (isMe) Playback.current else st?.track
                val playing = if (isMe) Playback.isPlaying else st?.playing == true
                val selected = chosen == d.id
                Row(
                    Modifier.fillMaxWidth().clickable { sync.setTarget(if (isMe) null else d.id) }.padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(d.name + if (isMe) " (this phone)" else "", color = if (selected) Accent else androidx.compose.ui.graphics.Color.White)
                        Text(
                            if (track != null) "${if (playing) "Playing" else "Paused"}: ${track.title} — ${track.artist}" else "${kindLabel(d.kind)} · idle",
                            fontSize = 12.sp, color = if (playing) Accent else Dim, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    val t = sync.targetId
                    if (isMe && t != null && sync.stateOf(t)?.track != null) {
                        OutlinedButton(onClick = { sync.transfer(t, me); sync.setTarget(null) }) { Text("Play here") }
                    } else if (!isMe && Playback.current != null) {
                        OutlinedButton(onClick = { sync.transfer(me, d.id); sync.setTarget(d.id) }) { Text("Send") }
                    }
                }
            }
            item {
                if (sync.devices.size <= 1) Text("No other devices online.", color = Dim, modifier = Modifier.padding(16.dp))
                Text("Tap a device to play on it and control it. The player shows what it plays.", color = Dim, fontSize = 12.sp, modifier = Modifier.padding(16.dp))
            }
        }
    }
}
