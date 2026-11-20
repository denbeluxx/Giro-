/* Shotgun — notifiche. Caricato dal service worker dell'app (importScripts). */
self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch (e) { d = { body: event.data ? event.data.text() : '' } }
  const scope = self.registration.scope
  event.waitUntil(self.registration.showNotification(d.title || 'Shotgun', {
    body: d.body || '',
    icon: scope + 'icon-192.png',
    badge: scope + 'icon-192.png',
    tag: d.tag,
    renotify: !!d.tag,
    data: { url: d.url || './' },
    actions: Array.isArray(d.actions) ? d.actions : [],
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  let url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href
  // tasto «Shotgun!» sulla notifica: l'app apre l'uscita e prenota il posto davanti
  if (event.action === 'shotgun') url += (url.includes('?') ? '&' : '?') + 'shotgun=1'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.navigate(url).then((w) => (w || c).focus())
    }
    return self.clients.openWindow(url)
  }))
})
