package cloud.icosahedron.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cloud.icosahedron.phone.data.Album
import cloud.icosahedron.phone.data.Artist
import cloud.icosahedron.phone.data.Playlist
import cloud.icosahedron.phone.data.Track
import cloud.icosahedron.phone.player.Playback
import coil.compose.AsyncImage

/** Loads something once per key; null while loading or when it failed. */
@Composable
fun <T> load(key: Any?, block: suspend () -> T): State<T?> =
    produceState<T?>(null, key) { value = try { block() } catch (_: Exception) { null } }

@Composable
fun Cover(coverId: String?, size: Dp, round: Boolean = false, modifier: Modifier = Modifier) {
    val client = LocalClient.current
    val shape = if (round) CircleShape else RoundedCornerShape(8.dp)
    val url = remember(coverId) { client.coverUrl(coverId, 400) }
    Box(modifier.size(size).clip(shape).background(PanelHi)) {
        if (url != null) AsyncImage(url, null, Modifier.size(size), contentScale = ContentScale.Crop)
    }
}

@Composable
fun SectionHeader(title: String, onSeeAll: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 18.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, fontSize = 20.sp, modifier = Modifier.weight(1f))
        if (onSeeAll != null) TextButton(onClick = onSeeAll) { Text("See all", color = Accent) }
    }
}

@Composable
fun AlbumCard(a: Album, size: Dp = 140.dp, onClick: () -> Unit) {
    CollectionBox("album", a.id, a.name, a.artist, a.coverArt, onClick, Modifier.width(size)) {
        Cover(a.coverArt, size)
        Text(kept("album", a.id) + a.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp))
        Text(a.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = Dim)
    }
}

@Composable
fun AlbumShelf(title: String, albums: List<Album>?, onSeeAll: (() -> Unit)?, onOpen: (Album) -> Unit) {
    if (albums.isNullOrEmpty()) return
    SectionHeader(title, onSeeAll)
    LazyRow(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(albums) { AlbumCard(it, onClick = { onOpen(it) }) }
    }
}

@Composable
fun PlaylistShelf(playlists: List<Playlist>?, onSeeAll: () -> Unit, onOpen: (Playlist) -> Unit) {
    if (playlists.isNullOrEmpty()) return
    SectionHeader("Playlists", onSeeAll)
    LazyRow(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(playlists.take(20)) { p ->
            CollectionBox("playlist", p.id, p.name, "${p.songCount} songs", p.coverArt, { onOpen(p) }, Modifier.width(140.dp)) {
                Cover(p.coverArt, 140.dp)
                Text(kept("playlist", p.id) + p.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp))
                Text("${p.songCount} songs", fontSize = 12.sp, color = Dim)
            }
        }
    }
}

@Composable
fun ArtistRow(a: Artist, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Cover(a.coverArt, 48.dp, round = true)
        Column(Modifier.padding(start = 12.dp)) {
            Text(a.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (a.albumCount > 0) Text("${a.albumCount} albums", fontSize = 12.sp, color = Dim)
        }
    }
}

/** A song: tap to play the list from here; the menu adds it to the queue. */
@Composable
fun TrackRow(t: Track, showCover: Boolean = true, number: Int? = null, onPlay: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val playing = Control.track?.id == t.id
    Row(Modifier.fillMaxWidth().clickable(onClick = onPlay).padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        if (number != null) Text(number.toString(), color = Dim, modifier = Modifier.width(28.dp), fontSize = 14.sp)
        if (showCover) Cover(t.coverArt, 44.dp, modifier = Modifier.padding(end = 12.dp))
        Column(Modifier.weight(1f)) {
            Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, color = if (playing) Accent else androidx.compose.ui.graphics.Color.White)
            Text(t.artist + (if (t.bpm != null && cloud.icosahedron.phone.data.Prefs.showBpm) " · ${t.bpm} BPM" else ""), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = Dim)
        }
        if (cloud.icosahedron.phone.player.Offline.isKept(t.id)) Text("↓ ", fontSize = 12.sp, color = Accent)
        Text(fmt(t.duration * 1000L), fontSize = 12.sp, color = Dim)
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More", tint = Dim) }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { Text("Play next") }, onClick = { menu = false; Control.playNext(t) })
                DropdownMenuItem(text = { Text("Add to queue") }, onClick = { menu = false; Control.addToQueue(listOf(t)) })
                if (cloud.icosahedron.phone.player.Offline.isKept(t.id)) {
                    DropdownMenuItem(text = { Text("Remove from offline") }, onClick = { menu = false; cloud.icosahedron.phone.player.Offline.unkeep(t) })
                } else {
                    val ctx = androidx.compose.ui.platform.LocalContext.current
                    val cl = LocalClient.current
                    DropdownMenuItem(text = { Text("Keep offline") }, onClick = { menu = false; keepOffline(ctx, cl, listOf(t)) })
                }
            }
        }
    }
}

