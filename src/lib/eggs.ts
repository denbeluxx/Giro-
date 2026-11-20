import { tripEffect, type Balances } from './calc'
import type { ID, Member, Trip } from './types'

/**
 * Easter egg: tutte funzioni pure, calcolate dai viaggi confermati.
 * Nessun dato in più viene salvato: se un viaggio cambia, cambiano anche titoli e medaglie.
 */

const confirmed = (trips: Trip[]) => trips.filter((t) => t && t.status === 'confirmed' && typeof t.startsAt === 'string')

/** «Pilota» a chi ha il saldo più alto (positivo), «Parassita» a chi ce l'ha più basso (negativo). Solo se non c'è pareggio. */
export function titles(shown: Record<ID, number>, ids: ID[]): { pilota?: ID; parassita?: ID } {
  if (ids.length < 2) return {}
  const vals = ids.map((id) => ({ id, v: shown[id] ?? 0 }))
  const max = Math.max(...vals.map((x) => x.v)), min = Math.min(...vals.map((x) => x.v))
  const top = vals.filter((x) => x.v === max), bottom = vals.filter((x) => x.v === min)
  return {
    pilota: max > 0 && top.length === 1 ? top[0].id : undefined,
    parassita: min < 0 && bottom.length === 1 ? bottom[0].id : undefined,
  }
}

/** Conducente di un'uscita (chi guida all'andata guida anche al ritorno). */
const driverOf = (t: Trip) => t.legs?.find((l) => l?.driverId)?.driverId ?? null

/** «Santo protettore»: chi ha guidato le ultime 5 uscite confermate del gruppo, una dopo l'altra. */
export const SAINT_STREAK = 5
export function saint(trips: Trip[]): { id: ID; streak: number } | null {
  const list = confirmed(trips).filter((t) => driverOf(t)).sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1))
  const first = list[0] && driverOf(list[0])
  if (!first) return null
  let n = 0
  for (const t of list) { if (driverOf(t) !== first) break; n++ }
  return n >= SAINT_STREAK ? { id: first, streak: n } : null
}

/** «Disperso»: da almeno 15 giorni non partecipa a nessuna uscita confermata (né è nel gruppo da meno tempo). */
export const LOST_DAYS = 15
export function lostDays(m: Member, trips: Trip[], now = Date.now()): number | null {
  if (m.leftAt) return null
  const seen = confirmed(trips).filter((t) => (t.presentIds ?? []).includes(m.id)).map((t) => t.startsAt).sort().pop()
  const since = seen ?? m.joinedAt
  const t = Date.parse(since)
  if (!Number.isFinite(t)) return null
  const days = Math.floor((now - t) / 86400e3)
  return days >= LOST_DAYS ? days : null
}

/** «Record»: l'uscita confermata più lunga (km reali). */
export function recordTripId(trips: Trip[]): ID | null {
  let best: { id: ID; m: number } | null = null
  for (const t of confirmed(trips)) {
    const m = tripEffect(t).realMeters
    if (m > 0 && (!best || m > best.m)) best = { id: t.id, m }
  }
  return best?.id ?? null
}

/** «Nottambuli»: rientro tra le 4 e le 8 del mattino. */
export function nightOwl(t: Trip): string | null {
  const time = t.legs?.find((l) => l?.kind === 'ritorno')?.time
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return null
  const h = Number(time.split(':')[0])
  return h >= 4 && h < 8 ? time : null
}

/** «Pari perfetto»: saldo mostrato esattamente 0,0 km dopo aver partecipato ad almeno un'uscita. */
export function perfectEven(id: ID, shown: Record<ID, number>, trips: Trip[]): boolean {
  return (shown[id] ?? 0) === 0 && confirmed(trips).some((t) => (t.presentIds ?? []).includes(id))
}

/** Roulette: chi è a pari merito per il saldo più basso tra i presenti disponibili (confronto al decimo di km). */
export function tiedForDriver(members: Member[], presentIds: ID[], unavailableIds: ID[], bal: Balances): ID[] {
  const cands = members.filter((m) => presentIds.includes(m.id) && !unavailableIds.includes(m.id))
  if (cands.length < 2) return []
  const tenth = (id: ID) => Math.round((bal.km[id] ?? 0) / 100)
  const min = Math.min(...cands.map((m) => tenth(m.id)))
  const tied = cands.filter((m) => tenth(m.id) === min).map((m) => m.id)
  return tied.length >= 2 ? tied : []
}
