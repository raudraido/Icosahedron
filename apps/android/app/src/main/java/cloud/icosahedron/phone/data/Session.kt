package cloud.icosahedron.phone.data

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

    /** The server used last, kept even after signing out, so the next sign-in starts with it. */
    fun lastServer(): String = prefs.getString("lastServer", "") ?: ""

    fun saveLastServer(url: String) {
        prefs.edit().putString("lastServer", url).apply()
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
        /** "music.example.com" -> "https://music.example.com". */
        fun normalizeUrl(raw: String): String {
            val url = raw.trim().trimEnd('/')
            return if (url.startsWith("http://") || url.startsWith("https://")) url else "https://$url"
        }

        /** Signs in: validates the server and the account, then keeps the salted token. */
        suspend fun login(rawUrl: String, user: String, password: String): Session {
            val url = normalizeUrl(rawUrl)
            val salt = SubsonicClient.newSalt()
            val session = Session(url, user.trim(), salt, SubsonicClient.md5(password + salt))
            session.client().ping()
            return session
        }
    }
}
