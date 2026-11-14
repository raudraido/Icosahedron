package cloud.icosahedron.phone.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

enum class SongSort(val title: String, val field: String, val ascByDefault: Boolean = true) {
    Title("Title", "title"), Artist("Artist", "artist"), Album("Album", "album"), Year("Year", "year", false),
    Added("Date added", "createdAt", false), Plays("Play count", "playCount", false), Duration("Length", "duration"),
    Bpm("BPM", "bpm"), Random("Random", "random"),
}

/** What the songs are narrowed to; the range ones are found by a search in the list sorted by that field. */
sealed interface SongFilter {
    val key: String
    val label: String
    object All : SongFilter { override val key = "all"; override val label = "All songs" }
    object Favorites : SongFilter { override val key = "fav"; override val label = "Favorites" }
    object Unplayed : SongFilter { override val key = "unplayed"; override val label = "Never played" }
    data class Genre(val id: String, val name: String) : SongFilter { override val key = "g:$id"; override val label = name }
    /** Every song the artist is on, with the compilations and the guest appearances. */
    data class Artist(val id: String, val name: String) : SongFilter { override val key = "a:$id"; override val label = name }
    data class Decade(val from: Int, val to: Int, override val label: String) : SongFilter { override val key = "y:$from-$to" }
    data class Bpm(val from: Int, val to: Int?, override val label: String) : SongFilter { override val key = "b:$from-$to" }
}

/** A filter on a number, answered by finding where it starts and ends in the list sorted by that number. */
class RangeSpec(val field: String, val min: Int, val max: Int?)

fun SongFilter.range(): RangeSpec? = when (this) {
    is SongFilter.Unplayed -> RangeSpec("playCount", 0, 0)
    is SongFilter.Decade -> RangeSpec("year", from, to)
    is SongFilter.Bpm -> RangeSpec("bpm", from, to)
    else -> null
}

data class SongQuery(val search: String = "", val filter: SongFilter = SongFilter.All, val sort: SongSort = SongSort.Title, val asc: Boolean = true) {
    val key get() = "$search|${filter.key}|${sort.name}|$asc"
}

class SongPage(val songs: List<Track>, val total: Int)

/**
 * Navidrome's own API (/api/song): the server sorts, searches and filters and gives the list a page at a time, so even
 * a library of tens of thousands of songs needs no copy on the phone. It does not take the Subsonic token directly:
 * through the Icosahedron server the token is enough (the same header the engine reads), without it the password logs in
 * once for a JWT (kept encrypted, see [SecretStore]).
 */
object NativeApi {
    enum class State { Ready, NeedPassword, Unavailable }

    private val http = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
    private var forKey = ""
    private var viaJwt = false
    private var ready = false
    private var jwt: String? = null

    private fun id(c: SubsonicClient) = c.baseUrl + "|" + c.user

    private fun authHeader(c: SubsonicClient): Pair<String, String> =
        if (viaJwt && jwt != null) "x-nd-authorization" to "Bearer $jwt" else "Authorization" to "Subsonic u=${c.user}&t=${c.token}&s=${c.salt}"

    private fun probe(c: SubsonicClient): Int = try {
        val h = "Authorization" to "Subsonic u=${c.user}&t=${c.token}&s=${c.salt}"
        http.newCall(Request.Builder().url(c.baseUrl.trimEnd('/') + "/api/song?_start=0&_end=1").header(h.first, h.second).build()).execute().use { it.code }
    } catch (_: IOException) { 0 }

    /** Pair(status, token): 200 with the token, 401 for a wrong password, 403 when the server closes /auth, 0 for no answer. */
    private fun login(c: SubsonicClient, password: String): Pair<Int, String?> = try {
        val body = JSONObject().put("username", c.user).put("password", password).toString().toRequestBody("application/json".toMediaType())
        http.newCall(Request.Builder().url(c.baseUrl.trimEnd('/') + "/auth/login").post(body).build()).execute().use { r ->
            r.code to if (r.isSuccessful) runCatching { JSONObject(r.body?.string() ?: "").optString("token").takeIf { it.isNotEmpty() } }.getOrNull() else null
        }
    } catch (_: IOException) { 0 to null }

