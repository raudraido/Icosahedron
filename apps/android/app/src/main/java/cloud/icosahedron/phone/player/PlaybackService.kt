package cloud.icosahedron.phone.player

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import cloud.icosahedron.phone.data.Album
import cloud.icosahedron.phone.data.Artist
import cloud.icosahedron.phone.data.Playlist
import cloud.icosahedron.phone.data.SubsonicClient
import cloud.icosahedron.phone.data.Track
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

/**
 * Keeps the shared player alive as a media session when the app is not on screen, and lets other apps browse the
 * library: Android Auto (the car screen), Bluetooth and Assistant. The browse tree is Recent, Playlists, Albums,
 * Artists and a Random mix; a song played from an album or playlist plays the whole list from there.
 */
@androidx.annotation.OptIn(UnstableApi::class)
class PlaybackService : MediaLibraryService() {
    private var session: MediaLibrarySession? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    /** The list a song was shown in, so playing it plays that list. */
    private val parentOf = ConcurrentHashMap<String, String>()

    override fun onCreate() {
        super.onCreate()
        Playback.init(this)
        session = MediaLibrarySession.Builder(this, Playback.player, Callback()).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

    override fun onDestroy() {
        session?.release() // does not release the player: it belongs to the process
        session = null
        super.onDestroy()
    }

    private fun <T> future(block: suspend () -> T): ListenableFuture<T> {
        val f = SettableFuture.create<T>()
        scope.launch { try { f.set(block()) } catch (e: Exception) { f.setException(e) } }
        return f
    }

    private fun client(): SubsonicClient = Playback.client ?: throw IllegalStateException("not signed in")

    // ── Items ──
    private fun folder(id: String, title: String, subtitle: String? = null, cover: String? = null, type: Int = MediaMetadata.MEDIA_TYPE_FOLDER_MIXED) =
        MediaItem.Builder().setMediaId(id).setMediaMetadata(
            MediaMetadata.Builder().setTitle(title).setSubtitle(subtitle).setIsBrowsable(true).setIsPlayable(false)
                .setMediaType(type).setArtworkUri(cover?.let { Uri.parse(it) }).build(),
        ).build()

    private fun trackItem(t: Track, c: SubsonicClient) = MediaItem.Builder().setMediaId("track:${t.id}").setMediaMetadata(
        MediaMetadata.Builder().setTitle(t.title).setArtist(t.artist).setAlbumTitle(t.album).setIsBrowsable(false).setIsPlayable(true)
            .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC).setArtworkUri(c.coverUrl(t.coverArt, 256)?.let { Uri.parse(it) }).build(),
    ).build()

    private fun albumItem(a: Album, c: SubsonicClient) = folder("album:${a.id}", a.name, a.artist, c.coverUrl(a.coverArt, 256), MediaMetadata.MEDIA_TYPE_ALBUM)
    private fun playlistItem(p: Playlist, c: SubsonicClient) = folder("playlist:${p.id}", p.name, "${p.songCount} songs", c.coverUrl(p.coverArt, 256), MediaMetadata.MEDIA_TYPE_PLAYLIST)
    private fun artistItem(a: Artist, c: SubsonicClient) = folder("artist:${a.id}", a.name, null, c.coverUrl(a.coverArt, 256), MediaMetadata.MEDIA_TYPE_ARTIST)

    private suspend fun children(parent: String): List<MediaItem> {
        val c = client()
        return when {
            parent == "root" -> listOf(
                folder("recent", "Recently played"), folder("playlists", "Playlists"), folder("albums", "Albums"), folder("artists", "Artists"),
                MediaItem.Builder().setMediaId("mix:random").setMediaMetadata(MediaMetadata.Builder().setTitle("Random mix").setIsBrowsable(false).setIsPlayable(true).setMediaType(MediaMetadata.MEDIA_TYPE_PLAYLIST).build()).build(),
            )
            parent == "recent" -> c.albums("recent", 50).map { albumItem(it, c) }
            parent == "playlists" -> c.playlists().map { playlistItem(it, c) }
            parent == "albums" -> c.albums("alphabeticalByName", 300).map { albumItem(it, c) }
            parent == "artists" -> c.artists().take(500).map { artistItem(it, c) }
            parent.startsWith("artist:") -> c.artist(parent.removePrefix("artist:")).second.map { albumItem(it, c) }
            parent.startsWith("album:") || parent.startsWith("playlist:") -> tracksOf(parent).map { t -> parentOf[t.id] = parent; trackItem(t, c) }
            else -> emptyList()
        }
    }

