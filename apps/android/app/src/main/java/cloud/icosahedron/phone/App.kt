package cloud.icosahedron.phone

import android.Manifest
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import cloud.icosahedron.phone.data.Pending
import cloud.icosahedron.phone.data.Session
import cloud.icosahedron.phone.data.SessionStore
import cloud.icosahedron.phone.player.Playback
import cloud.icosahedron.phone.sync.SyncClient

/** Process-wide state: the signed-in session, the sync link and the player. */
class App : Application() {
    lateinit var store: SessionStore
        private set
    var session by mutableStateOf<Session?>(null)
        private set
    var sync by mutableStateOf<SyncClient?>(null)
        private set

    /** True while an activity is on screen; a sign-in request then needs no notification. */
    @Volatile var foreground = false

    override fun onCreate() {
        super.onCreate()
        instance = this
        store = SessionStore(this)
        Playback.init(this)
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("approvals", "Sign-in requests", NotificationManager.IMPORTANCE_HIGH))
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

    /** A notification for a sign-in request when the app is not in front. */
    fun announce(p: Pending) {
        if (foreground) return
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(this, "approvals")
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentTitle("Sign-in attempt")
            .setContentText("${p.deviceName} wants to sign in. Open to approve.")
            .setContentIntent(open).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        getSystemService(NotificationManager::class.java).notify(p.id.hashCode(), n)
    }

    companion object {
        lateinit var instance: App
            private set
    }
}
