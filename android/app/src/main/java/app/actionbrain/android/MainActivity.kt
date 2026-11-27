package app.actionbrain.android

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
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
import java.io.ByteArrayOutputStream

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
        AutoProcess.ensurePeriodic(this) // zero-touch safety net: every 6 hours, only does work if switched on
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
        if (intent.action == Intent.ACTION_SEND || intent.action == RecapIntent.ACTION) web.loadUrl(startUrl(intent)) // shared text, or an after-call recap
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        Outbox.flushSoon(this) // anything waiting goes out as soon as the app is opened
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

    /**
     * Shared text opens the Inbox with it filled in (same as the website's own Share target).
     * A shared FILE (WhatsApp: chat, more, Export chat, without media) is read here, held in memory, and handed to the Inbox page once.
     * Anything else opens the dashboard.
     */
    private fun startUrl(intent: Intent?): String {
        if (intent?.action == RecapIntent.ACTION) {
            RecapIntent.safeUrl(BuildConfig.APP_URL, intent.getStringExtra(RecapIntent.EXTRA_URL))?.let { return it }
        }
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain" && sharedStream(intent) != null) {
            readSharedFile(sharedStream(intent)!!)
            return BuildConfig.APP_URL + "/inbox?shared=file"
        }
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val builder = Uri.parse(BuildConfig.APP_URL).buildUpon().path("/inbox")
            intent.getStringExtra(Intent.EXTRA_SUBJECT)?.takeIf { it.isNotBlank() }?.let { builder.appendQueryParameter("title", it.take(500)) }
            intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }?.let { builder.appendQueryParameter("text", it.take(6000)) }
            return builder.build().toString()
        }
        return BuildConfig.APP_URL + "/dashboard"
    }

    @Suppress("DEPRECATION") // the typed version needs API 33; this app supports 26+
    private fun sharedStream(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra(Intent.EXTRA_STREAM)

    private fun readSharedFile(uri: Uri) {
        try {
            val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "chat.txt"
            val bytes = contentResolver.openInputStream(uri)?.use { input ->
                val out = ByteArrayOutputStream()
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    out.write(buffer, 0, n)
                    if (out.size() > MAX_SHARED_BYTES) return PendingShare.setError("That file is over 5 MB. Export a shorter chat, or paste the part you need.")
                }
                out.toByteArray()
            }
            if (bytes == null) PendingShare.setError("Could not open the shared file.") else PendingShare.setFile(name, String(bytes, Charsets.UTF_8))
        } catch (e: Exception) { // unreadable file, or permission to it already withdrawn
            PendingShare.setError("Could not read the shared file.")
        }
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
                        // prominent disclosure first (Google Play User Data policy); "Not now" never shows Android's prompt
                        pendingAudio?.deny()
                        pendingAudio = request
                        AlertDialog.Builder(this@MainActivity)
                            .setTitle(R.string.mic_consent_title)
                            .setMessage(R.string.mic_consent_body)
                            .setPositiveButton(R.string.screen_consent_agree) { _, _ ->
                                requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_AUDIO)
                            }
                            .setNegativeButton(R.string.consent_not_now) { _, _ -> pendingAudio?.deny(); pendingAudio = null }
                            .setOnCancelListener { pendingAudio?.deny(); pendingAudio = null }
                            .show()
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
        const val MAX_SHARED_BYTES = 5_000_000 // same limit as the website's own chat import
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