    /** Finds a way to sign in to the native API. */
    suspend fun ensure(c: SubsonicClient): State = withContext(Dispatchers.IO) {
        if (forKey != id(c)) { forKey = id(c); ready = false; viaJwt = false; jwt = null }
        if (ready) return@withContext State.Ready
        val p = probe(c)
        if (p == 200) { ready = true; viaJwt = false; return@withContext State.Ready }
        if (p == 0 || p == 404) return@withContext State.Unavailable
        val saved = SecretStore.get(forKey) ?: return@withContext State.NeedPassword
        val (code, token) = login(c, saved)
        when {
            token != null -> { jwt = token; viaJwt = true; ready = true; State.Ready }
            code == 401 -> { SecretStore.remove(forKey); State.NeedPassword }
            else -> State.Unavailable
        }
    }

    /** The password was typed: check it and keep it (encrypted). */
    suspend fun usePassword(c: SubsonicClient, password: String): Boolean = withContext(Dispatchers.IO) {
        forKey = id(c)
        val (_, token) = login(c, password)
        if (token == null) return@withContext false
        SecretStore.put(forKey, password)
        jwt = token; viaJwt = true; ready = true
        true
    }

    private fun get(c: SubsonicClient, path: String, params: List<Pair<String, String>>, retry: Boolean = true): Pair<JSONArray, Int> {
        val b = (c.baseUrl.trimEnd('/') + path).toHttpUrl().newBuilder()
        params.forEach { b.addQueryParameter(it.first, it.second) }
        val h = authHeader(c)
        http.newCall(Request.Builder().url(b.build()).header(h.first, h.second).build()).execute().use { r ->
            if (r.code == 401 && viaJwt && retry) { // the JWT ran out: sign in again with the kept password
                val saved = SecretStore.get(forKey)
                val token = saved?.let { login(c, it).second }
                if (token != null) { jwt = token; return get(c, path, params, retry = false) }
            }
            if (!r.isSuccessful) throw IOException("Server answered HTTP ${r.code}")
            val arr = JSONArray(r.body?.string() ?: "[]")
            return arr to (r.header("x-total-count")?.toIntOrNull() ?: arr.length())
        }
    }

    private fun params(q: SongQuery, sortField: String, asc: Boolean, start: Int, end: Int): List<Pair<String, String>> {
        val p = ArrayList<Pair<String, String>>()
        p += "_start" to start.toString(); p += "_end" to end.toString()
        p += "_sort" to sortField; p += "_order" to if (asc) "ASC" else "DESC"
        if (q.search.isNotBlank()) p += "title" to q.search.trim() // Navidrome matches it against the title, the artist and the album
        when (val f = q.filter) {
            is SongFilter.Genre -> p += "genre_id" to f.id
            is SongFilter.Artist -> p += "artist_id" to f.id
            is SongFilter.Favorites -> p += "starred" to "true"
            else -> {}
        }
        return p
    }

    private fun song(o: JSONObject): Track? {
        val id = o.str("id") ?: return null
        return Track(
            id, o.str("title") ?: "", o.str("artist") ?: "", o.str("artistId"), o.str("album"), o.str("albumId"),
            o.int("trackNumber") ?: 0, o.int("discNumber") ?: 0, o.optDouble("duration", 0.0).toInt(),
            id, // the cover: Navidrome's getCoverArt takes a song's own id
            o.optBoolean("starred", false), o.int("year")?.takeIf { it > 0 }, o.str("genre"), o.int("bitRate"), o.str("suffix"),
            o.int("bpm")?.takeIf { it > 0 }, o.optLong("size").takeIf { it > 0 }, o.str("path"), o.int("sampleRate"), o.int("bitDepth"), o.int("channels"),
            o.int("playCount"), o.str("createdAt"),
        )
    }

