import type { GroupToll, Pt, Toll } from './types'

/**
 * COPERTURA PEDAGGI — A4 Milano Est ⇄ Brescia Est (sistema chiuso, classe A: auto e moto).
 *
 * Tariffe: calcolatore ufficiale di infoviaggiando.it/pedaggi, lette il 20/11/2026 per tutte le coppie di caselli.
 * Posizioni: punti in cui le rampe di ogni casello si staccano dall'A4 secondo OpenStreetMap/OSRM (precisione ~300 m),
 * cioè gli stessi punti che l'app riceve quando calcola un percorso.
 */
export interface Gate extends Pt { id: string; name: string }
export const A4_GATES: Gate[] = [
  { id: 'milano-est', name: 'Milano Est', lat: 45.5677, lng: 9.3440 },
  { id: 'agrate', name: 'Agrate', lat: 45.5698, lng: 9.3602 },
  { id: 'cavenago', name: 'Cavenago-Cambiago', lat: 45.5793, lng: 9.4170 },
  { id: 'trezzo', name: 'Trezzo', lat: 45.5965, lng: 9.5031 },
  { id: 'capriate', name: 'Capriate', lat: 45.6100, lng: 9.5437 },
  { id: 'dalmine', name: 'Dalmine', lat: 45.6437, lng: 9.6196 },
  { id: 'bergamo', name: 'Bergamo', lat: 45.6693, lng: 9.6687 },
  { id: 'seriate', name: 'Seriate', lat: 45.6551, lng: 9.7508 },
  { id: 'grumello', name: 'Grumello-Telgate', lat: 45.6329, lng: 9.8567 },
  { id: 'ponte-oglio', name: 'Ponte Oglio', lat: 45.6239, lng: 9.8970 },
  { id: 'palazzolo', name: 'Palazzolo', lat: 45.6182, lng: 9.9217 },
  { id: 'rovato', name: 'Rovato', lat: 45.5770, lng: 10.0078 },
  { id: 'ospitaletto', name: 'Ospitaletto', lat: 45.5655, lng: 10.0695 },
  { id: 'brescia-ovest', name: 'Brescia Ovest', lat: 45.5248, lng: 10.1667 },
  { id: 'brescia-centro', name: 'Brescia Centro', lat: 45.5049, lng: 10.2380 },
  { id: 'brescia-est', name: 'Brescia Est', lat: 45.4815, lng: 10.3260 },
]
export const gateName = (id?: string) => A4_GATES.find((g) => g.id === id)?.name ?? id ?? ''

/** A ovest di questa longitudine l'A4 ha già passato la barriera di Milano Est (tratto urbano, senza biglietto). */
const WEST_OF_BARRIER = 9.352
/** Oltre questi limiti l'A4 è un'altra tratta a pagamento (verso Torino o verso Verona): fuori copertura. */
const WEST_LIMIT = 9.10, EAST_LIMIT = 10.345
/** Tangenziali di Milano percorse senza barriere nei collegamenti con l'A4: non generano pedaggio. */
const FREE_REFS = new Set(['A50', 'A51', 'A52'])

export const TARIFF_DATE = '2026-11-20'
export const TARIFF_SOURCE = 'infoviaggiando.it'
export const pairKey = (a: string, b: string) => [a, b].sort().join('|')
// centesimi, classe A: riga i = casello i verso i caselli successivi (tabella simmetrica)
const TRI: number[][] = [
  [170, 200, 260, 280, 350, 380, 430, 500, 530, 540, 610, 650, 720, 780, 820],
  [40, 90, 130, 180, 220, 270, 340, 360, 380, 440, 480, 560, 610, 650],
  [60, 90, 150, 190, 240, 310, 330, 350, 410, 450, 520, 580, 620],
  [40, 90, 130, 180, 250, 280, 290, 350, 400, 470, 530, 560],
  [70, 100, 150, 220, 250, 270, 330, 370, 440, 490, 530],
  [60, 100, 170, 200, 210, 280, 310, 390, 450, 490],
  [60, 130, 160, 170, 240, 280, 350, 410, 450],
  [80, 100, 120, 180, 220, 290, 350, 390],
  [30, 50, 120, 160, 230, 280, 320],
  [20, 90, 130, 200, 260, 300],
  [70, 110, 190, 240, 280],
  [50, 120, 170, 210],
  [80, 130, 170],
  [70, 110],
  [80],
]
export const TARIFFS: Record<string, number> = {}
TRI.forEach((row, i) => row.forEach((cents, k) => { TARIFFS[pairKey(A4_GATES[i].id, A4_GATES[i + 1 + k].id)] = cents }))

/**
 * Importo per una coppia di caselli. Vale la tabella ufficiale; una tariffa scritta dal gruppo la sostituisce
 * solo se è più recente della tabella (per esempio dopo un aumento non ancora recepito dall'app).
 */
export function tariffFor(a: string, b: string, groupTolls?: Record<string, GroupToll>): { cents: number; fonte: string } | null {
  const k = pairKey(a, b)
  const g = groupTolls?.[k]
  const t = TARIFFS[k]
  if (g && (t == null || g.on.slice(0, 10) > TARIFF_DATE)) return { cents: g.cents, fonte: `aggiornata dal gruppo il ${g.on.slice(0, 10).split('-').reverse().join('/')}` }
  if (t != null) return { cents: t, fonte: `ufficiale classe A (${TARIFF_SOURCE})` }
  return null
}

