import type { ID, Leg, Member, Settlement, Toll, TollStatus, Trip } from './types'

/** Soglia della regola ×3: meno di 5 km con flag nella stessa uscita. A 5 km esatti vale ×2. */
export const THRESHOLD_M = 5000
/** Oltre questo valore un dato è considerato corrotto e ignorato (10.000 km, 10.000 €). */
const MAX_M = 1e7
const MAX_CENTS = 1e6
const safe = (v: unknown, max: number) => (typeof v === 'number' && isFinite(v) && v >= 0 && v <= max ? v : 0)

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

/** Il percorso ha tratti tra tappe? Altrimenti si usa un tratto unico con tutti i presenti a bordo. */
const hasSegs = (leg: Leg) => !!leg.segs?.length && leg.stops.length === leg.segs.length + 1

/** Metri effettivi per tratto: quelli del percorso, riscalati se i km sono stati corretti a mano. */
export function segMeters(leg: Leg): number[] {
  if (!hasSegs(leg)) return leg.actualMeters != null ? [safe(leg.actualMeters, MAX_M)] : []
  const raw = leg.segs!.map((s) => safe(s.meters, MAX_M))
  if (leg.actualMeters == null) return raw
  const actual = safe(leg.actualMeters, MAX_M)
  const sum = raw.reduce((a, b) => a + b, 0)
  if (sum <= 0) return raw.map(() => actual / Math.max(1, raw.length))
  return raw.map((m) => (m / sum) * actual)
}

export function legMeters(leg: Leg): number {
  if (leg.actualMeters != null) return safe(leg.actualMeters, MAX_M)
  return leg.segs ? leg.segs.reduce((a, s) => a + safe(s.meters, MAX_M), 0) : 0
}

export function legSeconds(leg: Leg): number {
  return leg.segs ? leg.segs.reduce((a, s) => a + safe(s.seconds, 1e6), 0) : 0
}

const RANK: Record<TollStatus, number> = { none: 0, ok: 1, verify: 2, out: 3 }

export interface LegToll extends Toll {
  manual: boolean
  /** Centesimi già noti quando una parte della tratta è da verificare o fuori copertura. */
  known: number
}

/** Pedaggio dell'intera tratta: somma dei tratti, oppure l'importo inserito a mano per la tratta. */
export function legToll(leg: Leg): LegToll {
  const segs = leg.segs ?? []
  if (leg.tollOverride != null) {
    const base = segs.map((s) => s.toll).find((t) => t.status !== 'none')
    const cents = safe(leg.tollOverride, MAX_CENTS)
    const gates = leg.tollGates ?? (base?.from ? { from: base.from, to: base.to! } : null)
    return { ...(base ?? {}), from: gates?.from, to: gates?.to, status: cents > 0 ? 'ok' : 'none', cents, known: cents, manual: true, note: undefined }
  }
  // caselli scelti a mano senza importo: il pedaggio resta da verificare per quei caselli
  if (leg.tollGates) return { status: 'verify', cents: null, known: 0, manual: true, road: 'A4', from: leg.tollGates.from, to: leg.tollGates.to, note: 'Importo da inserire per i caselli scelti' }
  let status: TollStatus = 'none'
  let ref: Toll | undefined
  let known = 0
  let unknown = false
  for (const s of segs) {
    if (s.toll.status === 'none') continue
    if (RANK[s.toll.status] > RANK[status]) { status = s.toll.status; ref = s.toll }
    if (s.toll.status !== 'out' && s.toll.cents != null) known += safe(s.toll.cents, MAX_CENTS)
    else unknown = true
  }
  if (status === 'none') return { status, cents: 0, known: 0, manual: false }
  return { ...ref, status, cents: unknown ? null : known, known, manual: false }
}

