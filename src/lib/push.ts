import { useEffect, useState } from 'react'
import { store } from './store'

/** Notifiche del telefono: stato e iscrizione di questo dispositivo. */
export type PushState = 'unsupported' | 'needs-home' | 'denied' | 'off' | 'on'

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true

export async function pushState(): Promise<PushState> {
  if (store.mode !== 'cloud') return 'unsupported'
  // su iPhone le notifiche arrivano solo all'app aggiunta alla schermata Home
  if (isIOS() && !standalone()) return 'needs-home'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    return sub && Notification.permission === 'granted' ? 'on' : 'off'
  } catch { return 'off' }
}

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
const bytesToB64 = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '')

/** Da chiamare dopo un tocco: chiede il permesso e iscrive il dispositivo. */
export async function enablePush(): Promise<PushState> {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off'
  const reg = await navigator.serviceWorker.ready
  const key = await store.pushKey()
  let sub = await reg.pushManager.getSubscription()
  // una vecchia iscrizione fatta con un'altra chiave non riceverebbe nulla: si rifà
  const same = sub && bytesToB64(sub.options.applicationServerKey as ArrayBuffer) === key
  if (sub && !same) { await sub.unsubscribe().catch(() => {}); sub = null }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) })
  await store.savePush({ endpoint: sub.endpoint, p256dh: bytesToB64(sub.getKey('p256dh')), auth: bytesToB64(sub.getKey('auth')) })
  store.notify({ type: 'test' }).catch(() => {}) // conferma immediata sul telefono
  share('on')
  return 'on'
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) { await store.deletePush(sub.endpoint).catch(() => {}); await sub.unsubscribe().catch(() => {}) }
  share('off')
  return 'off'
}

/** Stato delle notifiche di questo dispositivo, condiviso tra le schermate (home, Gruppo, guida). */
let shared: PushState | null = null
const listeners = new Set<(s: PushState) => void>()
function share(s: PushState) { shared = s; listeners.forEach((f) => f(s)) }
export function usePush() {
  const [state, setState] = useState<PushState | null>(shared)
  useEffect(() => {
    listeners.add(setState)
    if (shared == null) pushState().then(share)
    return () => { listeners.delete(setState) }
  }, [])
  return [state, share] as const
}

/** All'apertura: se il telefono è già iscritto, l'iscrizione passa all'account attuale (es. dopo un cambio di account). */
export async function syncPush(): Promise<void> {
  if ((await pushState()) !== 'on') return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  const key = await store.pushKey()
  if (bytesToB64(sub.options.applicationServerKey as ArrayBuffer) !== key) { await sub.unsubscribe().catch(() => {}); share('off'); return }
  await store.savePush({ endpoint: sub.endpoint, p256dh: bytesToB64(sub.getKey('p256dh')), auth: bytesToB64(sub.getKey('auth')) })
}

export const PUSH_TEXT: Record<PushState, string> = {
  on: 'Nuove uscite, Shotgun, viaggi da confermare e saldo sotto i −70 km.',
  off: 'Nuove uscite, Shotgun, viaggi da confermare e saldo sotto i −70 km.',
  denied: 'Bloccate: riattivale dalle impostazioni del telefono per Shotgun, poi torna qui.',
  'needs-home': 'Su iPhone arrivano solo all\'app sulla schermata Home: Condividi → «Aggiungi alla schermata Home», poi aprila da lì.',
  unsupported: 'Con i dati dimostrativi o su questo browser le notifiche non sono disponibili.',
}
