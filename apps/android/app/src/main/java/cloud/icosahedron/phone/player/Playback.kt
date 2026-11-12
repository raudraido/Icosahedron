package cloud.icosahedron.phone.player

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import cloud.icosahedron.phone.data.SubsonicClient
import cloud.icosahedron.phone.data.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * This TV's player: one ExoPlayer for the whole process (the media service shares it for the
 * session and background playback) and the queue as Compose state for the screens. The queue
 * index is the position in the order the queue is shown; shuffle only changes what plays next.
 */
object Playback {
    private lateinit var appContext: Context
    lateinit var player: ExoPlayer
        private set
    var client: SubsonicClient? = null

    var queue by mutableStateOf<List<Track>>(emptyList())
        private set
    var index by mutableIntStateOf(-1)
        private set
    var isPlaying by mutableStateOf(false)
        private set
    var positionMs by mutableLongStateOf(0L)
        private set
    var durationMs by mutableLongStateOf(0L)
        private set
    var shuffle by mutableStateOf(false)
        private set
    var repeatAll by mutableStateOf(false)
        private set

    var speed by mutableStateOf(1f)
        private set
    var keepPitch by mutableStateOf(true)
        private set

    val current: Track? get() = queue.getOrNull(index)

    /** Called when what this player does changes (track, play state, queue, shuffle, repeat). */
    var onChanged: (() -> Unit)? = null
    /** Called about every half second while something is loaded; the sync client publishes the position from it. */
    var onTick: (() -> Unit)? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var scrobbledId: String? = null

