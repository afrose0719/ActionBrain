package app.actionbrain.android

/**
 * The pure, Android-free logic of the app. Keeping it here (not in the service) lets plain unit tests check it.
 *
 * What the app sends to ActionBrain is exactly what the website's /api/intake accepts: JSON {"title","text","group"}.
 * The server does the filtering (system notices, photos, allowed senders); the app only forwards.
 */
object Payload {
    private val TOKEN = Regex("^abi_[A-Za-z0-9_-]{43}$")

    fun looksLikeToken(value: String?): Boolean = value != null && TOKEN.matches(value)

    /** The app may only ever send the token to ITS OWN website's intake address. */
    fun isIntakeAddress(address: String?, appUrl: String): Boolean = address != null && address == appUrl.trimEnd('/') + "/api/intake"

    /** A JSON string literal, with everything that must be escaped, escaped. */
    fun quote(value: String): String {
        val out = StringBuilder(value.length + 2).append('"')
        for (c in value) {
            when {
                c == '"' -> out.append("\\\"")
                c == '\\' -> out.append("\\\\")
                c == '\n' -> out.append("\\n")
                c == '\r' -> out.append("\\r")
                c == '\t' -> out.append("\\t")
                c < ' ' || c == ' ' || c == ' ' -> out.append("\\u").append(c.code.toString(16).padStart(4, '0'))
                else -> out.append(c)
            }
        }
        return out.append('"').toString()
    }

    /** group is null for a one-to-one chat. Text is cut to what the server accepts (it cuts again, so this is only a courtesy). */
    fun message(sender: String, text: String, group: String?): String {
        val parts = mutableListOf("\"title\":" + quote(sender.take(100)), "\"text\":" + quote(text.take(1500)))
        if (!group.isNullOrBlank()) parts += "\"group\":" + quote(group.take(100))
        return "{" + parts.joinToString(",") + "}"
    }
}

/**
 * A file shared TO the app (an exported WhatsApp chat) waits here until the website asks for it, exactly once.
 * It lives in memory only: never written to disk, never sent anywhere by the app. The website reads it and shows it for your review.
 */
object PendingShare {
    private var json: String? = null

    @Synchronized
    fun setFile(name: String, text: String) {
        json = "{\"name\":" + Payload.quote(name.take(200)) + ",\"text\":" + Payload.quote(text) + "}"
    }

    @Synchronized
    fun setError(message: String) {
        json = "{\"error\":" + Payload.quote(message) + "}"
    }

    /** The waiting file as JSON, or "" if none. Reading it clears it. */
    @Synchronized
    fun take(): String {
        val value = json ?: ""
        json = null
        return value
    }
}

/**
 * Android often posts the same notification again (when it is updated, or when you open the chat).
 * A message with the same sender and text seen within the window is not sent twice. (The server also drops repeats.)
 */
class RecentSet(private val windowMs: Long = 2 * 60_000, private val maxSize: Int = 100, private val clock: () -> Long = System::currentTimeMillis) {
    private val seen = LinkedHashMap<String, Long>()

    /** True the first time a key is seen inside the window. */
    @Synchronized
    fun firstTime(key: String): Boolean {
        val now = clock()
        val it = seen.entries.iterator()
        while (it.hasNext()) if (now - it.next().value > windowMs) it.remove()
        if (seen.containsKey(key)) return false
        seen[key] = now
        while (seen.size > maxSize) seen.remove(seen.keys.first())
        return true
    }
}
