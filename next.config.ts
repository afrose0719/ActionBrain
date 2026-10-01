import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content Security Policy: the browser refuses to load anything not on this list.
// 'unsafe-inline' for scripts is required by Next.js's own inline bootstrap scripts unless every page is
// rendered per-request with a nonce. This app never inserts raw HTML (React escapes everything), which is
// what makes this acceptable. 'unsafe-eval' and websockets are only needed by the dev server.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' https://*.supabase.co${isDev ? " ws://localhost:* http://localhost:*" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

// The policy for Web Workers, which is separate from the one for pages. A worker is governed by the headers on its OWN
// script file (served from /_next/static), not by the page that starts it. Local speech recognition (Whisper) runs in
// a worker and needs two things pages do not: to run WebAssembly, and to download model files from Hugging Face.
// Giving only the static script files these permissions leaves every page's policy above unchanged and strict.
// The audio itself is never sent anywhere: only the model files are downloaded.
const workerCsp = [
  "default-src 'self'",
  // blob: because the speech engine loads its own loader script by first copying it into a temporary blob URL
  `script-src 'self' blob: 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" }, // older browsers; frame-ancestors covers modern ones
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone stays allowed for our own pages because voice input needs it
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false, // do not advertise "X-Powered-By: Next.js"
  headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Listed later, so for these files it replaces the page policy above (see "Header Overriding Behavior" in the Next.js docs).
      { source: "/_next/static/:path*", headers: [{ key: "Content-Security-Policy", value: workerCsp }] },
      {
        // The service worker must never be cached, or users would be stuck on an old version of it.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
