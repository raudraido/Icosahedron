package cloud.icosahedron.phone.data

import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Another device asking to be let in: what the approving phone shows. Three numbers, one is right. */
data class Pending(val id: String, val deviceName: String, val address: String, val at: Long, val expiresAt: Long, val choices: List<Int>) {
    companion object {
        fun fromJson(o: JSONObject): Pending? {
            val id = o.str("id") ?: return null
            val ch = o.optJSONArray("choices") ?: JSONArray()
            return Pending(
                id, o.optJSONObject("device")?.str("name") ?: "Device", o.str("address") ?: "",
                o.optLong("at"), o.optLong("expiresAt"), (0 until ch.length()).map { ch.optInt(it) },
            )
        }
    }
}

data class TrustedDevice(val id: String, val name: String, val kind: String, val lastSeen: Long, val address: String, val appPassword: Boolean)

/** Secure sign-in, the phone side (docs/secure-sign-in.md): the engine's `/device` API. */
object SecureSignIn {
    enum class Failure { WRONG, NO_TRUSTED_DEVICE, RATE, BUSY, OFFLINE, NOT_REQUIRED, ERROR }

    sealed interface Started {
        data class Ok(val id: String, val secret: String, val number: Int, val expiresIn: Int) : Started
        data class Failed(val why: Failure) : Started
    }

    sealed interface Poll {
        data object Pending : Poll
        data object Denied : Poll
        data object Expired : Poll
        data object Gone : Poll
        data class Approved(val session: Session) : Poll
    }

    private val http = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
    private val json = "application/json".toMediaType()

    /** What the engine is told about this phone, shown on the other device's prompt. */
    fun deviceInfo(): JSONObject = JSONObject()
        .put("name", "Icosahedron on ${Build.MODEL}").put("kind", "android").put("app", "Icosahedron Android")

    private suspend fun send(method: String, base: String, path: String, body: JSONObject? = null): Pair<Int, JSONObject?> = withContext(Dispatchers.IO) {
        try {
            val b = Request.Builder().url(base.trimEnd('/') + path)
            b.method(method, body?.toString()?.toRequestBody(json))
            http.newCall(b.build()).execute().use { r ->
                r.code to (try { JSONObject(r.body?.string().orEmpty()) } catch (_: Exception) { null })
            }
        } catch (_: Exception) { 0 to null }
    }

    /** Whether [base] is an engine, and whether it asks for approval. A plain Navidrome answers 404. */
    suspend fun probe(base: String): Pair<Boolean, Boolean> {
        val (status, j) = send("GET", base, "/device/info")
        val secure = j?.takeIf { it.has("secure") }?.optBoolean("secure") ?: return false to false
        return (status == 200) to secure
    }

    suspend fun request(base: String, user: String, password: String): Started {
        val (status, j) = send("POST", base, "/device/request", JSONObject().put("user", user).put("password", password).put("device", deviceInfo()))
        return when (status) {
            200 -> {
                val id = j?.str("id"); val secret = j?.str("secret"); val number = j?.int("number")
                if (id == null || secret == null || number == null) Started.Failed(Failure.ERROR)
                else Started.Ok(id, secret, number, j.int("expiresIn") ?: 300)
            }
            0 -> Started.Failed(Failure.OFFLINE)
            401 -> Started.Failed(Failure.WRONG)
            409 -> Started.Failed(if (j?.str("error") == "no_trusted_device") Failure.NO_TRUSTED_DEVICE else Failure.NOT_REQUIRED)
            429 -> Started.Failed(if (j?.str("error")?.contains("open") == true) Failure.BUSY else Failure.RATE)
            else -> Started.Failed(Failure.ERROR)
        }
    }

    private fun sessionOf(base: String, j: JSONObject, fallbackUser: String): Session? {
        val cred = j.optJSONObject("cred")
        val u = cred?.str("u") ?: fallbackUser
        val s = cred?.str("s") ?: return null
        val t = cred.str("t") ?: return null
        return Session(base.trimEnd('/'), u, s, t)
    }

    suspend fun poll(base: String, id: String, secret: String): Poll {
        val (status, j) = send("GET", base, "/device/poll?id=$id&secret=$secret")
        if (status == 404) return Poll.Gone
        if (j == null) return Poll.Pending // a hiccup: keep asking until it expires
        return when (j.optString("state")) {
            "approved" -> sessionOf(base, j, "")?.let { Poll.Approved(it) } ?: Poll.Gone
            "denied" -> Poll.Denied
            "expired" -> Poll.Expired
            else -> Poll.Pending
        }
    }

