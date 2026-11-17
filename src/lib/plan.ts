import { haversine } from './tolls'
import { uid, type ID, type Leg, type Member, type Pt, type Stop } from './types'

type Named = Pt & { name: string }
const firstName = (n: string) => n.split(' ')[0]
export const homeName = (m: Member) => `Casa di ${firstName(m.name)}`

/** Casa utilizzabile come tappa: solo se il proprietario l'ha resa disponibile al gruppo. */
export const usableHome = (m?: Member | null) => (m?.home && m.homeShared ? m.home : null)

/**
 * Ordine delle case che rende più corto il giro. Partenza e arrivo fissi (o liberi se null).
 * Fino a 7 case prova tutte le combinazioni; oltre usa «la più vicina» migliorata con 2-opt.
 */
export function bestOrder<T extends Pt>(start: Pt | null, pts: T[], end: Pt | null, dist: (a: Pt, b: Pt) => number = haversine): T[] {
  const cost = (seq: T[]) => {
    let d = 0
    if (start && seq.length) d += dist(start, seq[0])
    for (let i = 0; i < seq.length - 1; i++) d += dist(seq[i], seq[i + 1])
    if (end && seq.length) d += dist(seq[seq.length - 1], end)
    return d
  }
  if (pts.length <= 1) return [...pts]
  if (pts.length <= 7) {
    let best: T[] = [...pts], bestC = cost(best)
    const perm = (rest: T[], acc: T[]) => {
      if (!rest.length) { const c = cost(acc); if (c < bestC - 1e-6) { bestC = c; best = [...acc] } return }
      for (let i = 0; i < rest.length; i++) perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]])
    }
    perm(pts, [])
    return best
  }
  const left = [...pts], seq: T[] = []
  let cur: Pt | null = start
  while (left.length) {
    let bi = 0
    if (cur) left.forEach((p, i) => { if (dist(cur!, p) < dist(cur!, left[bi])) bi = i })
    else if (end) left.forEach((p, i) => { if (dist(end, p) > dist(end, left[bi])) bi = i }) // senza partenza: dalla più lontana dall'arrivo
    cur = left[bi]
    seq.push(left.splice(bi, 1)[0])
  }
  for (let improved = true, guard = 0; improved && guard < 50; guard++) {
    improved = false
    for (let i = 0; i < seq.length - 1; i++) for (let j = i + 1; j < seq.length; j++) {
      const cand = [...seq.slice(0, i), ...seq.slice(i, j + 1).reverse(), ...seq.slice(j + 1)]
      if (cost(cand) < cost(seq) - 1e-6) { seq.splice(0, seq.length, ...cand); improved = true }
    }
  }
  return seq
}

/**
 * Giro delle case. Andata: partenza (casa del conducente o altro punto) → case dei passeggeri → destinazione.
 * Ritorno: destinazione → case dei passeggeri → casa del conducente (o punto di arrivo).
 * Chi non ha una casa disponibile sale alla partenza e, al ritorno, scende all'ultima tappa.
 */
export function buildStops(kind: Leg['kind'], members: Member[], presentIds: ID[], driverId: ID, dest: Named, start?: Named | null): Stop[] {
  const by = new Map(members.map((m) => [m.id, m]))
  const driver = by.get(driverId)
  const pax = presentIds.filter((id) => id !== driverId && by.has(id))
  const withHome = pax.filter((id) => usableHome(by.get(id)))
  const noHome = pax.filter((id) => !usableHome(by.get(id)))
  const dh = usableHome(driver)
  const base: Named | null = start ?? (dh && driver ? { ...dh, name: homeName(driver) } : null)
  const homes = withHome.map((id) => { const m = by.get(id)!; const h = usableHome(m)!; return { id, lat: h.lat, lng: h.lng, name: homeName(m) } })
  const mk = (p: Named, extra: Partial<Stop> = {}): Stop => ({ id: uid(), name: p.name, lat: p.lat, lng: p.lng, on: [], off: [], ...extra })

  if (kind === 'andata') {
    const ordered = bestOrder(base, homes, dest)
    const stops: Stop[] = []
    if (base) stops.push(mk(base, { homeOf: start ? undefined : driverId }))
    for (const h of ordered) {
      const prev = stops[stops.length - 1]
      if (prev && haversine(prev, h) < 60) prev.on.push(h.id)
      else stops.push(mk(h, { on: [h.id], homeOf: h.id }))
    }
    if (stops.length) stops[0].on.push(...noHome)
    stops.push(mk(dest, { off: [...pax] }))
    return stops
  }
  const stops: Stop[] = [mk(dest, { on: [...pax] })]
  for (const h of bestOrder(dest, homes, base)) {
    const prev = stops[stops.length - 1]
    if (stops.length > 1 && haversine(prev, h) < 60) prev.off.push(h.id)
    else stops.push(mk(h, { off: [h.id], homeOf: h.id }))
  }
  if (base) {
    const prev = stops[stops.length - 1]
    if (stops.length > 1 && haversine(prev, base) < 60) prev.off.push(...noHome)
    else stops.push(mk(base, { off: [...noHome], homeOf: start ? undefined : driverId }))
  } else if (stops.length > 1) stops[stops.length - 1].off.push(...noHome)
  return stops
}

/** Ritorno con le tappe dell'andata in ordine inverso: chi era salito scende, e viceversa. */
export function reverseStops(stops: Stop[]): Stop[] {
  return [...stops].reverse().map((s) => ({ ...s, id: uid(), on: [...s.off], off: [...s.on] }))
}

/** Tappe aggiunte a mano (non case, non partenza o arrivo): da conservare quando il giro si ricostruisce. */
export function extraStops(stops: Stop[]): Stop[] {
  return stops.slice(1, -1).filter((s) => !s.homeOf).map((s) => ({ ...s, id: uid(), on: [], off: [] }))
}

/** Inserisce tappe extra prima dell'arrivo (andata) o dopo la partenza (ritorno). */
export function withExtras(kind: Leg['kind'], stops: Stop[], extras: Stop[]): Stop[] {
  if (!extras.length || stops.length < 2) return stops
  const keys = new Set(stops.map(stopKey))
  const add = extras.filter((e) => !keys.has(stopKey(e)))
  return kind === 'andata' ? [...stops.slice(0, -1), ...add, stops[stops.length - 1]] : [stops[0], ...add, ...stops.slice(1)]
}

export function newLeg(kind: Leg['kind'], driverId: ID | null, stops: Stop[]): Leg {
  return { kind, driverId, designated: false, stops, segs: null, geometry: null, routeState: 'missing', actualMeters: null, tollPayerId: null, tollOverride: null, tollGates: null }
}

/** Dopo un cambio di conducente: nessuno sale o scende due volte, il conducente non è passeggero. */
export function sanitizeStops(stops: Stop[], driverId: ID | null, presentIds: ID[]): Stop[] {
  const ok = (id: ID) => id !== driverId && presentIds.includes(id)
  return stops.map((s) => ({ ...s, on: s.on.filter(ok), off: s.off.filter(ok) }))
}

export const stopKey = (p: Pt) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
