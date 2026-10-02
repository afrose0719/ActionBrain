package app.actionbrain.android

import android.app.Notification
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Reads WhatsApp notifications (and only those) and forwards the message to your ActionBrain Inbox.
 * It exists only after YOU switch on Notification access for ActionBrain in Android's settings, and you can switch it off there at any time.
 * Nothing is sent until the website has handed the app your private token.
 */
class WhatsAppListenerService : NotificationListenerService() {
    private val recent = RecentSet()

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in PACKAGES) return
        val notification = sbn.notification
        if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return // the bundle header, not a message
        if (!CaptureSettings(this).load().notificationsActive(System.currentTimeMillis())) return // switched off or paused in Settings
        val config = TokenStore(this).load() ?: return

        val extras = notification.extras
        // WhatsApp uses Android's messaging layout, which carries the last message and its sender separately. Fall back to title/text.
        val last = lastMessage(extras)
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = (last?.getCharSequence("text") ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
        if (text.isBlank()) return

        val isGroup = extras.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION, false)
        val sender = if (isGroup) last?.getCharSequence("sender")?.toString().orEmpty().ifBlank { "Unknown" } else title
        val group = if (isGroup) (extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString() ?: title) else null

        if (!recent.firstTime("$sender|$group|$text")) return
        IntakeClient.send(this, config, Payload.message(sender, text, group))
    }

    @Suppress("DEPRECATION") // the typed getParcelableArray needs API 33; this app supports 26+
    private fun lastMessage(extras: Bundle): Bundle? = extras.getParcelableArray(Notification.EXTRA_MESSAGES)?.lastOrNull() as? Bundle

    private companion object {
        val PACKAGES = setOf("com.whatsapp", "com.whatsapp.w4b")
    }
}
