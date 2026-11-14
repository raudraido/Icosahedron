package cloud.icosahedron.phone.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import cloud.icosahedron.phone.App
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keeps one secret (the account's password, only when the sort and filter pages need it) encrypted with a key that lives in
 * the Android Keystore: the key never leaves the chip, and the text in the preferences is useless without it.
 */
object SecretStore {
    private const val ALIAS = "icosahedron_secrets"
    private val prefs get() = App.instance.getSharedPreferences("secrets", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build(),
        )
        return gen.generateKey()
    }

    fun put(id: String, secret: String) {
        try {
            val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            val ct = c.doFinal(secret.toByteArray(Charsets.UTF_8))
            prefs.edit().putString(id, Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)).apply()
        } catch (_: Exception) { }
    }

    fun get(id: String): String? {
        val v = prefs.getString(id, null) ?: return null
        return try {
            val (iv, ct) = v.split(":").let { Base64.decode(it[0], Base64.NO_WRAP) to Base64.decode(it[1], Base64.NO_WRAP) }
            val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv)) }
            String(c.doFinal(ct), Charsets.UTF_8)
        } catch (_: Exception) { null }
    }

    fun remove(id: String) { prefs.edit().remove(id).apply() }
    fun clear() { prefs.edit().clear().apply() }
}
