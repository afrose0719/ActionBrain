package app.actionbrain.android

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Milestone 30: the durable, encrypted offline queue (review rounds 6-7: "a captured message must never disappear because upload failed").
 *
 *  1. A captured message is written here FIRST (encrypted with a Keystore key), with its own event id.
 *  2. Then it is sent. It is deleted only when the server confirms it (stored, duplicate, ignored) or refuses it for good.
 *  3. No network or a server error: Android's JobScheduler retries later with backoff, when there is a network. Survives app restarts;
 *     a periodic job (AutoProcess) and the next capture also restart it after a reboot.
 *  4. The same event id is sent on every retry, so the server stores each message once (Milestone 28).
 *  5. Bounded: at most MAX_ROWS messages, none older than MAX_AGE. Anything dropped is counted and shown in Settings, never silent.
 *  6. Disconnecting the phone (or "Clear waiting messages") deletes the queue.
 * Uses only Android's own SQLite and JobScheduler: no libraries.
 */
object OutboxPolicy {
    const val MAX_ROWS = 500
    const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000
    const val BATCH = 25

    enum class Action { DELETE_SENT, DELETE_REFUSED, KEEP_AND_STOP, KEEP_AND_RETRY }

    /**
     * What to do with a queued message after one send attempt (review round 8, RFC 9110 status meanings):
     * 2xx (stored, duplicate, ignored) -> delete. No answer, 408 timeout, 429, 5xx -> keep and retry later.
     * 401/403 (token or access problem) -> keep and pause until the phone is reconnected. Other 4xx (400, 413, 415, 422: the message
     * itself is unacceptable) -> delete, counted as failed and shown in Settings, so one bad message never blocks the rest.
     */
    fun decide(code: Int?): Action = when {
        code == null -> Action.KEEP_AND_RETRY
        code in 200..299 -> Action.DELETE_SENT
        code == 401 || code == 403 -> Action.KEEP_AND_STOP
        code == 408 || code == 429 || code >= 500 -> Action.KEEP_AND_RETRY
        else -> Action.DELETE_REFUSED
    }

    /** How many of the oldest rows must go before one more fits. */
    fun overflow(count: Int): Int = if (count >= MAX_ROWS) count - MAX_ROWS + 1 else 0

    fun expired(createdAt: Long, now: Long): Boolean = now - createdAt > MAX_AGE_MS

    fun newEventId(): String = UUID.randomUUID().toString()
}

class OutboxDb(context: Context) : SQLiteOpenHelper(context.applicationContext, "outbox.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("create table outbox (id integer primary key autoincrement, event_id text not null unique, payload text not null, created_at integer not null)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
}

object Outbox {
    private val vault = Vault("actionbrain_outbox_key")
    private val executor = Executors.newSingleThreadExecutor()
    private val lock = Any()
    private const val JOB_RETRY = 7103

    data class Row(val id: Long, val eventId: String, val payload: String)

    /** Save first, then try to send at once (off the main thread). */
    fun add(context: Context, json: String) {
        val app = context.applicationContext
        executor.execute {
            synchronized(lock) { insert(app, json) }
            drain(app)
        }
    }

    fun count(context: Context): Int = synchronized(lock) {
        OutboxDb(context).readableDatabase.use { db -> db.rawQuery("select count(*) from outbox", null).use { c -> if (c.moveToFirst()) c.getInt(0) else 0 } }
    }

    fun clear(context: Context) = synchronized(lock) { OutboxDb(context).writableDatabase.use { it.delete("outbox", null, null) } }

    /** Called by the retry job and after a capture. Returns true when something must be retried later. */
    fun drain(context: Context): Boolean {
        val app = context.applicationContext
        val config = TokenStore(app).load() ?: return false // not connected: keep everything
        val stats = Stats(app)
        var sentAny = false
        synchronized(lock) {
            while (true) {
                val batch = oldest(app)
                if (batch.isEmpty()) break
                for (row in batch) {
                    val json = runCatching { vault.decrypt(row.payload) }.getOrNull()
                    if (json == null) { delete(app, row.id); stats.drop(1); continue } // unreadable (key reset): cannot be sent
                    val result = IntakeClient.post(config, json, row.eventId)
                    when (OutboxPolicy.decide(result.code)) {
                        OutboxPolicy.Action.DELETE_SENT -> { delete(app, row.id); stats.ok(result.status); sentAny = true }
                        OutboxPolicy.Action.DELETE_REFUSED -> { delete(app, row.id); stats.fail(result.status) }
                        OutboxPolicy.Action.KEEP_AND_STOP -> { stats.fail(result.status); return false }
                        OutboxPolicy.Action.KEEP_AND_RETRY -> { stats.fail(result.status); scheduleRetry(app); return true }
                    }
                }
            }
        }
        if (sentAny) AutoProcess.onCaptured(app)
        return false
    }

    fun scheduleRetry(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        if (scheduler.getPendingJob(JOB_RETRY) != null) return
        scheduler.schedule(
            JobInfo.Builder(JOB_RETRY, ComponentName(context, OutboxJob::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                .build()
        )
    }

    private fun insert(context: Context, json: String) {
        OutboxDb(context).writableDatabase.use { db ->
            db.beginTransaction() // prune + insert as one step: a crash never leaves half a change (review round 8)
            try {
                val now = System.currentTimeMillis()
                // remove what is too old, then make room
                db.delete("outbox", "created_at < ?", arrayOf((now - OutboxPolicy.MAX_AGE_MS).toString())).let { if (it > 0) Stats(context).drop(it) }
                val count = db.rawQuery("select count(*) from outbox", null).use { c -> if (c.moveToFirst()) c.getInt(0) else 0 }
                val extra = OutboxPolicy.overflow(count)
                if (extra > 0) {
                    db.execSQL("delete from outbox where id in (select id from outbox order by id limit $extra)")
                    Stats(context).drop(extra)
                }
                db.insert("outbox", null, ContentValues().apply {
                    put("event_id", OutboxPolicy.newEventId())
                    put("payload", vault.encrypt(json))
                    put("created_at", now)
                })
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
        }
    }

    /** Opening the app or reconnecting the phone: send anything waiting now (Samsung battery saving can delay the retry job). */
    fun flushSoon(context: Context) {
        val app = context.applicationContext
        executor.execute { if (count(app) > 0) drain(app) }
    }

    private fun oldest(context: Context): List<Row> =
        OutboxDb(context).readableDatabase.use { db ->
            db.rawQuery("select id, event_id, payload from outbox order by id limit ${OutboxPolicy.BATCH}", null).use { c ->
                buildList { while (c.moveToNext()) add(Row(c.getLong(0), c.getString(1), c.getString(2))) }
            }
        }

    private fun delete(context: Context, id: Long) {
        OutboxDb(context).writableDatabase.use { it.delete("outbox", "id = ?", arrayOf(id.toString())) }
    }
}

/** Retries the queue when Android says there is a network. Returning "reschedule" uses the exponential backoff above. */
class OutboxJob : JobService() {
    private val executor = Executors.newSingleThreadExecutor()

    override fun onStartJob(params: JobParameters): Boolean {
        executor.execute {
            val again = runCatching { Outbox.drain(this) }.getOrDefault(true)
            jobFinished(params, again)
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true
}
