"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

// Chrome and Edge fire "beforeinstallprompt" when the app can be installed. Safari (iPhone) never does, and
// has to be installed by hand from the Share menu, so we detect that case to show instructions instead.
type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const never = () => () => {};

export function useInstall() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [justInstalled, setJustInstalled] = useState(false);

  // already running as an installed app?
  const standalone = useSyncExternalStore(
    never,
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    () => false
  );
  const isIos = useSyncExternalStore(never, () => /iphone|ipad|ipod/i.test(navigator.userAgent), () => false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the event so Settings can show its own Install button
      setDeferred(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setJustInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null); // the browser only allows one prompt per event
  }, [deferred]);

  return { installed: standalone || justInstalled, canInstall: deferred !== null, isIos, install };
}
