package cloud.icosahedron.phone.ui

import android.content.Intent
import android.widget.Toast
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import cloud.icosahedron.phone.App
import cloud.icosahedron.phone.data.Album
import cloud.icosahedron.phone.data.Playlist
import cloud.icosahedron.phone.data.Track
import cloud.icosahedron.phone.player.Offline
import kotlinx.coroutines.launch

/** Where the menus can take you (the screens provide it). */
interface Opener {
    fun album(id: String)
    fun artist(id: String)
    fun back()
}

val LocalOpener = compositionLocalOf<Opener> {
    object : Opener { override fun album(id: String) {}; override fun artist(id: String) {}; override fun back() {} }
}

/** Bumped when playlists change, so the lists reload. */
object Library {
    var playlistsRevision by mutableIntStateOf(0)
}

/** Favorites changed in the app, so every list shows them at once. */
object Favorites {
    val over = mutableStateMapOf<String, Boolean>()
    fun album(a: Album) = over["album:${a.id}"] ?: a.starred
    fun track(t: Track) = over["track:${t.id}"] ?: t.starred
}

/**
 * What a menu is for. kind: "album", "playlist", "track" or "list" (songs without an id of their own).
 * The same menu opens from the "⋮" button on a page and from a long press on a card, like in the iOS app.
 */
class Target(
    val kind: String, val id: String, val name: String, val subtitle: String, val cover: String?,
    val album: Album? = null, val playlist: Playlist? = null, val track: Track? = null,
    val preloaded: List<Track>? = null,
    /** The menu belongs to the page that shows this; deleting the playlist closes the page. */
    val onPage: Boolean = false,
)