    fun init(context: Context) {
        if (::player.isInitialized) return
        appContext = context.applicationContext
        Offline.init(appContext)
        player = ExoPlayer.Builder(appContext)
            .setMediaSourceFactory(androidx.media3.exoplayer.source.DefaultMediaSourceFactory(Offline.dataSourceFactory()))
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                true,
            )
            .setHandleAudioBecomingNoisy(true)
            .build()
        val prefs = appContext.getSharedPreferences("playback", Context.MODE_PRIVATE)
        speed = prefs.getFloat("speed", 1f)
        keepPitch = prefs.getBoolean("keepPitch", true)
        applySpeed()
        Eq.init(appContext)
        // The system can fail to give the player a session (the audio service restarting): -1 then breaks every song
        ensureAudioSession()
        // The equalizer is an audio effect inside the system's audio service: it is only made when it is on (or being set up)
        if (Eq.wantedAtStart) Eq.attach(player.audioSessionId)
        player.addListener(object : Player.Listener {
            override fun onAudioSessionIdChanged(audioSessionId: Int) { if (Eq.isAttached || Eq.wantedAtStart) Eq.attach(audioSessionId) }
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                // "AudioTrack init failed": get a fresh session once and try the song again
                if (error.errorCode == androidx.media3.common.PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED && System.currentTimeMillis() - lastAudioRepair > 5_000) {
                    lastAudioRepair = System.currentTimeMillis()
                    ensureAudioSession(force = true)
                    player.prepare()
                }
            }
        })
        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { sync(); onChanged?.invoke() }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) { sync(); nowPlaying(); prefetchNext(); onChanged?.invoke() }
            override fun onPlaybackStateChanged(playbackState: Int) { sync(); onChanged?.invoke() }
            override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) { sync(); onChanged?.invoke() }
            override fun onRepeatModeChanged(repeatMode: Int) { sync(); onChanged?.invoke() }
            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int,
            ) { sync() }
        })
        scope.launch {
            while (true) {
                delay(500)
                if (queue.isNotEmpty()) { sync(); scrobbleWhenDue(); onTick?.invoke(); saveSession() }
            }
        }
    }

    private var lastAudioRepair = 0L

    private fun ensureAudioSession(force: Boolean = false) {
        try {
            if (!force && player.audioSessionId > 0) return
            val id = appContext.getSystemService(android.media.AudioManager::class.java).generateAudioSessionId()
            if (id > 0) player.audioSessionId = id
        } catch (_: Exception) { }
    }

    /** Fetches the next song into the cache while this one plays. */
    private fun prefetchNext() {
        val next = queue.getOrNull(index + 1)
        Offline.prefetch(next, next?.let { client?.streamUrl(it.id) })
    }

    /** Copies the player's state into the Compose state. */
    private fun sync() {
        index = if (queue.isEmpty()) -1 else player.currentMediaItemIndex.coerceIn(0, queue.size - 1)
        isPlaying = player.isPlaying
        positionMs = player.currentPosition.coerceAtLeast(0)
        durationMs = player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: ((current?.duration ?: 0) * 1000L)
        shuffle = player.shuffleModeEnabled
        repeatAll = player.repeatMode != Player.REPEAT_MODE_OFF
    }

    private fun item(t: Track): MediaItem = buildItem(t)

    /** A playable item for [t] (the media session and Android Auto use it). */
    fun mediaItemFor(t: Track): MediaItem = buildItem(t)

    /** The queue the session set from outside (Android Auto): keeps the screens' list in step with the player. */
    fun adoptQueue(tracks: List<Track>) { queue = tracks; scrobbledId = null }

    private fun buildItem(t: Track): MediaItem {
        val c = client
        return MediaItem.Builder()
            .setMediaId(t.id)
            .setUri(c?.streamUrl(t.id))
            .setCustomCacheKey(Offline.keyFor(t))
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(t.title).setArtist(t.artist).setAlbumTitle(t.album)
                    .setArtworkUri(c?.coverUrl(t.coverArt, 512)?.let { android.net.Uri.parse(it) })
                    .build(),
            )
            .build()
    }

    /**
     * Keeps the media service running so playback survives leaving the app (it may refuse from the
     * background). A plain start, not startForegroundService: Media3 moves the service to the foreground
     * itself once music plays, and a foreground start that is not answered with startForeground within a
     * few seconds (the track is still buffering, or fails) kills the app.
     */
    private fun ensureService() {
        try {
            appContext.startService(Intent(appContext, PlaybackService::class.java))
        } catch (_: Exception) { /* playback itself does not depend on it */ }
    }

    fun playTracks(tracks: List<Track>, start: Int = 0, startPositionMs: Long = 0, playWhenReady: Boolean = true) {
        if (tracks.isEmpty()) return
        queue = tracks
        player.setMediaItems(tracks.map(::item), start.coerceIn(0, tracks.size - 1), startPositionMs)
        player.prepare()
        player.playWhenReady = playWhenReady
        scrobbledId = null
        ensureService()
        sync()
        onChanged?.invoke()
    }

    /** Right after the current track (starts playing when nothing is queued). */
    fun playNext(track: Track) = insert(listOf(track), at = if (queue.isEmpty()) 0 else index + 1)

    fun addToQueue(tracks: List<Track>) = insert(tracks, at = queue.size)

    /** Inserts after `at - 1`; returns where the first inserted track landed. */
    fun insert(tracks: List<Track>, at: Int): Int {
        if (tracks.isEmpty()) return at
        if (queue.isEmpty()) { playTracks(tracks, 0); return 0 }
        val pos = at.coerceIn(0, queue.size)
        player.addMediaItems(pos, tracks.map(::item))
        queue = queue.toMutableList().apply { addAll(pos, tracks) }
        sync()
        onChanged?.invoke()
        return pos
    }

    fun jump(i: Int) {
        if (i !in queue.indices) return
        player.seekTo(i, 0)
        player.play()
        sync()
    }

    fun remove(i: Int) {
        if (i !in queue.indices) return
        player.removeMediaItem(i)
        queue = queue.toMutableList().apply { removeAt(i) }
        sync()
        onChanged?.invoke()
    }

    /** Array-move: the item at `from` ends up at index `to`. */
    fun move(from: Int, to: Int) {
        if (from !in queue.indices || to !in queue.indices || from == to) return
        player.moveMediaItem(from, to)
        queue = queue.toMutableList().apply { add(to, removeAt(from)) }
        sync()
        onChanged?.invoke()
    }

    fun toggle() { if (player.isPlaying) player.pause() else { player.play(); ensureService() } }
    fun play() { player.play(); ensureService() }
    fun pause() = player.pause()
    fun next() { player.seekToNextMediaItem(); sync() }
    fun previous() { player.seekToPrevious(); sync() }
    fun seekTo(ms: Long) { player.seekTo(ms.coerceAtLeast(0)); sync(); onChanged?.invoke() }
    fun shuffleTo(on: Boolean) { player.shuffleModeEnabled = on }
    fun repeatTo(on: Boolean) { player.repeatMode = if (on) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF }
    /** Playback speed 0.5x to 2x; with [keep] the pitch stays (time-stretch), without it the pitch follows the speed. */
    fun setSpeed(value: Float, keep: Boolean = keepPitch) {
        speed = value.coerceIn(0.5f, 2f)
        keepPitch = keep
        applySpeed()
        appContext.getSharedPreferences("playback", Context.MODE_PRIVATE).edit().putFloat("speed", speed).putBoolean("keepPitch", keepPitch).apply()
    }

    private fun applySpeed() {
        player.playbackParameters = androidx.media3.common.PlaybackParameters(speed, if (keepPitch) 1f else speed)
    }

    fun setVolume(percent: Int) { player.volume = (percent.coerceIn(0, 100)) / 100f }

    // ── The queue is remembered, so the app (and a play button in the car or on a headset) continues where it was ──
    class Saved(val tracks: List<Track>, val index: Int, val positionMs: Long)

    private val sessionFile get() = java.io.File(appContext.filesDir, "playback-session.json")
    private var lastSig = ""
    private var lastSave = 0L

    private fun saveSession() {
        val q = queue
        if (q.isEmpty()) return
        val sig = q.size.toString() + q.first().id + q.last().id + index + (current?.id ?: "")
        val now = System.currentTimeMillis()
        if (sig == lastSig && now - lastSave < 15_000) return
        lastSig = sig; lastSave = now
        val idx = index; val pos = positionMs; val user = client?.user
        scope.launch(Dispatchers.IO) {
            try {
                val o = org.json.JSONObject().put("user", user).put("index", idx).put("positionMs", pos)
                    .put("queue", org.json.JSONArray(q.map { it.toWire() }))
                sessionFile.writeText(o.toString())
            } catch (_: Exception) { }
        }
    }

    fun loadSaved(): Saved? = try {
        val o = org.json.JSONObject(sessionFile.readText())
        val tracks = o.getJSONArray("queue").let { a -> (0 until a.length()).mapNotNull { Track.fromWire(a.getJSONObject(it)) } }
        if (tracks.isEmpty() || o.optString("user") != client?.user) null
        else Saved(tracks, o.optInt("index", 0).coerceIn(0, tracks.size - 1), o.optLong("positionMs", 0))
    } catch (_: Exception) { null }

    /** Puts the remembered queue back (paused unless [play]). */
    fun restoreSession(play: Boolean = false): Boolean {
        if (queue.isNotEmpty()) return true
        val s = loadSaved() ?: return false
        playTracks(s.tracks, s.index, s.positionMs, play)
        return true
    }

    /** For the media session: what to play when a play button is pressed and nothing is loaded. */
    fun resumption(): androidx.media3.session.MediaSession.MediaItemsWithStartPosition? {
        val s = loadSaved() ?: return null
        queue = s.tracks
        return androidx.media3.session.MediaSession.MediaItemsWithStartPosition(s.tracks.map(::item), s.index, s.positionMs)
    }

    fun clearSaved() { try { sessionFile.delete() } catch (_: Exception) { }; lastSig = "" }

    fun stop() {
        player.stop()
        player.clearMediaItems()
        queue = emptyList()
        sync()
        onChanged?.invoke()
    }

    // The server's play count: "now playing" at the start, the play itself after half the track.
    private fun nowPlaying() {
        if (!player.playWhenReady) return // a restored queue is not a play
        val t = current ?: return
        val c = client ?: return
        scope.launch(Dispatchers.IO) { try { c.scrobble(t.id, false) } catch (_: Exception) { } }
    }

    private fun scrobbleWhenDue() {
        val t = current ?: return
        if (scrobbledId == t.id || !isPlaying) return
        val dur = durationMs
        if (dur > 0 && positionMs >= minOf(dur / 2, 4 * 60_000L)) {
            scrobbledId = t.id
            val c = client ?: return
            scope.launch(Dispatchers.IO) { try { c.scrobble(t.id, true) } catch (_: Exception) { } }
        }
    }
}
