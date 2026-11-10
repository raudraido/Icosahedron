package cloud.icosahedron.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
import java.util.concurrent.TimeUnit

/**
 * Quick Connect (docs/quick-connect.md): this TV shows a six-digit code, a signed-in app authorizes
 * it, the TV claims the sign-in. The server answers on /quickconnect/* and has it off by default.
 */
class QuickConnectClient(baseUrl: String) {
    data class Initiated(val secret: String, val code: String, val expiresInSeconds: Int)

    private val base = baseUrl.trimEnd('/')
    private val http = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
    private val json = "application/json".toMediaType()

    private suspend fun request(method: String, path: String, body: JSONObject? = null): Pair<Int, JSONObject?> = withContext(Dispatchers.IO) {
        val b = Request.Builder().url(base + path)
        if (body != null) b.method(method, body.toString().toRequestBody(json)) else b.method(method, null)
        http.newCall(b.build()).execute().use { r ->
            val text = r.body?.string().orEmpty()
            val parsed = try { JSONObject(text) } catch (_: Exception) { null }
            r.code to parsed
        }
    }

    /** Whether the server has Quick Connect switched on. */
    suspend fun enabled(): Boolean = withContext(Dispatchers.IO) {
        http.newCall(Request.Builder().url("$base/quickconnect/enabled").build()).execute().use { r ->
            r.isSuccessful && r.body?.string()?.trim() == "true"
        }
    }

    suspend fun initiate(deviceId: String, name: String): Initiated {
        val (status, o) = request(
            "POST", "/quickconnect/initiate",
            JSONObject().put("deviceId", deviceId).put("name", name).put("app", "Icosahedron TV").put("kind", "tv"),
        )
        if (status == 403) throw IOException("Quick Connect is not switched on on this server (QUICK_CONNECT=true).")
        if (status == 429) throw IOException("Too many attempts, wait a minute.")
        if (status != 200 || o == null) throw IOException("The server answered HTTP $status")
        return Initiated(o.getString("secret"), o.getString("code"), o.optInt("expiresIn", 600))
    }

    /** true once a signed-in app authorized the code; false while waiting; null when it is unknown or expired. */
    suspend fun authenticated(secret: String): Boolean? {
        val (status, o) = request("GET", "/quickconnect/connect?secret=$secret")
        if (status == 404) return null
        if (status != 200 || o == null) throw IOException("The server answered HTTP $status")
        return o.optBoolean("authenticated", false)
    }

    /** Takes the sign-in the app authorized (works once). */
    suspend fun claim(secret: String): Session {
        val (status, o) = request("POST", "/quickconnect/claim", JSONObject().put("secret", secret))
        if (status != 200 || o == null) throw IOException("The sign-in was not authorized")
        return Session(base, o.getString("u"), o.getString("s"), o.getString("t"))
    }
}

/** A server that answered the LAN broadcast. */
data class FoundServer(val address: String, val id: String, val name: String)

/** LAN discovery: broadcasts "who is Icosahedron?" to UDP 7360, the way Jellyfin finds its servers. */
object Discovery {
    private const val PORT = 7360

    suspend fun find(timeoutMs: Long = 1800): List<FoundServer> = withContext(Dispatchers.IO) {
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
}
