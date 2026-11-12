@file:OptIn(UnstableApi::class)

package cloud.icosahedron.phone.player

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheEvictor
import androidx.media3.datasource.cache.CacheSpan
import androidx.media3.datasource.cache.CacheWriter
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import cloud.icosahedron.phone.data.Prefs
import cloud.icosahedron.phone.data.Quality
import cloud.icosahedron.phone.data.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import java.io.File
import java.util.TreeSet

/**
 * The offline side of the player. Two caches on disk:
 *  - the **cache**: what was played and what comes next, the oldest is removed when the limit is reached;
 *  - **kept** songs ("Keep offline"): never removed except by the user.
 * A song that is in either cache plays without the network. Streaming goes through both.
 */
object Offline {
    private lateinit var appContext: Context
    private lateinit var lru: SimpleCache
    private lateinit var keptCache: SimpleCache
    private lateinit var evictor: LruEvictor
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** The songs kept on the phone, in the order they were kept. */
    val kept = mutableStateListOf<Track>()
    /** An album or a playlist kept offline, with its songs, so it opens without a network. */
    class Collection(val kind: String, val id: String, val name: String, val subtitle: String, val cover: String?, val tracks: List<Track>)

    val collections = mutableStateListOf<Collection>()
    fun isCollectionKept(kind: String, id: String) = collections.any { it.kind == kind && it.id == id }

    /** How many songs are still waiting to be downloaded; 0 when idle. */
    var pending by mutableIntStateOf(0)
        private set
    var downloading by mutableStateOf<String?>(null)
        private set
    private val queueLock = Any()
    private val waiting = ArrayDeque<Track>()
    private var worker: Job? = null
    private var prefetchJob: Job? = null
    @Volatile private var prefetchWriter: CacheWriter? = null

    fun init(context: Context) {
        if (::appContext.isInitialized) return
        appContext = context.applicationContext
        val db = StandaloneDatabaseProvider(appContext)
        evictor = LruEvictor(Prefs.cacheLimitMb * 1024L * 1024L)
        lru = SimpleCache(File(appContext.cacheDir, "audio"), evictor, db)
        keptCache = SimpleCache(File(appContext.filesDir, "offline"), NoOpCacheEvictor(), db)
        loadKept()
        loadCollections()
    }

    // ── Keys: a kept song has one key whatever the quality; the others are per quality ──
    fun keyFor(t: Track): String = if (isKept(t.id)) "kept:${t.id}" else "${t.id}|${Quality.current()}"
    fun isKept(id: String): Boolean = kept.any { it.id == id }

    fun cachingAllowed(): Boolean = !Quality.onCellular() || Prefs.cacheOnCellular

    private fun http() = DefaultDataSource.Factory(appContext, DefaultHttpDataSource.Factory().setConnectTimeoutMs(15_000).setReadTimeoutMs(30_000))

