"use client";
import { useEffect, useState } from "react";

// Registers the service worker AND keeps an installed PWA up to date:
// - checks for a new SW on load and whenever the app regains focus
// - when a new SW takes control, reloads once so the latest deploy is shown
//
// A service-worker failure only costs offline support, so it does not block the
// app — but it is never swallowed: it is logged and rendered as a one-line
// notice, so "the PWA stopped updating" is diagnosable (INV-NO-SWALLOW).
export default function PWARegister() {
  const [swError, setSwError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const note = (stage) => (err) => {
      console.warn(`[pwa] ${stage} failed:`, err);
      setSwError("Offline mode is unavailable in this browser session — the app still works online.");
    };

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
        reg.update().catch(note("update"));
        if (reg.waiting) reg.waiting.postMessage("skip-waiting");
      }).catch(note("getRegistration"));

    const register = () =>
      navigator.serviceWorker.register("/sw.js").then(() => checkForUpdate()).catch(note("register"));

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

  if (!swError) return null;
  return (
    <p role="status" className="fixed bottom-2 inset-x-2 z-40 rounded-lg bg-slate-900/85 px-3 py-1.5 text-center text-[11px] text-slate-100">
      {swError}
    </p>
  );
}
