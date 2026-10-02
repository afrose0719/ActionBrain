package app.actionbrain.android

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.TextView
import kotlin.math.hypot

/**
 * The floating ActionBrain button shown over a WhatsApp chat in "On tap" mode.
 *  - tap: [onTap] (capture what is on screen)
 *  - drag: moves it, and remembers where
 *  - long-press: [onLongPress] (hide it for today)
 * It is drawn as an accessibility overlay window, which Android allows an accessibility service to do WITHOUT the separate
 * "Display over other apps" permission. It never takes the keyboard focus, so it does not get in the way of typing.
 */
class Bubble(private val service: AccessibilityService, private val onTap: () -> Unit, private val onLongPress: () -> Unit) {
    private val windows = service.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val prefs = service.getSharedPreferences("bubble", Context.MODE_PRIVATE)
    private val handler = Handler(Looper.getMainLooper())
    private val density = service.resources.displayMetrics.density
    private val size = (SIZE_DP * density).toInt()
    private val screenWidth get() = service.resources.displayMetrics.widthPixels
    private val screenHeight get() = service.resources.displayMetrics.heightPixels
    private val slop = ViewConfiguration.get(service).scaledTouchSlop
    private var added = false

    private val view = TextView(service).apply {
        text = "A"
        gravity = Gravity.CENTER
        setTextColor(Color.WHITE)
        textSize = 20f
        typeface = Typeface.DEFAULT_BOLD
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(0xE64F46E5.toInt()) // the ActionBrain indigo, a little see-through
        }
        elevation = 6 * density
        contentDescription = service.getString(R.string.bubble_description)
        setOnClickListener { onTap() } // also what TalkBack's double-tap triggers
    }

    private val params = WindowManager.LayoutParams(
        size,
        size,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        // first time: the right edge, a third of the way down, clear of the message box and the send button
        x = prefs.getInt("x", screenWidth - size - (8 * density).toInt()).coerceIn(0, (screenWidth - size).coerceAtLeast(0))
        y = prefs.getInt("y", screenHeight / 3).coerceIn(0, (screenHeight - size).coerceAtLeast(0))
    }

    init {
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var moved = false
        var longFired = false
        val longPress = Runnable {
            if (!moved) {
                longFired = true
                onLongPress()
            }
        }
        view.setOnTouchListener { v, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX; downY = event.rawY; startX = params.x; startY = params.y
                    moved = false; longFired = false
                    handler.postDelayed(longPress, ViewConfiguration.getLongPressTimeout() + 200L)
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    if (!moved && hypot(dx, dy) > slop) {
                        moved = true
                        handler.removeCallbacks(longPress)
                    }
                    if (moved && added) {
                        params.x = (startX + dx).toInt().coerceIn(0, (screenWidth - size).coerceAtLeast(0))
                        params.y = (startY + dy).toInt().coerceIn(0, (screenHeight - size).coerceAtLeast(0))
                        runCatching { windows.updateViewLayout(view, params) }
                    }
                }
                MotionEvent.ACTION_UP -> {
                    handler.removeCallbacks(longPress)
                    if (moved) prefs.edit().putInt("x", params.x).putInt("y", params.y).apply() else if (!longFired) v.performClick()
                }
                MotionEvent.ACTION_CANCEL -> handler.removeCallbacks(longPress)
            }
            true
        }
    }

    fun show() {
        if (added) return
        added = runCatching { windows.addView(view, params) }.isSuccess
    }

    fun remove() {
        handler.removeCallbacksAndMessages(null)
        if (added) runCatching { windows.removeView(view) }
        added = false
    }

    private companion object {
        const val SIZE_DP = 52
    }
}
