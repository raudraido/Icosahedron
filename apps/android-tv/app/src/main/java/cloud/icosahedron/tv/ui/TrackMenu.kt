@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.key
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.tv.material3.Button
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import cloud.icosahedron.tv.data.Playlist
import cloud.icosahedron.tv.data.Track
import cloud.icosahedron.tv.player.Playback
import kotlinx.coroutines.launch

/** The favorite marks changed on this TV (the song lists are not reloaded): the choice wins over what the list was loaded with. */
object TvFavorites {
    val over = mutableStateMapOf<String, Boolean>()
    fun isFavorite(t: Track) = over[t.id] ?: t.starred
}

/**
 * What can be done with one song, opened by holding OK on it: play it next, add it to the queue, go to its album or its artist, add
 * it to a playlist, mark it as a favorite. OK picks, Back closes.
 */
@Composable
fun TrackMenu(track: Track, onDismiss: () -> Unit) {
    val client = LocalClient.current
    val go = LocalNavigate.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var page by remember { mutableStateOf("main") }
    val playlists by produceState<List<Playlist>?>(null, page) { if (page == "playlists") value = runCatching { client.playlists() }.getOrNull() }
    val fav = TvFavorites.isFavorite(track)
    val focus = remember { FocusRequester() }
    // The menu opens while OK is still held. The release of that long press must not count as a click on the first item (Play next):
    // the OK events of the hold (its repeats and its release) are swallowed until it is let go.
    val openedAt = remember { android.os.SystemClock.uptimeMillis() }
    var released by remember { mutableStateOf(false) }
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()

    Dialog(onDismissRequest = { if (page == "main") onDismiss() else page = "main" }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.width(480.dp).background(Panel, RoundedCornerShape(16.dp)).padding(20.dp).onPreviewKeyEvent { e ->
                val ok = e.key == Key.DirectionCenter || e.key == Key.Enter || e.key == Key.NumPadEnter
                when {
                    !ok || released -> false
                    e.type == KeyEventType.KeyUp -> { released = true; android.os.SystemClock.uptimeMillis() - openedAt < 3000 }
                    else -> e.nativeKeyEvent.repeatCount > 0 // the repeats of the hold; a fresh press goes through
                }
            },
        ) {
            Text(track.title, fontSize = 20.sp, maxLines = 1, modifier = Modifier.padding(bottom = 2.dp))
            Text(listOfNotNull(track.artist, track.album).joinToString(" · "), fontSize = 13.sp, color = Dim, maxLines = 1, modifier = Modifier.padding(bottom = 12.dp))
            if (page == "main") {
                @Composable fun item(label: String, first: Boolean = false, action: () -> Unit) = Button(
                    onClick = action,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp).then(if (first) Modifier.focusRequester(focus) else Modifier),
                ) { Text(label) }
                item("Play next", first = true) { Playback.playNext(track); toast("Playing next"); onDismiss() }
                item("Add to queue") { Playback.addToQueue(listOf(track)); toast("Added to the queue"); onDismiss() }
                track.albumId?.let { id -> item("Go to album") { onDismiss(); go(Screen.AlbumDetail(id)) } }
                track.artistId?.let { id -> item("Go to artist") { onDismiss(); go(Screen.ArtistDetail(id)) } }
                item("Add to playlist") { page = "playlists" }
                item(if (fav) "Remove from favorites" else "Favorite") {
                    val on = !fav
                    TvFavorites.over[track.id] = on
                    scope.launch { if (!runCatching { client.setStarred(track.id, on) }.isSuccess) TvFavorites.over[track.id] = !on }
                    onDismiss()
                }
            } else {
                val list = playlists
                when {
                    list == null -> Text("Loading…", color = Dim)
                    list.isEmpty() -> Text("No playlists yet", color = Dim)
                    else -> LazyColumn(Modifier.heightIn(max = 340.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        items(list, key = { it.id }) { p ->
                            Button(onClick = {
                                scope.launch { toast(if (runCatching { client.addToPlaylist(p.id, track.id) }.isSuccess) "Added to ${p.name}" else "Could not add it") }
                                onDismiss()
                            }, modifier = Modifier.fillMaxWidth()) { Text(p.name, maxLines = 1) }
                        }
                    }
                }
            }
        }
        LaunchedEffect(page) { if (page == "main") runCatching { focus.requestFocus() } }
    }
}
