package app.actionbrain.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CallTrackerTest {
    private val t0 = 1_800_000_000_000L

    @Test
    fun anAnsweredCallOfFourMinutesOffersARecapWithTheCallersName() {
        val tracker = CallTracker()
        tracker.onPosted("k", "WhatsApp", isCall = true, ongoing = true, showsTimer = true, caller = "Priya", startedAt = t0, now = t0 + 1000)
        assertEquals(CallTracker.Recap("WhatsApp", "Priya", 240), tracker.onRemoved("k", t0 + 240_000))
    }

    @Test
    fun ringingMissedAndDeclinedCallsNeverOfferARecap() {
        val tracker = CallTracker()
        // a ringing (or then missed / declined) call shows no running timer
        tracker.onPosted("k", "WhatsApp", isCall = true, ongoing = true, showsTimer = false, caller = "Priya", startedAt = t0, now = t0)
        assertNull(tracker.onRemoved("k", t0 + 60_000))
        // an ordinary message notification is not a call
        tracker.onPosted("m", "WhatsApp", isCall = false, ongoing = false, showsTimer = false, caller = "Priya", startedAt = t0, now = t0)
        assertNull(tracker.onRemoved("m", t0 + 60_000))
    }

    @Test
    fun shortCallsAreIgnored() {
        val tracker = CallTracker()
        tracker.onPosted("k", "WhatsApp", isCall = true, ongoing = true, showsTimer = true, caller = "Priya", startedAt = t0, now = t0)
        assertNull(tracker.onRemoved("k", t0 + 19_000))
    }

    @Test
    fun updatesKeepTheOriginalStartAndAnUnknownKeyIsIgnored() {
        val tracker = CallTracker()
        tracker.onPosted("k", "WhatsApp", true, true, true, "Priya", t0, t0)
        tracker.onPosted("k", "WhatsApp", true, true, true, "Priya", t0 + 60_000, t0 + 60_000) // the timer notification is updated
        assertEquals(300, tracker.onRemoved("k", t0 + 300_000)?.seconds)
        assertNull(tracker.onRemoved("unknown", t0))
    }

    @Test
    fun genericTitlesAreNotTakenAsTheCallersName() {
        for (title in listOf("Ongoing voice call", "WhatsApp", "  ", null)) assertNull(title, CallTracker.cleanCaller(title))
        assertEquals("Priya Raman", CallTracker.cleanCaller("  Priya Raman "))
    }

    @Test
    fun durationAndTheRecapPage() {
        assertEquals("45 s", CallTracker.duration(45))
        assertEquals("4 min", CallTracker.duration(240))
        val url = CallTracker.recapUrl("https://action-brain-sigma.vercel.app", CallTracker.Recap("WhatsApp", "Priya & Co", 240))
        assertEquals("https://action-brain-sigma.vercel.app/meetings?recap=Priya%20%26%20Co&via=WhatsApp&mins=4", url)
    }
}
