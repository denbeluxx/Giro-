import { describe, expect, it } from 'vitest'
import { balances, settleUp, suggestDriver, tripEffect } from './calc'
import { A4_GATES, analyzeOsrmLeg, pairKey } from './tolls'
import type { Leg, Member, Stop, Toll, Trip } from './types'

const NO: Toll = { status: 'none', cents: 0 }
const stop = (id: string, on: string[] = [], off: string[] = []): Stop => ({ id, name: id, lat: 45.7, lng: 9.7, on, off })
function leg(p: Partial<Leg> & { km: number[]; stops: Stop[] }): Leg {
  return {
    kind: 'andata', driverId: 'A', designated: false, geometry: null, routeState: 'ok', actualMeters: null, tollPayerId: null, tollOverride: null,
    ...p, segs: p.km.map((k, i) => ({ meters: k * 1000, seconds: 60, toll: (p as any).tolls?.[i] ?? NO })),
  }
}
function trip(legs: Leg[], p: Partial<Trip> = {}): Trip {
  return { id: 't' + Math.random(), groupId: 'g', status: 'confirmed', version: 1, startsAt: '2026-11-14T21:00:00.000Z', dest: { name: 'X', lat: 0, lng: 0 }, presentIds: ['A', 'B', 'C'], unavailableIds: [], legs, createdBy: 'A', updatedBy: 'A', updatedAt: '', confirmedAt: '', ...p }
}
const member = (id: string, joinedAt = '2026-01-01'): Member => ({ id, groupId: 'g', userId: id, name: id, color: 0, home: null, homeShared: false, joinedAt, leftAt: null })
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)
const fmt = (m: number) => (m / 1000).toFixed(1)

describe('regole dei chilometri', () => {
  const go = (km: number, d = true) => leg({ km: [km], stops: [stop('s', ['B']), stop('e', [], ['B'])], designated: d })
  const back = (km: number, d = true) => ({ ...go(km, d), kind: 'ritorno' as const })

  it('2 + 2 km con flag: 4 effettivi, 12 ponderati (×3)', () => {
    const e = tripEffect(trip([go(2), back(2)]))
    expect(e.realMeters).toBe(4000)
    expect(e.weightedMeters).toBe(12000)
    expect(e.legs.map((l) => l.mult)).toEqual([3, 3])
  })
  it('3 + 3 km con flag: 6 effettivi, 12 ponderati (×2)', () => {
    const e = tripEffect(trip([go(3), back(3)]))
    expect(e.realMeters).toBe(6000)
    expect(e.weightedMeters).toBe(12000)
  })
  it('5 km esatti: 10 ponderati', () => {
    expect(tripEffect(trip([go(2.5), back(2.5)])).weightedMeters).toBe(10000)
    expect(tripEffect(trip([go(5)])).weightedMeters).toBe(10000)
  })
  it('4,9 km: 14,7 ponderati', () => {
    expect(tripEffect(trip([go(4.9)])).weightedMeters).toBeCloseTo(14700, 6)
  })
  it('senza flag: ×1', () => {
    expect(tripEffect(trip([go(2, false), back(2, false)])).weightedMeters).toBe(4000)
  })
  it('km corretti a mano entrano nella soglia con il valore preciso', () => {
    const l = { ...go(6), actualMeters: 4999 }
    expect(tripEffect(trip([l])).legs[0].mult).toBe(3)
    expect(tripEffect(trip([{ ...l, actualMeters: 5000 }])).legs[0].mult).toBe(2)
  })
  it('ritorno dopo mezzanotte: stessa uscita, stessa soglia', () => {
    const r = { ...back(3), time: '01:40' }
    const e = tripEffect(trip([{ ...go(3), time: '22:30' }, r]))
    expect(e.legs.map((l) => l.mult)).toEqual([2, 2]) // 6 km complessivi ≥ 5
  })
  it('conducenti diversi: la soglia vale per ciascuno', () => {
    const e = tripEffect(trip([go(3), { ...back(3), driverId: 'B', stops: [stop('e', ['A']), stop('s', [], ['A'])] }]))
    expect(e.legs.map((l) => l.mult)).toEqual([3, 3]) // 3 km a testa < 5
    expect(sum(e.km)).toBe(0)
  })
  it('le fermate intermedie non creano nuove soglie', () => {
    const l = leg({ km: [2, 2, 2], designated: true, stops: [stop('a', ['B']), stop('b', ['C']), stop('c'), stop('d', [], ['B', 'C'])] })
    expect(tripEffect(trip([l])).legs[0].mult).toBe(2)
  })
})

