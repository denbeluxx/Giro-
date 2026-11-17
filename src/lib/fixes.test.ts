import { describe, expect, it } from 'vitest'
import { displayRound, legToll, settleUp, suggestDriver, tripEffect, zeroSumRound } from './calc'
import { kmField, parseNum } from './format'
import { bestOrder, buildStops } from './plan'
import { A4_GATES, analyzeOsrmLeg, haversine, refreshTolls } from './tolls'
import type { Leg, Member, Stop, Toll, Trip } from './types'

const NO: Toll = { status: 'none', cents: 0 }
const stop = (id: string, on: string[] = [], off: string[] = []): Stop => ({ id, name: id, lat: 45.7, lng: 9.7, on, off })
const leg = (p: Partial<Leg> & { km: number[]; stops: Stop[]; tolls?: Toll[] }): Leg => ({
  kind: 'andata', driverId: 'A', designated: false, geometry: null, routeState: 'ok', actualMeters: null, tollPayerId: null, tollOverride: null,
  ...p, segs: p.km.map((k, i) => ({ meters: k * 1000, seconds: 60, toll: p.tolls?.[i] ?? NO })),
})
const trip = (legs: Leg[], p: Partial<Trip> = {}): Trip => ({ id: 't', groupId: 'g', status: 'confirmed', version: 1, startsAt: '2026-11-14T21:00:00Z', dest: { name: 'X', lat: 45.62, lng: 9.59 }, presentIds: ['A', 'B', 'C'], unavailableIds: [], legs, createdBy: 'A', updatedBy: 'A', updatedAt: '', confirmedAt: '', ...p })
const mem = (id: string, home: [number, number] | null, shared = true, joined = '2026-01-01'): Member => ({ id, groupId: 'g', userId: id, name: id, color: 0, home: home && { lat: home[0], lng: home[1], label: id }, homeShared: shared, joinedAt: joined, leftAt: null })
const sum = (o: Record<string, number> | Map<string, number>) => [...(o instanceof Map ? o.values() : Object.values(o))].reduce((a, b) => a + b, 0)
const tourLen = (s: Stop[]) => s.slice(1).reduce((a, x, i) => a + haversine(s[i], x), 0)

describe('giro delle case', () => {
  // dati demo: Seriate, Bergamo, Dalmine, Alzano, Stezzano → Bolgia (Osio Sopra)
  const ms = [mem('Andrea', [45.6862, 9.7255]), mem('Luca', [45.6953, 9.6701]), mem('Marco', [45.6498, 9.6052]), mem('Giulia', [45.7312, 9.7281]), mem('Sara', [45.6588, 9.6517])]
  const bolgia = { name: 'Bolgia', lat: 45.6255, lng: 9.5905 }
  it('sceglie l\'ordine più corto con la destinazione come arrivo fisso', () => {
    const s = buildStops('andata', ms, ms.map((m) => m.id), 'Andrea', bolgia)
    expect(s[0].name).toBe('Casa di Andrea')
    expect(s[s.length - 1].name).toBe('Bolgia')
    expect(s.map((x) => x.name)).toEqual(['Casa di Andrea', 'Casa di Giulia', 'Casa di Luca', 'Casa di Sara', 'Casa di Marco', 'Bolgia'])
    // in linea d'aria il giro è molto più corto del vecchio «casa più vicina» (≈ 41 km)
    expect(tourLen(s)).toBeLessThan(26000)
  })
  it('conducente senza casa: parte dalla casa più lontana dalla destinazione', () => {
    const noHome = ms.map((m) => (m.id === 'Marco' ? { ...m, home: null } : m))
    const s = buildStops('andata', noHome, ms.map((m) => m.id), 'Marco', bolgia)
    expect(s[0].name).toBe('Casa di Giulia')
    expect(s[s.length - 1].name).toBe('Bolgia')
  })
  it('una casa non condivisa non diventa mai una tappa', () => {
    const priv = ms.map((m) => (m.id === 'Luca' ? { ...m, homeShared: false } : m))
    const s = buildStops('andata', priv, ['Andrea', 'Luca'], 'Andrea', bolgia)
    expect(s.map((x) => x.name)).toEqual(['Casa di Andrea', 'Bolgia'])
    expect(s[0].on).toContain('Luca') // sale alla partenza
  })
  it('bestOrder con molte tappe resta valido', () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ lat: 45.6 + (i % 3) * 0.03, lng: 9.5 + i * 0.02 }))
    const o = bestOrder({ lat: 45.6, lng: 9.4 }, pts, { lat: 45.7, lng: 9.8 })
    expect(o).toHaveLength(10)
    expect(new Set(o).size).toBe(10)
  })
})