    /** A recovery code, or an invite from the administrator, instead of an approval. */
    suspend fun signIn(code: String, base: String, user: String, password: String): Pair<Session?, Failure?> {
        for (path in listOf("/device/recover", "/device/redeem")) {
            val (status, j) = send("POST", base, path, JSONObject().put("user", user).put("password", password).put("code", code).put("device", deviceInfo()))
            if (status == 200 && j != null) return (sessionOf(base, j, user) to null)
            if (status == 0) return null to Failure.OFFLINE
            if (status == 429) return null to Failure.RATE
            if (status != 401) return null to Failure.ERROR
        }
        return null to Failure.WRONG
    }

    // ── Signed in ──
    suspend fun pending(c: SubsonicClient): List<Pending> {
        val (st, body) = c.engine("GET", "/device/pending")
        if (st != 200) return emptyList()
        return try { val a = JSONArray(body); (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let(Pending::fromJson) } } catch (_: Exception) { emptyList() }
    }

    /** "approved", "denied", "wrong", "expired", "unknown" or "offline". */
    suspend fun decide(c: SubsonicClient, id: String, approve: Boolean, number: Int?): String {
        val b = JSONObject().put("id", id).put("approve", approve)
        if (number != null) b.put("number", number)
        val (st, body) = c.engine("POST", "/device/decide", b)
        if (st == 0) return "offline"
        return try { JSONObject(body).optString("result", "unknown") } catch (_: Exception) { "unknown" }
    }

    suspend fun isOn(c: SubsonicClient): Boolean {
        val (st, body) = c.engine("GET", "/device/info")
        return st == 200 && try { JSONObject(body).optBoolean("secure") } catch (_: Exception) { false }
    }

    suspend fun devices(c: SubsonicClient): Pair<List<TrustedDevice>, String?>? {
        val (st, body) = c.engine("GET", "/device/list")
        if (st != 200) return null
        return try {
            val j = JSONObject(body)
            val a = j.optJSONArray("devices") ?: JSONArray()
            (0 until a.length()).mapNotNull { a.optJSONObject(it) }.mapNotNull { d ->
                val id = d.str("id") ?: return@mapNotNull null
                TrustedDevice(id, d.str("name") ?: "Device", d.str("kind") ?: "web", d.optLong("lastSeen"), d.str("lastAddress") ?: "", d.optBoolean("appPassword"))
            } to j.str("current")
        } catch (_: Exception) { null }
    }

    sealed interface TurnOn {
        data class On(val session: Session, val recoveryCodes: List<String>) : TurnOn
        data class Failed(val message: String) : TurnOn
    }

    /** Switches it on (an administrator). This phone becomes the first trusted device and signs in again with the secret it gets. */
    suspend fun turnOn(c: SubsonicClient): TurnOn {
        val (st, body) = c.engine("PUT", "/device/secure", JSONObject().put("enabled", true).put("device", deviceInfo()))
        val j = try { JSONObject(body) } catch (_: Exception) { null }
        return when (st) {
            200 -> {
                val s = j?.let { sessionOf(c.baseUrl, it, c.user) }
                val codes = j?.optJSONArray("recoveryCodes")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
                if (s == null) TurnOn.Failed("Something went wrong.") else TurnOn.On(s, codes)
            }
            0 -> TurnOn.Failed("Could not reach the server.")
            403 -> TurnOn.Failed("Only a server administrator can switch this on.")
            412 -> TurnOn.Failed("Navidrome does not accept the sync server yet, so nobody could sign in. Add ExtAuth.TrustedSources (ND_EXTAUTH_TRUSTEDSOURCES) with the sync server's address to Navidrome first (docs/deploy-server.md, Secure sign-in).")
            409 -> TurnOn.Failed("It is already on.")
            else -> TurnOn.Failed("Something went wrong.")
        }
    }

    suspend fun turnOff(c: SubsonicClient): Boolean = c.engine("PUT", "/device/secure", JSONObject().put("enabled", false)).first == 200

    suspend fun newRecoveryCodes(c: SubsonicClient): List<String>? {
        val (st, body) = c.engine("POST", "/device/recovery-codes", JSONObject())
        if (st != 200) return null
        return try { JSONObject(body).optJSONArray("recoveryCodes")?.let { a -> (0 until a.length()).map { a.optString(it) } } } catch (_: Exception) { null }
    }

    /** A device secret for a third-party app (shown once). */
    suspend fun appPassword(c: SubsonicClient, name: String): String? {
        val (st, body) = c.engine("POST", "/device/app-password", JSONObject().put("name", name))
        if (st != 200) return null
        return try { JSONObject(body).str("secret") } catch (_: Exception) { null }
    }

    suspend fun remove(c: SubsonicClient, id: String): Boolean = c.engine("DELETE", "/device/$id").first == 204
}
