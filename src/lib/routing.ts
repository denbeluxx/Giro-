import { A4_GATES, a4Toll, analyzeOsrmLeg, haversine, type OsrmLeg } from './tolls'
import type { GroupToll, Pt, Seg, Stop, Toll } from './types'

/** Build «sim»: percorsi e luoghi simulati, senza rete. Serve per l'anteprima e i collaudi automatici. */
export const SIM = import.meta.env?.VITE_SIM === '1'
const OSRM = (import.meta.env?.VITE_OSRM_URL as string) || 'https://router.project-osrm.org'
const PHOTON = (import.meta.env?.VITE_PHOTON_URL as string) || 'https://photon.komoot.io'

export interface Route { segs: Seg[]; geometry: [number, number][]; state: 'ok' | 'stimato' }
export interface Found extends Pt { name: string; address?: string }
type Tolls = Record<string, GroupToll> | undefined

async function getJson(url: string, signal?: AbortSignal): Promise<any> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 12000)
  signal?.addEventListener('abort', () => ctl.abort())
  try {
    const r = await fetch(url, { signal: ctl.signal })
    if (!r.ok) throw new Error(`Servizio non disponibile (${r.status})`)
    return await r.json()
  } finally { clearTimeout(timer) }
}
const coords = (pts: Pt[]) => pts.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')

// --- Simulazione -----------------------------------------------------------------

function simToll(a: Stop | (Pt & { name?: string }), b: Stop | (Pt & { name?: string }), tolls: Tolls): Toll {
  if (/brebemi|treviglio/i.test(`${a.name ?? ''} ${b.name ?? ''}`)) return { status: 'out', cents: null, road: 'A35', note: 'A35 BreBeMi: fuori dalla copertura iniziale' }
  if (haversine(a, b) < 25000) return { status: 'none', cents: 0 }
  const near = (p: Pt) => A4_GATES.map((g) => ({ g, d: haversine(p, g) })).sort((x, y) => x.d - y.d)[0]
  const f = near(a), t = near(b)
  if (f.d > 16000 || t.d > 16000 || f.g.id === t.g.id) return { status: 'none', cents: 0 }
  return a4Toll(f.g.id, t.g.id, tolls)
}

/** Stima a partire dalla distanza in linea d'aria. Mai presentata come percorso reale. */
export function estimateRoute(stops: (Pt & { name?: string })[], tolls?: Tolls, withTolls = SIM): Route {
  const segs: Seg[] = []
  const geometry: [number, number][] = []
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1]
    const meters = Math.round(haversine(a, b) * 1.32)
    segs.push({ meters, seconds: Math.round(meters / (meters > 15000 ? 22 : 9.5)), toll: withTolls ? simToll(a, b, tolls) : { status: 'none', cents: 0 } })
    const n = 14, dx = b.lng - a.lng, dy = b.lat - a.lat, bend = (i % 2 ? -1 : 1) * 0.09
    for (let k = 0; k <= n; k++) {
      const t = k / n, off = Math.sin(t * Math.PI) * bend
      geometry.push([a.lat + dy * t + dx * off * 0.7, a.lng + dx * t - dy * off * 1.4])
    }
  }
  return { segs, geometry, state: 'stimato' }
}

// --- Servizi reali ---------------------------------------------------------------

/** Percorsi stradali tra le tappe (OSRM). Con due sole tappe restituisce anche le alternative. */
export async function routeStops(stops: Stop[], tolls: Tolls, signal?: AbortSignal): Promise<Route[]> {
  if (stops.length < 2) return []
  if (SIM) { await new Promise((r) => setTimeout(r, 450)); return [{ ...estimateRoute(stops, tolls), state: 'ok' }] }
  const alt = stops.length === 2 ? '&alternatives=true' : ''
  const j = await getJson(`${OSRM}/route/v1/driving/${coords(stops)}?overview=full&geometries=geojson&steps=true${alt}`, signal)
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error('Nessun percorso trovato tra queste tappe')
  return j.routes.map((r: any): Route => ({
    state: 'ok',
    geometry: r.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]),
    segs: r.legs.map((l: OsrmLeg) => ({ meters: l.distance, seconds: l.duration, toll: analyzeOsrmLeg(l, tolls) })),
  }))
}

/** Matrice delle distanze su strada tra punti (metri). */
export async function matrix(pts: Pt[], signal?: AbortSignal): Promise<{ m: number[][]; real: boolean }> {
  const est = () => ({ m: pts.map((a) => pts.map((b) => haversine(a, b) * 1.32)), real: false })
  if (pts.length < 2) return est()
  if (SIM) return { ...est(), real: true }
  try {
    const j = await getJson(`${OSRM}/table/v1/driving/${coords(pts)}?annotations=distance`, signal)
    if (j.code === 'Ok' && j.distances) return { m: j.distances, real: true }
  } catch { /* stima */ }
  return est()
}

const SIM_PLACES: Found[] = [
  { name: 'Bolgia', address: 'Via Vaccarezza, Osio Sopra', lat: 45.6255, lng: 9.5905 },
  { name: 'Setai Club', address: 'Via Portico, Orio al Serio', lat: 45.6727, lng: 9.7022 },
  { name: 'Piazza Vecchia', address: 'Città Alta, Bergamo', lat: 45.7041, lng: 9.6625 },
  { name: 'Oriocenter', address: 'Via Portico 71, Orio al Serio', lat: 45.6648, lng: 9.6983 },
  { name: 'Navigli', address: 'Ripa di Porta Ticinese, Milano', lat: 45.4523, lng: 9.1746 },
  { name: 'Corso Como', address: 'Corso Como, Milano', lat: 45.4822, lng: 9.1877 },
  { name: 'Alcatraz', address: 'Via Valtellina 25, Milano', lat: 45.4947, lng: 9.1823 },
  { name: 'Lungolago di Sarnico', address: 'Sarnico', lat: 45.6676, lng: 9.9603 },
  { name: 'Piazza della Loggia', address: 'Brescia', lat: 45.5397, lng: 10.2203 },
  { name: 'Stazione di Bergamo', address: 'Piazzale Marconi, Bergamo', lat: 45.6906, lng: 9.6751 },
  { name: 'Treviglio centro (via BreBeMi)', address: 'Piazza Manara, Treviglio', lat: 45.5214, lng: 9.5937 },
  { name: 'Pizzeria da Mimmo', address: 'Via Colleoni, Bergamo', lat: 45.7044, lng: 9.6641 },
  { name: 'Bar Sport', address: 'Via Italia 12, Seriate', lat: 45.6846, lng: 9.7271 },
  { name: 'Parcheggio Malpensata', address: 'Via Carnovali, Bergamo', lat: 45.6853, lng: 9.6726 },
]

/** Ricerca di indirizzi e luoghi (Photon, dati OpenStreetMap). */
export async function searchPlaces(q: string, near?: Pt, signal?: AbortSignal): Promise<Found[]> {
  if (SIM) {
    await new Promise((r) => setTimeout(r, 250))
    const s = q.toLowerCase()
    return SIM_PLACES.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(s))
  }
  const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : '&lat=45.695&lon=9.67'
  const j = await getJson(`${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=7${bias}`, signal)
  return (j.features ?? []).map((f: any): Found => {
    const p = f.properties ?? {}
    const street = [p.street, p.housenumber].filter(Boolean).join(' ')
    const name = p.name || street || p.city || 'Luogo'
    const address = [p.name ? street : '', p.city || p.town || p.village, p.county].filter(Boolean).join(', ')
    return { name, address, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }
  })
}
