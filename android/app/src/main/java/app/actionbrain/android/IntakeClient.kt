package app.actionbrain.android

import android.content.Context
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

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
}

/** Sends one message to ActionBrain, off the main thread, retrying a couple of times if the network or server hiccups. */
object IntakeClient {
    private val executor = Executors.newSingleThreadExecutor()
    private val waitsMs = longArrayOf(0, 2_000, 10_000)
    private val status = Regex("\"status\"\\s*:\\s*\"([a-z]+)\"")

    private sealed interface Outcome {
        data class Done(val result: String) : Outcome
        data class Rejected(val reason: String) : Outcome // retrying cannot help (bad token, bad request)
        data class Retry(val reason: String) : Outcome
    }

    fun send(context: Context, config: TokenStore.Config, json: String) {
        val app = context.applicationContext
        executor.execute {
            val stats = Stats(app)
            var last = "no answer"
            for (wait in waitsMs) {
                if (wait > 0) Thread.sleep(wait)
                when (val outcome = post(config, json)) {
                    is Outcome.Done -> return@execute stats.ok(outcome.result)
                    is Outcome.Rejected -> return@execute stats.fail(outcome.reason)
                    is Outcome.Retry -> last = outcome.reason
                }
            }
            stats.fail(last)
        }
    }

    private fun post(config: TokenStore.Config, json: String): Outcome {
        if (!config.address.startsWith("https://")) return Outcome.Rejected("address is not https")
        val connection = URL(config.address).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 10_000
            connection.readTimeout = 15_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Authorization", "Bearer ${config.token}")
            connection.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val body = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            when {
                code in 200..299 -> Outcome.Done(status.find(body)?.groupValues?.get(1) ?: "ok")
                code == 401 -> Outcome.Rejected("token rejected: create a new one in Settings")
                code == 429 || code >= 500 -> Outcome.Retry("server error $code")
                else -> Outcome.Rejected("refused ($code)")
            }
        } catch (e: IOException) {
            Outcome.Retry("network: ${e.javaClass.simpleName}")
        } finally {
            connection.disconnect()
        }
    }
}