@Composable
fun TargetMenu(t: Target, expanded: Boolean, onDismiss: () -> Unit) {
    val client = LocalClient.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val opener = LocalOpener.current
    val sync = App.instance.sync
    var page by remember(expanded) { mutableStateOf("main") }
    var dialog by remember { mutableStateOf<String?>(null) }
    var text by remember { mutableStateOf("") }
    val playlists by produceState<List<Playlist>?>(null, page) { if (page == "playlists") value = runCatching { client.playlists() }.getOrNull() }

    suspend fun tracks(): List<Track>? = t.preloaded ?: when (t.kind) {
        "album" -> runCatching { client.album(t.id).second }.getOrNull()
        "playlist" -> runCatching { client.playlistTracks(t.id) }.getOrNull()
        "track" -> t.track?.let { listOf(it) }
        else -> null
    }

    val downloaded = when (t.kind) {
        "track" -> t.track?.let { Offline.isKept(it.id) } == true
        "list" -> t.preloaded?.let { l -> l.isNotEmpty() && l.all { Offline.isKept(it.id) } } == true
        else -> Offline.isCollectionKept(t.kind, t.id)
    }

    fun download() = scope.launch {
        when (t.kind) {
            "track" -> t.track?.let { x -> if (Offline.isKept(x.id)) Offline.unkeep(x) else keepOffline(context, client, listOf(x)) }
            "list" -> tracks()?.let { l -> if (l.all { Offline.isKept(it.id) }) l.forEach { Offline.unkeep(it) } else keepOffline(context, client, l) }
            else -> if (downloaded) Offline.unkeepCollection(t.kind, t.id) else {
                val l = tracks()
                if (l.isNullOrEmpty()) Toast.makeText(context, "Could not load it", Toast.LENGTH_SHORT).show()
                else keepCollectionOffline(context, client, t.kind, t.id, t.name, t.subtitle, t.cover, l)
            }
        }
    }

    val favoriteKey = t.album?.let { "album:${it.id}" } ?: t.track?.let { "track:${it.id}" }
    val isFavorite = t.album?.let { Favorites.album(it) } ?: t.track?.let { Favorites.track(it) } ?: false
    fun toggleFavorite() {
        val key = favoriteKey ?: return
        val on = !isFavorite
        Favorites.over[key] = on
        scope.launch {
            val ok = runCatching { if (t.album != null) client.setAlbumStarred(t.album.id, on) else client.setStarred(t.track!!.id, on) }.isSuccess
            if (!ok) Favorites.over[key] = !on
        }
    }

    fun share() = scope.launch {
        val id = if (t.kind == "track") t.track?.id else t.id
        val url = id?.let { runCatching { client.createShare(it) }.getOrNull() }
        if (url == null) Toast.makeText(context, "Sharing is not available (turn on ND_ENABLESHARING in Navidrome)", Toast.LENGTH_LONG).show()
        else context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url), null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    DropdownMenu(expanded, onDismiss) {
        when (page) {
            "devices" -> {
                DropdownMenuItem(text = { Text("‹ Back") }, onClick = { page = "main" })
                sync?.devices?.filter { it.id != sync.myId }?.forEach { d ->
                    listOf("Play Now" to "now", "Play Next" to "next", "Add to Queue" to "end").forEach { (label, at) ->
                        DropdownMenuItem(text = { Text("${d.name}: $label") }, onClick = { onDismiss(); scope.launch { tracks()?.let { sync.enqueue(d.id, it, at) } } })
                    }
                }
            }
            "playlists" -> {
                DropdownMenuItem(text = { Text("‹ Back") }, onClick = { page = "main" })
                DropdownMenuItem(text = { Text("New Playlist…") }, onClick = { onDismiss(); text = ""; dialog = "new" })
                playlists?.forEach { p ->
                    DropdownMenuItem(text = { Text(p.name) }, onClick = {
                        onDismiss()
                        scope.launch {
                            val l = tracks()
                            if (!l.isNullOrEmpty()) {
                                val ok = runCatching { client.addToPlaylist(p.id, l.map { it.id }) }.isSuccess
                                Toast.makeText(context, if (ok) "Added to ${p.name}" else "Could not add", Toast.LENGTH_SHORT).show()
                                Library.playlistsRevision++
                            }
                        }
                    })
                }
            }
            else -> {
                DropdownMenuItem(text = { Text("Play Next") }, onClick = { onDismiss(); scope.launch { tracks()?.reversed()?.forEach { Control.playNext(it) } } })
                DropdownMenuItem(text = { Text("Add to Queue") }, onClick = { onDismiss(); scope.launch { tracks()?.let { Control.addToQueue(it) } } })
                if (sync != null && sync.devices.any { it.id != sync.myId }) DropdownMenuItem(text = { Text("Add to Device Queue  ›") }, onClick = { page = "devices" })
                DropdownMenuItem(text = { Text(if (downloaded) "Remove Download" else "Download") }, onClick = { onDismiss(); download() })
                if (favoriteKey != null) DropdownMenuItem(text = { Text(if (isFavorite) "Remove Favorite" else "Favorite") }, onClick = { onDismiss(); toggleFavorite() })
                DropdownMenuItem(text = { Text("Add to Playlist  ›") }, onClick = { page = "playlists" })
                if (t.kind != "list") DropdownMenuItem(text = { Text("Share") }, onClick = { onDismiss(); share() })
                val albumId = t.track?.albumId
                if (albumId != null) DropdownMenuItem(text = { Text("Show Album") }, onClick = { onDismiss(); opener.album(albumId) })
                val artistId = t.album?.artistId ?: t.track?.artistId
                if (artistId != null) DropdownMenuItem(text = { Text("Show Artist") }, onClick = { onDismiss(); opener.artist(artistId) })
                if (t.playlist != null) {
                    DropdownMenuItem(text = { Text("Rename") }, onClick = { onDismiss(); text = t.playlist.name; dialog = "rename" })
                    DropdownMenuItem(text = { Text("Delete") }, onClick = { onDismiss(); dialog = "delete" })
                }
            }
        }
    }

    when (dialog) {
        "new", "rename" -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text(if (dialog == "new") "New Playlist" else "Rename Playlist") },
            text = { OutlinedTextField(text, { text = it }, singleLine = true, label = { Text("Name") }) },
            confirmButton = {
                TextButton(enabled = text.isNotBlank(), onClick = {
                    val mode = dialog; dialog = null
                    scope.launch {
                        if (mode == "new") runCatching { client.createPlaylist(text.trim(), tracks()?.map { it.id } ?: emptyList()) }
                        else runCatching { client.renamePlaylist(t.playlist!!.id, text.trim()) }
                        Library.playlistsRevision++
                    }
                }) { Text(if (dialog == "new") "Create" else "Rename", color = Accent) }
            },
            dismissButton = { TextButton(onClick = { dialog = null }) { Text("Cancel") } },
        )
        "delete" -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("Delete “${t.playlist?.name}”?") },
            text = { Text("The songs themselves are not deleted.") },
            confirmButton = {
                TextButton(onClick = {
                    dialog = null
                    scope.launch { runCatching { client.deletePlaylist(t.playlist!!.id) }; Library.playlistsRevision++; if (t.onPage) opener.back() }
                }) { Text("Delete", color = Accent) }
            },
            dismissButton = { TextButton(onClick = { dialog = null }) { Text("Cancel") } },
        )
    }
}