    private fun lruSource(write: Boolean): DataSource = CacheDataSource.Factory()
        .setCache(lru).setUpstreamDataSourceFactory(http())
        .apply { if (!write) setCacheWriteDataSinkFactory(null) }
        .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR).createDataSource()

    /** What the player reads through: kept songs first (read only), then the cache (written when the connection allows). */
    fun dataSourceFactory(): DataSource.Factory = DataSource.Factory {
        val inner = lruSource(cachingAllowed())
        CacheDataSource.Factory()
            .setCache(keptCache).setUpstreamDataSourceFactory { inner }
            .setCacheWriteDataSinkFactory(null)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR).createDataSource()
    }

    // ── The cache: the next song is fetched while this one plays ──
    fun prefetch(t: Track?, url: String?) {
        prefetchWriter?.cancel()
        prefetchJob?.cancel()
        if (t == null || url == null || !cachingAllowed() || isKept(t.id)) return
        val key = keyFor(t)
        prefetchJob = scope.launch {
            try {
                val w = CacheWriter(lruSource(true) as CacheDataSource, DataSpec.Builder().setUri(url).setKey(key).build(), null, null)
                prefetchWriter = w
                w.cache()
            } catch (_: Exception) { } finally { prefetchWriter = null }
        }
    }

    fun cacheBytes(): Long = if (::lru.isInitialized) lru.cacheSpace else 0
    fun keptBytes(): Long = if (::keptCache.isInitialized) keptCache.cacheSpace else 0

    fun setLimitMb(mb: Int) { Prefs.cacheLimitMb = mb; evictor.max = mb * 1024L * 1024L }

    fun clearCache() {
        scope.launch { try { lru.keys.toList().forEach { lru.removeResource(it) } } catch (_: Exception) { } }
    }

    // ── Kept songs ──
    private val file get() = File(appContext.filesDir, "kept.json")

    private fun loadKept() {
        try {
            val a = JSONArray(file.readText())
            kept.addAll((0 until a.length()).mapNotNull { Track.fromWire(a.getJSONObject(it)) })
        } catch (_: Exception) { }
    }

    private fun saveKept() {
        val snapshot = kept.toList()
        scope.launch { try { file.writeText(JSONArray(snapshot.map { it.toWire() }).toString()) } catch (_: Exception) { } }
    }

    private val collectionsFile get() = File(appContext.filesDir, "collections.json")

    private fun loadCollections() {
        try {
            val a = JSONArray(collectionsFile.readText())
            collections.addAll((0 until a.length()).mapNotNull { i ->
                val o = a.getJSONObject(i)
                val ts = o.getJSONArray("tracks").let { t -> (0 until t.length()).mapNotNull { Track.fromWire(t.getJSONObject(it)) } }
                Collection(o.getString("kind"), o.getString("id"), o.getString("name"), o.optString("subtitle"), o.optString("cover").ifEmpty { null }, ts)
            })
        } catch (_: Exception) { }
    }

    private fun saveCollections() {
        val snapshot = collections.toList()
        scope.launch {
            try {
                collectionsFile.writeText(JSONArray(snapshot.map { c ->
                    org.json.JSONObject().put("kind", c.kind).put("id", c.id).put("name", c.name).put("subtitle", c.subtitle)
                        .put("cover", c.cover ?: "").put("tracks", JSONArray(c.tracks.map { it.toWire() }))
                }).toString())
            } catch (_: Exception) { }
        }
    }

    /** Keeps a whole album or playlist: it shows in Library → Offline and its songs are downloaded. */
    fun keepCollection(c: Collection, urlFor: (Track) -> String) {
        if (!isCollectionKept(c.kind, c.id)) { collections.add(c); saveCollections() }
        keep(c.tracks, urlFor)
    }

    /** The songs that another kept collection also holds stay. */
    fun unkeepCollection(kind: String, id: String) {
        val c = collections.firstOrNull { it.kind == kind && it.id == id } ?: return
        collections.remove(c); saveCollections()
        val others = collections.flatMap { it.tracks }.map { it.id }.toSet()
        c.tracks.filter { it.id !in others }.forEach { unkeep(it) }
    }

    /** Downloads the songs in the background, one at a time. */
    fun keep(tracks: List<Track>, urlFor: (Track) -> String) {
        synchronized(queueLock) {
            tracks.filter { t -> !isKept(t.id) && waiting.none { it.id == t.id } }.forEach { waiting.addLast(it) }
            pending = waiting.size + (if (downloading != null) 1 else 0)
            if (worker?.isActive == true) return
            worker = scope.launch {
                while (true) {
                    val t = synchronized(queueLock) { waiting.removeFirstOrNull() } ?: break
                    downloading = t.id
                    try {
                        val src = CacheDataSource.Factory().setCache(keptCache).setUpstreamDataSourceFactory(http()).createDataSource()
                        CacheWriter(src, DataSpec.Builder().setUri(urlFor(t)).setKey("kept:${t.id}").build(), null, null).cache()
                        kept.add(t); saveKept()
                    } catch (_: Exception) { try { keptCache.removeResource("kept:${t.id}") } catch (_: Exception) { } }
                    downloading = null
                    pending = synchronized(queueLock) { waiting.size }
                }
                pending = 0
            }
        }
    }

    fun unkeep(t: Track) {
        synchronized(queueLock) { waiting.removeAll { it.id == t.id } }
        kept.removeAll { it.id == t.id }
        saveKept()
        scope.launch { try { keptCache.removeResource("kept:${t.id}") } catch (_: Exception) { } }
    }

    fun unkeepAll() { collections.clear(); saveCollections(); kept.toList().forEach { unkeep(it) } }
}

/** The oldest songs go first when the cache is over its limit; the limit can be changed while it runs. */
private class LruEvictor(@Volatile var max: Long) : CacheEvictor {
    private val spans = TreeSet<CacheSpan> { a, b ->
        val d = a.lastTouchTimestamp - b.lastTouchTimestamp
        if (d == 0L) a.compareTo(b) else if (d < 0) -1 else 1
    }
    private var current = 0L

    override fun requiresCacheSpanTouches() = true
    override fun onCacheInitialized() {}
    override fun onStartFile(cache: Cache, key: String, position: Long, length: Long) { if (length != C.LENGTH_UNSET.toLong()) evict(cache, length) }
    override fun onSpanAdded(cache: Cache, span: CacheSpan) { spans.add(span); current += span.length; evict(cache, 0) }
    override fun onSpanRemoved(cache: Cache, span: CacheSpan) { spans.remove(span); current -= span.length }
    override fun onSpanTouched(cache: Cache, oldSpan: CacheSpan, newSpan: CacheSpan) { onSpanRemoved(cache, oldSpan); onSpanAdded(cache, newSpan) }
    private fun evict(cache: Cache, required: Long) {
        while (current + required > max && spans.isNotEmpty()) cache.removeSpan(spans.first())
    }
}
