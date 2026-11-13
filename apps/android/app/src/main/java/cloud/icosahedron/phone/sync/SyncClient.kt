package cloud.icosahedron.phone.sync

import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import cloud.icosahedron.phone.data.Pending
import cloud.icosahedron.phone.data.SecureSignIn
import cloud.icosahedron.phone.data.Session
import cloud.icosahedron.phone.App
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import cloud.icosahedron.phone.data.Track
import cloud.icosahedron.phone.data.Prefs
import cloud.icosahedron.phone.player.Playback
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

    data class RegDevice(val id: String, val name: String, val kind: String, val online: Boolean, val lastSeen: Long)
    /** Every player of the account the engine knows, online or not. */
    var registry by mutableStateOf<List<RegDevice>>(emptyList())
        private set

    data class Dev(val id: String, val name: String, val kind: String)
    /** What another player is doing: its own queue and state (docs/connect.md). */
    data class RemoteState(val queue: List<Track>, val index: Int, val playing: Boolean, val shuffle: Boolean, val repeatOn: Boolean) {
        val track: Track? get() = queue.getOrNull(index)
    }

    /** The players online right now, this phone first. */
    var devices by mutableStateOf<List<Dev>>(emptyList())
        private set
    var remoteStates by mutableStateOf<Map<String, RemoteState>>(emptyMap())
        private set
    /** The player the controls act on; null is this phone. */
    var targetId by mutableStateOf<String?>(null)
        private set
    private val positions = HashMap<String, Pair<Double, Long>>() // ms and when it arrived
    private val lastSeek = HashMap<String, Long>()

    /** Sign-in requests from other devices waiting for this phone to approve. */
    var approvals by mutableStateOf<List<Pending>>(emptyList())
        private set
    private val scope = CoroutineScope(Dispatchers.Main)

    private val main = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder().pingInterval(60, TimeUnit.SECONDS).build()
    private var ws: WebSocket? = null
    private var wanted = false
    private var retry = 0
    private var lastQueueIds: List<String> = emptyList()
    private var wasPlaying = false
    private var lastTick = 0L

    private val cm by lazy { App.instance.getSystemService(android.net.ConnectivityManager::class.java) }
    private var visible = true
    private var netWatching = false
    private val netCallback = object : android.net.ConnectivityManager.NetworkCallback() {
        // The network is back: connect at once instead of waiting for a timer that polled it blind
        override fun onAvailable(network: android.net.Network) {
            main.post { if (wanted && ws == null) { retry = 0; open() } }
        }
    }
    private val idleClose = Runnable {
        if (!visible && !Playback.isPlaying && !Prefs.syncInBackground) { ws?.close(1000, "idle"); ws = null; status = "off" }
    }

    /** The app came to the screen or left it. With the setting off, the link is dropped a minute after the app is left while nothing plays. */
    fun appVisible(v: Boolean) {
        visible = v
        main.removeCallbacks(idleClose)
        if (v) { if (wanted && ws == null) { retry = 0; open() } } else considerIdle()
    }

    private fun considerIdle() {
        main.removeCallbacks(idleClose)
        if (!visible && !Prefs.syncInBackground && !Playback.isPlaying) main.postDelayed(idleClose, 60_000)
    }

    fun start() {
        wanted = true
        retry = 0
        if (!netWatching) {
            try { cm.registerDefaultNetworkCallback(netCallback); netWatching = true } catch (_: Exception) { }
        }
        Playback.onChanged = {
            main.post {
                // Playback starting brings the link back, playback stopping lets it go (when the setting says so)
                if (wanted && ws == null && (visible || Playback.isPlaying)) { retry = 0; open() }
                publish(false)
                considerIdle()
            }
        }
        Playback.onTick = { if (Playback.isPlaying && System.currentTimeMillis() - lastTick > 3000) publish(false) }
        open()
    }

    fun stop() {
        wanted = false
        if (netWatching) { try { cm.unregisterNetworkCallback(netCallback) } catch (_: Exception) { }; netWatching = false }
        main.removeCallbacks(idleClose)
        Playback.onChanged = null
        Playback.onTick = null
        ws?.close(1000, "bye")
        ws = null
        status = "off"
    }

    private fun open() {
        if (!wanted) return
        if (!visible && !Playback.isPlaying && !Prefs.syncInBackground) return // battery saver: no link (and no retries) in the background
        val url = session.url.trimEnd('/').replaceFirst(Regex("^http"), "ws") + "/sync"
        status = "connecting"
        ws = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val hello = JSONObject()
                    .put("type", "hello")
                    .put("auth", JSONObject().put("u", session.user).put("t", session.token).put("s", session.salt))
                    .put(
                        "device",
                        JSONObject().put("deviceId", deviceId).put("name", deviceName).put("kind", "mobile")
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
        // No network: wait for the network callback instead of trying again blind
        if (cm.activeNetwork == null) return
        retry++
        // 1 s doubling to 5 min, with some jitter so that many devices do not return together
        val wait = min(300_000L, 1000L shl min(retry, 8))
        main.postDelayed({ if (ws == null) open() }, wait + (Math.random() * wait * 0.2).toLong())
    }

    private fun applyDevices(m: JSONObject) {
        val a = m.optJSONArray("devices") ?: return
        devices = (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { Dev(it.optString("deviceId"), it.optString("name", "Device"), it.optString("kind", "web")) }
            .sortedWith(compareByDescending<Dev> { it.id == deviceId }.thenBy { it.name.lowercase() })
        val online = devices.map { it.id }.toSet()
        if (targetId != null && targetId !in online) targetId = null
        if (remoteStates.keys.any { it !in online }) remoteStates = remoteStates.filterKeys { it in online }
    }

    private fun applyRemote(s: JSONObject, id: String) {
        if (id.isEmpty() || id == deviceId) return
        val prev = remoteStates[id]
        val queue = s.optJSONArray("queue")?.let { tracksOf(it) } ?: prev?.queue ?: emptyList()
        val next = RemoteState(queue, s.optInt("index", 0), s.optBoolean("playing"), s.optBoolean("shuffle"), s.optBoolean("repeat"))
        if (next != prev) remoteStates = remoteStates + (id to next)
        val now = System.currentTimeMillis()
        if ((lastSeek[id] ?: 0) + 2000 > now) return // a state that was already on its way would pull the bar back
        val reported = s.optDouble("positionMs", 0.0)
        val old = positions[id]
        if (old != null && prev != null && prev.playing && next.playing && prev.track?.id == next.track?.id) {
            val expected = old.first + (now - old.second)
            if (kotlin.math.abs(reported - expected) < 1500) { positions[id] = maxOf(reported, expected) to now; return }
        }
        positions[id] = reported to now
    }

    fun stateOf(id: String?): RemoteState? = id?.let { remoteStates[it] }

    /** Another player's position in ms, moving on while it plays. */
    fun positionOf(id: String?): Long {
        val p = positions[id ?: return 0] ?: return 0
        val playing = remoteStates[id]?.playing == true
        val pos = p.first + if (playing) System.currentTimeMillis() - p.second else 0
        val limit = (remoteStates[id]?.track?.duration ?: 0) * 1000L
        return (if (limit > 0) minOf(pos.toLong(), limit) else pos.toLong())
    }

    /** Chooses the player the controls act on. It only controls: music moves with an explicit [transfer]. */
    fun setTarget(id: String?) { targetId = if (id == deviceId) null else id }

    fun command(target: String, cmd: String, args: JSONObject? = null) {
        val o = JSONObject().put("type", "command").put("target", target).put("cmd", cmd)
        if (args != null) o.put("args", args)
        send(o)
    }

    fun seek(target: String, ms: Long) {
        command(target, "seek", JSONObject().put("positionMs", ms))
        positions[target] = ms.toDouble() to System.currentTimeMillis()
        lastSeek[target] = System.currentTimeMillis()
    }

    /** Moves [source]'s playback to [target]: the source pauses, the target continues where it was. */
    fun transfer(source: String, target: String) = send(JSONObject().put("type", "transfer").put("source", source).put("target", target))

    /** Starts [tracks] on another player (a window of a very long list). */
    fun playOn(target: String, tracks: List<Track>, index: Int) {
        if (tracks.isEmpty()) return
        val start = maxOf(0, index - 20)
        val window = tracks.drop(start).take(1000)
        command(target, "load", JSONObject().put("state", JSONObject().put("queue", JSONArray(window.map { it.toWire() })).put("index", index - start).put("positionMs", 0).put("playing", true)))
    }

    /** at: "now", "next" or "end". */
    fun enqueue(target: String, tracks: List<Track>, at: String) =
        command(target, "enqueue", JSONObject().put("at", at).put("tracks", JSONArray(tracks.map { it.toWire() })))

    val myId: String get() = deviceId
    fun rename(target: String, to: String) = send(JSONObject().put("type", "rename").put("target", target).put("name", to))
    fun forget(target: String) = send(JSONObject().put("type", "forget").put("target", target))

    private fun send(o: JSONObject) { ws?.send(o.toString()) }

    private fun handle(m: JSONObject) {
        when (m.optString("type")) {
            "welcome" -> {
                retry = 0
                status = "online"
                name = m.optString("name").takeIf { it.isNotEmpty() }
                lastQueueIds = emptyList()
                applyDevices(m)
                remoteStates = emptyMap(); positions.clear()
                m.optJSONObject("states")?.let { st -> st.keys().forEach { id -> st.optJSONObject(id)?.let { applyRemote(it, id) } } }
                publish(true)
                refreshApprovals()
            }
            "devices" -> applyDevices(m)
            "state" -> m.optJSONObject("state")?.let { applyRemote(it, m.optString("from")) }
            "registry" -> {
                val a = m.optJSONArray("devices") ?: JSONArray()
                registry = (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map {
                    RegDevice(it.optString("deviceId"), it.optString("name", "Device"), it.optString("kind", "web"), it.optBoolean("online"), it.optLong("lastSeen"))
                }.sortedWith(compareByDescending<RegDevice> { it.id == deviceId }.thenByDescending { it.online }.thenBy { it.name.lowercase() })
            }
            "approval" -> m.optJSONObject("request")?.let(Pending::fromJson)?.let { p ->
                if (p.expiresAt > System.currentTimeMillis() && approvals.none { it.id == p.id }) {
                    approvals = approvals + p
                    App.instance.announce(p)
                }
            }
            "approval_done" -> { val id = m.optString("id"); approvals = approvals.filter { it.id != id } }
            "renamed" -> name = m.optString("name").takeIf { it.isNotEmpty() }
            "command" -> command(m.optString("cmd"), m.optJSONObject("args"))
        }
    }

    /** Asks the engine which requests are open (after connecting, and when the app comes to the front). */
    fun refreshApprovals() {
        scope.launch {
            val list = SecureSignIn.pending(session.client()).filter { it.expiresAt > System.currentTimeMillis() }
            approvals = list
            list.forEach { App.instance.announce(it) }
        }
    }

    /** Approves with the number picked, or denies (number null). Returns what the engine says. */
    suspend fun answer(p: Pending, approve: Boolean, number: Int?): String {
        val r = SecureSignIn.decide(session.client(), p.id, approve, number)
        approvals = approvals.filter { it.id != p.id }
        return r
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
            "shuffle" -> args?.let { Playback.shuffleTo(it.optBoolean("on")) }
            "repeat" -> args?.let { Playback.repeatTo(it.optBoolean("on")) }
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
        fun defaultName(): String = Build.MODEL.takeIf { it.isNotBlank() } ?: "Android phone"
    }
}
