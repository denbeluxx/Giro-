import type { GroupToll, Pt, Toll } from './types'

/**
 * COPERTURA PEDAGGI — A4 Milano Est ⇄ Brescia Ovest (sistema chiuso, classe A).
 *
 * Caselli e progressive chilometriche: tabella svincoli dell'A4 (Wikipedia / Telepass, verificata il 16/11/2026).
 * Le coordinate sono APPROSSIMATE (±1 km): il riconoscimento combina posizione e lunghezza del tratto
 * autostradale, e nell'app il casello resta correggibile a mano.
 */
export interface Gate extends Pt { id: string; name: string; km: number }
export const A4_GATES: Gate[] = [
  { id: 'milano-est', name: 'Milano Est', km: 138.0, lat: 45.5560, lng: 9.2650 },
  { id: 'agrate', name: 'Agrate', km: 145.5, lat: 45.5700, lng: 9.3530 },
  { id: 'cavenago', name: 'Cavenago-Cambiago', km: 149.7, lat: 45.5810, lng: 9.4080 },
  { id: 'trezzo', name: 'Trezzo', km: 156.8, lat: 45.5960, lng: 9.5050 },
  { id: 'capriate', name: 'Capriate', km: 160.3, lat: 45.6060, lng: 9.5440 },
  { id: 'dalmine', name: 'Dalmine', km: 167.4, lat: 45.6400, lng: 9.6130 },
  { id: 'bergamo', name: 'Bergamo', km: 172.1, lat: 45.6680, lng: 9.6680 },
  { id: 'seriate', name: 'Seriate', km: 178.7, lat: 45.6670, lng: 9.7450 },
  { id: 'grumello', name: 'Grumello-Telgate', km: 187.3, lat: 45.6280, lng: 9.8580 },
  { id: 'ponte-oglio', name: 'Ponte Oglio', km: 190.6, lat: 45.6100, lng: 9.8940 },
  { id: 'palazzolo', name: 'Palazzolo', km: 192.8, lat: 45.6020, lng: 9.9180 },
  { id: 'rovato', name: 'Rovato', km: 201.0, lat: 45.5830, lng: 10.0030 },
  { id: 'ospitaletto', name: 'Ospitaletto', km: 206.0, lat: 45.5640, lng: 10.0660 },
  { id: 'brescia-ovest', name: 'Brescia Ovest', km: 214.9, lat: 45.5350, lng: 10.1650 },
]
export const gateName = (id?: string) => A4_GATES.find((g) => g.id === id)?.name ?? id ?? ''

/**
 * Tariffe di tabella. `stato: 'ufficiale'` solo per importi letti dal calcolatore del concessionario
 * (autostrade.it) e datati; `'indicativa'` = fonte non ufficiale, l'app la precompila ma la segnala «da verificare».
 * Il gruppo può confermare un importo con un tocco: da lì in poi vale come verificato per quella coppia.
 */
export interface Tariff { cents: number; classe: 'A'; fonte: string; data: string; stato: 'ufficiale' | 'indicativa' }
export const pairKey = (a: string, b: string) => [a, b].sort().join('|')
export const TARIFFS: Record<string, Tariff> = {
  [pairKey('bergamo', 'milano-est')]: { cents: 380, classe: 'A', fonte: 'calcolopercorso.it (non ufficiale)', data: '2026-11-16', stato: 'indicativa' },
}

export function tariffFor(a: string, b: string, groupTolls?: Record<string, GroupToll>): { cents: number; verified: boolean; fonte: string } | null {
  const k = pairKey(a, b)
  const g = groupTolls?.[k]
  if (g) return { cents: g.cents, verified: true, fonte: `confermata dal gruppo il ${g.on.slice(0, 10).split('-').reverse().join('/')}` }
  const t = TARIFFS[k]
  if (t) return { cents: t.cents, verified: t.stato === 'ufficiale', fonte: t.fonte }
  return null
}

