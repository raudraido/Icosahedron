package cloud.icosahedron.tv

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import cloud.icosahedron.tv.data.Session
import cloud.icosahedron.tv.data.SessionStore
import cloud.icosahedron.tv.player.Playback
import cloud.icosahedron.tv.sync.SyncClient

/** Process-wide state: the signed-in session, the sync link and the player. */
class App : Application() {
    lateinit var store: SessionStore
        private set
    var session by mutableStateOf<Session?>(null)
        private set
    var sync by mutableStateOf<SyncClient?>(null)
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        store = SessionStore(this)
        Playback.init(this)
        store.load()?.let { signedIn(it) }
    }

    fun signedIn(s: Session) {
        store.save(s)
        session = s
        Playback.client = s.client()
        sync?.stop()
        sync = SyncClient(s, store.deviceId(), SyncClient.defaultName()).also { it.start() }
    }

    fun signOut() {
        sync?.stop()
        sync = null
        Playback.stop()
        Playback.client = null
        store.clear()
        session = null
    }

    companion object {
        lateinit var instance: App
            private set
    }
}
