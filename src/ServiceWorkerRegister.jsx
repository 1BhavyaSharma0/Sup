import { useEffect } from "react";
// The service worker is only registered for production builds; in development it would cache stale modules.
export default function ServiceWorkerRegister() {
  useEffect(() => { if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("/sw.js").catch(() => {}); }, []);
  return null;
}
