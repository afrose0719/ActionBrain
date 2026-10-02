package app.actionbrain.android

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.window.OnBackInvokedDispatcher
import android.widget.FrameLayout

/**
 * The ActionBrain app: your ActionBrain website in a window, plus the phone abilities the website cannot have by itself
 * (see WebBridge and WhatsAppListenerService). It opens ONE website, BuildConfig.APP_URL, and nothing else.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private val appHost: String? = Uri.parse(BuildConfig.APP_URL).host
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingAudio: PermissionRequest? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this)
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        keepContentClearOfSystemBars(root)
        configureWebView()

        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { goBackOrLeave() }
        }
        web.loadUrl(startUrl(intent))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == Intent.ACTION_SEND) web.loadUrl(startUrl(intent)) // text shared from another app
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    @Deprecated("Used on Android 12 and older; newer versions use the callback registered in onCreate.")
    override fun onBackPressed() = goBackOrLeave()

    private fun goBackOrLeave() {
        if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
    }

    /** Shared text opens the Inbox with it filled in (same as the website's own Share target). Anything else opens the dashboard. */
    private fun startUrl(intent: Intent?): String {
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val builder = Uri.parse(BuildConfig.APP_URL).buildUpon().path("/inbox")
            intent.getStringExtra(Intent.EXTRA_SUBJECT)?.takeIf { it.isNotBlank() }?.let { builder.appendQueryParameter("title", it.take(500)) }
            intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }?.let { builder.appendQueryParameter("text", it.take(6000)) }
            return builder.build().toString()
        }
        return BuildConfig.APP_URL + "/dashboard"
    }

    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true // the website keeps your login here
            allowFileAccess = false
            mediaPlaybackRequiresUserGesture = true
            userAgentString = "$userAgentString ActionBrainApp/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(WebBridge(this, TokenStore(this)), "ActionBrainAndroid")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.scheme == "https" && uri.host == appHost) return false // stays in the app
                // anything else (a link in a message, a mail address, a phone number) opens outside, never inside the app
                if (uri.scheme in setOf("https", "http", "mailto", "tel")) runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) view.loadDataWithBaseURL(null, OFFLINE_HTML, "text/html", "utf-8", null)
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            // the Record button: the microphone, and only for our own website
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val wantsMic = PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources
                    if (request.origin.host != appHost || !wantsMic) return@runOnUiThread request.deny()
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    } else {
                        pendingAudio?.deny()
                        pendingAudio = request
                        requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_AUDIO)
                    }
                }
            }

            // "Use a call recording" and "Import chat" ask for a file
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    startActivityForResult(params.createIntent(), REQ_FILE)
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }
        }
    }

    @Deprecated("Kept because the framework Activity is used on purpose (no extra libraries).")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
        } else {
            @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_AUDIO) return
        val request = pendingAudio ?: return
        pendingAudio = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else request.deny()
    }

    /** Android 15+ draws apps edge to edge; this keeps the website clear of the status bar, the navigation bar and the keyboard. */
    private fun keepContentClearOfSystemBars(root: FrameLayout) {
        root.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
    }

    private companion object {
        const val REQ_FILE = 1
        const val REQ_AUDIO = 2
        val OFFLINE_HTML = """
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
            <body style="font-family:sans-serif;margin:0;padding:48px 24px;text-align:center;color:#334155">
              <h2>ActionBrain can't be reached</h2>
              <p>Check your connection, then try again.</p>
              <p><a href="${BuildConfig.APP_URL}/dashboard" style="display:inline-block;margin-top:12px;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none">Try again</a></p>
            </body></html>
        """.trimIndent()
    }
}
