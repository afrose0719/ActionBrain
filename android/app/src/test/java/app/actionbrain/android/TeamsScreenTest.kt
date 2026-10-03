package app.actionbrain.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * These screens copy the STRUCTURE of a real Teams chat screen (Android 16, Teams 1416), read over USB as ids, classes, positions and
 * text lengths only: a toolbar with the chat title, rows named "chat_message_from_other" holding "rich_text_layout" (whose description
 * starts with the sender) holding "bubble_content", which holds an optional quoted reply ("reply_container") and then the message text
 * as an UNNAMED text view. The compose box is "message_area". Only the outgoing row's id is a guess.
 */
class TeamsScreenTest {
    private val teams = ChatApps.TEAMS
    private val width = 720

    private fun textView(id: String?, text: String, top: Int, left: Int = 52, right: Int = 570) = ScreenNode(id, "android.widget.TextView", text, left, top, right, top + 50)

    private fun quote(user: String, text: String, top: Int) = ScreenNode(
        "com.microsoft.teams:id/reply_container", "android.view.ViewGroup", null, 52, top, 221, top + 74,
        listOf(
            ScreenNode("com.microsoft.teams:id/reply_rail", "android.view.View", null, 67, top, 78, top + 60),
            textView("com.microsoft.teams:id/reply_user", user, top),
            textView("com.microsoft.teams:id/reply_text", text, top + 23),
        ),
    )

    /** One message row exactly as Teams lays it out. [author] is what the row's description starts with. */
    private fun row(
        text: String,
        top: Int,
        author: String,
        rowId: String? = "chat_message_from_other",
        quoted: ScreenNode? = null,
        left: Int = 52,
        right: Int = 570,
    ): ScreenNode {
        val bubble = ScreenNode(
            "com.microsoft.teams:id/bubble_content", "android.widget.LinearLayout", null, left, top, right, top + 120,
            listOfNotNull(quoted, textView(null, text, top + 90, left, right)),
        )
        val rich = ScreenNode("com.microsoft.teams:id/rich_text_layout", "android.widget.LinearLayout", null, 37, top, 585, top + 130, listOf(bubble), author)
        return ScreenNode(rowId?.let { "com.microsoft.teams:id/$it" }, "android.view.ViewGroup", null, 0, top, width, top + 140, listOf(rich))
    }

    private fun screen(title: String?, rows: List<ScreenNode>, composeBox: Boolean = true, typed: String? = null): ScreenNode {
        val appbar = ScreenNode(
            "com.microsoft.teams:id/appbar", "android.widget.LinearLayout", null, 0, 64, width, 169,
            listOfNotNull(title?.let { textView("com.microsoft.teams:id/action_bar_title_text", it, 80) }),
        )
        val list = ScreenNode("com.microsoft.teams:id/conversations_recycler_view", "androidx.recyclerview.widget.RecyclerView", null, 0, 169, width, 1408, rows)
        val compose = ScreenNode(
            "com.microsoft.teams:id/bottom_layout", "android.widget.FrameLayout", null, 0, 1408, width, 1510,
            listOf(
                ScreenNode(
                    "com.microsoft.teams:id/message_area", "android.view.ViewGroup", null, 0, 1408, width, 1510,
                    listOfNotNull(typed?.let { ScreenNode("com.microsoft.teams:id/message_area_edit_text", "android.widget.EditText", it, 83, 1410, 581, 1487) }),
                ),
            ),
        )
        return ScreenNode(null, "android.widget.FrameLayout", null, 0, 0, width, 1600, listOf(appbar, list) + (if (composeBox) listOf(compose) else emptyList()))
    }

    private fun reader() = ChatReader(teams.ids)

    // ---- reading a one-to-one chat ----
    @Test
    fun whatIsOnScreenWhenTheChatOpensIsOldAndNeverSent() {
        assertTrue(reader().read(screen("Asha Rao", listOf(row("hello", 200, "Asha Rao"), row("how are you", 350, "Asha Rao"))), width).isEmpty())
    }

