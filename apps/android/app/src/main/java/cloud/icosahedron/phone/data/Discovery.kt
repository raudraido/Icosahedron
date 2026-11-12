package cloud.icosahedron.phone.data

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/** A server that answered the LAN broadcast. */
data class FoundServer(val address: String, val id: String, val name: String)

/**
 * Finds servers on the network two ways at once and merges what they find:
 *  - mDNS / DNS-SD (service _icosahedron._tcp): firewalls let it through and a router can forward it
 *    between networks (UniFi: Gateway mDNS Proxy), so it also works across a VLAN;
 *  - a broadcast "who is Icosahedron?" to UDP 7360, the way Jellyfin finds its servers (same network only).
 */
object Discovery {
    private const val PORT = 7360
    private const val SERVICE = "_icosahedron._tcp"

    suspend fun find(context: Context, timeoutMs: Long = 3000): List<FoundServer> = coroutineScope {
        val udp = async { udp(timeoutMs) }
        val mdns = async { mdns(context, timeoutMs) }
        val found = LinkedHashMap<String, FoundServer>()
        (mdns.await() + udp.await()).forEach { found.putIfAbsent(it.id, it) }
        found.values.toList()
    }

    private suspend fun udp(timeoutMs: Long): List<FoundServer> = withContext(Dispatchers.IO) {
        val found = LinkedHashMap<String, FoundServer>()
        try {
            DatagramSocket().use { socket ->
                socket.broadcast = true
                socket.soTimeout = 300
                val query = "who is Icosahedron?".toByteArray()
                socket.send(DatagramPacket(query, query.size, InetAddress.getByName("255.255.255.255"), PORT))
                val end = System.currentTimeMillis() + timeoutMs
                val buf = ByteArray(2048)
                while (System.currentTimeMillis() < end) {
                    try {
                        val packet = DatagramPacket(buf, buf.size)
                        socket.receive(packet)
                        val o = JSONObject(String(packet.data, 0, packet.length))
                        val address = o.optString("address")
                        if (address.isNotEmpty()) {
                            val id = o.optString("id").ifEmpty { address }
                            found[id] = FoundServer(address, id, o.optString("name").ifEmpty { address })
                        }
                    } catch (_: SocketTimeoutException) {
                    } catch (_: Exception) {
                    }
                }
            }
        } catch (_: Exception) {
        }
        found.values.toList()
    }

    private suspend fun mdns(context: Context, timeoutMs: Long): List<FoundServer> = withContext(Dispatchers.IO) {
        val nsd = context.applicationContext.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return@withContext emptyList()
        val found = ConcurrentHashMap<String, FoundServer>()
        val resolving = Mutex() // older Android resolves one service at a time
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val listener = object : NsdManager.DiscoveryListener {
            override fun onServiceFound(info: NsdServiceInfo) {
                scope.launch { resolve(nsd, info, resolving)?.let { found[it.id] = it } }
            }
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onServiceLost(info: NsdServiceInfo) {}
        }
        try {
            nsd.discoverServices(SERVICE, NsdManager.PROTOCOL_DNS_SD, listener)
            delay(timeoutMs)
        } catch (_: Exception) {
        } finally {
            try { nsd.stopServiceDiscovery(listener) } catch (_: Exception) {}
            scope.cancel()
        }
        found.values.toList()
    }

    /** The address the server tells in its TXT record, else the host and port the service was found on. */
    private suspend fun resolve(nsd: NsdManager, info: NsdServiceInfo, lock: Mutex): FoundServer? = lock.withLock {
        withTimeoutOrNull(2500) {
            suspendCancellableCoroutine { cont ->
                val listener = object : NsdManager.ResolveListener {
                    override fun onResolveFailed(si: NsdServiceInfo, errorCode: Int) {
                        if (cont.isActive) cont.resume(null)
                    }
                    override fun onServiceResolved(si: NsdServiceInfo) {
                        val attrs = si.attributes
                        fun attr(k: String) = attrs[k]?.let { String(it, Charsets.UTF_8) }?.takeIf { it.isNotBlank() }
                        val host = si.host?.hostAddress?.takeIf { !it.contains(':') }
                        val address = attr("address") ?: host?.let { "http://$it:${si.port}" }
                        val result = address?.let { FoundServer(it, attr("id") ?: it, attr("name") ?: si.serviceName) }
                        if (cont.isActive) cont.resume(result)
                    }
                }
                try {
                    nsd.resolveService(info, listener)
                } catch (_: Exception) {
                    if (cont.isActive) cont.resume(null)
                }
            }
        }
    }
}