/** Centesimi di pedaggio attribuiti a ciascun tratto (pesi uguali a quelli di segMeters). */
function segTollCents(leg: Leg): number[] {
  const segs = hasSegs(leg) ? leg.segs! : []
  if (!segs.length) return leg.tollOverride != null && leg.actualMeters != null ? [safe(leg.tollOverride, MAX_CENTS)] : []
  if (leg.tollOverride == null && leg.tollGates) return segs.map(() => 0) // importo ancora da inserire
  if (leg.tollOverride != null) {
    const total = safe(leg.tollOverride, MAX_CENTS)
    const out = segs.map(() => 0)
    if (!total) return out
    // l'importo della tratta si divide tra i tratti a pagamento in proporzione alla loro lunghezza
    let idx = segs.map((s, i) => (s.toll.status !== 'none' ? i : -1)).filter((i) => i >= 0)
    if (!idx.length) idx = [segs.reduce((best, s, i) => (s.meters > segs[best].meters ? i : best), 0)]
    // pesi: gli importi calcolati per ogni tratto, se tutti noti; altrimenti la lunghezza
    const auto = idx.map((i) => (segs[i].toll.status !== 'out' ? safe(segs[i].toll.cents, MAX_CENTS) : 0))
    const w = auto.every((c) => c > 0) ? auto : idx.map((i) => Math.max(1, safe(segs[i].meters, MAX_M)))
    const wsum = w.reduce((a, b) => a + b, 0)
    let given = 0
    idx.forEach((i, k) => { const c = k === idx.length - 1 ? total - given : Math.round((total * w[k]) / wsum); out[i] = c; given += c })
    return out
  }
  return segs.map((s) => (s.toll.status === 'none' || s.toll.status === 'out' ? 0 : safe(s.toll.cents, MAX_CENTS)))
}

/** Arrotonda a interi mantenendo la somma a zero (resto più grande, ordine stabile). */
export function zeroSumRound(vals: Map<ID, number>): Map<ID, number> {
  const ids = [...vals.keys()].sort()
  const clean = new Map(ids.map((id) => [id, isFinite(vals.get(id)!) ? vals.get(id)! : 0]))
  const out = new Map<ID, number>()
  let sum = 0
  for (const id of ids) { const r = Math.round(clean.get(id)!); out.set(id, r); sum += r }
  if (sum !== 0 && ids.length) {
    const dir = sum > 0 ? -1 : 1
    const order = ids
      .map((id) => ({ id, err: (out.get(id)! - clean.get(id)!) * (sum > 0 ? 1 : -1) }))
      .sort((a, b) => b.err - a.err || (a.id < b.id ? -1 : 1))
    const n = Math.min(Math.abs(sum), ids.length * 4) // mai un ciclo infinito su dati anomali
    for (let i = 0; i < n; i++) {
      const id = order[i % order.length].id
      out.set(id, out.get(id)! + dir)
    }
  }
  return out
}

/** Valori da mostrare arrotondati al passo (100 m = 0,1 km) con somma visibile zero. */
export function displayRound(vals: Record<ID, number>, step = 100): Record<ID, number> {
  const scaled = new Map(Object.entries(vals).map(([id, v]) => [id, v / step]))
  return Object.fromEntries([...zeroSumRound(scaled)].map(([id, v]) => [id, v * step]))
}