    @Test
    fun aNewIncomingMessageIsFoundInTheUnnamedTextOfItsBubble() {
        val r = reader()
        r.read(screen("Asha Rao", listOf(row("hello", 200, "Asha Rao"))), width)
        val got = r.read(screen("Asha Rao", listOf(row("hello", 200, "Asha Rao"), row("Can you review the doc by Friday?", 350, "Asha Rao"))), width)
        assertEquals(listOf(ChatMessage("Asha Rao", "Asha Rao", "Can you review the doc by Friday?", null, false)), got)
    }

    @Test
    fun aOneToOneChatStaysOneToOneWhenTheAuthorIsTheChatName_evenWithDifferentCapitals() {
        val r = reader()
        r.read(screen("Asha Rao", listOf(row("hello", 200, "ASHA RAO"))), width)
        val got = r.read(screen("Asha Rao", listOf(row("hello", 200, "ASHA RAO"), row("next", 350, "asha rao "))), width)
        assertNull(got.single().group)
        assertEquals("Asha Rao", got.single().sender)
    }

    @Test
    fun aQuotedReplyIsNeverTakenAsAMessage_onlyTheNewTextAfterItIs() {
        val r = reader()
        r.read(screen("Asha Rao", listOf(row("hello", 200, "Asha Rao"))), width)
        val withQuote = row("Sure, will do", 350, "Asha Rao", quoted = quote("Me Myself", "an old quoted line", 350))
        val got = r.read(screen("Asha Rao", listOf(row("hello", 200, "Asha Rao"), withQuote)), width)
        assertEquals(listOf("Sure, will do"), got.map { it.text })
    }

    @Test
    fun anUnnamedTextInsideAQuotedReplyIsAlsoIgnored() {
        val deepQuote = ScreenNode(
            "com.microsoft.teams:id/reply_container", "android.view.ViewGroup", null, 52, 350, 221, 424,
            listOf(ScreenNode(null, "android.widget.LinearLayout", null, 52, 350, 221, 424, listOf(textView(null, "unnamed quoted text", 350)))),
        )
        val got = reader().captureVisible(screen("Asha Rao", listOf(row("the real message", 350, "Asha Rao", quoted = deepQuote))), width)
        assertEquals(listOf("the real message"), got.map { it.text })
    }

    @Test
    fun namedTextsInsideABubbleAreNotMessages() {
        val named = ScreenNode(
            "com.microsoft.teams:id/bubble_content", "android.widget.LinearLayout", null, 52, 350, 570, 470,
            listOf(textView("com.microsoft.teams:id/timestamp_label", "10:15 AM", 350), textView(null, "the message", 400)),
        )
        val rich = ScreenNode("com.microsoft.teams:id/rich_text_layout", "LinearLayout", null, 37, 350, 585, 480, listOf(named), "Asha Rao")
        val rowNode = ScreenNode("com.microsoft.teams:id/chat_message_from_other", "ViewGroup", null, 0, 350, width, 490, listOf(rich))
        assertEquals(listOf("the message"), reader().captureVisible(screen("Asha Rao", listOf(rowNode)), width).map { it.text })
    }

    // ---- who wrote it ----
    @Test
    fun theRowSaysWhetherAMessageIsYours() {
        val r = reader()
        r.read(screen("Asha Rao", listOf(row("hello", 200, "Asha Rao"))), width)
        // the outgoing row's id is a guess ("chat_message_from_me"); the text is also on the right, as Teams draws your own messages
        val mine = row("I will send it tomorrow", 350, "You", rowId = "chat_message_from_me", left = 300, right = 700)
        val got = r.read(screen("Asha Rao", listOf(row("hello", 200, "Asha Rao"), mine)), width)
        assertEquals(listOf(ChatMessage("Asha Rao", "You", "I will send it tomorrow", null, true)), got)
    }

    @Test
    fun anIncomingRowIsNeverYoursEvenIfItsTextIsLongAndWide() {
        val wide = row("a very long message ".repeat(20), 350, "Asha Rao", left = 260, right = 700) // would look "outgoing" by position alone
        val got = reader().captureVisible(screen("Asha Rao", listOf(wide)), width)
        assertFalse(got.single().mine)
    }

