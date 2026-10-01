import type { MetadataRoute } from "next";

// Makes ActionBrain installable ("Add to Home screen" on phones, "Install app" in Chrome/Edge on desktop).
// Served at /manifest.webmanifest. tests/pwa.test.mts checks that every icon and link here really exists.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ActionBrain",
    short_name: "ActionBrain",
    description: "Your AI work memory. Never lose a commitment again.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#4f46e5",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // long-press the app icon on Android / right-click it on desktop
    shortcuts: [
      { name: "Tasks", url: "/tasks", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Inbox", url: "/inbox", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Search", url: "/search", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
    // Android: "Share" from WhatsApp, Gmail, a browser... and pick ActionBrain. The text lands in the Inbox form.
    share_target: {
      action: "/inbox",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
