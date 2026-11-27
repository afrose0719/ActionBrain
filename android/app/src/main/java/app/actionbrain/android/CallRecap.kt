package app.actionbrain.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

/**
 * Milestone 32: after-call voice recap (docs/reviews/whatsapp-calls.md). No app can record the other side of a WhatsApp or Teams call
 * on Android, so instead: when an ANSWERED call ends, ActionBrain asks "Call with Priya ended (4 min). Anything to remember?". One tap
 * opens the recorder, the user says what was agreed in a few seconds, it is transcribed on the phone and turned into tasks.
 * Nothing of the call itself is recorded. Opt-in (off by default).
 *
 * How a call is recognised: while a call is ANSWERED, the chat app shows an ongoing "call" notification with a running timer.
 * Ringing, missed and declined calls have no running timer, so they never produce a recap. Calls shorter than [MIN_SECONDS] are ignored.
 * Pure logic (no Android types) so unit tests cover it.
 */
class CallTracker(private val minSeconds: Int = MIN_SECONDS) {
    data class Recap(val app: String, val caller: String, val seconds: Int)

    private data class Active(val app: String, val caller: String, val startedAt: Long)
    private val active = HashMap<String, Active>()

    /** A notification was posted or updated. Only an ongoing call notification with a running timer counts as an answered call. */
    @Synchronized
    fun onPosted(key: String, app: String, isCall: Boolean, ongoing: Boolean, showsTimer: Boolean, caller: String?, startedAt: Long, now: Long) {
        if (!isCall || !ongoing || !showsTimer) return
        val name = cleanCaller(caller) ?: return
        val start = if (startedAt in 1..now) startedAt else now
        val known = active[key]
        if (known == null || known.caller != name) active[key] = Active(app, name, known?.startedAt ?: start)
    }

    /** A notification went away. If it was an answered call long enough to matter, returns the recap to offer. */
    @Synchronized
    fun onRemoved(key: String, now: Long): Recap? {
        val call = active.remove(key) ?: return null
        val seconds = ((now - call.startedAt) / 1000).toInt()
        return if (seconds >= minSeconds) Recap(call.app, call.caller, seconds) else null
    }

    companion object {
        const val MIN_SECONDS = 20

        /** The caller's display name, or null when the notification shows no usable name. Never a phone-number-only string. */
        fun cleanCaller(raw: String?): String? {
            val name = raw?.trim()?.take(80)?.takeIf { it.isNotEmpty() } ?: return null
            val generic = setOf("ongoing voice call", "ongoing video call", "whatsapp", "microsoft teams", "teams", "call")
            if (name.lowercase() in generic) return null
            return name
        }

        /** "4 min", or "45 s" for a short call. */
        fun duration(seconds: Int): String = if (seconds < 60) "$seconds s" else "${(seconds + 30) / 60} min"

        /** The page the recap opens: the Meetings recorder, set up for this call. Only the name and minutes travel, as URL parameters. */
        fun recapUrl(appUrl: String, recap: Recap): String {
            fun enc(v: String) = java.net.URLEncoder.encode(v, "UTF-8").replace("+", "%20")
            val mins = ((recap.seconds + 30) / 60).coerceAtLeast(1)
            return appUrl.trimEnd('/') + "/meetings?recap=" + enc(recap.caller) + "&via=" + enc(recap.app) + "&mins=" + mins
        }
    }
}

/** The recap notification opens the app with this action; the page address travels as an extra and is checked before use. */
object RecapIntent {
    const val ACTION = "app.actionbrain.android.RECAP"
    const val EXTRA_URL = "recap_url"

    /** Only our own site's /meetings recap page is accepted: the main screen can be opened by other apps, so never trust the extra. */
    fun safeUrl(appUrl: String, candidate: String?): String? {
        if (candidate == null) return null
        val prefix = appUrl.trimEnd('/') + "/meetings?recap="
        return if (candidate.startsWith(prefix) && candidate.length < 400 && !candidate.contains('#')) candidate else null
    }
}

object CallRecapNotifier {
    private const val CHANNEL = "call_recap"

    fun show(context: Context, app: ChatApp, recap: CallTracker.Recap) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (android.os.Build.VERSION.SDK_INT >= 33 && !manager.areNotificationsEnabled()) return // the user has not allowed notifications
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.recap_channel), NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = context.getString(R.string.recap_channel_description)
            }
        )
        val open = Intent(context, MainActivity::class.java)
            .setAction(RecapIntent.ACTION)
            .putExtra(RecapIntent.EXTRA_URL, CallTracker.recapUrl(BuildConfig.APP_URL, recap))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val tap = PendingIntent.getActivity(context, recap.caller.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_tile)
            .setContentTitle(context.getString(R.string.recap_title, app.label, recap.caller, CallTracker.duration(recap.seconds)))
            .setContentText(context.getString(R.string.recap_text))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setTimeoutAfter(60L * 60 * 1000) // an hour later the moment has passed
            .build()
        runCatching { manager.notify(recap.caller.hashCode(), notification) }
    }
}
