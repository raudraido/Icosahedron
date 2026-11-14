package cloud.icosahedron.phone.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import cloud.icosahedron.phone.App

/** The phone's own settings. */
object Prefs {
    private val p get() = App.instance.getSharedPreferences("settings", Context.MODE_PRIVATE)
    var lyricsOnline: Boolean
        get() = p.getBoolean("lyricsOnline", true)
        set(v) { p.edit().putBoolean("lyricsOnline", v).apply() }
    var showBpm: Boolean
        get() = p.getBoolean("showBpm", true)
        set(v) { p.edit().putBoolean("showBpm", v).apply() }
    var cacheLimitMb: Int
        get() = p.getInt("cacheLimitMb", 1024)
        set(v) { p.edit().putInt("cacheLimitMb", v).apply() }
    /** Stay connected to the sync server with the app in the background (sign-in requests, control from other devices). */
    var syncInBackground: Boolean
        get() = p.getBoolean("syncInBackground", true)
        set(v) { p.edit().putBoolean("syncInBackground", v).apply() }
    var cacheOnCellular: Boolean
        get() = p.getBoolean("cacheOnCellular", false)
        set(v) { p.edit().putBoolean("cacheOnCellular", v).apply() }
    // What the Library remembers: the tab, how Albums and Artists are sorted and filtered, grid or list
    var libraryTab: Int
        get() = p.getInt("libraryTab", 0)
        set(v) { p.edit().putInt("libraryTab", v).apply() }
    var songSort: String
        get() = p.getString("songSort", "Title") ?: "Title"
        set(v) { p.edit().putString("songSort", v).apply() }
    var songSortAsc: Boolean
        get() = p.getBoolean("songSortAsc", true)
        set(v) { p.edit().putBoolean("songSortAsc", v).apply() }
    var albumSort: String
        get() = p.getString("albumSort", "Name") ?: "Name"
        set(v) { p.edit().putString("albumSort", v).apply() }
    var albumFilter: String
        get() = p.getString("albumFilter", "all") ?: "all"
        set(v) { p.edit().putString("albumFilter", v).apply() }
    var albumGrid: Boolean
        get() = p.getBoolean("albumGrid", true)
        set(v) { p.edit().putBoolean("albumGrid", v).apply() }
    var artistSort: String
        get() = p.getString("artistSort", "Name") ?: "Name"
        set(v) { p.edit().putString("artistSort", v).apply() }
    var artistFavorites: Boolean
        get() = p.getBoolean("artistFavorites", false)
        set(v) { p.edit().putBoolean("artistFavorites", v).apply() }
    var artistGrid: Boolean
        get() = p.getBoolean("artistGrid", false)
        set(v) { p.edit().putBoolean("artistGrid", v).apply() }
    var qualityWifi: String
        get() = p.getString("qualityWifi", "raw") ?: "raw"
        set(v) { p.edit().putString("qualityWifi", v).apply() }
    var qualityCellular: String
        get() = p.getString("qualityCellular", "mp3-192") ?: "mp3-192"
        set(v) { p.edit().putString("qualityCellular", v).apply() }
}

/** How a song is delivered: the original file ("raw") or transcoded by the server ("mp3-192"). */
object Quality {
    val options: List<String> = listOf("raw") + listOf("mp3", "aac").flatMap { f -> listOf(96, 128, 192, 256, 320).map { "$f-$it" } }

    fun label(key: String): String = if (key == "raw") "Direct (original)" else key.replace('-', ' ').uppercase() + " kbps"

    fun onCellular(): Boolean {
        val cm = App.instance.getSystemService(ConnectivityManager::class.java) ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) &&
            !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    /** What applies to streaming right now. */
    fun current(): String = if (onCellular()) Prefs.qualityCellular else Prefs.qualityWifi
}