describe('pedaggi', () => {
  const g = (id: string) => A4_GATES.find((x) => x.id === id)!
  const step = (ref: string, a: { lat: number; lng: number }, b: { lat: number; lng: number }, distance: number) => ({ ref, distance, intersections: [{ location: [a.lng, a.lat] as [number, number], classes: ['toll'] }, { location: [b.lng, b.lat] as [number, number], classes: ['toll'] }] })
  it('uscita oltre Brescia Ovest: fuori copertura, non Seriate→Brescia Ovest', () => {
    const beyond = { lat: g('brescia-ovest').lat - 0.01, lng: g('brescia-ovest').lng + 0.05 }
    const t = analyzeOsrmLeg({ distance: 1, duration: 1, steps: [step('A4', g('seriate'), beyond, 36200 + 6700)] }, { 'brescia-ovest|seriate': { cents: 520, by: 'A', on: '2026-11-01' } })
    expect(t.status).toBe('out')
  })
  it('riconosce «A 4» e la sola «E64»', () => {
    expect(analyzeOsrmLeg({ distance: 1, duration: 1, steps: [step('A 4', g('seriate'), g('milano-est'), 40700)] }).road).toBe('A4')
    expect(analyzeOsrmLeg({ distance: 1, duration: 1, steps: [step('E64', g('seriate'), g('milano-est'), 40700)] }).road).toBe('A4')
  })
  it('tratta mista: importo noto + parte da inserire, e i saldi addebitano solo il noto', () => {
    const l = leg({ km: [20, 10], stops: [stop('s', ['B']), stop('p'), stop('e', [], ['B'])], tolls: [{ status: 'ok', cents: 250, road: 'A4' }, { status: 'out', cents: null, road: 'A58' }] })
    const t = legToll(l)
    expect(t).toMatchObject({ status: 'out', cents: null, known: 250 })
    expect(tripEffect(trip([l], { presentIds: ['A', 'B'] })).eur.get('A')).toBe(125)
  })
  it('importo a mano diviso tra i tratti a pagamento: chi sale dopo il primo casello paga la sua parte', () => {
    const l = leg({ km: [10, 10], stops: [stop('s', ['B']), stop('p', ['C']), stop('e', [], ['B', 'C'])], tolls: [{ status: 'ok', cents: 200 }, { status: 'ok', cents: 200 }], tollOverride: 600 })
    const e = tripEffect(trip([l]))
    expect(e.eur.get('C')).toBe(-100) // metà dei 600 € sul secondo tratto, diviso in tre
    expect(sum(e.eur)).toBe(0)
  })
  it('le tariffe confermate dopo il salvataggio aggiornano le uscite in programma', () => {
    const l = leg({ km: [40], stops: [stop('s'), stop('e')], tolls: [{ status: 'verify', cents: null, road: 'A4', from: 'dalmine', to: 'capriate' }] })
    const [r] = refreshTolls([l], { 'capriate|dalmine': { cents: 190, by: 'A', on: '2026-11-01' } })
    expect(r.segs![0].toll).toMatchObject({ status: 'ok', cents: 190 })
  })
})

describe('numeri e arrotondamenti', () => {
  it('somma visibile zero al decimo di km', () => {
    const v = { a: -65737, b: -48005, c: -16586, d: 19872, e: 110456 }
    const r = displayRound(v)
    expect(sum(r)).toBe(0)
    expect(Object.values(r).every((x) => x % 100 === 0)).toBe(true)
  })
  it('dati anomali non bloccano l\'app', () => {
    const t0 = Date.now()
    const m = zeroSumRound(new Map([['a', 1e300], ['b', -1e300 / 3], ['c', Infinity], ['d', NaN]]))
    expect(Date.now() - t0).toBeLessThan(100)
    expect(m.size).toBe(4)
    const l = leg({ km: [1], stops: [stop('s', ['B']), stop('e', [], ['B'])], actualMeters: 1e308 })
    expect(tripEffect(trip([l])).realMeters).toBe(0)
  })
  it('lettura dei numeri scritti a mano', () => {
    expect(parseNum('12,5')).toBe(12.5)
    expect(parseNum('1.250,5')).toBe(1250.5)
    expect(parseNum('3.5')).toBe(3.5)
    expect(parseNum('-3')).toBeNull()
    expect(parseNum('12abc')).toBeNull()
    expect(parseNum('1e30')).toBeNull()
    expect(parseNum('2500', 2000)).toBeNull()
    expect(kmField(4999)).toBe('4,999')
  })
  it('km inseriti a mano senza tappe: tutti i presenti dividono', () => {
    const l: Leg = { ...leg({ km: [], stops: [stop('e')] }), segs: null, actualMeters: 20000 }
    const e = tripEffect(trip([l], { presentIds: ['A', 'B'] }))
    expect(e.km.get('A')).toBe(10000)
    expect(e.km.get('B')).toBe(-10000)
  })
  it('rimborsi: prima le coppie che si chiudono a vicenda', () => {
    expect(settleUp({ a: -300, b: -200, c: 200, d: 300 })).toHaveLength(2)
  })
})

describe('frasi del suggerimento', () => {
  const ms = [mem('Andrea', null, true, '2026-01-01'), mem('Marco', null, true, '2026-01-03'), mem('Sara', null, true, '2026-01-05')]
  const fmt = (m: number) => `${m / 1000}`
  it('parla di chi può guidare, non di tutti i presenti', () => {
    const s = suggestDriver(ms, ['Andrea', 'Marco', 'Sara'], ['Andrea'], { km: { Andrea: -9000, Marco: -1000, Sara: 0 }, eur: {}, lastDrove: {} }, fmt)!
    expect(s.reason).toContain('tra chi può guidare')
  })
  it('spareggio spiegato con il criterio decisivo', () => {
    const s = suggestDriver(ms, ['Andrea', 'Marco', 'Sara'], [], { km: {}, eur: {}, lastDrove: { Andrea: '2026-10-01' } }, fmt)!
    expect(s.id).toBe('Marco')
    expect(s.reason).toBe('Marco e Sara sono pari e nessuno dei due ha ancora guidato: Marco è nel gruppo da più tempo.')
    expect(suggestDriver(ms, ['Sara'], [], { km: {}, eur: {}, lastDrove: {} }, fmt)!.reason).toBe('C\'è solo Sara.')
  })
})