export interface LegEffect {
  kind: Leg['kind']
  driverId: ID | null
  realMeters: number
  mult: 1 | 2 | 3
  weightedMeters: number
  toll: LegToll
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
  const legsIn = Array.isArray(trip.legs) ? trip.legs : []
  const flagged = new Map<ID, number>()
  for (const leg of legsIn) {
    if (leg.designated && leg.driverId) flagged.set(leg.driverId, (flagged.get(leg.driverId) ?? 0) + legMeters(leg))
  }
  const km = new Map<ID, number>()
  const eur = new Map<ID, number>()
  const add = (m: Map<ID, number>, id: ID, v: number) => m.set(id, (m.get(id) ?? 0) + v)
  const legs: LegEffect[] = []
  for (const leg of legsIn) {
    const real = legMeters(leg)
    const mult: 1 | 2 | 3 = !leg.designated || !leg.driverId ? 1 : (flagged.get(leg.driverId) ?? 0) < THRESHOLD_M ? 3 : 2
    const toll = legToll(leg)
    const payerId = leg.tollPayerId ?? leg.driverId
    legs.push({ kind: leg.kind, driverId: leg.driverId, realMeters: real, mult, weightedMeters: real * mult, toll, payerId })
    if (!leg.driverId) continue
    // senza tappe (es. nessuno ha la casa) si usa un tratto unico con tutti i presenti a bordo
    const occ = hasSegs(leg) ? occupantsBySeg(leg) : [[...new Set([leg.driverId, ...(trip.presentIds ?? [])])]]
    const meters = segMeters(leg)
    const tolls = segTollCents(leg)
    meters.forEach((m, i) => {
      const who = occ[i]
      if (!who?.length) return
      const w = m * mult
      add(km, leg.driverId!, w)
      for (const id of who) add(km, id, -w / who.length)
      const c = tolls[i] ?? 0
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
  const known = new Set(members.map((m) => m.id))
  for (const m of members) { km[m.id] = 0; eur[m.id] = 0 }
  for (const t of trips) {
    if (t.status !== 'confirmed') continue
    const ids = [...(t.presentIds ?? []), ...(t.legs ?? []).flatMap((l) => [l.driverId, l.tollPayerId, ...l.stops.flatMap((s) => [...s.on, ...s.off])])].filter((x): x is ID => !!x)
    if (ids.some((x) => !known.has(x))) { console.warn('Viaggio con persone estranee al gruppo ignorato', t.id); continue }
    const e = tripEffect(t)
    for (const [id, v] of e.km) km[id] = (km[id] ?? 0) + v
    for (const [id, v] of e.eur) eur[id] = (eur[id] ?? 0) + v
    for (const l of t.legs ?? []) {
      if (l.driverId && (!lastDrove[l.driverId] || lastDrove[l.driverId]! < t.startsAt)) lastDrove[l.driverId] = t.startsAt
    }
  }
  for (const s of settlements) {
    // un rimborso verso chi non è del gruppo non viene contato
    if (!known.has(s.from) || !known.has(s.to) || s.from === s.to) continue
    const c = safe(s.cents, MAX_CENTS)
    eur[s.from] = (eur[s.from] ?? 0) + c
    eur[s.to] = (eur[s.to] ?? 0) - c
  }
  return { km, eur, lastDrove }
}

export interface Suggestion { id: ID; reason: string }

/** Tra i presenti disponibili: saldo più basso, poi chi non guida da più tempo (o non ha mai guidato), poi ordine di ingresso. */
export function suggestDriver(members: Member[], presentIds: ID[], unavailableIds: ID[], bal: Balances, fmtKm: (m: number) => string): Suggestion | null {
  const cands = members.filter((m) => presentIds.includes(m.id) && !unavailableIds.includes(m.id))
  if (!cands.length) return null
  const tenth = (id: ID) => { const v = bal.km[id] ?? 0; return Math.sign(v) * Math.round(Math.abs(v) / 100) } // confronto al decimo di km mostrato
  const last = (id: ID) => bal.lastDrove[id] ?? ''
  const joined = (a: Member, b: Member) => (a.joinedAt < b.joinedAt ? -1 : a.joinedAt > b.joinedAt ? 1 : a.id < b.id ? -1 : 1)
  const sorted = [...cands].sort((a, b) => tenth(a.id) - tenth(b.id) || (last(a.id) < last(b.id) ? -1 : last(a.id) > last(b.id) ? 1 : 0) || joined(a, b))
  const top = sorted[0], second = sorted[1]
  const first = (m: Member) => m.name.split(' ')[0]
  if (cands.length === 1) return { id: top.id, reason: presentIds.length === 1 ? `C'è solo ${first(top)}.` : `Può guidare solo ${first(top)}.` }
  if (tenth(second.id) !== tenth(top.id)) return { id: top.id, reason: `${first(top)} ha il saldo più basso tra chi può guidare.` }
  if (last(top.id) !== last(second.id)) {
    return { id: top.id, reason: last(top.id) ? `A parità di saldo, ${first(top)} non guida da più tempo.` : `A parità di saldo, ${first(top)} non ha ancora guidato.` }
  }
  const why = last(top.id) ? '' : ' e non hanno ancora guidato'
  if (top.joinedAt === second.joinedAt) return { id: top.id, reason: `${first(top)} e ${first(second)} sono pari${why}: suggerito ${first(top)}.` }
  return { id: top.id, reason: `${first(top)} e ${first(second)} sono pari${why}: ${first(top)} è nel gruppo da più tempo.` }
}

/** Rimborsi per azzerare i saldi in euro: prima le coppie che si chiudono a vicenda, poi i maggiori. */
export function settleUp(eur: Record<ID, number>): { from: ID; to: ID; cents: number }[] {
  const debt = Object.entries(eur).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1))
  const cred = Object.entries(eur).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1))
  const out: { from: ID; to: ID; cents: number }[] = []
  for (const d of debt) {
    const c = cred.find((x) => x.v === d.v)
    if (c) { out.push({ from: d.id, to: c.id, cents: d.v }); c.v = 0; d.v = 0 }
  }
  const D = debt.filter((d) => d.v > 0), C = cred.filter((c) => c.v > 0)
  let i = 0, j = 0
  while (i < D.length && j < C.length) {
    const c = Math.min(D[i].v, C[j].v)
    if (c > 0) out.push({ from: D[i].id, to: C[j].id, cents: c })
    D[i].v -= c; C[j].v -= c
    if (D[i].v === 0) i++
    if (C[j].v === 0) j++
  }
  return out
}
