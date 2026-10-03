package app.actionbrain.android

import android.app.Activity
import android.app.AlertDialog
import android.app.StatusBarManager
import android.content.ComponentName
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.widget.Toast

/**
 * What the ActionBrain website can ask this app to do, as window.ActionBrainAndroid.
 * Security: the WebView only ever shows the one website (MainActivity blocks everything else), and every method here
 * re-checks what it is given. The token goes in, encrypted, and never comes back out.
 */
class WebBridge(private val activity: Activity, private val tokens: TokenStore) {

    @JavascriptInterface
    fun isApp(): Boolean = true

    /** The website hands over the private token it just created, so you never copy and paste it. */
    @JavascriptInterface
    fun saveIntake(address: String?, token: String?): Boolean {
        if (!Payload.isIntakeAddress(address, BuildConfig.APP_URL) || !Payload.looksLikeToken(token)) return false
        tokens.save(address!!, token!!)
        return true
    }

    @JavascriptInterface
    fun clearIntake() = tokens.clear()

    /** A chat export that was shared to the app, as JSON {"name","text"} or {"error"}. "" if nothing is waiting. Reading it clears it. */
    @JavascriptInterface
    fun takeSharedFile(): String = PendingShare.take()

    /** Current state as JSON for the Settings page. Contains no token. */
    @JavascriptInterface
    fun status(): String {
        val stats = Stats(activity)
        val capture = CaptureSettings(activity).load()
        return "{\"app\":true,\"version\":" + Payload.quote(BuildConfig.VERSION_NAME) +
            ",\"configured\":" + (tokens.load() != null) +
            ",\"listening\":" + listenerEnabled() +
            ",\"screenAvailable\":" + BuildConfig.SCREEN_READING +
            ",\"screenOn\":" + (BuildConfig.SCREEN_READING && screenServiceEnabled()) +
            ",\"notificationsOn\":" + capture.notifications +
            ",\"readingMode\":" + Payload.quote(capture.reading) +
            ",\"pausedUntil\":" + capture.pausedUntil +
            ",\"bubbleHidden\":" + capture.bubbleHidden(System.currentTimeMillis()) +
            ",\"apps\":{" + ChatApps.all.joinToString(",") { "\"" + it.source + "\":" + capture.appActive(it.source) } + "}" +
            ",\"sent\":" + stats.sent + ",\"failed\":" + stats.failed + ",\"lastAt\":" + stats.lastAt +
            ",\"lastResult\":" + Payload.quote(stats.lastResult) + "}"
    }

    @JavascriptInterface
    fun openNotificationAccess() = launch(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))

    /**
     * Live chat reading. Google Play requires a prominent disclosure and an explicit "agree" BEFORE the Accessibility settings open,
     * and it must come from the app itself, not the web page, so it is shown here as a native dialog.
     */
    @JavascriptInterface
    fun openScreenReadingSettings() {
        if (!BuildConfig.SCREEN_READING) return
        activity.runOnUiThread {
            AlertDialog.Builder(activity)
                .setTitle(R.string.screen_consent_title)
                .setMessage(R.string.screen_consent_body)
                .setPositiveButton(R.string.screen_consent_agree) { _, _ -> launch(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
                .setNegativeButton(R.string.screen_consent_cancel, null)
                .show()
        }
    }

    /** Switch notification capture on or off (the Android permission itself is not touched). */
    @JavascriptInterface
    fun setNotificationsEnabled(on: Boolean) = CaptureSettings(activity).setNotifications(on)

    /**
     * Switch a chat app ("whatsapp" or "teams") on or off. Switching Teams on for the first time first shows the app's own explanation
     * (what is read, what happens to it) and only switches it on after "Agree". Returns false for an unknown app.
     */
    @JavascriptInterface
    fun setAppEnabled(source: String?, on: Boolean): Boolean {
        val app = ChatApps.forSource(source) ?: return false
        val settings = CaptureSettings(activity)
        if (on && app.source == "teams" && !settings.teamsConsented()) {
            activity.runOnUiThread {
                val body = activity.getString(R.string.teams_consent_notifications) +
                    if (BuildConfig.SCREEN_READING) "\n\n" + activity.getString(R.string.teams_consent_screen) else ""
                AlertDialog.Builder(activity)
                    .setTitle(R.string.teams_consent_title)
                    .setMessage(body + "\n\n" + activity.getString(R.string.teams_consent_common))
                    .setPositiveButton(R.string.screen_consent_agree) { _, _ ->
                        settings.setTeamsConsented()
                        settings.setApp("teams", true)
                    }
                    .setNegativeButton(R.string.screen_consent_cancel, null)
                    .show()
            }
            return true // the choice is asked for; the status shows the result
        }
        return settings.setApp(app.source, on)
    }

    /** The shape of the latest notification from each app, with no message text. For fixing problems. */
    @JavascriptInterface
    fun notificationStructure(): String =
        ScreenStatus.lastNotification.entries.sortedBy { it.key }.joinToString("\n\n") { "[" + it.key + "]\n" + it.value }

    /** "off", "auto" or "tap". Anything else is refused and returns false. */
    @JavascriptInterface
    fun setReadingMode(mode: String?): Boolean = CaptureSettings(activity).setReading(mode)

    /** Pause all capture for this many minutes (1 to 1440). 0 resumes. */
    @JavascriptInterface
    fun pauseCapture(minutes: Int) = CaptureSettings(activity).pauseFor(minutes)

    /** Bring the floating button back after it was hidden for the day. */
    @JavascriptInterface
    fun showBubbleAgain() = CaptureSettings(activity).showBubbleAgain()

    /** Android 13+ asks "Add tile?" right away; older versions get a short how-to. */
    @JavascriptInterface
    fun addQuickSettingsTile() {
        activity.runOnUiThread {
            if (Build.VERSION.SDK_INT >= 33) {
                val manager = activity.getSystemService(StatusBarManager::class.java)
                manager.requestAddTileService(
                    ComponentName(activity, CaptureTileService::class.java),
                    activity.getString(R.string.tile_label),
                    Icon.createWithResource(activity, R.drawable.ic_tile),
                    activity.mainExecutor,
                ) { }
            } else {
                Toast.makeText(activity, R.string.tile_howto, Toast.LENGTH_LONG).show()
            }
        }
    }

    /** What the reading service sees, as structure only (names, positions, text LENGTHS, never any message text). For fixing problems. */
    @JavascriptInterface
    fun screenStructure(): String = ScreenStatus.lastStructure

    /** Phones that "optimise" battery may stop the listener. This opens the list where you can exempt ActionBrain. */
    @JavascriptInterface
    fun openBatterySettings() = launch(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))

    /** Android 13+ blocks sensitive access for apps installed from a file until you allow it here. */
    @JavascriptInterface
    fun openAppInfo() = launch(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.packageName)))

    private fun screenServiceEnabled(): Boolean =
        Settings.Secure.getString(activity.contentResolver, "enabled_accessibility_services")?.contains(activity.packageName + "/") == true

    private fun listenerEnabled(): Boolean =
        Settings.Secure.getString(activity.contentResolver, "enabled_notification_listeners")?.contains(activity.packageName) == true

    private fun launch(intent: Intent) = activity.runOnUiThread {
        runCatching { activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
}
