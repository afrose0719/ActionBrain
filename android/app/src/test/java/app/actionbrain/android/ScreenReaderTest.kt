package app.actionbrain.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenReaderTest {
    private val width = 1000

    // ---- building a fake WhatsApp screen ----
    private fun textNode(id: String, text: String, top: Int, left: Int, right: Int, pkg: String = "com.whatsapp") =
        ScreenNode("$pkg:id/$id", "android.widget.TextView", text, left, top, right, top + 50)

    /** Someone else's message sits at the left edge. */
    private fun incoming(text: String, top: Int, member: String? = null) = row(textNode("message_text", text, top, 20, 420), top, member)

    /** Your own message sits at the right edge. */
    private fun outgoing(text: String, top: Int) = row(textNode("message_text", text, top, 580, 980), top, null)

    private fun row(message: ScreenNode, top: Int, member: String?) = ScreenNode(
        null, "android.widget.LinearLayout", null, 0, top, width, top + 90,
        listOfNotNull(member?.let { textNode("name_in_group", it, top - 30, 20, 300) }, message),
    )

    private fun screen(title: String?, vararg rows: ScreenNode, pkg: String = "com.whatsapp") = ScreenNode(
        null, "android.widget.FrameLayout", null, 0, 0, width, 2000,
        listOfNotNull(
            title?.let { textNode("conversation_contact_name", it, 10, 100, 600, pkg) },
            ScreenNode("$pkg:id/entry", "android.widget.EditText", null, 0, 1900, width, 2000), // the box you type in
            ScreenNode(null, "androidx.recyclerview.widget.RecyclerView", null, 0, 100, width, 1850, rows.toList()),
        ),
    )

    private fun reader() = ChatReader()

    // ---- baseline and new messages ----
    @Test
    fun whatYouSeeWhenYouOpenAChatIsOldAndNeverSent() {
        val r = reader()
        assertTrue(r.read(screen("Rajesh", incoming("hi", 200), outgoing("hello", 300)), width).isEmpty())
    }

    @Test
    fun aNewMessageIsReturnedOnceOnly() {
        val r = reader()
        r.read(screen("Rajesh", incoming("hi", 200), outgoing("hello", 300)), width)
        val next = screen("Rajesh", incoming("hi", 200), outgoing("hello", 300), incoming("Can you send the proposal by Friday?", 400))
        assertEquals(listOf("Can you send the proposal by Friday?"), r.read(next, width).map { it.text })
        assertTrue(r.read(next, width).isEmpty()) // the same screen again: nothing new
    }

    @Test
    fun otherPeoplesMessagesAreFromTheChatName_andYourOwnAreMarkedMine() {
        val r = reader()
        r.read(screen("Rajesh", incoming("hi", 200)), width)
        val got = r.read(screen("Rajesh", incoming("hi", 200), incoming("Can you send it?", 300), outgoing("I will send it tomorrow", 400)), width)
        assertEquals(
            listOf(
                ChatMessage("Rajesh", "Rajesh", "Can you send it?", null, false),
                ChatMessage("Rajesh", "You", "I will send it tomorrow", null, true),
            ),
            got,
        )
    }

    @Test
    fun severalNewMessagesComeBackInScreenOrder() {
        val r = reader()
        r.read(screen("Rajesh", incoming("one", 200)), width)
        val got = r.read(screen("Rajesh", incoming("one", 200), incoming("two", 300), incoming("three", 400)), width)
        assertEquals(listOf("two", "three"), got.map { it.text })
    }

    @Test
    fun messagesAreOrderedByPositionEvenIfTheScreenListsThemOutOfOrder() {
        val r = reader()
        r.read(screen("Rajesh", incoming("one", 200)), width)
        val got = r.read(screen("Rajesh", incoming("three", 400), incoming("one", 200), incoming("two", 300)), width)
        assertEquals(listOf("two", "three"), got.map { it.text })
    }

    // ---- groups ----
    @Test
    fun inAGroupEachMessageCarriesTheMembersNameAndTheGroup() {
        val r = reader()
        r.read(screen("Project Team", incoming("morning", 200, "Priya")), width)
        val got = r.read(screen("Project Team", incoming("morning", 200, "Priya"), incoming("Update the deck by Monday", 330, "Anish"), outgoing("On it", 460)), width)
        assertEquals(
            listOf(
                ChatMessage("Project Team", "Anish", "Update the deck by Monday", "Project Team", false),
                ChatMessage("Project Team", "You", "On it", "Project Team", true),
            ),
            got,
        )
    }

    @Test
    fun aGroupMessageWithNoReadableNameIsFromUnknown_neverTheGroupName() {
        val r = reader()
        r.read(screen("Project Team", incoming("morning", 200, "Priya")), width)
        val got = r.read(screen("Project Team", incoming("morning", 200, "Priya"), incoming("no name here", 330)), width)
        assertEquals("Unknown", got.single().sender)
    }

    // ---- not flooding the Inbox ----
    @Test
    fun scrollingBackToOlderMessagesSendsNothing_andScrollingDownAgainDoesNotResendThem() {
        val r = reader()
        r.read(screen("Rajesh", incoming("m1", 200), incoming("m2", 300), incoming("m3", 400)), width)
        val live = screen("Rajesh", incoming("m1", 200), incoming("m2", 300), incoming("m3", 400), incoming("m4", 500))
        assertEquals(listOf("m4"), r.read(live, width).map { it.text })
        // scroll far up: the last message is no longer on screen
        assertTrue(r.read(screen("Rajesh", incoming("old1", 200), incoming("old2", 300)), width).isEmpty())
        // scroll back down to the bottom: everything here was already seen
        assertTrue(r.read(live, width).isEmpty())
    }

    @Test
    fun switchingChatsStartsANewBaseline() {
        val r = reader()
        r.read(screen("Rajesh", incoming("hi", 200)), width)
        assertTrue(r.read(screen("Priya", incoming("hello", 200), incoming("are you free?", 300)), width).isEmpty())
        assertEquals(listOf("call me"), r.read(screen("Priya", incoming("hello", 200), incoming("are you free?", 300), incoming("call me", 400)), width).map { it.text })
    }

    @Test
    fun aMessageThatWasAlreadyOnScreenWhenYouOpenedTheChatIsNeverSent_evenAfterScrollingBackAndForth() {
        val r = reader()
        r.read(screen("Rajesh", incoming("old1", 200), incoming("old2", 300)), width) // baseline: both are history
        r.read(screen("Rajesh", incoming("older1", 200), incoming("older2", 300), incoming("old1", 400)), width) // scrolled up a little
        // scrolling down again: "old2" comes back into view below messages that WERE lined up
        assertTrue(r.read(screen("Rajesh", incoming("older2", 200), incoming("old1", 300), incoming("old2", 400)), width).isEmpty())
    }

    @Test
    fun aGenuinelyNewMessageStillArrivesAfterScrollingAround() {
        val r = reader()
        r.read(screen("Rajesh", incoming("a", 200), incoming("b", 300), incoming("c", 400)), width)
        r.read(screen("Rajesh", incoming("b", 200), incoming("c", 300), incoming("d", 400)), width) // d was new: sent
        val got = r.read(screen("Rajesh", incoming("c", 200), incoming("d", 300), incoming("e", 400)), width)
        assertEquals(listOf("e"), got.map { it.text })
    }

    @Test
    fun aRepeatedIdenticalMessageInTheSameChatSessionIsSentOnlyOnce() {
        val r = reader()
        r.read(screen("Rajesh", incoming("hi", 200)), width)
        assertEquals(listOf("ok"), r.read(screen("Rajesh", incoming("hi", 200), incoming("ok", 300)), width).map { it.text })
        assertTrue(r.read(screen("Rajesh", incoming("hi", 200), incoming("ok", 300), incoming("ok", 400)), width).isEmpty())
    }

    @Test
    fun reopeningAChatStartsFreshSoNothingFromBeforeIsSentAgain() {
        val r = reader()
        r.read(screen("Rajesh", incoming("hi", 200)), width)
        assertEquals(1, r.read(screen("Rajesh", incoming("hi", 200), incoming("new one", 300)), width).size)
        r.read(screen("Priya", incoming("x", 200)), width)
        assertTrue(r.read(screen("Rajesh", incoming("hi", 200), incoming("new one", 300)), width).isEmpty()) // the baseline of the reopened chat
        assertEquals(listOf("and another"), r.read(screen("Rajesh", incoming("hi", 200), incoming("new one", 300), incoming("and another", 400)), width).map { it.text })
    }

    @Test
    fun resetForgetsTheChat() {
        val r = reader()
        r.read(screen("Rajesh", incoming("hi", 200)), width)
        r.reset()
        assertTrue(r.read(screen("Rajesh", incoming("hi", 200), incoming("new", 300)), width).isEmpty()) // a fresh baseline after leaving WhatsApp
    }

    // ---- what it refuses to read ----
    @Test
    fun outsideAChatNothingIsReadAndTheBaselineSurvives() {
        val r = reader()
        r.read(screen("Rajesh", incoming("hi", 200)), width)
        assertTrue(r.read(screen(null, incoming("looks like a message but there is no chat name", 300)), width).isEmpty())
        assertEquals(listOf("next"), r.read(screen("Rajesh", incoming("hi", 200), incoming("next", 300)), width).map { it.text })
    }

    @Test
    fun theBoxYouTypeInIsNeverRead() {
        val typing = ScreenNode("com.whatsapp:id/entry", "android.widget.EditText", "my secret draft", 0, 1900, width, 2000)
        val r = reader()
        val base = screen("Rajesh", incoming("hi", 200))
        r.read(base, width)
        val withDraft = ScreenNode(null, null, null, 0, 0, width, 2000, base.children + typing + incoming("new", 300))
        assertEquals(listOf("new"), r.read(withDraft, width).map { it.text })
    }

    @Test
    fun onlyWhatsAppsOwnNamedPartsCount_blankMessagesAreIgnored() {
        val r = reader()
        r.read(screen("Rajesh", incoming("hi", 200)), width)
        val lookalike = ScreenNode("com.other:id/message_text_extra", "android.widget.TextView", "not a message", 20, 300, 420, 350)
        val blank = row(textNode("message_text", "   ", 400, 20, 420), 400, null)
        assertTrue(r.read(screen("Rajesh", incoming("hi", 200), row(lookalike, 300, null), blank), width).isEmpty())
    }

    @Test
    fun whatsAppBusinessWorksToo() {
        val r = reader()
        r.read(screen("Client", incoming("hi", 200).copy(children = listOf(textNode("message_text", "hi", 200, 20, 420, "com.whatsapp.w4b"))), pkg = "com.whatsapp.w4b"), width)
        val next = screen(
            "Client",
            incoming("hi", 200).copy(children = listOf(textNode("message_text", "hi", 200, 20, 420, "com.whatsapp.w4b"))),
            incoming("x", 300).copy(children = listOf(textNode("message_text", "Send the quote", 300, 20, 420, "com.whatsapp.w4b"))),
            pkg = "com.whatsapp.w4b",
        )
        assertEquals(listOf("Send the quote"), r.read(next, width).map { it.text })
    }

    // ---- who wrote it ----
    @Test
    fun theLeftEdgeIsOthersAndTheRightEdgeIsYou() {
        assertFalse(ChatReader.isOutgoing(ScreenNode(null, null, "x", 20, 0, 420, 50), width))
        assertTrue(ChatReader.isOutgoing(ScreenNode(null, null, "x", 580, 0, 980, 50), width))
        assertTrue(ChatReader.isOutgoing(ScreenNode(null, null, "x", 700, 0, 980, 50), width))
        assertFalse(ChatReader.isOutgoing(ScreenNode(null, null, "x", 20, 0, 840, 50), width)) // a long message from someone else
        assertTrue(ChatReader.isOutgoing(ScreenNode(null, null, "x", 200, 0, 975, 50), width)) // a long message from you
        assertFalse(ChatReader.isOutgoing(ScreenNode(null, null, "x", 900, 0, 980, 50), 0)) // unknown screen width: never guess "mine"
    }

    // ---- the picture of the screen for fixing problems ----
    @Test
    fun theStructureDumpNeverContainsMessageText() {
        val secret = "my password is hunter2"
        val dump = ScreenStructure.dump(screen("Rajesh Kumar", incoming(secret, 200), outgoing("and the pin is 4321", 300)))
        assertFalse(dump.contains(secret))
        assertFalse(dump.contains("hunter2"))
        assertFalse(dump.contains("4321"))
        assertFalse(dump.contains("Rajesh"))
        assertTrue(dump.contains("#message_text"))
        assertTrue(dump.contains("text=${secret.length} chars"))
    }

    @Test
    fun theStructureDumpIsCutToAReasonableSize() {
        val rows = (1..500).map { incoming("m$it", it * 10) }
        val dump = ScreenStructure.dump(screen("Rajesh", *rows.toTypedArray()), maxLines = 50)
        assertEquals(51, dump.lines().size)
        assertTrue(dump.endsWith("... (cut)"))
    }

    @Test
    fun parentLookupFindsTheEnclosingRow() {
        val message = textNode("message_text", "x", 100, 20, 420)
        val rowNode = ScreenNode(null, null, null, 0, 0, width, 90, listOf(message))
        val root = ScreenNode(null, null, null, 0, 0, width, 2000, listOf(rowNode))
        assertTrue(ChatReader.parentOf(root, message) === rowNode)
        assertNull(ChatReader.parentOf(root, root))
    }
}
