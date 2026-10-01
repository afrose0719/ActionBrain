"use client";

import { useEffect } from "react";

// Registers the service worker. Skipped in development so a cached page can never confuse local work.
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      /* installing as an app still works without it */
    });
  }, []);
  return null;
}