    /** One page. For a range filter the numbers are positions in the list sorted by the range's field (see [slice]). */
    suspend fun page(c: SubsonicClient, q: SongQuery, start: Int, end: Int): SongPage = withContext(Dispatchers.IO) {
        val r = q.filter.range()
        val (arr, total) = if (r != null) get(c, "/api/song", params(q, r.field, true, start, end))
        else get(c, "/api/song", params(q, q.sort.field, if (q.sort == SongSort.Random) true else q.asc, start, end))
        SongPage((0 until arr.length()).mapNotNull { song(arr.getJSONObject(it)) }, total)
    }

    /** The total number of songs under a query, and for a range filter where they sit: [first, last) in the sorted list. */
    suspend fun slice(c: SubsonicClient, q: SongQuery): Pair<Int, Int> = withContext(Dispatchers.IO) {
        val r = q.filter.range() ?: return@withContext 0 to get(c, "/api/song", params(q, q.sort.field, true, 0, 1)).second
        val total = get(c, "/api/song", params(q, r.field, true, 0, 1)).second
        // The first position where the field is at least `min` (or above `max`): a search in the sorted list, one song per step
        fun valueAt(i: Int): Int = get(c, "/api/song", params(q, r.field, true, i, i + 1)).first.optJSONObject(0)?.optInt(r.field, 0) ?: 0
        fun firstWhere(pass: (Int) -> Boolean): Int {
            var lo = 0; var hi = total
            while (lo < hi) { val mid = (lo + hi) / 2; if (pass(valueAt(mid))) hi = mid else lo = mid + 1 }
            return lo
        }
        val from = firstWhere { it >= r.min }
        val to = if (r.max == null) total else firstWhere { it > r.max }
        from to to
    }

    /** Every album the artist is on, as Navidrome counts it: its own, the compilations and the ones it only appears on. */
    suspend fun artistAlbums(c: SubsonicClient, artistId: String): List<Pair<Album, String?>> = withContext(Dispatchers.IO) {
        val (arr, _) = get(c, "/api/album", listOf("_start" to "0", "_end" to "1000", "_sort" to "name", "_order" to "ASC", "artist_id" to artistId))
        (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.mapNotNull { o ->
            val id = o.str("id") ?: return@mapNotNull null
            val types = o.optJSONObject("tags")?.optJSONArray("releasetype")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
            Album(
                id, o.str("name") ?: "", o.str("albumArtist") ?: "", o.str("albumArtistId"), "al-$id",
                (o.int("maxYear") ?: o.int("minYear"))?.takeIf { it > 0 }, o.int("songCount") ?: 0, false, types, o.optBoolean("compilation", false),
            ) to o.str("albumArtistId")
        }
    }

    /** All the artist's songs in album order, up to [limit]. */
    suspend fun artistSongs(c: SubsonicClient, artistId: String, limit: Int = 3000): List<Track> {
        val out = ArrayList<Track>()
        val q = SongQuery(filter = SongFilter.Artist(artistId, ""), sort = SongSort.Album, asc = true)
        while (out.size < limit) {
            val page = page(c, q, out.size, out.size + 500).songs
            out += page
            if (page.size < 500) break
        }
        return out.sortedWith(compareBy<Track> { it.album ?: "" }.thenBy { it.discNumber }.thenBy { it.trackNumber })
    }

    suspend fun genres(c: SubsonicClient): List<Pair<String, String>> = withContext(Dispatchers.IO) {
        val (arr, _) = get(c, "/api/genre", listOf("_start" to "0", "_end" to "2000", "_sort" to "name", "_order" to "ASC"))
        (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.mapNotNull { o -> o.str("id")?.let { it to (o.str("name") ?: it) } }
    }

    /** A random selection for Shuffle: from the whole query, or from a window of the slice for a range filter. */
    suspend fun shuffled(c: SubsonicClient, q: SongQuery, count: Int = 300): List<Track> {
        if (q.filter.range() == null) return page(c, q.copy(sort = SongSort.Random), 0, count).songs
        val (from, to) = slice(c, q)
        if (to <= from) return emptyList()
        val span = to - from
        val start = if (span > count) from + (0..(span - count)).random() else from
        return page(c, q, start, minOf(start + count, to)).songs.shuffled()
    }
}