export function haversine(a: Pt, b: Pt): number {
  const R = 6371000, r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Casello dell'A4 in cui un punto del percorso entra o esce dall'autostrada. */
export function gateAt(p: Pt): Gate | 'out' | null {
  if (p.lng < WEST_LIMIT || p.lng > EAST_LIMIT) return 'out'
  if (p.lng < WEST_OF_BARRIER) return A4_GATES[0]
  let best: Gate | null = null, bd = Infinity
  for (const g of A4_GATES) { const d = haversine(p, g); if (d < bd) { bd = d; best = g } }
  return bd <= 1500 ? best : null
}

/** Pedaggio per una coppia nota di caselli A4. */
export function a4Toll(from: string, to: string, groupTolls?: Record<string, GroupToll>): Toll {
  if (from === to) return { status: 'none', cents: 0 }
  const t = tariffFor(from, to, groupTolls)
  if (!t) return { status: 'verify', cents: null, road: 'A4', from, to, note: 'Importo non in tabella' }
  return { status: 'ok', cents: t.cents, road: 'A4', from, to, note: `Tariffa ${t.fonte}` }
}

// --- Lettura della risposta OSRM -------------------------------------------------

interface OsrmIntersection { location: [number, number]; classes?: string[] }
interface OsrmStep { distance: number; ref?: string; name?: string; maneuver?: { location: [number, number] }; intersections?: OsrmIntersection[] }
export interface OsrmLeg { distance: number; duration: number; steps: OsrmStep[] }

const pt = (l: [number, number]): Pt => ({ lat: l[1], lng: l[0] })
/** Sigle autostradali di un passo del percorso («A4; E64» → A4). La E64 coincide con l'A4 tra Milano e Brescia. */
function motorways(st: OsrmStep): string[] {
  const tokens = (st.ref ?? '').split(/[;,/]/).map((x) => x.replace(/\s+/g, '').toUpperCase()).filter(Boolean)
  const a = tokens.map((x) => x.match(/^A\d+$/)?.[0]).filter((x): x is string => !!x)
  return a.length ? a : tokens.includes('E64') ? ['A4'] : []
}

/**
 * Riconosce i pedaggi di una tratta OSRM dai passi percorsi in autostrada (sigla della strada):
 * ogni tratto continuo sull'A4 va dal casello d'ingresso a quello d'uscita e prende l'importo di tabella.
 * Altre autostrade a pagamento (A35 BreBeMi, A58…) restano fuori copertura: l'importo si scrive a mano.
 */
export function analyzeOsrmLeg(leg: OsrmLeg, groupTolls?: Record<string, GroupToll>): Toll {
  const steps = leg.steps ?? []
  const runs: { from: Pt; to: Pt; meters: number }[] = []
  const others = new Set<string>()
  let run: { from: Pt; to: Pt; meters: number } | null = null
  steps.forEach((st, i) => {
    const refs = motorways(st)
    for (const r of refs) if (r !== 'A4' && !FREE_REFS.has(r)) others.add(r)
    const pts = st.intersections ?? []
    if (refs.includes('A4') && (st.maneuver || pts.length)) {
      const start = st.maneuver ? pt(st.maneuver.location) : pt(pts[0].location)
      const next = steps[i + 1]
      const end = next?.maneuver ? pt(next.maneuver.location) : pts.length ? pt(pts[pts.length - 1].location) : start
      if (run) { run.to = end; run.meters += st.distance } else { run = { from: start, to: end, meters: st.distance }; runs.push(run) }
    } else if (run && st.distance > 400) run = null // le rampe brevi senza sigla non spezzano il tratto
  })
  if (others.size) {
    const road = others.has('A35') ? 'A35' : [...others][0]
    return { status: 'out', cents: null, road, note: `${road === 'A35' ? 'A35 BreBeMi' : road}: fuori copertura, scrivi l'importo` }
  }
  if (!runs.length) return { status: 'none', cents: 0 }
  let cents = 0
  let first: { from: string; to: string } | null = null
  let paid = 0
  for (const r of runs) {
    const f = gateAt(r.from), t = gateAt(r.to)
    if (f === 'out' || t === 'out') return { status: 'out', cents: null, road: 'A4', note: 'A4 fuori dal tratto Milano Est – Brescia Est: scrivi l\'importo' }
    if (!f || !t) return { status: 'verify', cents: null, road: 'A4', note: 'Casello non riconosciuto: scegli entrata e uscita' }
    if (f.id === t.id) continue // stesso casello (per esempio solo il tratto urbano oltre la barriera): niente biglietto
    const one = a4Toll(f.id, t.id, groupTolls)
    if (one.cents == null) return one
    cents += one.cents; paid++
    if (!first) first = { from: f.id, to: t.id }
  }
  if (!first) return { status: 'none', cents: 0 }
  if (paid === 1) return a4Toll(first.from, first.to, groupTolls)
  return { status: 'ok', cents, road: 'A4', note: `${paid} tratti sull'A4, tariffe ufficiali classe A` }
}

/** Riallinea alla tabella i pedaggi A4 già riconosciuti (per le uscite ancora in programma). */
export function refreshTolls<L extends { segs: { meters: number; seconds: number; toll: Toll }[] | null; tollOverride: number | null }>(legs: L[], groupTolls?: Record<string, GroupToll>): L[] {
  return legs.map((l) => {
    if (!l.segs || l.tollOverride != null) return l
    let changed = false
    const segs = l.segs.map((s) => {
      if (s.toll.road !== 'A4' || !s.toll.from || !s.toll.to || s.toll.status === 'out') return s
      const t = a4Toll(s.toll.from, s.toll.to, groupTolls)
      // su una distanza stimata il pedaggio resta da verificare: i caselli sono solo probabili
      const fresh: Toll = s.toll.estimate ? { ...t, status: 'verify', estimate: true, note: s.toll.note } : t
      if (fresh.cents === s.toll.cents && fresh.status === s.toll.status) return s
      changed = true
      return { ...s, toll: fresh }
    })
    return changed ? { ...l, segs } : l
  })
}
