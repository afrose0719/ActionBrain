package app.actionbrain.android

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Reads the messages of an OPEN WhatsApp chat (which WhatsApp does not announce as a notification) and sends the new ones to your Inbox.
 *
 * Limits, on purpose:
 *  - Android only delivers events from WhatsApp's packages (see res/xml/screen_service_config.xml), and the code checks again.
 *  - Read-only: no gestures, no clicks, no typing. The only text ever copied off the screen is the chat name, message text and a
 *    group member's name. Nothing you type, nothing from any other app.
 *  - Nothing is stored. A few short keys stay in memory to avoid sending the same message twice.
 * Which messages are new, and who wrote them, is decided by [ChatReader] (pure Kotlin, unit tested).
 */
class WhatsAppScreenService : AccessibilityService() {
    private val reader = ChatReader()
    private val handler = Handler(Looper.getMainLooper())
    private val scan = Runnable { scanNow() }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.packageName?.toString() !in PACKAGES) return
        handler.removeCallbacks(scan)
        handler.postDelayed(scan, DEBOUNCE_MS) // wait for the screen to settle: one look per burst of changes
    }

    override fun onInterrupt() = Unit

    override fun onUnbind(intent: Intent?): Boolean {
        handler.removeCallbacks(scan)
        reader.reset()
        ScreenStatus.lastStructure = ""
        return super.onUnbind(intent)
    }

    private fun scanNow() {
        val root = rootInActiveWindow ?: return
        if (root.packageName?.toString() !in PACKAGES) return reader.reset() // you moved to another app: forget the chat

        val node = toNode(root, 0, intArrayOf(MAX_NODES))
        ScreenStatus.lastStructure = ScreenStructure.dump(node)
        ScreenStatus.lastSeenAt = System.currentTimeMillis()

        val config = TokenStore(this).load() ?: return // not connected yet: nothing is sent
        for (m in reader.read(node, resources.displayMetrics.widthPixels)) {
            // your own message: the title is the chat it was written in. Someone else's: the title is who wrote it.
            IntakeClient.send(this, config, Payload.message(if (m.mine) m.chat else m.sender, m.text, m.group, m.mine))
        }
    }

    /** Copies the screen into plain nodes. Text is copied ONLY for the three parts we use; every other node keeps just its shape. */
    private fun toNode(info: AccessibilityNodeInfo, depth: Int, budget: IntArray): ScreenNode {
        budget[0]--
        val bounds = Rect().also { info.getBoundsInScreen(it) }
        val id = info.viewIdResourceName
        val wanted = id != null && (id.endsWith(":id/" + WhatsAppIds.CHAT_NAME) || id.endsWith(":id/" + WhatsAppIds.MESSAGE_TEXT) || id.endsWith(":id/" + WhatsAppIds.GROUP_MEMBER))
        val children = ArrayList<ScreenNode>()
        if (depth < MAX_DEPTH) {
            for (i in 0 until info.childCount) {
                if (budget[0] <= 0) break
                val child = info.getChild(i) ?: continue
                children += toNode(child, depth + 1, budget)
            }
        }
        return ScreenNode(id, info.className?.toString(), if (wanted) info.text?.toString() else null, bounds.left, bounds.top, bounds.right, bounds.bottom, children)
    }

    private companion object {
        val PACKAGES = setOf("com.whatsapp", "com.whatsapp.w4b")
        const val DEBOUNCE_MS = 600L
        const val MAX_DEPTH = 40
        const val MAX_NODES = 800
    }
}
