package app.actionbrain.android

/**
 * The names an app uses for the parts of its chat screen. An app can have several candidates (names change between versions);
 * the reader accepts a node whose id ends with any of them. Matched by the id AFTER ":id/", so "com.whatsapp:id/message_text" and
 * "com.whatsapp.w4b:id/message_text" both match "message_text".
 */
data class AppIds(val chatName: List<String>, val messageText: List<String>, val groupMember: List<String>) {
    fun isChatName(node: ScreenNode) = matches(node, chatName)

    fun isMessageText(node: ScreenNode) = matches(node, messageText)

    fun isGroupMember(node: ScreenNode) = matches(node, groupMember)

    /** True for the only three kinds of screen part this app's reader may copy text from. Everything else keeps just its shape. */
    fun wanted(id: String?): Boolean {
        val name = idName(id) ?: return false
        return name in chatName || name in messageText || name in groupMember
    }

    private fun matches(node: ScreenNode, names: List<String>): Boolean {
        val name = idName(node.id) ?: return false
        return name in names
    }

    private fun idName(id: String?): String? = id?.substringAfter(":id/", "")?.takeIf { it.isNotEmpty() }
}

/** A chat app ActionBrain can capture from. [source] is what the server and the Inbox call it. */
data class ChatApp(val source: String, val label: String, val packages: Set<String>, val ids: AppIds)

object ChatApps {
    val WHATSAPP = ChatApp(
        source = "whatsapp",
        label = "WhatsApp",
        packages = setOf("com.whatsapp", "com.whatsapp.w4b"),
        ids = AppIds(chatName = listOf("conversation_contact_name"), messageText = listOf("message_text"), groupMember = listOf("name_in_group")),
    )

    /**
     * Microsoft Teams. The screen-part names below are educated guesses, NOT yet checked against a real Teams screen.
     * If reading finds nothing, "Show what the app sees" (Settings) shows the real names, with no message text, and these lists are the one
     * place to fix. Notifications do not depend on any of this.
     */
    val TEAMS = ChatApp(
        source = "teams",
        label = "Microsoft Teams",
        packages = setOf("com.microsoft.teams"),
        ids = AppIds(
            chatName = listOf("toolbar_title", "chat_title", "conversation_title", "thread_title", "app_bar_title"),
            messageText = listOf("message_body", "message_content", "message_text", "chat_message_text"),
            groupMember = listOf("message_author", "author_name", "sender_name"),
        ),
    )

    val all = listOf(WHATSAPP, TEAMS)

    /** Every package any supported app uses. */
    val allPackages: Set<String> = all.flatMap { it.packages }.toSet()

    fun forPackage(pkg: String?): ChatApp? = if (pkg == null) null else all.firstOrNull { pkg in it.packages }

    fun forSource(source: String?): ChatApp? = all.firstOrNull { it.source == source }
}
