package app.actionbrain.android

import android.app.assist.AssistContent
import android.app.assist.AssistStructure
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.speech.RecognitionService
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Milestone 31: ActionBrain as the phone's default digital assistant (Settings -> Apps -> Default apps -> Digital assistant app).
 * Long-press the power or home button in a WhatsApp or Teams chat: Android hands ActionBrain that ONE screen, ActionBrain shows what it
 * found ("5 messages from Priya (WhatsApp)") and sends it only when the user taps Send. Works in the Google Play build: it uses the
 * Assist API that assistant apps use, not an Accessibility service, and reads nothing unless the user asks.
 */
class ActionBrainAssistService : VoiceInteractionService()

class AssistSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession = AssistSession(this)
}

/** Android requires every assistant to name a speech recogniser. ActionBrain has none of its own: this one does nothing. */
class AssistRecognitionService : RecognitionService() {
    override fun onStartListening(recognizerIntent: Intent?, listener: Callback?) {
        runCatching { listener?.error(android.speech.SpeechRecognizer.ERROR_CLIENT) }
    }
    override fun onCancel(listener: Callback?) = Unit
    override fun onStopListening(listener: Callback?) = Unit
}

class AssistSession(context: Context) : VoiceInteractionSession(context) {
    private lateinit var title: TextView
    private lateinit var detail: TextView
    private lateinit var send: Button
    private var found: List<ChatMessage> = emptyList()
    private var app: ChatApp? = null

    override fun onCreateContentView(): View {
        val pad = (16 * context.resources.displayMetrics.density).toInt()
        title = TextView(context).apply { textSize = 17f; setTypeface(typeface, Typeface.BOLD); text = context.getString(R.string.assist_reading) }
        detail = TextView(context).apply { textSize = 14f; setPadding(0, pad / 2, 0, pad) }
        send = Button(context).apply {
            text = context.getString(R.string.assist_send)
            isEnabled = false
            setOnClickListener { sendAll() }
        }
        val cancel = Button(context).apply { text = context.getString(R.string.assist_cancel); setOnClickListener { finish() } }
        val buttons = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END; addView(cancel); addView(send) }
        return LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(0xFFFFFFFF.toInt())
            addView(title)
            addView(detail)
            addView(buttons)
            gravity = Gravity.BOTTOM
        }
    }

    @Deprecated("Android 10+ calls onHandleAssist(AssistState), whose default implementation calls this one")
    @Suppress("DEPRECATION")
    override fun onHandleAssist(data: Bundle?, structure: AssistStructure?, content: AssistContent?) {
        val result = read(structure)
        found = result.second
        app = result.first
        val message = when {
            TokenStore(context).load() == null -> context.getString(R.string.assist_not_connected)
            result.first == null -> context.getString(R.string.assist_not_chat)
            !CaptureSettings(context).load().appActive(result.first!!.source) -> context.getString(R.string.assist_app_off, result.first!!.label)
            else -> null
        }
        if (::title.isInitialized) {
            if (message != null) {
                title.text = message
                detail.text = ""
                found = emptyList()
            } else {
                title.text = AssistCapture.summary(result.first!!, found)
                detail.text = context.getString(R.string.assist_detail)
                send.isEnabled = found.isNotEmpty()
            }
        }
    }

    private fun read(structure: AssistStructure?): Pair<ChatApp?, List<ChatMessage>> {
        if (structure == null) return null to emptyList()
        val chatApp = ChatApps.forPackage(structure.activityComponent?.packageName) ?: return null to emptyList()
        val width = context.resources.displayMetrics.widthPixels
        val messages = ArrayList<ChatMessage>()
        for (i in 0 until structure.windowNodeCount) {
            val window = structure.getWindowNodeAt(i)
            val root = AssistCapture.toScreenNode(chatApp, ViewNodeAdapter(window.rootViewNode), window.left, window.top)
            messages += ChatReader(chatApp.ids).captureVisible(root, width)
        }
        return chatApp to messages.distinctBy { "${it.chat}|${it.sender}|${it.mine}|${it.text}" }
    }

    private fun sendAll() {
        val config = TokenStore(context).load()
        val chatApp = app
        if (config == null || chatApp == null || found.isEmpty()) return finish()
        for (m in found) {
            // your own message: the title is the chat it was written in. Someone else's: the title is who wrote it.
            IntakeClient.send(context, config, Payload.message(if (m.mine) m.chat else m.sender, m.text, m.group, m.mine, chatApp.source))
        }
        title.text = context.getString(R.string.assist_sent, found.size)
        detail.text = ""
        send.isEnabled = false
        title.postDelayed({ finish() }, 900)
    }
}

/** Android's view description, seen through [AssistView] so the conversion stays pure and testable. */
private class ViewNodeAdapter(private val node: AssistStructure.ViewNode) : AssistView {
    override val idPackage: String? get() = node.idPackage
    override val idEntry: String? get() = node.idEntry
    override val className: String? get() = node.className
    override val text: CharSequence? get() = node.text
    override val contentDescription: CharSequence? get() = node.contentDescription
    override val left: Int get() = node.left
    override val top: Int get() = node.top
    override val width: Int get() = node.width
    override val height: Int get() = node.height
    override val scrollX: Int get() = node.scrollX
    override val scrollY: Int get() = node.scrollY
    override val children: List<AssistView> get() = (0 until node.childCount).map { ViewNodeAdapter(node.getChildAt(it)) }
}
