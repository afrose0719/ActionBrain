package app.actionbrain.android

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import java.util.Calendar

/**
 * Reads the messages of an OPEN chat (which the chat app does not announce as a notification), in the chat apps you switched on in Settings
 * (WhatsApp, and Microsoft Teams if you chose it). What it does depends on the mode you chose (see [CaptureMode]):
 *  - auto: reads the open chat by itself and sends the NEW messages.
 *  - tap:  does nothing in the background. A floating button appears over the chat; when you tap it, it reads what is on screen once.
 *  - off:  reads nothing.
 * Pausing (Settings, or the Quick Settings tile) acts as "off" for everything for a while.
 *
 * The class keeps its old name (WhatsAppScreenService) on purpose: Android stores the accessibility access you granted under this exact name.
 *
 * Limits, on purpose:
 *  - Android only delivers events from the apps in res/xml/screen_service_config.xml, and the code reads an app only if it is switched on.
 *  - Read-only: no gestures, no clicks, no typing. The only text ever copied off the screen is the chat name, message text and a
 *    group member's name. Nothing you type, nothing from any other app.
 *  - Nothing is stored. A few short keys stay in memory to avoid sending the same message twice.
 * Which messages are new, and who wrote them, is decided by [ChatReader] (pure Kotlin, unit tested), one reader per app.
 */
class WhatsAppScreenService : AccessibilityService() {
    private val readers = ChatApps.all.associate { it.source to ChatReader(it.ids) }
    private val handler = Handler(Looper.getMainLooper())
    private var bubble: Bubble? = null
    private var misses = 0

    private val screenChanged = Runnable { onScreenChanged() }
    private val pollBubble = Runnable { refreshBubble() }

