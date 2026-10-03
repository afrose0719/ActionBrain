package app.actionbrain.android

/**
 * The names an app uses for the parts of its chat screen. An app can have several candidates (names change between versions);
 * the reader accepts a node whose id ends with any of them. Matched by the id AFTER ":id/", so "com.whatsapp:id/message_text" and
 * "com.whatsapp.w4b:id/message_text" both match "message_text".
 *
 * Apps differ in HOW they mark a message:
 *  - WhatsApp gives the message text its own id ([messageText]) and group member names theirs ([groupMember]).
 *  - Teams gives the text NO id. It is an unnamed text inside a message bubble ([bubble]); a quoted reply inside the bubble ([quoted])
 *    is not a message; the sender is the start of the message row's description ([authorFrom]); and the row says whether the message
 *    is incoming or outgoing ([incomingRow], [outgoingRow]).
 */
data class AppIds(
    val chatName: List<String>,
    val messageText: List<String>,
    val groupMember: List<String>,
    /** Containers whose unnamed text children are the message text (the app puts no id on the text itself). */
    val bubble: List<String> = emptyList(),
    /** Quoted-reply blocks inside a bubble: their text is an earlier message, not a new one. */
    val quoted: List<String> = emptyList(),
    /** Nodes whose description starts with the author's name, then ". ". */
    val authorFrom: List<String> = emptyList(),
    /** Message rows that say who wrote them. Anything else falls back to where the text sits on screen. */
    val incomingRow: List<String> = emptyList(),
    val outgoingRow: List<String> = emptyList(),
    /** If not empty, at least one of these must be on screen for a chat to count as open (they tell a chat screen from a list that shares the title bar). */
    val requires: List<String> = emptyList(),
) {
    fun isChatName(node: ScreenNode) = matches(node.id, chatName)

    fun isMessageText(node: ScreenNode) = matches(node.id, messageText)

    fun isGroupMember(node: ScreenNode) = matches(node.id, groupMember)

    fun isBubble(node: ScreenNode) = matches(node.id, bubble)

    fun isQuote(node: ScreenNode) = matches(node.id, quoted)

    fun isIncomingRow(node: ScreenNode) = matches(node.id, incomingRow)

    fun isOutgoingRow(node: ScreenNode) = matches(node.id, outgoingRow)

    fun isRequired(node: ScreenNode) = matches(node.id, requires)

    /** True for the kinds of screen part this app's reader may copy NAMED text from. Everything else keeps just its shape. */
    fun wanted(id: String?): Boolean {
        val name = idName(id) ?: return false
        return name in chatName || name in messageText || name in groupMember
    }

    fun isBubbleId(id: String?) = matches(id, bubble)

    fun isQuoteId(id: String?) = matches(id, quoted)

    fun isAuthorId(id: String?) = matches(id, authorFrom)

    private fun matches(id: String?, names: List<String>): Boolean {
        val name = idName(id) ?: return false
        return name in names
    }

    private fun idName(id: String?): String? = id?.substringAfter(":id/", "")?.takeIf { it.isNotEmpty() }
}

/**
 * The sender's name from a message row's description, which starts "Name. Received 9:15 AM. The message...".
 * Only the name is kept (everything up to the first ". "), so the rest of the description, which repeats the message, is never copied.
 * Null when the description does not look like that.
 */
fun authorFromDescription(description: CharSequence?): String? {
    val text = description?.toString() ?: return null
    val end = text.indexOf(". ")
    if (end <= 0) return null
    val name = text.substring(0, end).trim()
    return if (name.isEmpty() || name.length > 80 || name.contains('\n')) null else name
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
     * Microsoft Teams. These names come from the STRUCTURE of a real Teams chat screen (ids, classes and positions only, no message text),
     * Android 16, Teams version 1416. Verified, also against what a standard accessibility service (not just a debugging tool) can see: the chat title, the message bubble,
     * the quoted-reply block, the incoming row and the compose box. NOT verified: the id of an OUTGOING row (the guesses below fall back to the text's position on screen if wrong) and
     * what a group chat looks like (the sender is read from the row description either way). Teams can rename any of this in an update.
     */
    val TEAMS = ChatApp(
        source = "teams",
        label = "Microsoft Teams",
        packages = setOf("com.microsoft.teams"),
        ids = AppIds(
            chatName = listOf("action_bar_title_text"),
            messageText = emptyList(),
            groupMember = emptyList(),
            bubble = listOf("bubble_content"),
            quoted = listOf("reply_container"),
            authorFrom = listOf("rich_text_layout"),
            incomingRow = listOf("chat_message_from_other"),
            outgoingRow = listOf("chat_message_from_me", "chat_message_from_self", "chat_message_from_current_user"),
            // a real accessibility service does NOT see the "message_area" container (Teams marks it not important for accessibility), but it does
            // see the compose box itself; either one proves a chat screen (the chat list has neither)
            requires = listOf("message_area_edit_text", "message_area"),
        ),
    )

    val all = listOf(WHATSAPP, TEAMS)

    /** Every package any supported app uses. */
    val allPackages: Set<String> = all.flatMap { it.packages }.toSet()

    fun forPackage(pkg: String?): ChatApp? = if (pkg == null) null else all.firstOrNull { pkg in it.packages }

    fun forSource(source: String?): ChatApp? = all.firstOrNull { it.source == source }
}
