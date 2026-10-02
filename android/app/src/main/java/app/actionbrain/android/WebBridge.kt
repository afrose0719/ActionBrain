package app.actionbrain.android

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.webkit.JavascriptInterface

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
        return "{\"app\":true,\"version\":" + Payload.quote(BuildConfig.VERSION_NAME) +
            ",\"configured\":" + (tokens.load() != null) +
            ",\"listening\":" + listenerEnabled() +
            ",\"screenAvailable\":" + BuildConfig.SCREEN_READING +
            ",\"screenOn\":" + (BuildConfig.SCREEN_READING && screenServiceEnabled()) +
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
