package app.actionbrain.android

/**
 * Works out, from what an open WhatsApp chat shows on screen, which messages are NEW and who wrote them.
 * Pure Kotlin on purpose (no Android types): the real service copies the screen into [ScreenNode]s and this does the thinking,
 * so plain unit tests can cover it.
 *
 * Privacy rules this code keeps:
 *  - it only ever looks at three kinds of node: the chat name, message text, and a group member's name. Never the box you type in.
 *  - it keeps nothing but short-lived in-memory keys, to avoid sending the same message twice.
 *  - it never sends what was already on screen when you opened the chat, or older messages you scroll back to.
 *
 * The names of the screen parts come from [AppIds] (one set per chat app, see ChatApps.kt). An app can rename them in an update.
 * If it does, this finds nothing and sends nothing. It never guesses.
 */
data class ScreenNode(
    val id: String?,
    val className: String?,
    val text: String?,
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
    val children: List<ScreenNode> = emptyList(),
    /** For a message row: the sender's name, taken from the start of its description (see [authorFromDescription]). */
    val author: String? = null,
)

/** mine = written by you. For your own messages [chat] is where you wrote it; for others, [sender] is who wrote it. */
data class ChatMessage(val chat: String, val sender: String, val text: String, val group: String?, val mine: Boolean)

class ChatReader(private val ids: AppIds = ChatApps.WHATSAPP.ids) {
    private var chat: String? = null
    private var previous: List<String> = emptyList()
    private var groupChat = false

    /** Everything seen on screen in this chat since it was opened. Automatic reading never sends anything that was already there. */
    private val known = LinkedHashSet<String>()

    /** What has actually been sent in this chat. The floating button skips only these, because tapping it is a deliberate "take it all". */
    private val sent = LinkedHashSet<String>()

    /** Forget everything (the user left WhatsApp, or turned the service off). The next chat you open starts from a clean baseline. */
    @Synchronized
    fun reset() {
        chat = null
        previous = emptyList()
        groupChat = false
        known.clear()
        sent.clear()
    }

    /**
     * Reads one look at the screen. Returns only messages that appeared since the previous look at the SAME chat.
     * The first look at a chat is a baseline: whatever is on screen already counts as old and is not returned.
     * New messages are found by lining the previous look up against this one (the screen scrolls a little between looks);
     * if they cannot be lined up (you scrolled far), this look becomes the new baseline and nothing is returned.
     * Trade-off: an identical message repeated in the same chat session ("ok", "ok") is sent only the first time.
     */
    @Synchronized
    fun read(root: ScreenNode, screenWidth: Int): List<ChatMessage> {
        val look = look(root, screenWidth) ?: return emptyList()
        val fresh = freshSince(look.messages, look.keys).filter { known.add(keyOf(it)) } // add() is false for a key already known
        markSent(fresh)
        remember(look.keys)
        return fresh
    }

    /**
     * For the floating button: everything visible on screen right now that has not been sent yet, in screen order.
     * Unlike [read], the history on screen counts: the user pressed the button on purpose. Only what was actually SENT before (by this
     * or by [read]) is skipped, and what is returned here is remembered so automatic reading does not send it again.
     * Limit: lines are stamped with the time they reach ActionBrain, not the time shown in WhatsApp.
     */
    @Synchronized
    fun captureVisible(root: ScreenNode, screenWidth: Int): List<ChatMessage> {
        val look = look(root, screenWidth) ?: return emptyList()
        val onThisScreen = HashSet<String>()
        val fresh = look.messages.filter { keyOf(it) !in sent && onThisScreen.add(keyOf(it)) }
        markSent(fresh)
        remember(look.keys)
        return fresh
    }

    private class Look(val messages: List<ChatMessage>, val keys: List<String>)

