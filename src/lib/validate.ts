import type { Leg, Seg, Stop, Toll, Trip } from './types'

/**
 * Difesa contro dati incompleti o manomessi nel database: un viaggio malformato viene
 * ripulito o scartato invece di bloccare l'app per tutto il gruppo.
 */
const num = (v: unknown, min = -Infinity, max = Infinity) => (typeof v === 'number' && isFinite(v) && v >= min && v <= max ? v : null)
const str = (v: unknown) => (typeof v === 'string' ? v : null)
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const TOLL_STATES = ['none', 'ok', 'verify', 'out'] as const

function toll(v: any): Toll {
  const status = TOLL_STATES.includes(v?.status) ? v.status : 'none'
  return { status, cents: num(v?.cents, 0, 1e6), road: str(v?.road) ?? undefined, from: str(v?.from) ?? undefined, to: str(v?.to) ?? undefined, note: str(v?.note) ?? undefined }
}
function stop(v: any): Stop | null {
  const lat = num(v?.lat, -90, 90), lng = num(v?.lng, -180, 180)
  if (lat == null || lng == null) return null
  return { id: str(v?.id) ?? `${lat},${lng}`, name: str(v?.name) ?? 'Tappa', lat, lng, on: ids(v?.on), off: ids(v?.off), homeOf: str(v?.homeOf) ?? undefined }
}
function seg(v: any): Seg | null {
  const meters = num(v?.meters, 0, 1e7)
  return meters == null ? null : { meters, seconds: num(v?.seconds, 0, 1e6) ?? 0, toll: toll(v?.toll) }
}
function leg(v: any): Leg | null {
  if (!v || typeof v !== 'object') return null
  const stops = (Array.isArray(v.stops) ? v.stops : []).map(stop).filter(Boolean) as Stop[]
  let segs = Array.isArray(v.segs) ? (v.segs.map(seg).filter(Boolean) as Seg[]) : null
  if (segs && segs.length !== Math.max(0, stops.length - 1)) segs = null
  const geometry = Array.isArray(v.geometry) ? v.geometry.filter((p: any) => Array.isArray(p) && num(p[0]) != null && num(p[1]) != null).slice(0, 20000) : null
  const tg = v.tollGates && str(v.tollGates.from) && str(v.tollGates.to) ? { from: v.tollGates.from, to: v.tollGates.to } : null
  return {
    kind: v.kind === 'ritorno' ? 'ritorno' : 'andata', driverId: str(v.driverId), designated: v.designated === true, time: str(v.time) ?? undefined,
    stops, segs, geometry, routeState: ['ok', 'stimato', 'missing'].includes(v.routeState) ? v.routeState : segs ? 'stimato' : 'missing',
    actualMeters: num(v.actualMeters, 0, 1e7), tollPayerId: str(v.tollPayerId), tollOverride: num(v.tollOverride, 0, 1e6), tollGates: tg,
  }
}

export function sanitizeTrip(t: any): Trip | null {
  try {
    if (!t || typeof t !== 'object' || !str(t.id)) return null
    const legs = (Array.isArray(t.legs) ? t.legs : []).map(leg).filter(Boolean).slice(0, 2) as Leg[]
    const lat = num(t.dest?.lat, -90, 90), lng = num(t.dest?.lng, -180, 180)
    if (!legs.length || lat == null || lng == null || !str(t.startsAt) || isNaN(Date.parse(t.startsAt))) return null
    return {
      ...t, legs, presentIds: ids(t.presentIds), unavailableIds: ids(t.unavailableIds),
      dest: { name: str(t.dest?.name) ?? 'Destinazione', lat, lng, address: str(t.dest?.address) ?? undefined },
      status: ['planned', 'confirmed', 'cancelled'].includes(t.status) ? t.status : 'planned',
      version: num(t.version, 1) ?? 1,
    }
  } catch { return null }
}

export function sanitizeTrips(list: unknown[]): Trip[] {
  const out: Trip[] = []
  for (const t of list) { const s = sanitizeTrip(t); if (s) out.push(s); else console.warn('Viaggio con dati non validi ignorato', t) }
  return out
}
