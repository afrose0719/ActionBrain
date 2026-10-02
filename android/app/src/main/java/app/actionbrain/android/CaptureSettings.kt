package app.actionbrain.android

import android.content.Context

/** How live chat reading behaves. The three choices a user can make in Settings. */
object CaptureMode {
    /** Never read the screen. */
    const val OFF = "off"

    /** Read an open chat by itself and send new messages. */
    const val AUTO = "auto"

    /** Read only when the floating button is tapped. */
    const val TAP = "tap"

    /** Returns the value if it is one of the three modes, else null. Anything from outside the app is checked with this. */
    fun parse(value: String?): String? = value?.takeIf { it == OFF || it == AUTO || it == TAP }
}

/**
 * What the user chose, and the rules that follow from it. Pure Kotlin, so tests can cover every combination.
 * Notifications and chat reading are independent. Pausing switches BOTH off for a while without losing the choices.
 */
data class CapturePolicy(
    val notifications: Boolean = true,
    val reading: String = CaptureMode.AUTO,
    val pausedUntil: Long = 0,
    val bubbleHiddenUntil: Long = 0,
) {
    fun paused(now: Long) = pausedUntil > now

    fun notificationsActive(now: Long) = notifications && !paused(now)

    /** The mode that is actually in force right now (paused means off). */
    fun readingMode(now: Long) = if (paused(now)) CaptureMode.OFF else reading

    fun bubbleHidden(now: Long) = bubbleHiddenUntil > now

    /** The floating button is shown only in "tap" mode, only while a WhatsApp chat is on screen, and not if hidden for today. */
    fun showBubble(now: Long, chatOpen: Boolean) = chatOpen && readingMode(now) == CaptureMode.TAP && !bubbleHidden(now)
}

/** Stores the choices on the phone (plain on/off values, nothing private). The same file is read by the services and the quick tile. */
class CaptureSettings(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("capture", Context.MODE_PRIVATE)

    fun load() = CapturePolicy(
        notifications = prefs.getBoolean("notifications", true),
        reading = CaptureMode.parse(prefs.getString("reading", null)) ?: CaptureMode.AUTO,
        pausedUntil = prefs.getLong("pausedUntil", 0),
        bubbleHiddenUntil = prefs.getLong("bubbleHiddenUntil", 0),
    )

    fun setNotifications(on: Boolean) = prefs.edit().putBoolean("notifications", on).apply()

    /** False (and nothing changes) if [mode] is not one of the three. */
    fun setReading(mode: String?): Boolean {
        val valid = CaptureMode.parse(mode) ?: return false
        prefs.edit().putString("reading", valid).apply()
        return true
    }

    /** Pause everything for [minutes] (1 to 1440). 0 resumes. */
    fun pauseFor(minutes: Int, now: Long = System.currentTimeMillis()) {
        val until = if (minutes <= 0) 0L else now + minutes.coerceAtMost(1440) * 60_000L
        prefs.edit().putLong("pausedUntil", until).apply()
    }

    fun hideBubbleUntil(time: Long) = prefs.edit().putLong("bubbleHiddenUntil", time).apply()

    fun showBubbleAgain() = hideBubbleUntil(0)
}