export function haversine(a: Pt, b: Pt): number {
  const R = 6371000, r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Coppia di caselli più plausibile dati ingresso, uscita e lunghezza del tratto a pagamento. */
export function matchGates(entry: Pt, exit: Pt, tollMeters: number): { from: Gate; to: Gate } | null {
  let best: { from: Gate; to: Gate; score: number } | null = null
  for (const f of A4_GATES) {
    const df = haversine(entry, f)
    if (df > 5000) continue
    for (const t of A4_GATES) {
      if (t.id === f.id) continue
      const dt = haversine(exit, t)
      if (dt > 5000) continue
      const gap = Math.abs(tollMeters - Math.abs(f.km - t.km) * 1000)
      // se il tratto a pagamento è molto più lungo della distanza tra i caselli, l'uscita è un'altra
      if (gap > Math.max(2500, Math.abs(f.km - t.km) * 1000 * 0.15)) continue
      const score = df + dt + gap
      if (!best || score < best.score) best = { from: f, to: t, score }
    }
  }
  return best && { from: best.from, to: best.to }
}

/** Pedaggio per una coppia nota di caselli A4. */
export function a4Toll(from: string, to: string, groupTolls?: Record<string, GroupToll>): Toll {
  const t = tariffFor(from, to, groupTolls)
  if (!t) return { status: 'verify', cents: null, road: 'A4', from, to, note: 'Importo non ancora in tabella' }
  return { status: t.verified ? 'ok' : 'verify', cents: t.cents, road: 'A4', from, to, note: t.verified ? `Tariffa ${t.fonte}` : `Tariffa indicativa · ${t.fonte}` }
}

// --- Lettura della risposta OSRM -------------------------------------------------

interface OsrmIntersection { location: [number, number]; classes?: string[] }
interface OsrmStep { distance: number; ref?: string; name?: string; intersections?: OsrmIntersection[] }
export interface OsrmLeg { distance: number; duration: number; steps: OsrmStep[] }

/**
 * Riconosce i tratti a pagamento di una tratta OSRM (classe `toll` sulle intersezioni)
 * e li classifica: nessun pedaggio, A4 coperta, da verificare, fuori copertura (A35 e altre).
 */
export function analyzeOsrmLeg(leg: OsrmLeg, groupTolls?: Record<string, GroupToll>): Toll {
  const refs = new Set<string>()
  let meters = 0
  let entry: Pt | null = null
  let exit: Pt | null = null
  for (const st of leg.steps ?? []) {
    const tollPts = (st.intersections ?? []).filter((i) => i.classes?.includes('toll'))
    if (!tollPts.length) continue
    meters += st.distance
    const tokens = (st.ref ?? '').split(/[;,/]/).map((x) => x.replace(/\s+/g, '').toUpperCase()).filter(Boolean)
    const aRefs = tokens.map((x) => x.match(/^A\d+/)?.[0]).filter((x): x is string => !!x)
    for (const r of aRefs) refs.add(r)
    // la E64 coincide con l'A4 tra Milano e Brescia: se manca la sigla A la deduciamo
    if (!aRefs.length && tokens.includes('E64')) refs.add('A4')
    const first = tollPts[0].location, last = tollPts[tollPts.length - 1].location
    if (!entry) entry = { lat: first[1], lng: first[0] }
    exit = { lat: last[1], lng: last[0] }
  }
  if (!entry || !exit || meters < 300) return { status: 'none', cents: 0 }
  const others = [...refs].filter((r) => r !== 'A4')
  if (others.length) {
    const road = others.includes('A35') ? 'A35' : others[0]
    return { status: 'out', cents: null, road, note: road === 'A35' ? 'A35 BreBeMi: fuori dalla copertura iniziale' : `${road}: fuori dalla copertura iniziale` }
  }
  if (!refs.has('A4')) return { status: 'verify', cents: null, note: 'Tratto a pagamento non riconosciuto' }
  const m = matchGates(entry, exit, meters)
  if (!m) return { status: 'out', cents: null, road: 'A4', note: 'A4 fuori dal tratto Milano Est – Brescia Ovest' }
  return a4Toll(m.from.id, m.to.id, groupTolls)
}

/** Riapplica le tariffe confermate dal gruppo ai pedaggi A4 già riconosciuti (per le uscite ancora in programma). */
export function refreshTolls<L extends { segs: { meters: number; seconds: number; toll: Toll }[] | null; tollOverride: number | null }>(legs: L[], groupTolls?: Record<string, GroupToll>): L[] {
  return legs.map((l) => {
    if (!l.segs || l.tollOverride != null) return l
    let changed = false
    const segs = l.segs.map((s) => {
      if (s.toll.road !== 'A4' || !s.toll.from || !s.toll.to || s.toll.status === 'out') return s
      const fresh = a4Toll(s.toll.from, s.toll.to, groupTolls)
      if (fresh.cents === s.toll.cents && fresh.status === s.toll.status) return s
      changed = true
      return { ...s, toll: fresh }
    })
    return changed ? { ...l, segs } : l
  })
}
