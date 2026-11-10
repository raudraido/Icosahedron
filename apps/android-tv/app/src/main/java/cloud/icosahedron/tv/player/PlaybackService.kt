package cloud.icosahedron.tv.player

import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/** Keeps the shared player alive as a media session when the app is not on screen. */
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        Playback.init(this)
        session = MediaSession.Builder(this, Playback.player).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onDestroy() {
        session?.release() // does not release the player: it belongs to the process
        session = null
        super.onDestroy()
    }
}
