package cloud.icosahedron.phone.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import cloud.icosahedron.phone.App
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * The account's profile picture. The sync server keeps it (GET/PUT/DELETE /avatar), so every device shows the same
 * one; the phone keeps a copy to show at launch and offline. Without a picture the first letter of the user name shows.
 */
object Avatar {
    var image by mutableStateOf<Bitmap?>(null)
        private set
    private var etag: String? = null
    private var user = ""

    private fun file(): File? = if (user.isEmpty()) null else File(App.instance.cacheDir, "avatar-$user.img")
    private val prefs get() = App.instance.getSharedPreferences("avatar", Context.MODE_PRIVATE)

    /** Shows the kept copy at once, then asks the server whether the picture changed. */
    suspend fun refresh(c: SubsonicClient) {
        if (user != c.user) {
            user = c.user
            image = file()?.takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.path) }
            etag = if (image == null) null else prefs.getString("etag-$user", null)
        }
        val r = c.engineRaw("GET", "/avatar", etag = if (image == null) null else etag)
        when (r.status) {
            200 -> BitmapFactory.decodeByteArray(r.bytes, 0, r.bytes.size)?.let { image = it; etag = r.etag; store(r.bytes) }
            404 -> { image = null; etag = null; store(null) }
            else -> {} // 304: unchanged; others (old server, offline): keep what is shown
        }
    }

    /** Crops to a square, shrinks to 256 px and uploads. Returns an error text, or null when it worked. */
    suspend fun set(context: Context, uri: Uri, c: SubsonicClient): String? {
        val jpeg = try { square(context, uri) } catch (_: Exception) { null } ?: return "That picture could not be used"
        val r = c.engineRaw("PUT", "/avatar", jpeg, "image/jpeg")
        if (r.status != 204) return if (r.status == 404) "The sync server needs updating (0.16.2 or newer)" else if (r.status == 0) "Could not reach the server" else "The server did not accept the picture"
        user = c.user; etag = null
        image = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size)
        store(jpeg)
        refresh(c)
        return null
    }

    suspend fun remove(c: SubsonicClient) { c.engineRaw("DELETE", "/avatar"); image = null; etag = null; store(null) }

    /** Forgets the picture (signing out). */
    fun clear() { store(null); image = null; etag = null; user = "" }

    private fun store(data: ByteArray?) {
        val f = file() ?: return
        try { if (data != null) f.writeBytes(data) else f.delete() } catch (_: Exception) { }
        prefs.edit().apply { if (etag != null) putString("etag-$user", etag) else remove("etag-$user") }.apply()
    }

    private fun square(context: Context, uri: Uri, side: Int = 256): ByteArray? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= side && bounds.outHeight / (sample * 2) >= side) sample *= 2
        val src = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: return null
        val s = minOf(src.width, src.height)
        val cropped = Bitmap.createBitmap(src, (src.width - s) / 2, (src.height - s) / 2, s, s)
        val out = Bitmap.createScaledBitmap(cropped, side, side, true)
        return ByteArrayOutputStream().also { out.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
    }
}
