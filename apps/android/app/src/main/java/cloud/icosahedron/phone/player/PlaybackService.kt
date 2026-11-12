package cloud.icosahedron.phone.player

import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import androidx.media3.session.MediaSessionService

/** Keeps the shared player alive as a media session when the app is not on screen. */
@androidx.annotation.OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        Playback.init(this)
        session = MediaSession.Builder(this, Playback.player).setCallback(object : MediaSession.Callback {
            override fun onPlaybackResumption(mediaSession: MediaSession, controller: MediaSession.ControllerInfo): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
                val r = Playback.resumption()
                return if (r != null) Futures.immediateFuture(r) else Futures.immediateFailedFuture(UnsupportedOperationException("nothing to resume"))
            }
        }).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onDestroy() {
        session?.release() // does not release the player: it belongs to the process
        session = null
        super.onDestroy()
    }
}
