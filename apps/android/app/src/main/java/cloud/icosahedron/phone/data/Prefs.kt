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