describe('quote e saldi', () => {
  it('90 km normali in tre: +60 al conducente, −30 a testa ai passeggeri', () => {
    const e = tripEffect(trip([leg({ km: [90], stops: [stop('s', ['B', 'C']), stop('e', [], ['B', 'C'])] })]))
    expect(e.km.get('A')).toBe(60000)
    expect(e.km.get('B')).toBe(-30000)
    expect(e.km.get('C')).toBe(-30000)
  })
  it('chi sale lungo il percorso paga solo i tratti percorsi', () => {
    // A guida 10 km con B, poi raccoglie C e fa altri 20 km
    const e = tripEffect(trip([leg({ km: [10, 20], stops: [stop('s', ['B']), stop('p', ['C']), stop('e', [], ['B', 'C'])] })]))
    expect(Math.abs(e.km.get('C')! + 20000 / 3)).toBeLessThan(1) // al metro, per chiudere a zero
    expect(Math.abs(e.km.get('B')! + 5000 + 20000 / 3)).toBeLessThan(1)
    expect(sum(e.km)).toBe(0)
  })
  it('cambio conducente al ritorno', () => {
    const a = leg({ km: [30], stops: [stop('s', ['B', 'C']), stop('e', [], ['B', 'C'])] })
    const r = leg({ kind: 'ritorno', driverId: 'B', km: [30], stops: [stop('e', ['A', 'C']), stop('s', [], ['A', 'C'])] })
    const e = tripEffect(trip([a, r]))
    expect(e.km.get('A')).toBe(20000 - 10000)
    expect(e.km.get('B')).toBe(20000 - 10000)
    expect(e.km.get('C')).toBe(-20000)
  })
  it('la somma è zero anche con divisioni non intere', () => {
    const e = tripEffect(trip([leg({ km: [7.3331, 11.0007], designated: true, stops: [stop('s', ['B']), stop('p', ['C']), stop('e', [], ['B', 'C'])], tolls: [NO, { status: 'ok', cents: 385 }] } as any)]))
    expect(sum(e.km)).toBe(0)
    expect(sum(e.eur)).toBe(0)
  })
  it('solo i viaggi confermati cambiano i saldi; annullare e modificare ricalcola', () => {
    const ms = ['A', 'B', 'C'].map((m) => member(m))
    const l = leg({ km: [90], stops: [stop('s', ['B', 'C']), stop('e', [], ['B', 'C'])] })
    const t = trip([l], { status: 'planned' })
    expect(balances(ms, [t], []).km).toEqual({ A: 0, B: 0, C: 0 })
    const c = { ...t, status: 'confirmed' as const }
    expect(balances(ms, [c], []).km.A).toBe(60000)
    expect(balances(ms, [c, c].slice(0, 1), []).km.A).toBe(60000)
    const edited = { ...c, legs: [{ ...l, actualMeters: 60000 }] }
    expect(balances(ms, [edited], []).km).toEqual({ A: 40000, B: -20000, C: -20000 })
    expect(balances(ms, [{ ...c, status: 'cancelled' }], []).km).toEqual({ A: 0, B: 0, C: 0 })
  })
})

describe('pedaggi e rimborsi', () => {
  const tollLeg = (p: Partial<Leg> = {}) => leg({ km: [5, 40], stops: [stop('s', ['B']), stop('p', ['C']), stop('e', [], ['B', 'C'])], tolls: [NO, { status: 'ok', cents: 390, road: 'A4' }], ...p } as any)
  it('il pedaggio è diviso tra gli occupanti del tratto a pagamento, conducente compreso', () => {
    const e = tripEffect(trip([tollLeg()]))
    expect(e.eur.get('A')).toBe(260)
    expect(e.eur.get('B')).toBe(-130)
    expect(e.eur.get('C')).toBe(-130)
  })
  it('si può cambiare pagante e correggere l\'importo', () => {
    const e = tripEffect(trip([tollLeg({ tollPayerId: 'C', tollOverride: 600 })]))
    expect(e.eur.get('C')).toBe(400)
    expect(e.eur.get('A')).toBe(-200)
  })
  it('un rimborso aggiorna il saldo in euro', () => {
    const ms = ['A', 'B', 'C'].map((m) => member(m))
    const t = trip([tollLeg()])
    const b0 = balances(ms, [t], [])
    expect(settleUp(b0.eur)).toEqual([{ from: 'B', to: 'A', cents: 130 }, { from: 'C', to: 'A', cents: 130 }])
    const b1 = balances(ms, [t], [{ id: 's', groupId: 'g', from: 'B', to: 'A', cents: 130, createdAt: '', createdBy: 'B' }])
    expect(b1.eur).toEqual({ A: 130, B: 0, C: -130 })
  })
})

