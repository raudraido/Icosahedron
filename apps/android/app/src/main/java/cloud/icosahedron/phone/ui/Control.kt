package cloud.icosahedron.phone.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.setValue
import cloud.icosahedron.phone.App
import cloud.icosahedron.phone.data.Track
import cloud.icosahedron.phone.player.Playback
import org.json.JSONObject

/**
 * What the player controls act on: this phone, or another player of the account chosen on the Devices
 * tab (docs/connect.md). The mini player, Now Playing and every "play" go through here.
 */
object Control {
    private val sync get() = App.instance.sync

    /** Moved by the screens every half second while another player is controlled, so its position moves. */
    var tick by mutableLongStateOf(0L)

    val target: String? get() = sync?.targetId
    val remote: Boolean get() = target != null
    private val state get() = sync?.stateOf(target)

    val track: Track? get() = if (remote) state?.track else Playback.current
    val isPlaying: Boolean get() = if (remote) state?.playing == true else Playback.isPlaying
    val queue: List<Track> get() = if (remote) state?.queue ?: emptyList() else Playback.queue
    val index: Int get() = if (remote) state?.index ?: -1 else Playback.index
    val shuffle: Boolean get() = if (remote) state?.shuffle == true else Playback.shuffle
    val repeatOn: Boolean get() = if (remote) state?.repeatOn == true else Playback.repeatAll
    val durationMs: Long get() = if (remote) (track?.duration ?: 0) * 1000L else Playback.durationMs
    val positionMs: Long get() { tick; return if (remote) sync?.positionOf(target) ?: 0 else Playback.positionMs }

    private fun cmd(c: String, args: JSONObject? = null) { target?.let { sync?.command(it, c, args) } }

    fun toggle() = if (remote) cmd("toggle") else Playback.toggle()
    fun next() = if (remote) cmd("next") else Playback.next()
    fun previous() = if (remote) cmd("prev") else Playback.previous()
    fun seekTo(ms: Long) { if (remote) sync?.seek(target!!, ms) else Playback.seekTo(ms) }
    fun jump(i: Int) = if (remote) cmd("jump", JSONObject().put("index", i)) else Playback.jump(i)
    fun remove(i: Int) = if (remote) cmd("remove", JSONObject().put("index", i)) else Playback.remove(i)
    fun shuffleTo(on: Boolean) = if (remote) cmd("shuffle", JSONObject().put("on", on)) else Playback.shuffleTo(on)
    fun repeatTo(on: Boolean) = if (remote) cmd("repeat", JSONObject().put("on", on)) else Playback.repeatTo(on)

    fun playTracks(tracks: List<Track>, index: Int = 0) {
        val t = target
        if (t != null) sync?.playOn(t, tracks, index) else Playback.playTracks(tracks, index)
    }

    fun playNext(track: Track) { val t = target; if (t != null) sync?.enqueue(t, listOf(track), "next") else Playback.playNext(track) }
    fun addToQueue(tracks: List<Track>) { val t = target; if (t != null) sync?.enqueue(t, tracks, "end") else Playback.addToQueue(tracks) }
}
