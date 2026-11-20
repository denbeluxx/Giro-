import { describe, expect, it } from 'vitest'
import { balances, settleUp, suggestDriver, tripEffect } from './calc'
import { A4_GATES, TARIFFS, a4Toll, analyzeOsrmLeg, pairKey } from './tolls'
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
  type P = { lat: number; lng: number }
  const st = (ref: string, at: P, distance: number) => ({ ref, distance, maneuver: { location: [at.lng, at.lat] as [number, number] }, intersections: [{ location: [at.lng, at.lat] as [number, number] }] })
  // percorso tipo: città → A4 da `from` a `to` → città (OSRM pubblico non segnala i tratti a pagamento: conta la sigla)
  const viaA4 = (from: P, to: P, ref = 'A4', km = 30) => [st('', { lat: from.lat + 0.02, lng: from.lng }, 3000), st(ref, from, km * 1000), st('', to, 2500)]
  it('nessun pedaggio', () => {
    expect(analyzeOsrmLeg({ distance: 4000, duration: 400, steps: [st('', { lat: 45.69, lng: 9.72 }, 4000)] }).status).toBe('none')
  })
  it('A4: importo ufficiale compilato da solo, senza conferme', () => {
    const t = analyzeOsrmLeg({ distance: 50000, duration: 2400, steps: viaA4(g('seriate'), g('milano-est'), 'A4; E64') })
    expect(t).toMatchObject({ status: 'ok', cents: 430, from: 'seriate', to: 'milano-est', road: 'A4' })
    expect(analyzeOsrmLeg({ distance: 1, duration: 1, steps: viaA4(g('bergamo'), g('milano-est')) })).toMatchObject({ status: 'ok', cents: 380 })
    expect(analyzeOsrmLeg({ distance: 1, duration: 1, steps: viaA4(g('dalmine'), g('rovato')) })).toMatchObject({ status: 'ok', cents: 280, from: 'dalmine', to: 'rovato' })
  })
  it('tabella completa e simmetrica: 120 coppie', () => {
    expect(Object.keys(TARIFFS)).toHaveLength(120)
    expect(TARIFFS[pairKey('brescia-est', 'milano-est')]).toBe(820)
    expect(TARIFFS[pairKey('ponte-oglio', 'palazzolo')]).toBe(20)
    expect(a4Toll('bergamo', 'seriate').cents).toBe(a4Toll('seriate', 'bergamo').cents)
  })
  it('uscita verso la tangenziale o Milano città: vale la barriera di Milano Est', () => {
    const t = analyzeOsrmLeg({ distance: 1, duration: 1, steps: [st('A4', { lat: 45.6689, lng: 9.6653 }, 27587), st('', { lat: 45.5681, lng: 9.3483 }, 1835), st('A51', { lat: 45.56, lng: 9.33 }, 14000)] })
    expect(t).toMatchObject({ status: 'ok', cents: 380, from: 'bergamo', to: 'milano-est' })
    const far = analyzeOsrmLeg({ distance: 1, duration: 1, steps: viaA4({ lat: 45.6558, lng: 9.7468 }, { lat: 45.5350, lng: 9.1602 }) })
    expect(far).toMatchObject({ status: 'ok', cents: 430, to: 'milano-est' })
  })
  it('solo il tratto urbano a ovest della barriera: nessun pedaggio', () => {
    expect(analyzeOsrmLeg({ distance: 1, duration: 1, steps: viaA4({ lat: 45.5552, lng: 9.2622 }, { lat: 45.5423, lng: 9.1783 }) }).status).toBe('none')
  })
  it('distingue caselli vicini (Ponte Oglio e Palazzolo distano 2 km)', () => {
    expect(analyzeOsrmLeg({ distance: 1, duration: 1, steps: viaA4({ lat: 45.6689, lng: 9.6653 }, { lat: 45.6174, lng: 9.9242 }) }).to).toBe('palazzolo')
    expect(analyzeOsrmLeg({ distance: 1, duration: 1, steps: viaA4({ lat: 45.6689, lng: 9.6653 }, { lat: 45.6247, lng: 9.8927 }) }).to).toBe('ponte-oglio')
  })
  it('A4 spezzata in più passi con una rampa breve in mezzo: un solo tratto', () => {
    const steps = [st('A4', g('seriate'), 12000), st('', g('dalmine'), 200), st('A4', g('dalmine'), 20000), st('', g('agrate'), 900)]
    expect(analyzeOsrmLeg({ distance: 1, duration: 1, steps })).toMatchObject({ status: 'ok', cents: 270, from: 'seriate', to: 'agrate' })
  })
  it('due ingressi distinti sull\'A4: somma dei due biglietti', () => {
    const steps = [st('A4', g('seriate'), 8000), st('', g('bergamo'), 5000), st('A4', g('dalmine'), 9000), st('', g('capriate'), 900)]
    expect(analyzeOsrmLeg({ distance: 1, duration: 1, steps })).toMatchObject({ status: 'ok', cents: 60 + 70 })
  })
  it('A35 BreBeMi e A4 oltre Brescia Est: fuori copertura; tangenziali di Milano: gratis', () => {
    expect(analyzeOsrmLeg({ distance: 1, duration: 1, steps: [st('A35', { lat: 45.5, lng: 9.6 }, 30000), st('', { lat: 45.52, lng: 10.0 }, 500)] })).toMatchObject({ status: 'out', road: 'A35' })
    expect(analyzeOsrmLeg({ distance: 1, duration: 1, steps: viaA4(g('seriate'), { lat: 45.45, lng: 10.52 }) })).toMatchObject({ status: 'out', road: 'A4' })
    expect(analyzeOsrmLeg({ distance: 1, duration: 1, steps: [st('A51', { lat: 45.5, lng: 9.27 }, 9000), st('', { lat: 45.47, lng: 9.26 }, 500)] }).status).toBe('none')
  })
  it('una tariffa scritta dal gruppo vale solo se più recente della tabella', () => {
    const k = pairKey('seriate', 'milano-est')
    expect(a4Toll('seriate', 'milano-est', { [k]: { cents: 999, by: 'A', on: '2026-11-01' } }).cents).toBe(430)
    expect(a4Toll('seriate', 'milano-est', { [k]: { cents: 450, by: 'A', on: '2027-01-02T10:00:00Z' } }).cents).toBe(450)
  })
})

