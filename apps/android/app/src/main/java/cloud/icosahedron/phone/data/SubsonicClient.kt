package cloud.icosahedron.phone.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
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
            .addQueryParameter("c", "Icosahedron")

    fun streamUrl(id: String): String {
        val b = builder("stream").addQueryParameter("id", id)
        val q = Quality.current()
        if (q != "raw") {
            val (format, kbps) = q.split("-").let { it[0] to it[1] }
            b.addQueryParameter("format", format).addQueryParameter("maxBitRate", kbps)
        }
        return b.build().toString()
    }

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

    /** The engine's own API (the /device calls): the credentials go in an Authorization header. */
    suspend fun engine(method: String, path: String, json: JSONObject? = null): Pair<Int, String> = withContext(Dispatchers.IO) {
        val body = json?.toString()?.toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url(baseUrl.trimEnd('/') + path)
            .header("Authorization", "Subsonic u=$user&t=$token&s=$salt")
            .method(method, body ?: if (method == "GET" || method == "DELETE") null else "".toRequestBody())
            .build()
        try {
            http.newCall(req).execute().use { r -> r.code to (r.body?.string() ?: "") }
        } catch (e: IOException) { 0 to "" }
    }

    class Raw(val status: Int, val bytes: ByteArray, val etag: String?)

    /** Like [engine] but with bytes in and out (the profile picture), and an ETag for "has it changed". */
    suspend fun engineRaw(method: String, path: String, body: ByteArray? = null, contentType: String? = null, etag: String? = null): Raw = withContext(Dispatchers.IO) {
        val rb = body?.toRequestBody((contentType ?: "application/octet-stream").toMediaType())
        val b = Request.Builder().url(baseUrl.trimEnd('/') + path)
            .header("Authorization", "Subsonic u=$user&t=$token&s=$salt")
            .method(method, rb ?: if (method == "GET" || method == "DELETE") null else "".toRequestBody())
        if (etag != null) b.header("If-None-Match", etag)
        try {
            http.newCall(b.build()).execute().use { r -> Raw(r.code, r.body?.bytes() ?: ByteArray(0), r.header("ETag")) }
        } catch (e: IOException) { Raw(0, ByteArray(0), null) }
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

    suspend fun albums(type: String, size: Int = 40, offset: Int = 0, genre: String? = null, fromYear: Int? = null, toYear: Int? = null): List<Album> =
        call(
            "getAlbumList2",
            *listOfNotNull(
                "type" to type, "size" to size.toString(), "offset" to offset.toString(),
                genre?.let { "genre" to it }, fromYear?.let { "fromYear" to it.toString() }, toYear?.let { "toYear" to it.toString() },
            ).toTypedArray(),
        )
            .optJSONObject("albumList2")?.objs("album")?.mapNotNull { Album.fromSubsonic(it) } ?: emptyList()

    suspend fun genres(): List<String> =
        call("getGenres").optJSONObject("genres")?.objs("genre")?.mapNotNull { it.str("value") }?.sorted() ?: emptyList()

    suspend fun starredAlbumsAndArtists(): Pair<List<Album>, List<Artist>> {
        val s = call("getStarred2").optJSONObject("starred2")
        return (s?.objs("album")?.mapNotNull { Album.fromSubsonic(it) } ?: emptyList()) to
            (s?.objs("artist")?.mapNotNull { Artist.fromSubsonic(it) } ?: emptyList())
    }

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

    suspend fun song(id: String): Track? =
        call("getSong", "id" to id).optJSONObject("song")?.let { Track.fromSubsonic(it) }

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

    /** Every song, a page at a time (Navidrome answers an empty search with the whole library). */
    suspend fun songs(offset: Int, size: Int): List<Track> =
        call("search3", "query" to "", "artistCount" to "0", "albumCount" to "0", "songCount" to size.toString(), "songOffset" to offset.toString())
            .optJSONObject("searchResult3")?.objs("song")?.mapNotNull { Track.fromSubsonic(it) } ?: emptyList()

    /** The top level of the folder view. */
    suspend fun directoryRoot(): List<DirEntry> {
        val root = call("getIndexes").optJSONObject("indexes") ?: return emptyList()
        return root.objs("index").flatMap { it.objs("artist") }.mapNotNull { DirEntry.fromSubsonic(it, forceDir = true) } +
            root.objs("child").mapNotNull { DirEntry.fromSubsonic(it) }
    }

    suspend fun directory(id: String): List<DirEntry> =
        call("getMusicDirectory", "id" to id).optJSONObject("directory")?.objs("child")?.mapNotNull { DirEntry.fromSubsonic(it) } ?: emptyList()

    suspend fun radios(): List<Radio> =
        call("getInternetRadioStations").optJSONObject("internetRadioStations")?.objs("internetRadioStation")?.mapNotNull { Radio.fromSubsonic(it) } ?: emptyList()

    suspend fun starred(): List<Track> =
        call("getStarred2").optJSONObject("starred2")?.objs("song")?.mapNotNull { Track.fromSubsonic(it) } ?: emptyList()

    suspend fun setStarred(id: String, on: Boolean) { call(if (on) "star" else "unstar", "id" to id) }

    suspend fun setAlbumStarred(id: String, on: Boolean) { call(if (on) "star" else "unstar", "albumId" to id) }

    suspend fun addToPlaylist(playlistId: String, songIds: List<String>) {
        call("updatePlaylist", *(listOf("playlistId" to playlistId) + songIds.map { "songIdToAdd" to it }).toTypedArray())
    }

    suspend fun createPlaylist(name: String, songIds: List<String>) {
        call("createPlaylist", *(listOf("name" to name) + songIds.map { "songId" to it }).toTypedArray())
    }

    suspend fun renamePlaylist(id: String, name: String) { call("updatePlaylist", "playlistId" to id, "name" to name) }

    suspend fun deletePlaylist(id: String) { call("deletePlaylist", "id" to id) }

    /** A share link (Navidrome sharing) for a song, an album or a playlist. */
    suspend fun createShare(id: String): String? =
        call("createShare", "id" to id).optJSONObject("shares")?.objs("share")?.firstOrNull()?.str("url")

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
