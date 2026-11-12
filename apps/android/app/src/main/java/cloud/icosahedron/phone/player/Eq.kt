package cloud.icosahedron.phone.player

import android.content.Context
import android.media.audiofx.Equalizer
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** The phone's equalizer (the system effect on the player's audio session); the bands depend on the phone. */
object Eq {
    private var eq: Equalizer? = null
    private lateinit var prefs: android.content.SharedPreferences
    var available by mutableStateOf(false)
        private set
    var enabled by mutableStateOf(false)
        private set
    var minLevel = -1500
        private set
    var maxLevel = 1500
        private set
    val freqs = mutableStateListOf<Int>()   // Hz
    val levels = mutableStateListOf<Int>()  // millibel

    fun init(context: Context) { prefs = context.getSharedPreferences("eq", Context.MODE_PRIVATE) }

    /** Only a phone that has the equalizer switched on makes the effect at start. */
    val wantedAtStart: Boolean get() = ::prefs.isInitialized && prefs.getBoolean("enabled", false)
    var isAttached = false
        private set

    /** Makes the effect when the equalizer page opens. */
    fun ensure(session: Int) { if (!isAttached) attach(session) }

    /** Called with the player's audio session id (it changes). */
    fun attach(session: Int) {
        try {
            eq?.release()
            val e = Equalizer(0, session)
            eq = e
            minLevel = e.bandLevelRange[0].toInt(); maxLevel = e.bandLevelRange[1].toInt()
            freqs.clear(); levels.clear()
            for (b in 0 until e.numberOfBands) {
                freqs.add(e.getCenterFreq(b.toShort()) / 1000)
                levels.add(prefs.getInt("band$b", 0).coerceIn(minLevel, maxLevel))
            }
            enabled = prefs.getBoolean("enabled", false)
            available = true
            isAttached = true
            apply()
        } catch (_: Exception) { available = false; isAttached = false }
    }

    private fun apply() {
        val e = eq ?: return
        try {
            e.enabled = enabled
            levels.forEachIndexed { b, v -> e.setBandLevel(b.toShort(), v.toShort()) }
        } catch (_: Exception) { }
    }

    fun turn(on: Boolean) { enabled = on; prefs.edit().putBoolean("enabled", on).apply(); apply() }

    fun setLevel(band: Int, millibel: Int) {
        if (band !in levels.indices) return
        levels[band] = millibel.coerceIn(minLevel, maxLevel)
        prefs.edit().putInt("band$band", levels[band]).apply()
        apply()
    }

    fun reset() { levels.indices.forEach { levels[it] = 0; prefs.edit().putInt("band$it", 0).apply() }; apply() }
}
