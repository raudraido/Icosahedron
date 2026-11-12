package cloud.icosahedron.phone.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** One line of a song's lyrics; [timeMs] is when it starts, null for lyrics that are not timed. */
data class LyricLine(val timeMs: Long?, val text: String)

/**
 * Lyrics: from the server first (OpenSubsonic `getLyricsBySongId`, Navidrome reads them from the files'
 * tags or .lrc files), else from LRCLIB (lrclib.net, a free public database), like the other apps do.
 * Timed lyrics are preferred. Looked up once per song and kept for the session.
 */
object Lyrics {
    private val cache = ConcurrentHashMap<String, List<LyricLine>>()
    private val http = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS).build()

    suspend fun forTrack(client: SubsonicClient, t: Track): List<LyricLine> {
        cache[t.id]?.let { return it }
        val lines = runCatching { client.lyrics(t.id) }.getOrDefault(emptyList()).ifEmpty { lrclib(t) }
        cache[t.id] = lines
        return lines
    }

    private suspend fun lrclib(t: Track): List<LyricLine> = withContext(Dispatchers.IO) {
        runCatching {
            val b = "https://lrclib.net/api/get".toHttpUrl().newBuilder()
                .addQueryParameter("artist_name", t.artist)
                .addQueryParameter("track_name", t.title)
            if (!t.album.isNullOrEmpty()) b.addQueryParameter("album_name", t.album)
            if (t.duration > 0) b.addQueryParameter("duration", t.duration.toString())
            val req = Request.Builder().url(b.build()).header("User-Agent", "Icosahedron TV").build()
            http.newCall(req).execute().use { r ->
                if (!r.isSuccessful) return@use emptyList()
                val o = JSONObject(r.body!!.string())
                val synced = o.optString("syncedLyrics").takeIf { it.isNotBlank() && it != "null" }?.let(::parseLrc).orEmpty()
                if (synced.isNotEmpty()) synced
                else o.optString("plainLyrics").takeIf { it.isNotBlank() && it != "null" }?.let(::plain).orEmpty()
            }
        }.getOrDefault(emptyList())
    }

    private val stamp = Regex("""\[(\d+):(\d+(?:\.\d+)?)]""")

    /** "[mm:ss.xx] text" lines (LRC); tags like [ar:...] are skipped. */
    fun parseLrc(text: String): List<LyricLine> {
        val out = ArrayList<LyricLine>()
        for (raw in text.lines()) {
            val marks = stamp.findAll(raw).toList()
            val last = marks.lastOrNull() ?: continue
            val lyric = raw.substring(last.range.last + 1).trim()
            for (m in marks) {
                val ms = ((m.groupValues[1].toDouble() * 60 + m.groupValues[2].toDouble()) * 1000).toLong()
                out += LyricLine(ms, lyric)
            }
        }
        return out.sortedBy { it.timeMs }
    }

    fun plain(text: String): List<LyricLine> = text.lines().map { LyricLine(null, it.trimEnd()) }
}