    // switching a mode or an app in Settings should take effect at once, not at the next screen change
    private val settingsChanged = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> handler.post { refreshBubble() } }

    override fun onServiceConnected() {
        super.onServiceConnected()
        getSharedPreferences("capture", MODE_PRIVATE).registerOnSharedPreferenceChangeListener(settingsChanged) // held by this field: Android keeps listeners weakly
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (ChatApps.forPackage(event.packageName?.toString()) == null) return
        handler.removeCallbacks(screenChanged)
        handler.postDelayed(screenChanged, DEBOUNCE_MS) // wait for the screen to settle: one look per burst of changes
    }

    override fun onInterrupt() = Unit

    override fun onUnbind(intent: Intent?): Boolean {
        getSharedPreferences("capture", MODE_PRIVATE).unregisterOnSharedPreferenceChangeListener(settingsChanged)
        handler.removeCallbacksAndMessages(null)
        removeBubble()
        readers.values.forEach { it.reset() }
        ScreenStatus.lastStructure = ""
        return super.onUnbind(intent)
    }

    private fun onScreenChanged() {
        refreshBubble()
        val now = System.currentTimeMillis()
        if (CaptureSettings(this).load().readingMode(now) == CaptureMode.AUTO) autoRead()
    }

    /** The chat app in front, if it is one we support AND the user switched it on. */
    private fun activeApp(root: AccessibilityNodeInfo?, policy: CapturePolicy): ChatApp? {
        val app = ChatApps.forPackage(root?.packageName?.toString()) ?: return null
        return if (policy.appActive(app.source)) app else null
    }

    // ---- automatic mode ----

    private fun autoRead() {
        val root = rootInActiveWindow ?: return
        val app = activeApp(root, CaptureSettings(this).load())
        if (app == null) { // another app, or one that is switched off: forget the chats
            if (ChatApps.forPackage(root.packageName?.toString()) == null) readers.values.forEach { it.reset() }
            return
        }

        val node = toNode(app, root, 0, intArrayOf(MAX_NODES))
        record(node)

        val config = TokenStore(this).load() ?: return // not connected yet: nothing is sent
        readers.getValue(app.source).read(node, resources.displayMetrics.widthPixels).forEach { send(config, app, it) }
    }

    // ---- on-tap mode ----

    /** Shows or hides the floating button. It is shown only in tap mode, only over a chat of an app that is on, and not if hidden for today. */
    private fun refreshBubble() {
        val now = System.currentTimeMillis()
        val policy = CaptureSettings(this).load()
        if (policy.readingMode(now) != CaptureMode.TAP) return removeBubble() // other modes: no button, and no looking at the screen for it
        val root = rootInActiveWindow
        val app = activeApp(root, policy)
        if (root != null && ChatApps.forPackage(root.packageName?.toString()) == null) readers.values.forEach { it.reset() } // an explicit other app (not just a blink)
        val chatOpen = app != null && root != null && app.ids.chatName.any { root.findAccessibilityNodeInfosByViewId("${root.packageName}:id/$it").isNotEmpty() }

        // a single empty look is often just a screen transition: only believe "gone" after two in a row
        misses = if (chatOpen) 0 else misses + 1
        if (policy.showBubble(now, chatOpen || misses < 2 && bubble != null)) {
            if (bubble == null) bubble = Bubble(this, ::captureNow, ::hideBubbleForToday).also { it.show() }
            handler.removeCallbacks(pollBubble)
            handler.postDelayed(pollBubble, POLL_MS) // while it is showing, notice when you leave the app
        } else {
            removeBubble()
        }
    }

    private fun removeBubble() {
        handler.removeCallbacks(pollBubble)
        bubble?.remove()
        bubble = null
    }

    /** The button was tapped: send everything visible that was not sent before. */
    private fun captureNow() {
        val root = rootInActiveWindow
        val app = activeApp(root, CaptureSettings(this).load())
        if (root == null || app == null) return toast("Open a chat in WhatsApp or Teams first")
        val config = TokenStore(this).load() ?: return toast("Not connected. Open ActionBrain, then Settings, then Phone messages.")

        val node = toNode(app, root, 0, intArrayOf(MAX_NODES))
        record(node)
        val messages = readers.getValue(app.source).captureVisible(node, resources.displayMetrics.widthPixels)
        if (messages.isEmpty()) return toast("Nothing new to capture")
        messages.forEach { send(config, app, it) }
        toast(if (messages.size == 1) "✓ 1 message captured" else "✓ ${messages.size} messages captured")
    }

    private fun hideBubbleForToday() {
        val tomorrow = Calendar.getInstance().apply {
            add(Calendar.DAY_OF_YEAR, 1)
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        CaptureSettings(this).hideBubbleUntil(tomorrow)
        removeBubble()
        Toast.makeText(this, R.string.bubble_hidden_today, Toast.LENGTH_LONG).show()
    }

    // ---- shared ----

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    private fun record(node: ScreenNode) {
        ScreenStatus.lastStructure = ScreenStructure.dump(node)
        ScreenStatus.lastSeenAt = System.currentTimeMillis()
    }

    private fun send(config: TokenStore.Config, app: ChatApp, m: ChatMessage) {
        // your own message: the title is the chat it was written in. Someone else's: the title is who wrote it.
        IntakeClient.send(this, config, Payload.message(if (m.mine) m.chat else m.sender, m.text, m.group, m.mine, app.source))
    }

    /** Copies the screen into plain nodes. Text is copied ONLY for the three parts this app's reader uses; every other node keeps just its shape. */
    private fun toNode(app: ChatApp, info: AccessibilityNodeInfo, depth: Int, budget: IntArray): ScreenNode {
        budget[0]--
        val bounds = Rect().also { info.getBoundsInScreen(it) }
        val id = info.viewIdResourceName
        val wanted = app.ids.wanted(id)
        val children = ArrayList<ScreenNode>()
        if (depth < MAX_DEPTH) {
            for (i in 0 until info.childCount) {
                if (budget[0] <= 0) break
                val child = info.getChild(i) ?: continue
                children += toNode(app, child, depth + 1, budget)
            }
        }
        return ScreenNode(id, info.className?.toString(), if (wanted) info.text?.toString() else null, bounds.left, bounds.top, bounds.right, bounds.bottom, children)
    }

    private companion object {
        const val DEBOUNCE_MS = 600L
        const val POLL_MS = 1500L
        const val MAX_DEPTH = 40
        const val MAX_NODES = 800
    }
}
