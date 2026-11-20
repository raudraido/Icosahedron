package cloud.icosahedron.phone.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject

/**
 * ListenBrainz through the sync server: the user's own token is the whole connection (no developer key,
 * unlike Last.fm), kept on the server so one connection covers all of the account's devices.
 */
class ListenBrainz {
    enum class State { UNKNOWN, DISCONNECTED, CONNECTED }

    var state by mutableStateOf(State.UNKNOWN)
        private set
    var username by mutableStateOf("")
        private set
    var scrobble by mutableStateOf(false)
        private set
    var message by mutableStateOf<String?>(null)

    suspend fun refresh(c: SubsonicClient) {
        val (st, body) = c.engine("GET", "/listenbrainz/connection")
        if (st != 200) { state = State.UNKNOWN; return }
        val o = try { JSONObject(body) } catch (_: Exception) { null }
        val name = o?.optString("username").orEmpty()
        if (name.isNotEmpty()) {
            state = State.CONNECTED; username = name; scrobble = o?.optBoolean("scrobbleEnabled") ?: false
        } else { state = State.DISCONNECTED; scrobble = false }
        scrobbling = scrobble
    }

    suspend fun connect(token: String, c: SubsonicClient) {
        message = null
        val (st, _) = c.engine("PUT", "/listenbrainz/connection", JSONObject().put("token", token.trim()))
        when (st) {
            200 -> refresh(c)
            0 -> message = "Could not reach the server"
            400 -> message = "That does not look like a ListenBrainz user token"
            401 -> message = "ListenBrainz does not accept that token"
            else -> message = "ListenBrainz did not answer"
        }
    }

    suspend fun setScrobbling(on: Boolean, c: SubsonicClient) {
        scrobble = on; scrobbling = on
        c.engine("PUT", "/listenbrainz/toggles", JSONObject().put("scrobbleEnabled", on))
    }

    suspend fun disconnect(c: SubsonicClient) {
        c.engine("DELETE", "/listenbrainz/connection"); state = State.DISCONNECTED; scrobble = false; scrobbling = false
    }

    companion object {
        /** Mirrors the connection's "scrobble" switch for the player, which must not wait on the settings page. */
        @Volatile var scrobbling = false

        /** The player calls this once it has a client, so a connection made earlier (or on another device) counts. */
        suspend fun load(c: SubsonicClient) {
            val (st, body) = c.engine("GET", "/listenbrainz/connection")
            scrobbling = st == 200 && try { JSONObject(body).optBoolean("scrobbleEnabled") } catch (_: Exception) { false }
        }

        private fun meta(t: Track) = JSONObject().put("title", t.title).put("artist", t.artist).put("album", t.album ?: "").put("duration", t.duration)

        suspend fun nowPlaying(t: Track, c: SubsonicClient) {
            if (scrobbling) c.engine("POST", "/listenbrainz/nowplaying", JSONObject().put("track", meta(t)))
        }

        suspend fun played(t: Track, c: SubsonicClient) {
            if (scrobbling) c.engine("POST", "/listenbrainz/scrobble", JSONObject().put("track", meta(t)).put("timestamp", System.currentTimeMillis() / 1000))
        }
    }
}
