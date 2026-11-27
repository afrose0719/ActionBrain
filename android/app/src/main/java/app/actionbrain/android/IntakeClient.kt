package app.actionbrain.android

import android.content.Context
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Counters shown in the website's Settings so you can see it working. Plain numbers and a short status, nothing private. */
class Stats(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("stats", Context.MODE_PRIVATE)
    val sent: Int get() = prefs.getInt("sent", 0)
    val failed: Int get() = prefs.getInt("failed", 0)
    val lastAt: Long get() = prefs.getLong("lastAt", 0)
    val lastResult: String get() = prefs.getString("lastResult", "") ?: ""

    @Synchronized
    fun ok(result: String) = prefs.edit().putInt("sent", sent + 1).putLong("lastAt", System.currentTimeMillis()).putString("lastResult", result).apply()

    @Synchronized
    fun fail(reason: String) = prefs.edit().putInt("failed", failed + 1).putLong("lastAt", System.currentTimeMillis()).putString("lastResult", reason).apply()

    /** Messages the queue had to drop (full, older than 7 days, or unreadable). Shown in Settings so a loss is never silent. */
    val dropped: Int get() = prefs.getInt("dropped", 0)

    @Synchronized
    fun drop(n: Int) = prefs.edit().putInt("dropped", dropped + n).apply()
}

/**
 * Sends captured messages to ActionBrain. Since Milestone 30 every message goes through the encrypted offline queue (Outbox) first,
 * so nothing is lost when there is no network; the queue calls post() and deletes a message only once the server has answered.
 */
object IntakeClient {
    private val status = Regex("\"status\"\\s*:\\s*\"([a-z]+)\"")

    /** The server's answer: HTTP code (null = no answer, network) and a short status for Settings. */
    data class Result(val code: Int?, val status: String)

    fun send(context: Context, @Suppress("UNUSED_PARAMETER") config: TokenStore.Config, json: String) = Outbox.add(context, json)

    fun post(config: TokenStore.Config, json: String, eventId: String): Result {
        if (!config.address.startsWith("https://")) return Result(400, "address is not https")
        val connection = URL(config.address).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 10_000
            connection.readTimeout = 15_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Authorization", "Bearer ${config.token}")
            connection.setRequestProperty("x-actionbrain-event-id", eventId) // the same id on every retry: stored once (Milestone 28)
            connection.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val body = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            Result(code, when {
                code in 200..299 -> status.find(body)?.groupValues?.get(1) ?: "ok"
                code == 401 -> "token rejected: create a new one in Settings"
                code == 429 || code >= 500 -> "server error $code: will retry"
                else -> "refused ($code)"
            })
        } catch (e: IOException) {
            Result(null, "no network: waiting to send")
        } finally {
            connection.disconnect()
        }
    }
}