describe('pedaggi su percorsi reali (risposte di OSRM del 20/11/2026: sigla, metri, lng, lat di ogni passo)', () => {
  type S = [string, number, number, number]
  const leg = (s: S[]) => ({ distance: 1, duration: 1, steps: s.map(([ref, distance, lng, lat]) => ({ ref, distance, maneuver: { location: [lng, lat] as [number, number] }, intersections: [{ location: [lng, lat] as [number, number] }] })) })
  it('Seriate → Navigli (entra a Bergamo, esce sulla Tangenziale Est): 3,80 €', () => {
    const t = analyzeOsrmLeg(leg([['', 494, 9.7173, 45.685], ['', 794, 9.6785, 45.6824], ['A4', 27587, 9.6653, 45.6689], ['', 1835, 9.3483, 45.5681], ['A51', 14248, 9.3322, 45.5598], ['', 437, 9.2509, 45.4644]]))
    expect(t).toMatchObject({ status: 'ok', cents: 380, from: 'bergamo', to: 'milano-est' })
  })
  it('Navigli → Seriate (A51, A52, poi A4 fino a Bergamo): 3,80 €', () => {
    const t = analyzeOsrmLeg(leg([['A51', 6014, 9.2522, 45.4679], ['A52', 3517, 9.2614, 45.5201], ['', 673, 9.2645, 45.5511], ['', 581, 9.2701, 45.5553], ['A4', 32850, 9.2767, 45.5572], ['', 1453, 9.6608, 45.6662], ['', 792, 9.6709, 45.6776]]))
    expect(t).toMatchObject({ status: 'ok', cents: 380, from: 'milano-est', to: 'bergamo' })
  })
  it('Bergamo → Brescia (esce a Brescia Ovest): 3,50 €', () => {
    expect(analyzeOsrmLeg(leg([['', 856, 9.6688, 45.6729], ['A4', 42309, 9.6724, 45.6695], ['', 897, 10.1659, 45.525], ['', 1399, 10.1712, 45.5311]]))).toMatchObject({ status: 'ok', cents: 350, to: 'brescia-ovest' })
  })
  it('Dalmine → Agrate: 1,80 €; Alzano → Rovato: 2,40 €', () => {
    expect(analyzeOsrmLeg(leg([['SS470dir', 1497, 9.6143, 45.6568], ['', 632, 9.6195, 45.6455], ['A4', 21407, 9.6153, 45.6413], ['', 412, 9.3628, 45.5702]]))).toMatchObject({ status: 'ok', cents: 180, from: 'dalmine', to: 'agrate' })
    expect(analyzeOsrmLeg(leg([['', 856, 9.6688, 45.6729], ['A4', 28248, 9.6724, 45.6695], ['', 723, 10.0047, 45.5775]]))).toMatchObject({ status: 'ok', cents: 240, from: 'bergamo', to: 'rovato' })
  })
  it('strade statali senza autostrada: nessun pedaggio', () => {
    expect(analyzeOsrmLeg(leg([['SPexSS498', 875, 9.7532, 45.6418], ['SS573', 3137, 9.7761, 45.6198], ['SPBS573', 1549, 9.8494, 45.5999]])).status).toBe('none')
  })
  it('Seriate → Verona: A4 oltre Brescia Est, fuori copertura; Brescia → Milano via BreBeMi: fuori copertura', () => {
    expect(analyzeOsrmLeg(leg([['', 464, 9.7475, 45.6538], ['A4', 100572, 9.753, 45.6545], ['', 1130, 10.9646, 45.3975]]))).toMatchObject({ status: 'out', road: 'A4' })
    expect(analyzeOsrmLeg(leg([['A4', 3469, 10.164, 45.5261], ['A35', 55227, 10.1272, 45.5434], ['A58', 1302, 9.4407, 45.5123], ['SP103', 15540, 9.4343, 45.5158]]))).toMatchObject({ status: 'out', road: 'A35' })
  })
})
