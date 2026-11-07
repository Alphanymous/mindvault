import { registerSW } from 'virtual:pwa-register'
import { isNativeApp } from './import/web'

/**
 * The offline service worker is for the installed web app only.
 * The Android and desktop apps ship their files inside the app, so a service worker there can only serve the
 * previous version's cached files after an update. Earlier versions did register one, so remove it.
 */
export function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  const bundled = isNativeApp() || !!window.mindvault
  if (!bundled) {
    registerSW({ immediate: true })
    return
  }
  void removeStaleServiceWorker()
}

async function removeStaleServiceWorker() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    if (!regs.length) return
    await Promise.all(regs.map((r) => r.unregister()))
    if ('caches' in window) for (const key of await caches.keys()) await caches.delete(key)
    // The page that is open was served by the old worker: load it once more from the app itself.
    if (navigator.serviceWorker.controller) location.reload()
  } catch {
    // Nothing else to do: the app still works, it may just show the previous version until restarted.
  }
}
