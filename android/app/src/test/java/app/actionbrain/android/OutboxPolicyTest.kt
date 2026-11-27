package app.actionbrain.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OutboxPolicyTest {
    @Test
    fun aMessageIsDeletedOnlyWhenTheServerHasAnswered() {
        assertEquals(OutboxPolicy.Action.DELETE_SENT, OutboxPolicy.decide(200))
        assertEquals(OutboxPolicy.Action.KEEP_AND_RETRY, OutboxPolicy.decide(null)) // no network: keep
        assertEquals(OutboxPolicy.Action.KEEP_AND_RETRY, OutboxPolicy.decide(500))
        assertEquals(OutboxPolicy.Action.KEEP_AND_RETRY, OutboxPolicy.decide(502))
        assertEquals(OutboxPolicy.Action.KEEP_AND_RETRY, OutboxPolicy.decide(429))
        assertEquals(OutboxPolicy.Action.KEEP_AND_STOP, OutboxPolicy.decide(401)) // bad token: keep until reconnected
        assertEquals(OutboxPolicy.Action.KEEP_AND_STOP, OutboxPolicy.decide(403)) // access problem: keep (round 8)
        assertEquals(OutboxPolicy.Action.KEEP_AND_RETRY, OutboxPolicy.decide(408)) // timeout: retry, never delete (round 8)
        assertEquals(OutboxPolicy.Action.DELETE_REFUSED, OutboxPolicy.decide(422))
        assertEquals(OutboxPolicy.Action.DELETE_REFUSED, OutboxPolicy.decide(400)) // retrying cannot help
        assertEquals(OutboxPolicy.Action.DELETE_REFUSED, OutboxPolicy.decide(413))
    }

    @Test
    fun theQueueIsBounded() {
        assertEquals(0, OutboxPolicy.overflow(0))
        assertEquals(0, OutboxPolicy.overflow(OutboxPolicy.MAX_ROWS - 1))
        assertEquals(1, OutboxPolicy.overflow(OutboxPolicy.MAX_ROWS))
        assertEquals(11, OutboxPolicy.overflow(OutboxPolicy.MAX_ROWS + 10))
    }

    @Test
    fun messagesExpireAfterSevenDays() {
        val now = 1_800_000_000_000L
        assertFalse(OutboxPolicy.expired(now - OutboxPolicy.MAX_AGE_MS, now))
        assertTrue(OutboxPolicy.expired(now - OutboxPolicy.MAX_AGE_MS - 1, now))
    }

    @Test
    fun everyMessageGetsItsOwnEventIdInTheFormatTheServerAccepts() {
        val a = OutboxPolicy.newEventId()
        val b = OutboxPolicy.newEventId()
        assertNotEquals(a, b)
        assertTrue(Regex("^[A-Za-z0-9_-]{8,64}$").matches(a)) // same rule as the server (Milestone 28)
    }
}
