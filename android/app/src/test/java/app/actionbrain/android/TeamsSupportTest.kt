package app.actionbrain.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TeamsSupportTest {
    private val whatsapp = ChatApps.WHATSAPP
    private val teams = ChatApps.TEAMS

    private fun note(
        title: String = "Rajesh",
        text: String = "Can you send the RCA by Friday?",
        messages: List<Pair<String?, String?>> = emptyList(),
        group: Boolean = false,
        conversationTitle: String? = null,
        category: String? = null,
        summary: Boolean = false,
        messagingStyle: Boolean = false,
    ) = NotificationData(title, text, messages, group, conversationTitle, category, summary, messagingStyle)

    // ---- the registry ----
    @Test
    fun everyAppHasItsOwnSourceAndPackages() {
        assertEquals(listOf("whatsapp", "teams"), ChatApps.all.map { it.source })
        assertEquals(ChatApps.all.size, ChatApps.all.map { it.source }.toSet().size)
        val packages = ChatApps.all.flatMap { it.packages }
        assertEquals("a package must belong to one app only", packages.size, packages.toSet().size)
        assertEquals(packages.toSet(), ChatApps.allPackages)
    }

    @Test
    fun packagesAndSourcesLookUpTheRightApp() {
        assertEquals(whatsapp, ChatApps.forPackage("com.whatsapp"))
        assertEquals(whatsapp, ChatApps.forPackage("com.whatsapp.w4b"))
        assertEquals(teams, ChatApps.forPackage("com.microsoft.teams"))
        assertNull(ChatApps.forPackage("com.example.other"))
        assertNull(ChatApps.forPackage(null))
        assertEquals(teams, ChatApps.forSource("teams"))
        assertNull(ChatApps.forSource("telegram"))
        assertNull(ChatApps.forSource(null))
    }

    @Test
    fun theSourceNamesAreTheOnesTheServerKnows() {
        // the server (and the Inbox) understand exactly these two
        assertEquals(setOf("whatsapp", "teams"), ChatApps.all.map { it.source }.toSet())
    }

    // ---- WhatsApp notifications behave exactly as before ----
    @Test
    fun aWhatsAppDirectMessageIsFromThePersonInTheTitle() {
        assertEquals(ChatMessage("Rajesh", "Rajesh", "Can you send the RCA by Friday?", null, false), NotificationParser.parse(whatsapp, note()))
    }

    @Test
    fun whatsAppDoesNotNeedAMessagingLayoutOrACategory() {
        assertEquals("hi", NotificationParser.parse(whatsapp, note(text = "hi", category = null, messagingStyle = false))?.text)
    }

    @Test
    fun aWhatsAppGroupMessageUsesTheLastMessagesSenderAndTheGroupName() {
        val got = NotificationParser.parse(
            whatsapp,
            note(title = "Project Team", text = "ignored", group = true, conversationTitle = "Project Team", messages = listOf("Priya" to "old", "Anish" to "Update the deck")),
        )
        assertEquals(ChatMessage("Project Team", "Anish", "Update the deck", "Project Team", false), got)
    }

    @Test
    fun aGroupMessageWithNoSenderIsFromUnknown_neverTheGroup() {
        assertEquals("Unknown", NotificationParser.parse(whatsapp, note(group = true, conversationTitle = "Team", messages = listOf(null to "hello")))?.sender)
    }

    @Test
    fun theGroupNameFallsBackToTheTitle() {
        assertEquals("Project Team", NotificationParser.parse(whatsapp, note(title = "Project Team", group = true, conversationTitle = null, messages = listOf("A" to "x")))?.group)
    }

    @Test
    fun aMessagesTextBeatsTheSummaryText() {
        assertEquals("the real last message", NotificationParser.parse(whatsapp, note(text = "3 new messages", messages = listOf("Rajesh" to "the real last message")))?.text)
    }

    @Test
    fun aBlankLastMessageFallsBackToTheTextAndBlankEverythingIsNothing() {
        assertEquals("fallback", NotificationParser.parse(whatsapp, note(text = "fallback", messages = listOf("Rajesh" to "  ")))?.text)
        assertNull(NotificationParser.parse(whatsapp, note(text = "   ")))
        assertNull(NotificationParser.parse(whatsapp, note(text = "", messages = listOf("Rajesh" to null))))
    }

    @Test
    fun theBundleHeaderIsNotAMessage() {
        assertNull(NotificationParser.parse(whatsapp, note(summary = true)))
        assertNull(NotificationParser.parse(teams, note(summary = true, messagingStyle = true)))
    }

    // ---- Teams: only message notifications ----
    @Test
    fun aTeamsMessageUsingTheMessagingLayoutIsKept() {
        val got = NotificationParser.parse(teams, note(title = "Asha", text = "Can you review the doc?", messagingStyle = true))
        assertEquals(ChatMessage("Asha", "Asha", "Can you review the doc?", null, false), got)
    }

    @Test
    fun aTeamsNotificationInTheMessageCategoryIsKeptEvenWithoutTheLayout() {
        assertEquals("hello", NotificationParser.parse(teams, note(text = "hello", category = "msg"))?.text)
    }

    @Test
    fun teamsCallsRemindersAndActivityAreNotMessages() {
        for (category in listOf("call", "event", "reminder", "social", "promo", "status", "email", "alarm", null)) {
            assertNull("category $category", NotificationParser.parse(teams, note(text = "Asha is calling you", category = category, messagingStyle = false)))
        }
    }

    @Test
    fun aTeamsGroupChatWorksLikeAWhatsAppGroup() {
        val got = NotificationParser.parse(
            teams,
            note(title = "Sprint chat", group = true, conversationTitle = "Sprint chat", messagingStyle = true, messages = listOf("Lee" to "Please review the PR")),
        )
        assertEquals(ChatMessage("Sprint chat", "Lee", "Please review the PR", "Sprint chat", false), got)
    }

    // ---- what is kept for diagnosis never contains words ----
    @Test
    fun theNotificationShapeContainsLengthsOnly() {
        val secret = "my password is hunter2"
        val shape = NotificationParser.describe(
            note(title = "Rajesh Kumar", text = secret, messages = listOf("Rajesh Kumar" to secret), conversationTitle = "Secret Project", category = "msg", messagingStyle = true),
            "chat_messages",
        )
        for (word in listOf("hunter2", "password", "Rajesh", "Kumar", "Secret", "Project")) assertFalse("must not contain $word", shape.contains(word))
        assertTrue(shape.contains("category: msg"))
        assertTrue(shape.contains("channel: chat_messages"))
        assertTrue(shape.contains("messaging layout: true"))
        assertTrue(shape.contains("text: ${secret.length} chars"))
    }

    // ---- per-app switches ----
    @Test
    fun whatsAppIsOnAndTeamsIsOffUntilTheUserChoosesIt() {
        val p = CapturePolicy()
        assertTrue(p.appActive("whatsapp"))
        assertFalse(p.appActive("teams"))
        assertFalse(p.appActive("telegram"))
        assertFalse(p.appActive(null))
        assertTrue(CapturePolicy(apps = setOf("whatsapp", "teams")).appActive("teams"))
        assertFalse(CapturePolicy(apps = emptySet()).appActive("whatsapp"))
    }

    // ---- the payload carries the source ----
    @Test
    fun whatsAppPayloadsAreUnchangedAndTeamsPayloadsSaySo() {
        assertEquals("{\"title\":\"Rajesh\",\"text\":\"hi\"}", Payload.message("Rajesh", "hi", null))
        assertEquals("{\"title\":\"Rajesh\",\"text\":\"hi\"}", Payload.message("Rajesh", "hi", null, false, "whatsapp"))
        assertEquals("{\"title\":\"Asha\",\"text\":\"hi\",\"source\":\"teams\"}", Payload.message("Asha", "hi", null, false, "teams"))
        assertEquals("{\"title\":\"Sprint\",\"text\":\"On it\",\"group\":\"Sprint\",\"mine\":true,\"source\":\"teams\"}", Payload.message("Sprint", "On it", "Sprint", true, "teams"))
    }

    @Test
    fun theSourceCannotBreakOutOfTheJson() {
        assertEquals("{\"title\":\"a\",\"text\":\"b\",\"source\":\"x\\\"},{\\\"evil\"}", Payload.message("a", "b", null, false, "x\"},{\"evil"))
    }

    // ---- Teams reading uses its own screen-part names ----
    private fun teamsScreen(title: String, vararg rows: Pair<String, Int>) = ScreenNode(
        null, "android.widget.FrameLayout", null, 0, 0, 1000, 2000,
        listOf(ScreenNode("com.microsoft.teams:id/toolbar_title", "TextView", title, 100, 10, 600, 60)) +
            rows.map { (text, top) -> ScreenNode(null, "LinearLayout", null, 0, top, 1000, top + 80, listOf(ScreenNode("com.microsoft.teams:id/message_body", "TextView", text, 20, top, 420, top + 50))) },
    )

    @Test
    fun theTeamsReaderFindsTeamsMessagesAndSendsOnlyNewOnes() {
        val reader = ChatReader(teams.ids)
        assertTrue(reader.read(teamsScreen("Asha", "hello" to 200), 1000).isEmpty()) // baseline
        val got = reader.read(teamsScreen("Asha", "hello" to 200, "Can you review the doc?" to 300), 1000)
        assertEquals(listOf("Can you review the doc?"), got.map { it.text })
        assertEquals("Asha", got.single().sender)
    }

    @Test
    fun theWhatsAppReaderIgnoresTeamsScreensAndTheOtherWayRound() {
        assertTrue(ChatReader(whatsapp.ids).captureVisible(teamsScreen("Asha", "hello" to 200), 1000).isEmpty())
        val whatsappScreen = ScreenNode(
            null, null, null, 0, 0, 1000, 2000,
            listOf(
                ScreenNode("com.whatsapp:id/conversation_contact_name", "TextView", "Rajesh", 100, 10, 600, 60),
                ScreenNode("com.whatsapp:id/message_text", "TextView", "hi", 20, 200, 420, 250),
            ),
        )
        assertTrue(ChatReader(teams.ids).captureVisible(whatsappScreen, 1000).isEmpty())
    }

    @Test
    fun onlyTheNamedPartsOfTheRightAppAreCopiedFromTheScreen() {
        assertTrue(teams.ids.wanted("com.microsoft.teams:id/message_body"))
        assertTrue(teams.ids.wanted("com.microsoft.teams:id/toolbar_title"))
        assertFalse(teams.ids.wanted("com.microsoft.teams:id/compose_box"))
        assertFalse(teams.ids.wanted("com.microsoft.teams:id/"))
        assertFalse(teams.ids.wanted(null))
        assertFalse(teams.ids.wanted("message_body")) // no id prefix: not a real resource id
        assertFalse(whatsapp.ids.wanted("com.whatsapp:id/entry")) // the box you type in
    }
}
