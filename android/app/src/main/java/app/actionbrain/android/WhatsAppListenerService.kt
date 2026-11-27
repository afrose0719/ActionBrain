package app.actionbrain.android

import android.app.Notification
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Reads notifications from the chat apps ActionBrain supports (WhatsApp, and Microsoft Teams once switched on) and forwards the message to
 * your Inbox. It exists only after YOU switch on Notification access for ActionBrain in Android's settings, and you can switch it off there
 * at any time. Nothing is sent until the website has handed the app your private token.
 *
 * The class keeps its old name, WhatsAppListenerService, on purpose: Android stores the notification access you granted under this exact
 * name, so renaming it would silently switch access off for everyone who has already granted it.
 */
class WhatsAppListenerService : NotificationListenerService() {
    private val recent = RecentSet()
    private val calls = CallTracker()

    /** Android reconnects the listener after a reboot or an update: send anything still waiting in the offline queue. */
    override fun onListenerConnected() {
        Thread { if (Outbox.count(this) > 0) Outbox.scheduleRetry(this) }.start()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val app = ChatApps.forPackage(sbn.packageName) ?: return
        val policy = CaptureSettings(this).load()
        if (!policy.appActive(app.source)) return // this app is switched off in Settings
        if (!policy.notificationsActive(System.currentTimeMillis())) return // notifications switched off, or paused
        val notification = sbn.notification
        trackCall(app, sbn) // after-call recap (Milestone 32): only answered calls, only if switched on
        val data = describe(notification)

        // Keep the SHAPE of the latest notification (never its words), so a parsing problem can be diagnosed without sharing a message.
        ScreenStatus.lastNotification[app.source] = NotificationParser.describe(data, notification.channelId)

        val config = TokenStore(this).load() ?: return
        val message = NotificationParser.parse(app, data) ?: return
        if (!recent.firstTime("${app.source}|${message.sender}|${message.group}|${message.text}")) return
        IntakeClient.send(this, config, Payload.message(message.sender, message.text, message.group, false, app.source))
        AutoProcess.onCaptured(this) // zero-touch: analyse once the conversation has been quiet for a while (only if switched on)
    }

    /** A call notification went away: if it was an answered call that mattered, offer the after-call recap. */
    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        val app = ChatApps.forPackage(sbn.packageName) ?: return
        val recap = calls.onRemoved(sbn.key, System.currentTimeMillis()) ?: return
        val policy = CaptureSettings(this).load()
        if (!policy.callRecap || !policy.appActive(app.source) || policy.paused(System.currentTimeMillis())) return
        CallRecapNotifier.show(this, app, recap)
    }

    private fun trackCall(app: ChatApp, sbn: StatusBarNotification) {
        val n = sbn.notification
        calls.onPosted(
            key = sbn.key,
            app = app.label,
            isCall = n.category == Notification.CATEGORY_CALL,
            ongoing = n.flags and Notification.FLAG_ONGOING_EVENT != 0,
            showsTimer = n.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER, false),
            caller = n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
            startedAt = n.`when`,
            now = System.currentTimeMillis(),
        )
    }

    @Suppress("DEPRECATION") // the typed getParcelableArray needs API 33; this app supports 26+
    private fun describe(n: Notification): NotificationData {
        val extras = n.extras
        val messages = extras.getParcelableArray(Notification.EXTRA_MESSAGES).orEmpty().mapNotNull { it as? Bundle }.map { b ->
            b.getCharSequence("sender")?.toString() to b.getCharSequence("text")?.toString()
        }
        return NotificationData(
            title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty(),
            text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty(),
            messages = messages,
            isGroupConversation = extras.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION, false),
            conversationTitle = extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString(),
            category = n.category,
            isGroupSummary = n.flags and Notification.FLAG_GROUP_SUMMARY != 0,
            hasMessagingStyle = extras.containsKey(Notification.EXTRA_MESSAGES) || extras.getCharSequence(Notification.EXTRA_TEMPLATE)?.toString()?.endsWith("MessagingStyle") == true,
        )
    }
}
