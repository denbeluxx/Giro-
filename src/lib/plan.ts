import { haversine } from './tolls'
import { uid, type ID, type Leg, type Member, type Pt, type Stop } from './types'

type Named = Pt & { name: string }
const firstName = (n: string) => n.split(' ')[0]
export const homeName = (m: Member) => `Casa di ${firstName(m.name)}`

function nearestOrder<T extends Pt>(from: Pt, pts: T[]): T[] {
  const left = [...pts], out: T[] = []
  let cur: Pt = from
  while (left.length) {
    let bi = 0
    left.forEach((p, i) => { if (haversine(cur, p) < haversine(cur, left[bi])) bi = i })
    cur = left[bi]
    out.push(left.splice(bi, 1)[0])
  }
  return out
}

/**
 * Giro delle case. Andata: casa del conducente (o altra partenza) → case dei passeggeri → destinazione.
 * Ritorno: destinazione → case dei passeggeri → casa del conducente.
 * Chi non ha una casa disponibile sale alla partenza e, al ritorno, scende all'ultima tappa.
 */
export function buildStops(kind: Leg['kind'], members: Member[], presentIds: ID[], driverId: ID, dest: Named, start?: Named | null): Stop[] {
  const by = new Map(members.map((m) => [m.id, m]))
  const driver = by.get(driverId)
  const pax = presentIds.filter((id) => id !== driverId && by.has(id))
  const withHome = pax.filter((id) => by.get(id)!.home)
  const noHome = pax.filter((id) => !by.get(id)!.home)
  const base: Named | null = start ?? (driver?.home ? { ...driver.home, name: homeName(driver) } : null)
  const homes = withHome.map((id) => { const m = by.get(id)!; return { id, lat: m.home!.lat, lng: m.home!.lng, name: homeName(m) } })
  const mk = (p: Named, extra: Partial<Stop> = {}): Stop => ({ id: uid(), name: p.name, lat: p.lat, lng: p.lng, on: [], off: [], ...extra })

  if (kind === 'andata') {
    const ordered = nearestOrder(base ?? dest, base ? homes : [...homes].reverse())
    const stops: Stop[] = []
    if (base) stops.push(mk(base, { homeOf: start ? undefined : driverId }))
    for (const h of ordered) {
      const prev = stops[stops.length - 1]
      if (prev && haversine(prev, h) < 60) prev.on.push(h.id)
      else stops.push(mk(h, { on: [h.id], homeOf: h.id }))
    }
    if (stops.length) stops[0].on.push(...noHome)
    stops.push(mk(dest, { off: [...pax], on: stops.length ? [] : [] }))
    return stops
  }
  const stops: Stop[] = [mk(dest, { on: [...pax] })]
  for (const h of nearestOrder(dest, homes)) {
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

export function newLeg(kind: Leg['kind'], driverId: ID | null, stops: Stop[]): Leg {
  return { kind, driverId, designated: false, stops, segs: null, geometry: null, routeState: 'missing', actualMeters: null, tollPayerId: null, tollOverride: null }
}

/** Dopo un cambio di conducente: nessuno sale o scende due volte, il conducente non è passeggero. */
export function sanitizeStops(stops: Stop[], driverId: ID | null, presentIds: ID[]): Stop[] {
  const ok = (id: ID) => id !== driverId && presentIds.includes(id)
  return stops.map((s) => ({ ...s, on: s.on.filter(ok), off: s.off.filter(ok) }))
}

export const stopKey = (p: Pt) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
