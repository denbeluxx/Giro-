import type { ID, Leg, Member, Settlement, Toll, TollStatus, Trip } from './types'

/** Soglia della regola ×3: meno di 5 km con flag nella stessa uscita. A 5 km esatti vale ×2. */
export const THRESHOLD_M = 5000

/** Occupanti (conducente compreso) per ciascun tratto tra tappe consecutive. */
export function occupantsBySeg(leg: Leg): ID[][] {
  const out: ID[][] = []
  const aboard = new Set<ID>()
  for (let i = 0; i < leg.stops.length - 1; i++) {
    const s = leg.stops[i]
    for (const id of s.off) aboard.delete(id)
    for (const id of s.on) aboard.add(id)
    const set = new Set(aboard)
    if (leg.driverId) set.add(leg.driverId)
    out.push([...set])
  }
  return out
}

/** Metri effettivi per tratto: quelli del percorso, riscalati se i km sono stati corretti a mano. */
export function segMeters(leg: Leg): number[] {
  if (!leg.segs) return []
  const raw = leg.segs.map((s) => s.meters)
  if (leg.actualMeters == null) return raw
  const sum = raw.reduce((a, b) => a + b, 0)
  if (sum <= 0) return raw.map(() => leg.actualMeters! / Math.max(1, raw.length))
  return raw.map((m) => (m / sum) * leg.actualMeters!)
}

export function legMeters(leg: Leg): number {
  if (leg.actualMeters != null) return leg.actualMeters
  return leg.segs ? leg.segs.reduce((a, s) => a + s.meters, 0) : 0
}

export function legSeconds(leg: Leg): number {
  return leg.segs ? leg.segs.reduce((a, s) => a + s.seconds, 0) : 0
}

const RANK: Record<TollStatus, number> = { none: 0, ok: 1, verify: 2, out: 3 }

/** Pedaggio dell'intera tratta: somma dei tratti, oppure l'importo corretto a mano. */
export function legToll(leg: Leg): Toll & { manual: boolean } {
  if (leg.tollOverride != null) {
    const base = (leg.segs ?? []).map((s) => s.toll).find((t) => t.status !== 'none')
    return { ...(base ?? {}), status: leg.tollOverride > 0 ? 'ok' : 'none', cents: leg.tollOverride, manual: true }
  }
  let status: TollStatus = 'none'
  let cents: number | null = 0
  let ref: Toll | undefined
  for (const s of leg.segs ?? []) {
    if (s.toll.status === 'none') continue
    if (RANK[s.toll.status] > RANK[status]) { status = s.toll.status; ref = s.toll }
    cents = cents == null || s.toll.cents == null ? null : cents + s.toll.cents
  }
  if (status === 'none') return { status, cents: 0, manual: false }
  return { ...ref, status, cents, manual: false }
}

/** Centesimi di pedaggio attribuiti a ciascun tratto. */
function segTollCents(leg: Leg): number[] {
  const segs = leg.segs ?? []
  if (leg.tollOverride != null) {
    const out = segs.map(() => 0)
    if (!segs.length) return out
    let idx = segs.findIndex((s) => s.toll.status !== 'none')
    if (idx < 0) idx = segs.reduce((best, s, i) => (s.meters > segs[best].meters ? i : best), 0)
    out[idx] = leg.tollOverride
    return out
  }
  return segs.map((s) => (s.toll.status === 'none' || s.toll.status === 'out' ? 0 : s.toll.cents ?? 0))
}

/** Arrotonda a interi mantenendo la somma a zero (resto più grande, ordine stabile). */
export function zeroSumRound(vals: Map<ID, number>): Map<ID, number> {
  const ids = [...vals.keys()].sort()
  const out = new Map<ID, number>()
  let sum = 0
  for (const id of ids) { const r = Math.round(vals.get(id)!); out.set(id, r); sum += r }
  if (sum !== 0) {
    const dir = sum > 0 ? -1 : 1
    const order = ids
      .map((id) => ({ id, err: (out.get(id)! - vals.get(id)!) * (sum > 0 ? 1 : -1) }))
      .sort((a, b) => b.err - a.err || (a.id < b.id ? -1 : 1))
    for (let i = 0; i < Math.abs(sum); i++) {
      const id = order[i % order.length].id
      out.set(id, out.get(id)! + dir)
    }
  }
  return out
}

export interface LegEffect {
  kind: Leg['kind']
  driverId: ID | null
  realMeters: number
  mult: 1 | 2 | 3
  weightedMeters: number
  toll: Toll & { manual: boolean }
  payerId: ID | null
}
export interface TripEffect {
  km: Map<ID, number> // metri ponderati, interi, somma zero
  eur: Map<ID, number> // centesimi, somma zero
  legs: LegEffect[]
  realMeters: number
  weightedMeters: number
}

/**
 * Effetto di un'uscita sui saldi. Funzione pura: i saldi del gruppo sono sempre
 * ricalcolati dai viaggi confermati, così modifiche e annullamenti restano coerenti.
 */
