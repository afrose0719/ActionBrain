/**
 * Where to send the user after login. Only ever a path on THIS site, so a crafted link
 * cannot bounce someone to another website after they log in (an "open redirect").
 * Returns null if the path is not safe.
 */
export function safeNextPath(path: string | null | undefined): string | null {
  if (!path || typeof path !== "string") return null;
  if (!path.startsWith("/")) return null; // "https://evil.com", "evil.com", "javascript:..."
  if (path[1] === "/" || path[1] === "\\") return null; // "//evil.com" and "/\evil.com" both mean "another site" to a browser
  if (/[\u0000-\u001f\u007f\s]/.test(path)) return null; // control characters, spaces, tabs, newlines
  if (path === "/login" || path.startsWith("/login?") || path.startsWith("/login/")) return null; // never loop back to login
  return path.length <= 2000 ? path : null;
}

/** Text arriving from the Android Share menu (/inbox?title=...&text=...&url=...). Null when nothing was shared. */
export function sharedTextFrom(search: string, max = 6000): string | null {
  const p = new URLSearchParams(search);
  const text = [p.get("title"), p.get("text"), p.get("url")]
    .filter((v): v is string => !!v && v.trim().length > 0)
    .map((v) => v.trim())
    .join("\n");
  return text ? text.slice(0, max) : null;
}
