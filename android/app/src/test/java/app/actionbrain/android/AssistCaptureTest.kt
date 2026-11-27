package app.actionbrain.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AssistCaptureTest {
    private data class V(
        override val idPackage: String? = null,
        override val idEntry: String? = null,
        override val className: String? = "android.widget.FrameLayout",
        override val text: CharSequence? = null,
        override val contentDescription: CharSequence? = null,
        override val left: Int = 0,
        override val top: Int = 0,
        override val width: Int = 1080,
        override val height: Int = 100,
        override val scrollX: Int = 0,
        override val scrollY: Int = 0,
        override val children: List<AssistView> = emptyList(),
    ) : AssistView

    private fun wa(entry: String, text: String? = null, top: Int = 0, left: Int = 0, width: Int = 1080, kids: List<AssistView> = emptyList()) =
        V("com.whatsapp", entry, "android.widget.TextView", text, null, left, top, width, 60, children = kids)

    @Test
    fun idsAreBuiltInTheFormTheParserExpects() {
        assertEquals("com.whatsapp:id/message_text", AssistCapture.idOf(wa("message_text")))
        assertNull(AssistCapture.idOf(V()))
    }

    @Test
    fun onlyChatNameAndMessageTextAreCopiedNeverTheTypingBox() {
        val screen = V(
            children = listOf(
                wa("conversation_contact_name", "Priya", top = 50),
                wa("message_text", "Tomorrow submit the RCA", top = 400, left = 40, width = 600),
                V("com.whatsapp", "entry", "android.widget.EditText", "my unsent draft", top = 2000),
            )
        )
        val node = AssistCapture.toScreenNode(ChatApps.WHATSAPP, screen)
        val texts = buildList { fun walk(n: ScreenNode) { n.text?.let { add(it) }; n.children.forEach { walk(it) } }; walk(node) }
        assertTrue("Priya" in texts)
        assertTrue("Tomorrow submit the RCA" in texts)
        assertTrue("the draft in the typing box is never copied", "my unsent draft" !in texts)
    }

    @Test
    fun positionsBecomeScreenPositionsIncludingScroll() {
        val inner = wa("message_text", "hi", top = 300, left = 40)
        val list = V(top = 100, scrollY = 250, children = listOf(inner))
        val node = AssistCapture.toScreenNode(ChatApps.WHATSAPP, V(children = listOf(list)))
        val msg = node.children[0].children[0]
        assertEquals(100 - 250 + 300, msg.top) // parent top, minus the parent's scroll, plus its own offset
        assertEquals(40, msg.left)
    }

    @Test
    fun theSameParserReadsTheMessagesFromAnAssistScreen() {
        val screen = V(
            children = listOf(
                wa("conversation_contact_name", "Priya", top = 50),
                wa("message_text", "Tomorrow submit the RCA", top = 400, left = 40, width = 600),
            )
        )
        val node = AssistCapture.toScreenNode(ChatApps.WHATSAPP, screen)
        val messages = ChatReader(ChatApps.WHATSAPP.ids).captureVisible(node, 1080)
        assertEquals(listOf("Tomorrow submit the RCA"), messages.map { it.text })
        assertEquals("1 message from Priya (WhatsApp)", AssistCapture.summary(ChatApps.WHATSAPP, messages))
        assertEquals("No messages found on this screen.", AssistCapture.summary(ChatApps.WHATSAPP, emptyList()))
    }
}