export function tripEffect(trip: Trip): TripEffect {
  const flagged = new Map<ID, number>()
  for (const leg of trip.legs) {
    if (leg.designated && leg.driverId) flagged.set(leg.driverId, (flagged.get(leg.driverId) ?? 0) + legMeters(leg))
  }
  const km = new Map<ID, number>()
  const eur = new Map<ID, number>()
  const add = (m: Map<ID, number>, id: ID, v: number) => m.set(id, (m.get(id) ?? 0) + v)
  const legs: LegEffect[] = []
  for (const leg of trip.legs) {
    const real = legMeters(leg)
    const mult: 1 | 2 | 3 = !leg.designated || !leg.driverId ? 1 : (flagged.get(leg.driverId) ?? 0) < THRESHOLD_M ? 3 : 2
    const toll = legToll(leg)
    const payerId = leg.tollPayerId ?? leg.driverId
    legs.push({ kind: leg.kind, driverId: leg.driverId, realMeters: real, mult, weightedMeters: real * mult, toll, payerId })
    if (!leg.driverId) continue
    const occ = occupantsBySeg(leg)
    const meters = segMeters(leg)
    const tolls = segTollCents(leg)
    meters.forEach((m, i) => {
      const who = occ[i]
      if (!who?.length) return
      const w = m * mult
      add(km, leg.driverId!, w)
      for (const id of who) add(km, id, -w / who.length)
      const c = tolls[i]
      if (c > 0 && payerId) {
        add(eur, payerId, c)
        for (const id of who) add(eur, id, -c / who.length)
      }
    })
  }
  return {
    km: zeroSumRound(km),
    eur: zeroSumRound(eur),
    legs,
    realMeters: legs.reduce((a, l) => a + l.realMeters, 0),
    weightedMeters: legs.reduce((a, l) => a + l.weightedMeters, 0),
  }
}

export interface Balances {
  km: Record<ID, number>
  eur: Record<ID, number>
  lastDrove: Record<ID, string | undefined>
}

export function balances(members: Member[], trips: Trip[], settlements: Settlement[]): Balances {
  const km: Record<ID, number> = {}
  const eur: Record<ID, number> = {}
  const lastDrove: Record<ID, string | undefined> = {}
  for (const m of members) { km[m.id] = 0; eur[m.id] = 0 }
  for (const t of trips) {
    if (t.status !== 'confirmed') continue
    const e = tripEffect(t)
    for (const [id, v] of e.km) km[id] = (km[id] ?? 0) + v
    for (const [id, v] of e.eur) eur[id] = (eur[id] ?? 0) + v
    for (const l of t.legs) {
      if (l.driverId && (!lastDrove[l.driverId] || lastDrove[l.driverId]! < t.startsAt)) lastDrove[l.driverId] = t.startsAt
    }
  }
  for (const s of settlements) {
    eur[s.from] = (eur[s.from] ?? 0) + s.cents
    eur[s.to] = (eur[s.to] ?? 0) - s.cents
  }
  return { km, eur, lastDrove }
}

export interface Suggestion { id: ID; reason: string }

/** Tra i presenti disponibili: saldo più basso, poi chi non guida da più tempo, poi ordine di ingresso. */
export function suggestDriver(members: Member[], presentIds: ID[], unavailableIds: ID[], bal: Balances, fmtKm: (m: number) => string): Suggestion | null {
  const cands = members.filter((m) => presentIds.includes(m.id) && !unavailableIds.includes(m.id))
  if (!cands.length) return null
  const tenth = (id: ID) => Math.round((bal.km[id] ?? 0) / 100) // confronto al decimo di km mostrato
  const last = (id: ID) => bal.lastDrove[id] ?? ''
  const sorted = [...cands].sort(
    (a, b) => tenth(a.id) - tenth(b.id) || (last(a.id) < last(b.id) ? -1 : last(a.id) > last(b.id) ? 1 : 0) || (a.joinedAt < b.joinedAt ? -1 : a.joinedAt > b.joinedAt ? 1 : a.id < b.id ? -1 : 1),
  )
  const top = sorted[0]
  const tied = sorted.filter((m) => tenth(m.id) === tenth(top.id))
  let reason: string
  if (tied.length === 1) reason = `${top.name} ha il saldo più basso tra i presenti (${fmtKm(bal.km[top.id] ?? 0)}).`
  else {
    const tiedTime = tied.filter((m) => last(m.id) === last(top.id))
    if (tiedTime.length === 1) reason = last(top.id) ? `A parità di saldo, ${top.name} non guida da più tempo.` : `A parità di saldo, ${top.name} non ha ancora guidato.`
    else reason = `Saldi pari: ${top.name} è il primo per ordine di ingresso nel gruppo.`
  }
  return { id: top.id, reason }
}

/** Rimborsi minimi per azzerare i saldi in euro. */
export function settleUp(eur: Record<ID, number>): { from: ID; to: ID; cents: number }[] {
  const debt = Object.entries(eur).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v)
  const cred = Object.entries(eur).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v)
  const out: { from: ID; to: ID; cents: number }[] = []
  let i = 0, j = 0
  while (i < debt.length && j < cred.length) {
    const c = Math.min(debt[i].v, cred[j].v)
    if (c > 0) out.push({ from: debt[i].id, to: cred[j].id, cents: c })
    debt[i].v -= c; cred[j].v -= c
    if (debt[i].v === 0) i++
    if (cred[j].v === 0) j++
  }
  return out
}