    /** Reads the chat name and messages off the screen and keeps track of which chat this is. Null when no chat is open. */
    private fun look(root: ScreenNode, screenWidth: Int): Look? {
        val title = findAll(root) { ids.isChatName(it) }.firstOrNull()?.text?.trim().orEmpty()
        if (title.isEmpty()) return null // not inside a chat (the chat list, settings...): read nothing

        // some apps (Teams) have the same title bar on their chat LIST: a chat is only open if its compose box is on screen too
        if (ids.requires.isNotEmpty() && findAll(root) { ids.isRequired(it) }.isEmpty()) return null

        val nodes = messageNodes(root).sortedBy { it.top }
        if (title != chat) {
            chat = title
            groupChat = false
            previous = emptyList()
            known.clear()
            sent.clear()
        }
        if (findAll(root) { ids.isGroupMember(it) }.isNotEmpty()) groupChat = true
        // where the app names the author of each message (Teams): in a one-to-one chat the author is the chat's own name,
        // so someone else's name on an incoming message means it is a group
        if (!groupChat && ids.authorFrom.isNotEmpty() &&
            nodes.any { n -> !outgoing(n, root, screenWidth) && authorOf(n, root)?.let { !it.trim().equals(title, ignoreCase = true) } == true }
        ) groupChat = true

        val messages = nodes.map { toMessage(it, root, title, screenWidth) }
        return Look(messages, messages.map(::keyOf))
    }

    private fun markSent(messages: List<ChatMessage>) {
        messages.forEach { sent.add(keyOf(it)) }
        while (sent.size > MAX_KNOWN) sent.remove(sent.first())
    }

    private fun remember(keys: List<String>) {
        known.addAll(keys)
        while (known.size > MAX_KNOWN) known.remove(known.first())
        previous = keys
    }

    /** The messages after the point where the previous look lines up with this one. */
    private fun freshSince(messages: List<ChatMessage>, keys: List<String>): List<ChatMessage> {
        if (previous.isEmpty()) return emptyList()
        // the bottom of the previous look, as long as possible (the top of the screen scrolls away between looks), at least 2 messages if there were 2
        for (k in previous.size downTo minOf(2, previous.size)) {
            val tail = previous.takeLast(k)
            var end = keys.size - 1
            while (end >= k - 1) {
                if (keys.subList(end - k + 1, end + 1) == tail) return messages.subList(end + 1, messages.size)
                end--
            }
        }
        return emptyList()
    }

    /** The text nodes that are messages: those with the app's message-text id, and the unnamed texts in message bubbles (not quoted replies). */
    private fun messageNodes(root: ScreenNode): List<ScreenNode> {
        val out = ArrayList<ScreenNode>()
        out += findAll(root) { ids.isMessageText(it) && !it.text.isNullOrBlank() }
        for (bubble in findAll(root) { ids.isBubble(it) }) collectBubbleText(bubble, out)
        return out
    }

    private fun collectBubbleText(node: ScreenNode, out: MutableList<ScreenNode>) {
        for (child in node.children) {
            if (ids.isQuote(child)) continue // a quoted earlier message, not a new one
            if (child.id == null && !child.text.isNullOrBlank()) out += child
            collectBubbleText(child, out)
        }
    }

    /** Who wrote it: the message's row says so when the app marks it; otherwise it is where the text sits on screen. */
    private fun outgoing(node: ScreenNode, root: ScreenNode, width: Int): Boolean {
        var ancestor: ScreenNode? = parentOf(root, node)
        var steps = 0
        while (ancestor != null && steps < 6) {
            if (ids.isOutgoingRow(ancestor)) return true
            if (ids.isIncomingRow(ancestor)) return false
            ancestor = parentOf(root, ancestor)
            steps++
        }
        return isOutgoing(node, width)
    }

    /** The author named on the message's row (a few levels up), if the app puts it there. */
    private fun authorOf(node: ScreenNode, root: ScreenNode): String? {
        var ancestor: ScreenNode? = parentOf(root, node)
        var steps = 0
        while (ancestor != null && steps < 6) {
            ancestor.author?.let { return it }
            ancestor = parentOf(root, ancestor)
            steps++
        }
        return null
    }

