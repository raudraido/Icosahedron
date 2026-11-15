package cloud.icosahedron.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Navidrome's own API (/api/song, /api/album): it knows every album and song an artist is on, with the compilations and the
 * guest appearances. It takes the Subsonic token only through the Icosahedron server (the header the engine reads); a TV has no
 * password to give, so without that server this is simply not available and the artist page shows the artist's own albums.
 */
object NativeApi {
    private val http = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
    private var forKey = ""
    private var ready: Boolean? = null

    private fun get(c: SubsonicClient, path: String, params: List<Pair<String, String>>): JSONArray {
        val b = (c.baseUrl.trimEnd('/') + path).toHttpUrl().newBuilder()
        params.forEach { b.addQueryParameter(it.first, it.second) }
        http.newCall(Request.Builder().url(b.build()).header("Authorization", "Subsonic u=${c.user}&t=${c.token}&s=${c.salt}").build()).execute().use { r ->
            if (!r.isSuccessful) throw IOException("Server answered HTTP ${r.code}")
            return JSONArray(r.body?.string() ?: "[]")
        }
    }

    suspend fun ensure(c: SubsonicClient): Boolean = withContext(Dispatchers.IO) {
        val key = c.baseUrl + "|" + c.user
        if (forKey != key) { forKey = key; ready = null }
        ready ?: runCatching { get(c, "/api/song", listOf("_start" to "0", "_end" to "1")); true }.getOrDefault(false).also { ready = it }
    }

    /** Every album the artist is on, as Navidrome counts it, with the id of the album's own artist. */
    suspend fun artistAlbums(c: SubsonicClient, artistId: String): List<Pair<Album, String?>> = withContext(Dispatchers.IO) {
        val arr = get(c, "/api/album", listOf("_start" to "0", "_end" to "1000", "_sort" to "name", "_order" to "ASC", "artist_id" to artistId))
        (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.mapNotNull { o ->
            val id = o.str("id") ?: return@mapNotNull null
            val types = o.optJSONObject("tags")?.optJSONArray("releasetype")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
            Album(
                id, o.str("name") ?: "", o.str("albumArtist") ?: "", o.str("albumArtistId"), "al-$id",
                (o.int("maxYear") ?: o.int("minYear"))?.takeIf { it > 0 }, o.int("songCount") ?: 0, types, o.optBoolean("compilation", false),
            ) to o.str("albumArtistId")
        }
    }

    /** The artist's songs in album order (a page of [count] from [offset]); an empty list ends the paging. */
    suspend fun artistSongs(c: SubsonicClient, artistId: String, offset: Int, count: Int): List<Track> = withContext(Dispatchers.IO) {
        val arr = get(c, "/api/song", listOf("_start" to offset.toString(), "_end" to (offset + count).toString(), "_sort" to "album", "_order" to "ASC", "artist_id" to artistId))
        (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.mapNotNull { o ->
            val id = o.str("id") ?: return@mapNotNull null
            Track(
                id, o.str("title") ?: "", o.str("artist") ?: "", o.str("artistId"), o.str("album"), o.str("albumId"),
                o.int("trackNumber") ?: 0, o.int("discNumber") ?: 0, o.optDouble("duration", 0.0).toInt(), id,
                o.optBoolean("starred", false), o.int("year")?.takeIf { it > 0 }, o.str("genre"), o.int("bitRate"), o.str("suffix"),
            )
        }
    }

    /** All the artist's songs for Play (album, disc, track order), up to [limit]. */
    suspend fun allArtistSongs(c: SubsonicClient, artistId: String, limit: Int = 3000): List<Track> {
        val out = ArrayList<Track>()
        while (out.size < limit) {
            val page = artistSongs(c, artistId, out.size, 500)
            out += page
            if (page.size < 500) break
        }
        return out.sortedWith(compareBy<Track> { it.album ?: "" }.thenBy { it.discNumber }.thenBy { it.trackNumber })
    }
}
