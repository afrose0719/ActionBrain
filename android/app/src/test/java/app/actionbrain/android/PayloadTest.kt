package app.actionbrain.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PayloadTest {
    private val goodToken = "abi_" + "A".repeat(43)
    private val app = "https://action-brain-sigma.vercel.app"

    @Test
    fun tokenMustBeExactlyAbiPlus43UrlSafeCharacters() {
        assertTrue(Payload.looksLikeToken(goodToken))
        assertTrue(Payload.looksLikeToken("abi_" + "a-_Z9".repeat(8) + "abc"))
        for (bad in listOf(null, "", "abi_short", "xyz_" + "A".repeat(43), "abi_" + "A".repeat(44), "abi_" + "A".repeat(42) + "!", " $goodToken", "$goodToken\n")) {
            assertFalse("should reject: $bad", Payload.looksLikeToken(bad))
        }
    }

    @Test
    fun tokenIsOnlyEverSentToTheAppsOwnIntakeAddress() {
        assertTrue(Payload.isIntakeAddress("$app/api/intake", app))
        assertTrue(Payload.isIntakeAddress("$app/api/intake", "$app/"))
        for (bad in listOf(null, "", "http://action-brain-sigma.vercel.app/api/intake", "https://evil.example/api/intake", "$app/api/intake/", "$app/api/intake?x=1", "$app.evil.example/api/intake", "https://evil.example/?$app/api/intake", "$app/api/health")) {
            assertFalse("should reject: $bad", Payload.isIntakeAddress(bad, app))
        }
    }

    @Test
    fun quoteEscapesEverythingJsonRequires() {
        assertEquals("\"plain\"", Payload.quote("plain"))
        assertEquals("\"say \\\"hi\\\" \\\\ ok\"", Payload.quote("say \"hi\" \\ ok"))
        assertEquals("\"a\\nb\\r\\tc\"", Payload.quote("a\nb\r\tc"))
        assertEquals("\"\\u0000\\u001f\"", Payload.quote("\u0000\u001f"))
        assertEquals("\"\\u2028\\u2029\"", Payload.quote("  "))
        assertEquals("\"राजेश 📷\"", Payload.quote("राजेश 📷")) // other scripts and emoji pass through untouched
    }

    @Test
    fun oneToOneMessageHasNoGroupField() {
        assertEquals("{\"title\":\"Rajesh\",\"text\":\"Call me\"}", Payload.message("Rajesh", "Call me", null))
        assertEquals("{\"title\":\"Rajesh\",\"text\":\"Call me\"}", Payload.message("Rajesh", "Call me", "  "))
    }

    @Test
    fun groupMessageCarriesTheGroupName() {
        assertEquals("{\"title\":\"Priya\",\"text\":\"Update the deck\",\"group\":\"Project Team\"}", Payload.message("Priya", "Update the deck", "Project Team"))
    }

    @Test
    fun hostileTextCannotBreakOutOfTheJson() {
        val json = Payload.message("x\",\"group\":\"evil", "\"}, {\"title\":\"y", null)
        assertEquals("{\"title\":\"x\\\",\\\"group\\\":\\\"evil\",\"text\":\"\\\"}, {\\\"title\\\":\\\"y\"}", json)
    }

    @Test
    fun lengthsAreCappedLikeTheServer() {
        val json = Payload.message("n".repeat(300), "t".repeat(5000), "g".repeat(300))
        assertTrue(json.contains("\"title\":\"" + "n".repeat(100) + "\""))
        assertTrue(json.contains("\"text\":\"" + "t".repeat(1500) + "\""))
        assertTrue(json.contains("\"group\":\"" + "g".repeat(100) + "\""))
    }

    @Test
    fun aSharedFileIsHandedOverExactlyOnce() {
        PendingShare.take() // start clean
        assertEquals("", PendingShare.take())
        PendingShare.setFile("WhatsApp Chat with Rajesh.txt", "line1\n\"quoted\" \\ end")
        assertEquals("{\"name\":\"WhatsApp Chat with Rajesh.txt\",\"text\":\"line1\\n\\\"quoted\\\" \\\\ end\"}", PendingShare.take())
        assertEquals("", PendingShare.take()) // gone after being read
    }

    @Test
    fun aSharedFileErrorIsHandedOverOnceAndReplacesAFile() {
        PendingShare.setFile("a.txt", "x")
        PendingShare.setError("too big")
        assertEquals("{\"error\":\"too big\"}", PendingShare.take())
        assertEquals("", PendingShare.take())
    }

    @Test
    fun aSharedFileNameIsCut() {
        PendingShare.setFile("n".repeat(500), "x")
        assertTrue(PendingShare.take().contains("\"name\":\"" + "n".repeat(200) + "\""))
    }

    @Test
    fun recentSetDropsRepeatsInsideTheWindowOnly() {
        var now = 0L
        val set = RecentSet(windowMs = 1000, maxSize = 100, clock = { now })
        assertTrue(set.firstTime("a"))
        assertFalse(set.firstTime("a"))
        assertTrue(set.firstTime("b"))
        now = 999
        assertFalse(set.firstTime("a"))
        now = 1001
        assertTrue(set.firstTime("a")) // the window passed, so the same text is a new message
    }

    @Test
    fun recentSetNeverGrowsPastItsLimit() {
        val set = RecentSet(windowMs = 1_000_000, maxSize = 3, clock = { 0L })
        for (i in 1..10) assertTrue(set.firstTime("k$i"))
        assertTrue(set.firstTime("k1")) // forgotten: only the newest 3 are kept
        assertFalse(set.firstTime("k10"))
    }
}