/** Starts keeping songs on the phone; on mobile data only when that is allowed in Settings. */
fun keepOffline(context: android.content.Context, client: cloud.icosahedron.phone.data.SubsonicClient, tracks: List<Track>) {
    if (!cloud.icosahedron.phone.player.Offline.cachingAllowed()) {
        android.widget.Toast.makeText(context, "On mobile data downloads are off (Settings → Offline)", android.widget.Toast.LENGTH_LONG).show()
        return
    }
    cloud.icosahedron.phone.player.Offline.keep(tracks) { client.streamUrl(it.id) }
}

fun fmt(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(s / 60, s % 60)
}

/** A round profile picture, or the user's first letter on the accent colour. */
@Composable
fun AvatarView(size: Dp = 36.dp, modifier: Modifier = Modifier) {
    val img = cloud.icosahedron.phone.data.Avatar.image
    val user = LocalClient.current.user
    Box(modifier.size(size).clip(CircleShape).background(Accent), contentAlignment = Alignment.Center) {
        if (img != null) androidx.compose.foundation.Image(img.asImageBitmap(), "Account", Modifier.size(size), contentScale = ContentScale.Crop)
        else Text(user.take(1).uppercase(), fontSize = (size.value * 0.5f).sp, color = androidx.compose.ui.graphics.Color.White)
    }
}

private fun kept(kind: String, id: String) = if (cloud.icosahedron.phone.player.Offline.isCollectionKept(kind, id)) "↓ " else ""

/**
 * An album or playlist card or row: a tap opens it, a long press offers Play, Add to queue and Keep offline.
 * The songs are fetched when an action needs them.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun CollectionBox(kind: String, id: String, name: String, subtitle: String, cover: String?, onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    val client = LocalClient.current
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    val offline = cloud.icosahedron.phone.player.Offline
    val isKept = offline.isCollectionKept(kind, id)
    suspend fun tracks(): List<Track> = if (kind == "album") client.album(id).second else client.playlistTracks(id)
    Box(modifier) {
        Column(Modifier.androidx_combined(onClick) { menu = true }, content = content)
        DropdownMenu(menu, { menu = false }) {
            DropdownMenuItem(text = { Text("Play") }, onClick = { menu = false; scope.launch { runCatching { tracks() }.getOrNull()?.let { Control.playTracks(it, 0) } } })
            DropdownMenuItem(text = { Text("Add to queue") }, onClick = { menu = false; scope.launch { runCatching { tracks() }.getOrNull()?.let { Control.addToQueue(it) } } })
            if (isKept) DropdownMenuItem(text = { Text("Remove from offline") }, onClick = { menu = false; offline.unkeepCollection(kind, id) })
            else DropdownMenuItem(text = { Text("Keep offline") }, onClick = {
                menu = false
                scope.launch {
                    val t = runCatching { tracks() }.getOrNull()
                    if (t.isNullOrEmpty()) android.widget.Toast.makeText(context, "Could not load it", android.widget.Toast.LENGTH_SHORT).show()
                    else keepCollectionOffline(context, client, kind, id, name, subtitle, cover, t)
                }
            })
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
private fun Modifier.androidx_combined(onClick: () -> Unit, onLong: () -> Unit): Modifier =
    this.combinedClickable(onClick = onClick, onLongClick = onLong)

fun keepCollectionOffline(context: android.content.Context, client: cloud.icosahedron.phone.data.SubsonicClient, kind: String, id: String, name: String, subtitle: String, cover: String?, tracks: List<Track>) {
    if (!cloud.icosahedron.phone.player.Offline.cachingAllowed()) {
        android.widget.Toast.makeText(context, "On mobile data downloads are off (Settings → Offline)", android.widget.Toast.LENGTH_LONG).show()
        return
    }
    cloud.icosahedron.phone.player.Offline.keepCollection(cloud.icosahedron.phone.player.Offline.Collection(kind, id, name, subtitle, cover, tracks)) { client.streamUrl(it.id) }
}