    private suspend fun tracksOf(parent: String): List<Track> {
        val c = client()
        return when {
            parent.startsWith("album:") -> c.album(parent.removePrefix("album:")).second
            parent.startsWith("playlist:") -> c.playlistTracks(parent.removePrefix("playlist:"))
            parent == "mix:random" -> c.randomSongs(100)
            else -> emptyList()
        }
    }

    private fun <T> page(list: List<T>, page: Int, size: Int): List<T> =
        if (size <= 0 || size == Int.MAX_VALUE) list else list.drop(page * size).take(size)

    private inner class Callback : MediaLibrarySession.Callback {
        override fun onGetLibraryRoot(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: MediaLibraryService.LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> =
            Futures.immediateFuture(LibraryResult.ofItem(folder("root", "Icosahedron"), params))

        override fun onGetChildren(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String, page: Int, pageSize: Int, params: MediaLibraryService.LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
            future { LibraryResult.ofItemList(ImmutableList.copyOf(page(children(parentId), page, pageSize)), params) }

        override fun onGetItem(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, mediaId: String): ListenableFuture<LibraryResult<MediaItem>> =
            future {
                val c = client()
                when {
                    mediaId.startsWith("track:") -> c.song(mediaId.removePrefix("track:"))?.let { LibraryResult.ofItem(trackItem(it, c), null) } ?: LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE)
                    else -> LibraryResult.ofItem(folder(mediaId, mediaId), null)
                }
            }

        override fun onSearch(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String, params: MediaLibraryService.LibraryParams?): ListenableFuture<LibraryResult<Void>> =
            future {
                val r = client().search(query)
                session.notifySearchResultChanged(browser, query, r.third.size + r.second.size + r.first.size, params)
                LibraryResult.ofVoid()
            }

        override fun onGetSearchResult(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String, page: Int, pageSize: Int, params: MediaLibraryService.LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
            future {
                val c = client()
                val r = c.search(query)
                val items = r.second.map { albumItem(it, c) } + r.third.map { trackItem(it, c) } + r.first.map { artistItem(it, c) }
                LibraryResult.ofItemList(ImmutableList.copyOf(page(items, page, pageSize)), params)
            }

        /** What a play from the car, a headset or a voice command means: the whole list the song was in, a search result, or one song. */
        override fun onSetMediaItems(mediaSession: MediaSession, controller: MediaSession.ControllerInfo, mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<MediaSession.MediaItemsWithStartPosition> =
            future {
                val c = client()
                val first = mediaItems.firstOrNull() ?: throw IllegalArgumentException("nothing to play")
                val query = first.requestMetadata.searchQuery
                var start = 0
                val tracks: List<Track> = when {
                    !query.isNullOrBlank() -> c.search(query).third
                    first.mediaId.startsWith("mix:") || first.mediaId.startsWith("album:") || first.mediaId.startsWith("playlist:") -> tracksOf(first.mediaId)
                    mediaItems.size == 1 && first.mediaId.startsWith("track:") -> {
                        val id = first.mediaId.removePrefix("track:")
                        val list = parentOf[id]?.let { tracksOf(it) }
                        val i = list?.indexOfFirst { it.id == id } ?: -1
                        if (list != null && i >= 0) { start = i; list } else listOfNotNull(c.song(id))
                    }
                    else -> mediaItems.mapNotNull { m -> m.mediaId.removePrefix("track:").let { c.song(it) } }
                }
                if (tracks.isEmpty()) throw IllegalArgumentException("nothing to play")
                if (startIndex != C.INDEX_UNSET && mediaItems.size > 1) start = startIndex
                Playback.adoptQueue(tracks)
                MediaSession.MediaItemsWithStartPosition(tracks.map(Playback::mediaItemFor), start, if (startPositionMs == C.TIME_UNSET) 0 else startPositionMs)
            }

        override fun onPlaybackResumption(mediaSession: MediaSession, controller: MediaSession.ControllerInfo): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val r = Playback.resumption()
            return if (r != null) Futures.immediateFuture(r) else Futures.immediateFailedFuture(UnsupportedOperationException("nothing to resume"))
        }
    }
}
