package cloud.icosahedron.phone.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject

/** Last.fm through the sync server: one connection covers all of the account's devices. */
class LastFm {
    enum class State { UNKNOWN, NOT_CONFIGURED, DISCONNECTED, CONNECTED }

    var state by mutableStateOf(State.UNKNOWN)
        private set
    var username by mutableStateOf("")
        private set
    var scrobble by mutableStateOf(false)
        private set
    var pendingToken by mutableStateOf<String?>(null)
    var message by mutableStateOf<String?>(null)

    suspend fun refresh(c: SubsonicClient) {
        val (st, body) = c.engine("GET", "/lastfm/config")
        if (st != 200) { state = if (st == 0 || st == 404) State.UNKNOWN else State.NOT_CONFIGURED; return }
        val configured = try { JSONObject(body).optBoolean("configured") } catch (_: Exception) { false }
        if (!configured) { state = State.NOT_CONFIGURED; return }
        val (cs, cb) = c.engine("GET", "/lastfm/connection")
        val o = if (cs == 200) try { JSONObject(cb) } catch (_: Exception) { null } else null
        val name = o?.optString("username").orEmpty()
        if (name.isNotEmpty()) { state = State.CONNECTED; username = name; scrobble = o?.optBoolean("scrobbleEnabled") ?: false } else state = State.DISCONNECTED
    }

    /** Step 1: the address of Last.fm's approval page (to open in the browser). */
    suspend fun begin(c: SubsonicClient): String? {
        message = null
        val (st, body) = c.engine("POST", "/lastfm/token")
        val o = if (st == 200) try { JSONObject(body) } catch (_: Exception) { null } else null
        val token = o?.str("token"); val url = o?.str("authUrl")
        if (token == null || url == null) { message = if (st == 0) "Could not reach the server" else "Last.fm did not answer"; return null }
        pendingToken = token
        return url
    }

    /** Step 2: after approving in the browser. */
    suspend fun finish(c: SubsonicClient) {
        val token = pendingToken ?: return
        val (_, body) = c.engine("POST", "/lastfm/session", JSONObject().put("token", token))
        val ok = try { JSONObject(body).optBoolean("connected") } catch (_: Exception) { false }
        if (ok) { pendingToken = null; message = null; refresh(c) } else message = "Not approved yet: approve on Last.fm, then try again"
    }

    suspend fun setScrobbling(on: Boolean, c: SubsonicClient) { scrobble = on; c.engine("PUT", "/lastfm/toggles", JSONObject().put("scrobbleEnabled", on)) }

    suspend fun disconnect(c: SubsonicClient) { c.engine("DELETE", "/lastfm/connection"); state = State.DISCONNECTED; scrobble = false }
}
