package cloud.icosahedron.tv.data

import android.content.Context
import java.util.UUID

/** The signed-in account: the server, the user and the salted token (not the password). */
data class Session(val url: String, val user: String, val salt: String, val token: String) {
    fun client() = SubsonicClient(url, user, salt, token)
}

class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("icosahedron", Context.MODE_PRIVATE)

    fun load(): Session? {
        val url = prefs.getString("url", null) ?: return null
        val user = prefs.getString("user", null) ?: return null
        val salt = prefs.getString("salt", null) ?: return null
        val token = prefs.getString("token", null) ?: return null
        return Session(url, user, salt, token)
    }

    fun save(s: Session) {
        prefs.edit().putString("url", s.url).putString("user", s.user).putString("salt", s.salt).putString("token", s.token).apply()
    }

    fun clear() {
        prefs.edit().remove("url").remove("user").remove("salt").remove("token").apply()
    }

    /** Identifies this TV to the sync engine; the same across launches. */
    fun deviceId(): String {
        prefs.getString("deviceId", null)?.let { return it }
        val id = UUID.randomUUID().toString()
        prefs.edit().putString("deviceId", id).apply()
        return id
    }

    companion object {
        /** Signs in: validates the server and the account, then keeps the salted token. */
        suspend fun login(rawUrl: String, user: String, password: String): Session {
            var url = rawUrl.trim().trimEnd('/')
            if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://$url"
            val salt = SubsonicClient.newSalt()
            val session = Session(url, user.trim(), salt, SubsonicClient.md5(password + salt))
            session.client().ping()
            return session
        }
    }
}
