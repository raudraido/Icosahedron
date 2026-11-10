package cloud.icosahedron.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Subsonic / OpenSubsonic API (Navidrome), reached either through the web engine's proxy or
 * directly. Authenticates with a salted token; only the salt and the token are ever stored, never
 * the password.
 */
class SubsonicClient(val baseUrl: String, val user: String, val salt: String, val token: String) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private fun builder(endpoint: String): HttpUrl.Builder =
        (baseUrl.trimEnd('/') + "/rest/" + endpoint).toHttpUrl().newBuilder()
            .addQueryParameter("u", user)
            .addQueryParameter("t", token)
            .addQueryParameter("s", salt)
            .addQueryParameter("v", "1.16.1")
            .addQueryParameter("c", "IcosahedronTV")

    fun streamUrl(id: String): String = builder("stream").addQueryParameter("id", id).build().toString()

    fun coverUrl(id: String?, size: Int): String? =
        id?.let { builder("getCoverArt").addQueryParameter("id", it).addQueryParameter("size", size.toString()).build().toString() }

    /** The credentials in the shape the sync hub expects. */
    fun syncAuth(): JSONObject = JSONObject().put("u", user).put("t", token).put("s", salt)

    private suspend fun call(endpoint: String, vararg params: Pair<String, String>): JSONObject = withContext(Dispatchers.IO) {
        val b = builder(endpoint).addQueryParameter("f", "json")
        params.forEach { b.addQueryParameter(it.first, it.second) }
        http.newCall(Request.Builder().url(b.build()).build()).execute().use { r ->
            if (!r.isSuccessful) throw IOException("Server answered HTTP ${r.code}")
            val root = JSONObject(r.body!!.string()).getJSONObject("subsonic-response")
            if (root.optString("status") != "ok") {
                throw IOException(root.optJSONObject("error")?.optString("message") ?: "Request failed")
            }
            root
        }
    }

    suspend fun ping() { call("ping") }

    /**
     * The song's lyrics from the server (OpenSubsonic `getLyricsBySongId`): the timed version when there is
     * one, else the plain one. Empty when the server has none or does not support it.
     */
    suspend fun lyrics(id: String): List<LyricLine> {
        val lists = call("getLyricsBySongId", "id" to id).optJSONObject("lyricsList")?.objs("structuredLyrics") ?: return emptyList()
        val pick = lists.firstOrNull { it.optBoolean("synced") } ?: lists.firstOrNull() ?: return emptyList()
        val synced = pick.optBoolean("synced")
        val offset = pick.optLong("offset", 0)
        return pick.objs("line").map { LyricLine(if (synced) it.optLong("start") + offset else null, it.optString("value")) }
    }

    suspend fun albums(type: String, size: Int = 40, offset: Int = 0): List<Album> =
        call("getAlbumList2", "type" to type, "size" to size.toString(), "offset" to offset.toString())
            .optJSONObject("albumList2")?.objs("album")?.mapNotNull { Album.fromSubsonic(it) } ?: emptyList()

    suspend fun artists(): List<Artist> =
        call("getArtists").optJSONObject("artists")?.objs("index")
            ?.flatMap { it.objs("artist") }?.mapNotNull { Artist.fromSubsonic(it) } ?: emptyList()

    suspend fun artist(id: String): Pair<Artist?, List<Album>> {
        val a = call("getArtist", "id" to id).optJSONObject("artist") ?: return null to emptyList()
        return Artist.fromSubsonic(a) to a.objs("album").mapNotNull { Album.fromSubsonic(it) }
    }

    suspend fun album(id: String): Pair<Album?, List<Track>> {
        val a = call("getAlbum", "id" to id).optJSONObject("album") ?: return null to emptyList()
        return Album.fromSubsonic(a) to a.objs("song").mapNotNull { Track.fromSubsonic(it) }
    }

    suspend fun playlists(): List<Playlist> =
        call("getPlaylists").optJSONObject("playlists")?.objs("playlist")?.mapNotNull { Playlist.fromSubsonic(it) } ?: emptyList()

    suspend fun playlistTracks(id: String): List<Track> =
        call("getPlaylist", "id" to id).optJSONObject("playlist")?.objs("entry")?.mapNotNull { Track.fromSubsonic(it) } ?: emptyList()

    suspend fun search(query: String): Triple<List<Artist>, List<Album>, List<Track>> {
        val r = call(
            "search3", "query" to query, "artistCount" to "12", "albumCount" to "24", "songCount" to "40",
        ).optJSONObject("searchResult3")
        return Triple(
            r?.objs("artist")?.mapNotNull { Artist.fromSubsonic(it) } ?: emptyList(),
            r?.objs("album")?.mapNotNull { Album.fromSubsonic(it) } ?: emptyList(),
            r?.objs("song")?.mapNotNull { Track.fromSubsonic(it) } ?: emptyList(),
        )
    }

    suspend fun randomSongs(count: Int = 100): List<Track> =
        call("getRandomSongs", "size" to count.toString()).optJSONObject("randomSongs")?.objs("song")
            ?.mapNotNull { Track.fromSubsonic(it) } ?: emptyList()

    suspend fun starred(): List<Track> =
        call("getStarred2").optJSONObject("starred2")?.objs("song")?.mapNotNull { Track.fromSubsonic(it) } ?: emptyList()

    suspend fun scrobble(id: String, submission: Boolean) {
        call("scrobble", "id" to id, "submission" to submission.toString())
    }

    companion object {
        fun md5(s: String): String =
            MessageDigest.getInstance("MD5").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

        fun newSalt(): String {
            val chars = "abcdefghijklmnopqrstuvwxyz0123456789"
            return (1..10).map { chars.random() }.joinToString("")
        }
    }
}
