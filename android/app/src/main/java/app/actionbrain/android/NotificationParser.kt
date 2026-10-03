package app.actionbrain.android

/**
 * What the app needs from an Android notification, copied out of the Android types so this file stays pure Kotlin and can be unit tested.
 * [messages] are the (sender, text) pairs of a "messaging style" notification, oldest first. Empty for a plain notification.
 */
data class NotificationData(
    val title: String,
    val text: String,
    val messages: List<Pair<String?, String?>> = emptyList(),
    val isGroupConversation: Boolean = false,
    val conversationTitle: String? = null,
    val category: String? = null,
    val isGroupSummary: Boolean = false,
    val hasMessagingStyle: Boolean = false,
)

/** Turns one notification from a chat app into a message, or null when it is not a message worth keeping. */
object NotificationParser {
    private const val CATEGORY_MESSAGE = "msg"

    fun parse(app: ChatApp, n: NotificationData): ChatMessage? {
        if (n.isGroupSummary) return null // the bundle header, not a message

        // Teams also posts calls, meeting reminders, "someone liked your message" and activity digests as notifications. Those are not
        // messages. A message notification either uses Android's messaging layout or says so in its category.
        // WhatsApp's own notices (checking for messages, backup...) are dropped later, by the server.
        if (app.source == "teams" && !n.hasMessagingStyle && n.category != CATEGORY_MESSAGE) return null

        val last = n.messages.lastOrNull()
        val text = (last?.second?.takeIf { it.isNotBlank() } ?: n.text).trim()
        if (text.isBlank()) return null

        return if (n.isGroupConversation) {
            val group = n.conversationTitle?.takeIf { it.isNotBlank() } ?: n.title
            val sender = last?.first?.takeIf { it.isNotBlank() } ?: "Unknown"
            ChatMessage(chat = group, sender = sender, text = text, group = group, mine = false)
        } else {
            val sender = n.title.trim()
            ChatMessage(chat = sender, sender = sender, text = text, group = null, mine = false)
        }
    }

    /**
     * What a notification looks like, without a single word of it: its kind, category, channel and the LENGTH of each text field.
     * Used by "Show what notifications look like" to fix parsing problems without anyone sharing a message.
     */
    fun describe(n: NotificationData, channelId: String?): String = buildString {
        append("category: ").append(n.category ?: "none").append('\n')
        append("channel: ").append(channelId ?: "none").append('\n')
        append("messaging layout: ").append(n.hasMessagingStyle).append(", messages in it: ").append(n.messages.size).append('\n')
        append("group conversation flag: ").append(n.isGroupConversation).append(", bundle header: ").append(n.isGroupSummary).append('\n')
        append("title: ").append(n.title.length).append(" chars, text: ").append(n.text.length).append(" chars")
        append(", conversation title: ").append(n.conversationTitle?.length?.let { "$it chars" } ?: "none").append('\n')
        n.messages.takeLast(3).forEachIndexed { i, m ->
            append("message ").append(i + 1).append(": sender ").append(m.first?.length?.let { "$it chars" } ?: "none")
            append(", text ").append(m.second?.length?.let { "$it chars" } ?: "none").append('\n')
        }
    }.trimEnd()
}