    @Test
    fun ifTheOutgoingRowIdIsUnknownThePositionOfTheTextDecides() {
        val unknownRow = row("my own message", 350, "You", rowId = "some_other_row_name", left = 300, right = 700)
        assertTrue(reader().captureVisible(screen("Asha Rao", listOf(unknownRow)), width).single().mine)
        val leftSide = row("their message", 350, "Asha Rao", rowId = null, left = 52, right = 400)
        assertFalse(reader().captureVisible(screen("Asha Rao", listOf(leftSide)), width).single().mine)
    }

    // ---- group chats ----
    @Test
    fun aGroupIsRecognisedBecauseAnIncomingAuthorIsNotTheChatName_andEachMessageHasItsAuthor() {
        val r = reader()
        r.read(screen("Sprint chat", listOf(row("morning", 200, "Priya Nair"))), width)
        val mine = row("On it", 500, "You", rowId = "chat_message_from_me", left = 300, right = 700)
        val got = r.read(screen("Sprint chat", listOf(row("morning", 200, "Priya Nair"), row("Please update the deck", 350, "Anish Mehta"), mine)), width)
        assertEquals(
            listOf(
                ChatMessage("Sprint chat", "Anish Mehta", "Please update the deck", "Sprint chat", false),
                ChatMessage("Sprint chat", "You", "On it", "Sprint chat", true),
            ),
            got,
        )
    }

    @Test
    fun aGroupMessageWithNoAuthorIsFromUnknown_neverTheGroupName() {
        val r = reader()
        r.read(screen("Sprint chat", listOf(row("morning", 200, "Priya Nair"))), width)
        val noAuthor = row("who am I", 350, "Priya Nair").let { it.copy(children = listOf(it.children[0].copy(author = null))) }
        val got = r.read(screen("Sprint chat", listOf(row("morning", 200, "Priya Nair"), noAuthor)), width)
        assertEquals("Unknown", got.single().sender)
    }

    // ---- what a REAL accessibility service sees (the "important for accessibility" tree) ----
    // Found on a real phone: a debugging tool shows the compose container "message_area", but a standard accessibility service does not
    // get it. It gets the compose box ("message_area_edit_text", inside a scroll view) and nothing else of the bottom bar.
    private fun serviceView(title: String?, rows: List<ScreenNode>, editBox: Boolean = true): ScreenNode {
        val info = ScreenNode("com.microsoft.teams:id/infoLayout", "android.widget.Button", null, 184, 80, 447, 153, listOfNotNull(title?.let { textView("com.microsoft.teams:id/action_bar_title_text", it, 80) }))
        val list = ScreenNode("com.microsoft.teams:id/conversations_recycler_view", "androidx.recyclerview.widget.RecyclerView", null, 0, 170, width, 1408, rows)
        val coordinate = ScreenNode("com.microsoft.teams:id/coordinate_layout", "android.view.ViewGroup", null, 0, 170, width, 1408, listOf(list))
        val edit = ScreenNode(
            "com.microsoft.teams:id/message_area_edit_text_scrollview", "android.widget.ScrollView", null, 83, 1410, 581, 1487,
            listOf(ScreenNode("com.microsoft.teams:id/message_area_edit_text", "android.widget.EditText", "a draft", 83, 1410, 581, 1487)),
        )
        val pager = ScreenNode("com.microsoft.teams:id/chat_view_pager", "androidx.viewpager.widget.ViewPager", null, 0, 170, width, 1510, listOf(coordinate) + (if (editBox) listOf(edit) else emptyList()))
        return ScreenNode(null, "android.widget.FrameLayout", null, 0, 0, width, 1600, listOf(info, pager))
    }

    @Test
    fun aChatIsRecognisedFromTheComposeBoxAloneBecauseARealServiceDoesNotSeeTheComposeContainer() {
        val rows = listOf(row("Can you review the doc by Friday?", 350, "Asha Rao"))
        assertEquals(listOf("Can you review the doc by Friday?"), reader().captureVisible(serviceView("Asha Rao", rows), width).map { it.text })
    }

