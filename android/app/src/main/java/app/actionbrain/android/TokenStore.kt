package app.actionbrain.android

import android.content.Context

/** Where the app keeps the private intake token. Encrypted with a key that lives in Android's hardware-backed Keystore and never leaves it. */
class TokenStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("intake", Context.MODE_PRIVATE)
    private val vault = Vault("actionbrain_intake_key") // same key and format as before Milestone 30, so saved tokens still open

    data class Config(val address: String, val token: String)

    fun save(address: String, token: String) {
        prefs.edit().putString("address", address).putString("token", vault.encrypt(token)).apply()
    }

    fun load(): Config? {
        val address = prefs.getString("address", null) ?: return null
        val token = prefs.getString("token", null)?.let { runCatching { vault.decrypt(it) }.getOrNull() } ?: return null
        return Config(address, token)
    }

    fun clear() {
        prefs.edit().remove("address").remove("token").apply()
    }
}
