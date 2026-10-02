package app.actionbrain.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CapturePolicyTest {
    private val now = 1_000_000L

    @Test
    fun theDefaultsAreNotificationsOnAndAutomaticReading() {
        val p = CapturePolicy()
        assertTrue(p.notificationsActive(now))
        assertEquals(CaptureMode.AUTO, p.readingMode(now))
        assertFalse(p.paused(now))
    }

    @Test
    fun onlyTheThreeModesAreAccepted() {
        assertEquals("off", CaptureMode.parse("off"))
        assertEquals("auto", CaptureMode.parse("auto"))
        assertEquals("tap", CaptureMode.parse("tap"))
        for (bad in listOf(null, "", "AUTO", "Tap", " tap", "tap ", "always", "on", "1", "off;auto")) assertNull("should refuse: $bad", CaptureMode.parse(bad))
    }

    @Test
    fun notificationsAndReadingAreIndependent() {
        assertFalse(CapturePolicy(notifications = false, reading = CaptureMode.AUTO).notificationsActive(now))
        assertEquals(CaptureMode.AUTO, CapturePolicy(notifications = false, reading = CaptureMode.AUTO).readingMode(now))
        assertTrue(CapturePolicy(notifications = true, reading = CaptureMode.OFF).notificationsActive(now))
        assertEquals(CaptureMode.OFF, CapturePolicy(notifications = true, reading = CaptureMode.OFF).readingMode(now))
    }

    @Test
    fun pausingSwitchesEverythingOffUntilItEnds_andKeepsTheChoices() {
        val p = CapturePolicy(notifications = true, reading = CaptureMode.TAP, pausedUntil = now + 1)
        assertTrue(p.paused(now))
        assertFalse(p.notificationsActive(now))
        assertEquals(CaptureMode.OFF, p.readingMode(now))
        assertFalse(p.showBubble(now, chatOpen = true))
        // the moment the pause ends, the user's own choices are back
        assertFalse(p.paused(now + 1))
        assertTrue(p.notificationsActive(now + 1))
        assertEquals(CaptureMode.TAP, p.readingMode(now + 1))
    }

    @Test
    fun theButtonShowsOnlyInTapModeOverAnOpenChat() {
        for (mode in listOf(CaptureMode.OFF, CaptureMode.AUTO)) assertFalse(mode, CapturePolicy(reading = mode).showBubble(now, chatOpen = true))
        val tap = CapturePolicy(reading = CaptureMode.TAP)
        assertTrue(tap.showBubble(now, chatOpen = true))
        assertFalse(tap.showBubble(now, chatOpen = false)) // the chat list, another app, the home screen
    }

    @Test
    fun hidingTheButtonForTheDayHidesItUntilThatTime() {
        val p = CapturePolicy(reading = CaptureMode.TAP, bubbleHiddenUntil = now + 5)
        assertTrue(p.bubbleHidden(now))
        assertFalse(p.showBubble(now, chatOpen = true))
        assertTrue(p.showBubble(now + 5, chatOpen = true))
    }

    @Test
    fun aPauseOrHideInThePastDoesNothing() {
        val p = CapturePolicy(reading = CaptureMode.TAP, pausedUntil = now - 1, bubbleHiddenUntil = now - 1)
        assertFalse(p.paused(now))
        assertFalse(p.bubbleHidden(now))
        assertTrue(p.showBubble(now, chatOpen = true))
    }
}