    @Test
    fun withNeitherComposeMarkerItIsNotAChat() {
        assertTrue(reader().captureVisible(serviceView("Chat", listOf(row("a row", 350, "Someone")), editBox = false), width).isEmpty())
    }

    @Test
    fun theWholeFlowWorksOnTheServiceView_baselineThenNewThenTap() {
        val r = reader()
        val before = serviceView("Asha Rao", listOf(row("hello", 200, "Asha Rao")))
        assertTrue(r.read(before, width).isEmpty())
        val after = serviceView("Asha Rao", listOf(row("hello", 200, "Asha Rao"), row("new one", 350, "Asha Rao")))
        assertEquals(listOf("new one"), r.read(after, width).map { it.text })
        assertTrue(r.captureVisible(after, width).map { it.text } == listOf("hello")) // history on screen, never sent before: a tap takes it
    }

    // ---- the plain-words diagnosis (counts only) ----
    @Test
    fun theDiagnosisSaysWhatWasFound_inCountsOnly() {
        val secret = "my password is hunter2"
        val report = reader().diagnose(serviceView("Asha Rao", listOf(row(secret, 200, "Asha Rao"), row("reply", 350, "You", rowId = "chat_message_from_me", left = 300, right = 700))), width)
        assertTrue(report, report.contains("a chat with 2 message(s) read"))
        assertTrue(report, report.contains("compose box: found"))
        assertTrue(report, report.contains("yours 1, others 1"))
        for (word in listOf("hunter2", "password", "Asha", "Rao", "reply")) assertFalse("must not contain $word", report.contains(word))
    }

    @Test
    fun theDiagnosisNamesTheProblemWhenThereIsOne() {
        assertTrue(reader().diagnose(serviceView(null, listOf(row("x", 200, "A"))), width).contains("NOT a chat (no chat title found)"))
        assertTrue(reader().diagnose(serviceView("Chat", listOf(row("x", 200, "A")), editBox = false), width).contains("NOT a chat (no compose box found)"))
        assertTrue(reader().diagnose(serviceView("Asha Rao", emptyList()), width).contains("a chat, but NO message text was found"))
        assertTrue(reader().diagnose(serviceView("Asha Rao", emptyList()), width).contains("MISSING").not())
    }

    @Test
    fun theDiagnosisForWhatsAppSaysNoComposeBoxIsNeeded() {
        val whatsapp = ScreenNode(
            null, null, null, 0, 0, 1000, 2000,
            listOf(
                ScreenNode("com.whatsapp:id/conversation_contact_name", "TextView", "Rajesh", 100, 10, 600, 60),
                ScreenNode("com.whatsapp:id/message_text", "TextView", "hi", 20, 200, 420, 250),
            ),
        )
        val report = ChatReader().diagnose(whatsapp, 1000)
        assertTrue(report, report.contains("compose box: not needed"))
        assertTrue(report, report.contains("a chat with 1 message(s) read"))
        assertFalse(report.contains("Rajesh"))
    }

    // ---- is a chat open at all? ----
    @Test
    fun theChatListSharesTheTitleBarButHasNoComposeBox_soNothingIsRead() {
        assertTrue(reader().captureVisible(screen("Chat", listOf(row("a message-like row", 200, "Someone")), composeBox = false), width).isEmpty())
    }

    @Test
    fun withTheComposeBoxPresentTheChatIsRead() {
        assertEquals(1, reader().captureVisible(screen("Asha Rao", listOf(row("hello", 200, "Asha Rao"))), width).size)
    }

    @Test
    fun noTitleMeansNoChat() {
        assertTrue(reader().captureVisible(screen(null, listOf(row("hello", 200, "Asha Rao"))), width).isEmpty())
    }

    @Test
    fun whatYouAreTypingIsNeverRead() {
        val got = reader().captureVisible(screen("Asha Rao", listOf(row("hello", 200, "Asha Rao")), typed = "my private draft"), width)
        assertEquals(listOf("hello"), got.map { it.text })
    }

