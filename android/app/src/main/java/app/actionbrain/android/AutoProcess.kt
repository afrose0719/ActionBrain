package app.actionbrain.android

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Zero-touch (Milestone 29): asks the server to analyse conversations that have gone quiet. Uses Android's own JobScheduler
 * (no library), so Android decides the exact moment, waits for a network, and respects Doze and battery saving.
 *
 *  - After a message is captured: one job in about 10 minutes. If a job is already scheduled, nothing changes (a running job is never
 *    cancelled by a new message; review round 5).
 *  - When the server says more conversations are still inside their quiet period, the job schedules itself once more.
 *  - A slow periodic job (every 6 hours) catches anything left behind.
 *  - The server answers "off" while "Analyse automatically" is off; then the phone stays quiet for an hour.
 * It sends only the phone token and reads back only counts. It never asks to ignore battery optimisation.
 */
object AutoProcess {
    private const val JOB_SOON = 7101
    private const val JOB_PERIODIC = 7102
    private const val DELAY_MS = 10 * 60 * 1000L
    private const val PERIOD_MS = 6 * 60 * 60 * 1000L
    private const val OFF_PAUSE_MS = 60 * 60 * 1000L

    fun onCaptured(context: Context) {
        val prefs = context.applicationContext.getSharedPreferences("auto", Context.MODE_PRIVATE)
        if (System.currentTimeMillis() < prefs.getLong("offUntil", 0)) return
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        if (scheduler.getPendingJob(JOB_SOON) != null) return
        scheduleSoon(context, scheduler)
    }

    fun ensurePeriodic(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        if (scheduler.getPendingJob(JOB_PERIODIC) != null) return
        scheduler.schedule(
            JobInfo.Builder(JOB_PERIODIC, ComponentName(context, AutoProcessJob::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(PERIOD_MS)
                .build()
        )
    }

    /** The settings page switched something: forget a remembered "off" so the next message is processed. */
    fun forgetOff(context: Context) =
        context.applicationContext.getSharedPreferences("auto", Context.MODE_PRIVATE).edit().remove("offUntil").apply()

    internal fun scheduleSoon(context: Context, scheduler: JobScheduler) {
        scheduler.schedule(
            JobInfo.Builder(JOB_SOON, ComponentName(context, AutoProcessJob::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setMinimumLatency(DELAY_MS)
                .build()
        )
    }

    internal fun rememberOff(context: Context) =
        context.applicationContext.getSharedPreferences("auto", Context.MODE_PRIVATE).edit()
            .putLong("offUntil", System.currentTimeMillis() + OFF_PAUSE_MS).apply()

    /** "https://site/api/intake" -> "https://site/api/intake/process". Anything else -> null (never call an unexpected address). */
    fun processAddress(intakeAddress: String): String? =
        if (intakeAddress.startsWith("https://") && intakeAddress.endsWith("/api/intake")) "$intakeAddress/process" else null

    data class Result(val status: String, val waiting: Int)

    private val statusRe = Regex("\"status\"\\s*:\\s*\"([a-z_]+)\"")
    private val waitingRe = Regex("\"waiting\"\\s*:\\s*(\\d+)")

    /** Reads only the two fields the phone needs from the server's answer. */
    fun parse(body: String): Result =
        Result(statusRe.find(body)?.groupValues?.get(1) ?: "unknown", waitingRe.find(body)?.groupValues?.get(1)?.toIntOrNull() ?: 0)
}

class AutoProcessJob : JobService() {
    private val executor = Executors.newSingleThreadExecutor()

    override fun onStartJob(params: JobParameters): Boolean {
        val config = TokenStore(this).load() ?: return false
        val address = AutoProcess.processAddress(config.address) ?: return false
        executor.execute {
            val result = call(address, config.token)
            jobFinished(params, result == null) // no answer (network): let Android retry later
            if (result != null) {
                if (result.status == "off") AutoProcess.rememberOff(this)
                else if (result.waiting > 0) getSystemService(JobScheduler::class.java)?.let { AutoProcess.scheduleSoon(this, it) }
            }
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true

    private fun call(address: String, token: String): AutoProcess.Result? {
        val connection = URL(address).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 70_000 // the server may analyse a few conversations
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.outputStream.use { it.write(ByteArray(0)) }
            val code = connection.responseCode
            val body = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code >= 500 && !body.contains("not_configured")) null else AutoProcess.parse(body)
        } catch (e: IOException) {
            null
        } finally {
            connection.disconnect()
        }
    }
}
