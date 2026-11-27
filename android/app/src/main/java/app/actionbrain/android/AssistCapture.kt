package app.actionbrain.android

/**
 * Assistant capture (Milestone 31, Play-safe "tap to capture"): when ActionBrain is the phone's default digital assistant and the user
 * long-presses the power or home button, Android hands it the CURRENT screen once (the Assist API, the same feature assistant apps such
 * as ChatGPT or Gemini use). No Accessibility service, nothing in the background, only on the user's own action.
 *
 * This file turns Android's description of that screen into the same [ScreenNode] tree the live reader uses, so the SAME parser
 * ([ChatReader.captureVisible]) decides what is a message. Text is copied under the same rules as the live reader: only the chat name,
 * message text and sender names; never the box you type in. Pure Kotlin behind [AssistView], so unit tests can cover it.
 */
interface AssistView {
    val idPackage: String?
    val idEntry: String?
    val className: String?
    val text: CharSequence?
    val contentDescription: CharSequence?
    val left: Int
    val top: Int
    val width: Int
    val height: Int
    val scrollX: Int
    val scrollY: Int
    val children: List<AssistView>
}

object AssistCapture {
    const val MAX_DEPTH = 40
    const val MAX_NODES = 1200

    /** The id in the form the parser expects ("com.whatsapp:id/message_text"), or null. */
    fun idOf(v: AssistView): String? = if (v.idEntry.isNullOrEmpty()) null else "${v.idPackage ?: ""}:id/${v.idEntry}"

    /** [originX]/[originY]: where this view's parent starts on screen, minus the parent's scroll (assist positions are relative). */
    fun toScreenNode(app: ChatApp, v: AssistView, originX: Int = 0, originY: Int = 0): ScreenNode =
        convert(app, v, originX, originY, 0, intArrayOf(MAX_NODES), inBubble = false, inQuote = false)

    private fun convert(app: ChatApp, v: AssistView, originX: Int, originY: Int, depth: Int, budget: IntArray, inBubble: Boolean, inQuote: Boolean): ScreenNode {
        budget[0]--
        val left = originX + v.left
        val top = originY + v.top
        val id = idOf(v)
        val unnamedText = id == null && v.className?.endsWith("TextView") == true
        val copyText = app.ids.wanted(id) || (inBubble && !inQuote && unnamedText)
        val bubble = inBubble || app.ids.isBubbleId(id)
        val quote = inQuote || app.ids.isQuoteId(id)
        val children = ArrayList<ScreenNode>()
        if (depth < MAX_DEPTH) {
            for (child in v.children) {
                if (budget[0] <= 0) break
                children += convert(app, child, left - v.scrollX, top - v.scrollY, depth + 1, budget, bubble, quote)
            }
        }
        val author = if (app.ids.isAuthorId(id)) authorFromDescription(v.contentDescription) else null
        return ScreenNode(id, v.className, if (copyText) v.text?.toString() else null, left, top, left + v.width, top + v.height, children, author)
    }

    /** The one-line summary on the confirmation sheet, e.g. "5 messages from Priya (WhatsApp)". No message text. */
    fun summary(app: ChatApp, messages: List<ChatMessage>): String {
        if (messages.isEmpty()) return "No messages found on this screen."
        val chat = messages.first().chat.ifBlank { app.label }
        val n = messages.size
        return "$n message${if (n == 1) "" else "s"} from $chat (${app.label})"
    }
}