    private fun toMessage(node: ScreenNode, root: ScreenNode, title: String, width: Int): ChatMessage {
        val text = node.text!!.trim()
        val mine = outgoing(node, root, width)
        val group = if (groupChat) title else null
        val sender = when {
            mine -> "You"
            groupChat -> authorOf(node, root) ?: memberName(node, root) ?: "Unknown"
            else -> title
        }
        return ChatMessage(chat = title, sender = sender, text = text, group = group, mine = mine)
    }

    private fun keyOf(m: ChatMessage) = "${m.mine}|${m.sender}|${m.text}"

    /**
     * The name shown above a group member's message: looked for in the message's own row, climbing outwards a few levels.
     * It stops the moment the container holds more than one message, so it can never pick up a name that belongs to another row.
     */
    private fun memberName(message: ScreenNode, root: ScreenNode): String? {
        var ancestor: ScreenNode? = parentOf(root, message)
        repeat(4) {
            val a = ancestor ?: return null
            if (findAll(a) { ids.isMessageText(it) }.size > 1) return null
            val names = findAll(a) { ids.isGroupMember(it) }.mapNotNull { it.text?.trim()?.takeIf { t -> t.isNotEmpty() } }
            if (names.size == 1) return names.single()
            ancestor = parentOf(root, a)
        }
        return null // no name found: the caller says "Unknown"
    }

    companion object {
        private const val MAX_KNOWN = 500

        /**
         * Your own messages sit against the right edge, other people's against the left. This is a rule of thumb from where the
         * text is on screen, so it can be wrong for very long messages. The numbers are the first thing to tune on a real phone.
         */
        fun isOutgoing(node: ScreenNode, width: Int): Boolean {
            if (width <= 0) return false
            return node.left > width * 0.30 || (node.right >= width * 0.88 && node.left > width * 0.15)
        }

        fun findAll(root: ScreenNode, predicate: (ScreenNode) -> Boolean): List<ScreenNode> {
            val out = ArrayList<ScreenNode>()
            fun walk(n: ScreenNode) {
                if (predicate(n)) out += n
                n.children.forEach(::walk)
            }
            walk(root)
            return out
        }

        fun parentOf(root: ScreenNode, target: ScreenNode): ScreenNode? {
            for (child in root.children) {
                if (child === target) return root
                parentOf(child, target)?.let { return it }
            }
            return null
        }
    }
}

/**
 * A picture of the screen's STRUCTURE for fixing problems: class, id, position and how long the text is, never the text itself.
 * You can send it to the developer without sending a single message.
 */
object ScreenStructure {
    fun dump(root: ScreenNode, maxLines: Int = 120): String {
        val lines = ArrayList<String>()
        fun walk(n: ScreenNode, depth: Int) {
            if (lines.size >= maxLines) return
            val text = n.text?.let { " text=${it.length} chars" } ?: ""
            lines += "  ".repeat(depth) + (n.className?.substringAfterLast('.') ?: "?") + (n.id?.let { " #" + it.substringAfter(":id/") } ?: "") +
                " [${n.left},${n.top},${n.right},${n.bottom}]$text"
            n.children.forEach { walk(it, depth + 1) }
        }
        walk(root, 0)
        if (lines.size >= maxLines) lines += "... (cut)"
        return lines.joinToString("\n")
    }
}

/** What the website's Settings page can ask to see. Set by the screen service, read by the bridge. In memory only. */
object ScreenStatus {
    @Volatile
    var lastStructure: String = ""

    /** The shape of the latest notification from each chat app, with no message text. Keyed by [ChatApp.source]. */
    val lastNotification = java.util.concurrent.ConcurrentHashMap<String, String>()

    @Volatile
    var lastSeenAt: Long = 0
}
