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
    background_color: "#f5f3ed",
    theme_color: "#24756e",
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
    // Android: "Share" from WhatsApp, Gmail, or a call recorder, and pick ActionBrain.
    //  - text goes to the Inbox form
    //  - a call recording (audio file) goes to Meetings, to be transcribed on the device
    // It is a POST because files cannot travel in a web address. public/sw.js receives it (src/app/share-target/route.ts is the fallback).
    share_target: {
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "audio", accept: ["audio/*", ".m4a", ".mp3", ".aac", ".wav", ".ogg", ".opus", ".amr", ".3gp", ".3gpp", ".mp4"] }],
      },
    },
  };
}
