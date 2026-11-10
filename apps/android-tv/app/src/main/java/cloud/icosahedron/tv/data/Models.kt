package cloud.icosahedron.tv.data

import org.json.JSONArray
import org.json.JSONObject

// Small helpers over org.json: Subsonic answers with a single object where there is one item and
// an array where there are several.
fun JSONObject.str(k: String): String? = if (has(k) && !isNull(k)) optString(k).takeIf { it.isNotEmpty() } else null
fun JSONObject.int(k: String): Int? = if (has(k) && !isNull(k)) optInt(k) else null
fun JSONObject.objs(k: String): List<JSONObject> = when (val v = opt(k)) {
    is JSONArray -> (0 until v.length()).mapNotNull { v.optJSONObject(it) }
    is JSONObject -> listOf(v)
    else -> emptyList()
}

data class Track(
    val id: String,
    val title: String,
    val artist: String,
    val artistId: String?,
    val album: String?,
    val albumId: String?,
    val trackNumber: Int,
    val discNumber: Int,
    val duration: Int,
    val coverArt: String?,
    val starred: Boolean,
    val year: Int?,
    val genre: String?,
    val bitrate: Int?,
    val format: String?,
) {
    /** The track object of the sync protocol (the shape the desktop, web and iOS apps use). */
    fun toWire(): JSONObject = JSONObject().apply {
        put("id", id); put("title", title); put("artist", artist)
        put("artist_id", artistId ?: JSONObject.NULL)
        put("album", album ?: JSONObject.NULL)
        put("album_id", albumId ?: JSONObject.NULL)
        put("track_number", trackNumber); put("disc_number", discNumber)
        put("duration_secs", duration)
        put("cover_id", coverArt ?: JSONObject.NULL)
        put("starred", starred)
        put("genre", genre ?: JSONObject.NULL)
        put("year", year ?: JSONObject.NULL)
        put("play_count", 0)
        put("bitrate", bitrate ?: JSONObject.NULL)
        put("bpm", JSONObject.NULL)
        put("created", JSONObject.NULL)
        put("format", format ?: JSONObject.NULL)
    }

    companion object {
        fun fromSubsonic(o: JSONObject): Track? {
            val id = o.str("id") ?: return null
            return Track(
                id, o.str("title") ?: "", o.str("artist") ?: "", o.str("artistId"),
                o.str("album"), o.str("albumId"), o.int("track") ?: 0, o.int("discNumber") ?: 0,
                o.int("duration") ?: 0, o.str("coverArt"), o.has("starred"),
                o.int("year"), o.str("genre"), o.int("bitRate"), o.str("suffix"),
            )
        }

        fun fromWire(o: JSONObject): Track? {
            val id = o.str("id") ?: return null
            return Track(
                id, o.str("title") ?: "", o.str("artist") ?: "", o.str("artist_id"),
                o.str("album"), o.str("album_id"), o.int("track_number") ?: 0, o.int("disc_number") ?: 0,
                o.int("duration_secs") ?: 0, o.str("cover_id"), o.optBoolean("starred", false),
                o.int("year"), o.str("genre"), o.int("bitrate"), o.str("format"),
            )
        }
    }
}

data class Album(
    val id: String,
    val name: String,
    val artist: String,
    val artistId: String?,
    val coverArt: String?,
    val year: Int?,
    val songCount: Int,
) {
    companion object {
        fun fromSubsonic(o: JSONObject): Album? {
            val id = o.str("id") ?: return null
            return Album(
                id, o.str("name") ?: o.str("title") ?: "", o.str("artist") ?: "", o.str("artistId"),
                o.str("coverArt"), o.int("year"), o.int("songCount") ?: 0,
            )
        }
    }
}

data class Artist(val id: String, val name: String, val coverArt: String?, val albumCount: Int) {
    companion object {
        fun fromSubsonic(o: JSONObject): Artist? {
            val id = o.str("id") ?: return null
            return Artist(id, o.str("name") ?: "", o.str("coverArt"), o.int("albumCount") ?: 0)
        }
    }
}

data class Playlist(val id: String, val name: String, val songCount: Int, val coverArt: String?) {
    companion object {
        fun fromSubsonic(o: JSONObject): Playlist? {
            val id = o.str("id") ?: return null
            return Playlist(id, o.str("name") ?: "", o.int("songCount") ?: 0, o.str("coverArt"))
        }
    }
}