describe('riconoscimento pedaggi dal percorso', () => {
  const g = (id: string) => A4_GATES.find((x) => x.id === id)!
  const step = (ref: string, from: { lat: number; lng: number }, to: { lat: number; lng: number }, distance: number, toll = true) => ({
    ref, distance, intersections: [{ location: [from.lng, from.lat] as [number, number], classes: toll ? ['toll', 'motorway'] : [] }, { location: [to.lng, to.lat] as [number, number], classes: toll ? ['toll', 'motorway'] : [] }],
  })
  const city = { ref: '', distance: 4000, intersections: [{ location: [9.72, 45.69] as [number, number] }] }
  it('nessun pedaggio', () => {
    expect(analyzeOsrmLeg({ distance: 4000, duration: 400, steps: [city] }).status).toBe('none')
  })
  it('A4 coperta con tariffa confermata: importo compilato da solo', () => {
    const steps = [city, step('A4; E64', g('seriate'), g('milano-est'), 40700), city]
    const t = analyzeOsrmLeg({ distance: 50000, duration: 2400, steps }, { [pairKey('seriate', 'milano-est')]: { cents: 440, by: 'A', on: '2026-11-01' } })
    expect(t).toMatchObject({ status: 'ok', cents: 440, from: 'seriate', to: 'milano-est', road: 'A4' })
  })
  it('A4 con tariffa solo indicativa o assente: da verificare', () => {
    const t1 = analyzeOsrmLeg({ distance: 1, duration: 1, steps: [step('A4', g('bergamo'), g('milano-est'), 34100)] })
    expect(t1).toMatchObject({ status: 'verify', cents: 380 })
    const t2 = analyzeOsrmLeg({ distance: 1, duration: 1, steps: [step('A4', g('dalmine'), g('rovato'), 33600)] })
    expect(t2).toMatchObject({ status: 'verify', cents: null, from: 'dalmine', to: 'rovato' })
  })
  it('distingue caselli vicini usando la lunghezza del tratto', () => {
    const near = { lat: (g('ponte-oglio').lat + g('palazzolo').lat) / 2, lng: (g('ponte-oglio').lng + g('palazzolo').lng) / 2 }
    const t = analyzeOsrmLeg({ distance: 1, duration: 1, steps: [step('A4', g('bergamo'), near, 20700)] })
    expect(t.to).toBe('palazzolo')
  })
  it('A35 BreBeMi: fuori copertura', () => {
    const t = analyzeOsrmLeg({ distance: 1, duration: 1, steps: [step('A35', { lat: 45.5, lng: 9.6 }, { lat: 45.52, lng: 10.0 }, 30000)] })
    expect(t).toMatchObject({ status: 'out', road: 'A35' })
  })
})

describe('suggerimento del conducente', () => {
  const ms = [member('A', '2026-01-01'), member('B', '2026-01-02'), member('C', '2026-01-03')]
  it('saldo più basso tra i presenti disponibili', () => {
    const s = suggestDriver(ms, ['A', 'B', 'C'], [], { km: { A: 5000, B: -8000, C: -2000 }, eur: {}, lastDrove: {} }, fmt)!
    expect(s.id).toBe('B')
    expect(suggestDriver(ms, ['A', 'B', 'C'], ['B'], { km: { A: 5000, B: -8000, C: -2000 }, eur: {}, lastDrove: {} }, fmt)!.id).toBe('C')
    expect(suggestDriver(ms, ['A', 'C'], [], { km: { A: 5000, B: -8000, C: -2000 }, eur: {}, lastDrove: {} }, fmt)!.id).toBe('C')
  })
  it('a parità: chi non ha mai guidato, poi chi non guida da più tempo, poi ordine stabile', () => {
    const km = { A: 0, B: 0, C: 0 }
    expect(suggestDriver(ms, ['A', 'B', 'C'], [], { km, eur: {}, lastDrove: { A: '2026-10-01', B: '2026-09-01' } }, fmt)!.id).toBe('C')
    expect(suggestDriver(ms, ['A', 'B', 'C'], [], { km, eur: {}, lastDrove: { A: '2026-10-01', B: '2026-09-01', C: '2026-11-01' } }, fmt)!.id).toBe('B')
    expect(suggestDriver(ms, ['A', 'B', 'C'], [], { km, eur: {}, lastDrove: {} }, fmt)!.id).toBe('A')
  })
})
