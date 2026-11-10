package cloud.icosahedron.tv.sync

import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import cloud.icosahedron.tv.data.Session
import cloud.icosahedron.tv.data.Track
import cloud.icosahedron.tv.player.Playback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.math.min

/**
 * Link to the web engine's sync hub (docs/sync-protocol.md). This TV is one more player of the
 * account: it shows up in the other apps' device lists, takes their commands and publishes its own
 * state. Players are independent, so it never pauses anyone else.
 */
class SyncClient(private val session: Session, private val deviceId: String, private val deviceName: String) {
    var status by mutableStateOf("off") // off | connecting | online
        private set
    /** This TV's name as the engine knows it (renamable from the other apps). */
    var name by mutableStateOf<String?>(null)
        private set

    private val main = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).build()
    private var ws: WebSocket? = null
    private var wanted = false
    private var retry = 0
    private var lastQueueIds: List<String> = emptyList()
    private var wasPlaying = false
    private var lastTick = 0L

    fun start() {
        wanted = true
        retry = 0
        Playback.onChanged = { main.post { publish(false) } }
        Playback.onTick = { if (Playback.isPlaying && System.currentTimeMillis() - lastTick > 3000) publish(false) }
        open()
    }

    fun stop() {
        wanted = false
        Playback.onChanged = null
        Playback.onTick = null
        ws?.close(1000, "bye")
        ws = null
        status = "off"
    }

    private fun open() {
        if (!wanted) return
        val url = session.url.trimEnd('/').replaceFirst(Regex("^http"), "ws") + "/sync"
        status = "connecting"
        ws = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val hello = JSONObject()
                    .put("type", "hello")
                    .put("auth", JSONObject().put("u", session.user).put("t", session.token).put("s", session.salt))
                    .put(
                        "device",
                        JSONObject().put("deviceId", deviceId).put("name", deviceName).put("kind", "tv")
                            .put("playback", true).put("proto", 2),
                    )
                webSocket.send(hello.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val m = try { JSONObject(text) } catch (_: Exception) { return }
                main.post { handle(m) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { main.post { closed(webSocket, code) } }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { main.post { closed(webSocket, 0) } }
        })
    }

    private fun closed(socket: WebSocket, code: Int) {
        if (ws !== socket) return
        ws = null
        status = "off"
        // 4003 = bad credentials: do not hammer the engine
        if (!wanted || code == 4003) return
        retry++
        main.postDelayed({ open() }, min(30_000L, 1000L shl min(retry, 5)))
    }

    private fun send(o: JSONObject) { ws?.send(o.toString()) }

    private fun handle(m: JSONObject) {
        when (m.optString("type")) {
            "welcome" -> {
                retry = 0
                status = "online"
                name = m.optString("name").takeIf { it.isNotEmpty() }
                lastQueueIds = emptyList() // the engine we connected to knows nothing of this TV yet
                publish(true)
            }
            "renamed" -> name = m.optString("name").takeIf { it.isNotEmpty() }
            "command" -> command(m.optString("cmd"), m.optJSONObject("args"))
        }
    }

    // ── Commands from other apps ───────────────────────────────────────────────
    private fun tracksOf(a: JSONArray?): List<Track> =
        if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let(Track::fromWire) }

    private fun command(cmd: String, args: JSONObject?) {
        when (cmd) {
            "play" -> Playback.play()
            "pause" -> Playback.pause()
            "toggle" -> Playback.toggle()
            "next" -> Playback.next()
            "prev" -> Playback.previous()
            "seek" -> args?.let { Playback.seekTo(it.optLong("positionMs")) }
            "volume" -> args?.let { Playback.setVolume(it.optInt("volume", 100)) }
            "load" -> args?.optJSONObject("state")?.let { st ->
                val tracks = tracksOf(st.optJSONArray("queue"))
                Playback.playTracks(
                    tracks, st.optInt("index", 0), st.optLong("positionMs", 0),
                    playWhenReady = st.optBoolean("playing", true),
                )
            }
            "enqueue" -> if (args != null) {
                val tracks = tracksOf(args.optJSONArray("tracks"))
                val at = args.optString("at", "end")
                if (Playback.queue.isEmpty()) {
                    Playback.playTracks(tracks, 0)
                } else if (at == "end") {
                    Playback.addToQueue(tracks)
                } else {
                    val first = Playback.insert(tracks, Playback.index + 1) // keeps the given order
                    if (at == "now") Playback.jump(first)
                }
            }
            "jump" -> args?.let { Playback.jump(it.optInt("index", -1)) }
            "remove" -> args?.let { Playback.remove(it.optInt("index", -1)) }
            "shuffle" -> args?.let { Playback.setShuffle(it.optBoolean("on")) }
            "repeat" -> args?.let { Playback.setRepeat(it.optBoolean("on")) }
            "move" -> args?.let { Playback.move(it.optInt("from", -1), it.optInt("to", -1)) }
        }
    }

    // ── This TV's state ───────────────────────────────────────────────────────
    /** Publishes the state; the queue only when it changed (or when forced). A pause is published once. */
    private fun publish(force: Boolean) {
        if (status != "online" || Playback.queue.isEmpty()) return
        if (!force && !Playback.isPlaying && !wasPlaying) return
        wasPlaying = Playback.isPlaying
        lastTick = System.currentTimeMillis()
        val ids = Playback.queue.map { it.id }
        val state = JSONObject()
            .put("index", Playback.index)
            .put("positionMs", Playback.positionMs)
            .put("playing", Playback.isPlaying)
            .put("shuffle", Playback.shuffle)
            .put("repeat", Playback.repeatAll)
            .put("volume", (Playback.player.volume * 100).toInt())
        if (force || ids != lastQueueIds) {
            state.put("queue", JSONArray(Playback.queue.map { it.toWire() }))
            lastQueueIds = ids
        }
        send(JSONObject().put("type", "state").put("state", state))
    }

    companion object {
        /** What this TV is called until it is renamed. */
        fun defaultName(): String = Build.MODEL.takeIf { it.isNotBlank() } ?: "Google TV"
    }
}