    // ---- the floating button on Teams, and scrolling ----
    @Test
    fun tappingCapturesEverythingVisibleInOrder_andTwiceSendsNothingNew() {
        val r = reader()
        val screen = screen("Asha Rao", listOf(row("second", 400, "Asha Rao"), row("first", 200, "Asha Rao")))
        assertEquals(listOf("first", "second"), r.captureVisible(screen, width).map { it.text })
        assertTrue(r.captureVisible(screen, width).isEmpty())
    }

    @Test
    fun scrollingBackNeverFloodsTheInbox() {
        val r = reader()
        r.read(screen("Asha Rao", listOf(row("m1", 200, "Asha Rao"), row("m2", 350, "Asha Rao"))), width)
        assertTrue(r.read(screen("Asha Rao", listOf(row("old1", 200, "Asha Rao"), row("old2", 350, "Asha Rao"))), width).isEmpty())
    }

    // ---- what is copied off the real screen ----
    @Test
    fun onlyTheChatTitleIsCopiedByName_theMessageTextIsFoundByStructure() {
        assertTrue(teams.ids.wanted("com.microsoft.teams:id/action_bar_title_text"))
        for (id in listOf("bubble_content", "rich_text_layout", "reply_user", "reply_text", "message_area_edit_text", "message_area", "action_bar_sub_title_text", "chat_message_from_other")) {
            assertFalse(id, teams.ids.wanted("com.microsoft.teams:id/$id"))
        }
        assertTrue(teams.ids.isBubbleId("com.microsoft.teams:id/bubble_content"))
        assertTrue(teams.ids.isQuoteId("com.microsoft.teams:id/reply_container"))
        assertTrue(teams.ids.isAuthorId("com.microsoft.teams:id/rich_text_layout"))
        assertFalse(teams.ids.isBubbleId("com.whatsapp:id/bubble_content".replace("whatsapp", "x").replace("bubble_content", "other")))
        assertFalse(teams.ids.isBubbleId(null))
    }

    @Test
    fun theAuthorIsTheStartOfTheRowDescription_andNothingElseIsKept() {
        assertEquals("Asha Rao", authorFromDescription("Asha Rao. Received 9:15 AM. Can you review the doc? It is urgent. Thanks."))
        assertEquals("Asha Rao", authorFromDescription("Asha Rao. Sent 9:15 AM. hi"))
        assertEquals("You", authorFromDescription("You. Sent 9:15 AM. hi"))
        for (bad in listOf(null, "", "no full stop here", ". starts with one", "   . x", "Name\nwith newline. rest", "x".repeat(100) + ". rest")) {
            assertNull("should refuse: $bad", authorFromDescription(bad))
        }
    }

    @Test
    fun whatsAppAndTeamsDoNotReadEachOthersScreens() {
        assertTrue(ChatReader(ChatApps.WHATSAPP.ids).captureVisible(screen("Asha Rao", listOf(row("hello", 200, "Asha Rao"))), width).isEmpty())
        val whatsapp = ScreenNode(
            null, null, null, 0, 0, 1000, 2000,
            listOf(
                ScreenNode("com.whatsapp:id/conversation_contact_name", "TextView", "Rajesh", 100, 10, 600, 60),
                ScreenNode("com.whatsapp:id/message_text", "TextView", "hi", 20, 200, 420, 250),
            ),
        )
        assertTrue(ChatReader(teams.ids).captureVisible(whatsapp, 1000).isEmpty())
    }

    @Test
    fun whatsAppReadingIsUnchangedByTheTeamsAdditions() {
        val whatsapp = ScreenNode(
            null, null, null, 0, 0, 1000, 2000,
            listOf(
                ScreenNode("com.whatsapp:id/conversation_contact_name", "TextView", "Rajesh", 100, 10, 600, 60),
                ScreenNode(null, null, null, 0, 200, 1000, 290, listOf(ScreenNode("com.whatsapp:id/message_text", "TextView", "Can you send it?", 20, 200, 420, 250))),
            ),
        )
        assertEquals(listOf(ChatMessage("Rajesh", "Rajesh", "Can you send it?", null, false)), ChatReader().captureVisible(whatsapp, 1000))
    }
}
