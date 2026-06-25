"use client";
import { useEffect } from "react";

// Registers the service worker AND keeps an installed PWA up to date:
// - checks for a new SW on load and whenever the app regains focus
// - when a new SW takes control, reloads once so the latest deploy is shown
export default function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const checkForUpdate = () =>
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) return;
        reg.update().catch(() => {});
        if (reg.waiting) reg.waiting.postMessage("skip-waiting");
      }).catch(() => {});

    const register = () =>
      navigator.serviceWorker.register("/sw.js").then(() => checkForUpdate()).catch(() => {});

    window.addEventListener("load", register);
    const onFocus = () => checkForUpdate();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForUpdate(); });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("load", register);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return null;
}
