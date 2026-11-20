/** Stress test dei calcoli: migliaia di uscite generate a caso (seme fisso, risultati ripetibili). */
import { describe, expect, it } from 'vitest'
import { BONUS_CAP_M, THRESHOLD_M, balances, displayRound, legMeters, occupantsBySeg, segMeters, settleUp, suggestDriver, tripEffect } from './calc'
import type { ID, Leg, Member, Settlement, Stop, Toll, Trip } from './types'

function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const sum = (m: Map<ID, number> | Record<ID, number>) => (m instanceof Map ? [...m.values()] : Object.values(m)).reduce((a, b) => a + b, 0)

function world(seed: number, nMembers: number, nTrips: number) {
  const r = rng(seed)
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1))
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const members: Member[] = Array.from({ length: nMembers }, (_, i) => ({ id: `m${i}`, groupId: 'g', userId: null, name: `M${i}`, color: i % 8, home: null, homeShared: false, joinedAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`, leftAt: null }))
  const ids = members.map((m) => m.id)
  const toll = (): Toll => {
    const k = r()
    if (k < 0.55) return { status: 'none', cents: null }
    if (k < 0.8) return { status: 'ok', cents: int(50, 900) }
    if (k < 0.9) return { status: 'verify', cents: r() < 0.5 ? null : int(50, 900) }
    return { status: 'out', cents: null }
  }
  const leg = (kind: Leg['kind'], driver: ID | null, present: ID[]): Leg => {
    // tappe: il conducente parte, gli altri salgono e scendono lungo il giro
    const nStops = int(2, 6)
    const riders = present.filter((x) => x !== driver)
    const stops: Stop[] = Array.from({ length: nStops }, (_, i) => ({ id: `${kind}-s${i}`, name: `S${i}`, lat: 45 + r() / 10, lng: 9 + r() / 10, on: [], off: [] }))
    for (const p of riders) {
      const a = int(0, nStops - 2), b = int(a + 1, nStops - 1)
      stops[a].on.push(p); stops[b].off.push(p)
    }
    const hasSegs = r() < 0.85
    const segs = hasSegs ? Array.from({ length: nStops - 1 }, () => ({ meters: r() < 0.05 ? 0 : int(200, 60000), seconds: int(30, 3600), toll: toll() })) : null
    return {
      kind, driverId: driver, designated: false, stops, segs, geometry: null, routeState: 'ok',
      actualMeters: r() < 0.2 ? int(0, 120000) : null,
      tollPayerId: r() < 0.3 ? pick(present) : null,
      tollOverride: r() < 0.1 ? int(0, 3000) : null,
    }
  }
  const trips: Trip[] = Array.from({ length: nTrips }, (_, i) => {
    const present = ids.filter(() => r() < 0.55)
    if (present.length === 0) present.push(pick(ids))
    const driver = r() < 0.95 ? pick(present) : null
    const designated = r() < 0.25
    const legs = [leg('andata', driver, present)]
    if (r() < 0.8) legs.push(leg('ritorno', r() < 0.9 ? driver : pick(present), present))
    if (designated) legs[int(0, legs.length - 1)].designated = true
    const k = r()
    return {
      id: `t${seed}-${i}`, groupId: 'g', status: k < 0.75 ? 'confirmed' : k < 0.88 ? 'planned' : 'cancelled', version: 1,
      startsAt: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString(), dest: { name: 'D', lat: 45, lng: 9 },
      presentIds: present, unavailableIds: [], legs, createdBy: ids[0], updatedBy: ids[0], updatedAt: '2026-01-01T00:00:00Z', confirmedAt: null,
    } as Trip
  })
  const settlements: Settlement[] = Array.from({ length: int(0, 12) }, (_, i) => {
    const from = pick(ids); let to = pick(ids); if (to === from) to = ids[(ids.indexOf(from) + 1) % ids.length]
    return { id: `s${i}`, groupId: 'g', from, to, cents: int(1, 5000), createdAt: '2026-02-01T00:00:00Z', createdBy: from }
  })
  return { members, trips, settlements, r }
}

describe('stress test dei calcoli', () => {
  it('ogni uscita: km e pedaggi interi a somma zero, conducente mai in perdita, regole ×2 / ×3 rispettate', () => {
    let checked = 0
    for (let seed = 1; seed <= 60; seed++) {
      const { trips } = world(seed, 2 + (seed % 14), 80)
      for (const t of trips) {
        const fx = tripEffect(t)
        for (const v of [...fx.km.values(), ...fx.eur.values()]) expect(Number.isInteger(v)).toBe(true)
        expect(sum(fx.km)).toBe(0)
        expect(sum(fx.eur)).toBe(0)
        // chi guida da solo o con altri non scende mai sotto zero per i km di quell'uscita
        const drivers = new Set(t.legs.map((l) => l.driverId).filter(Boolean) as ID[])
        if (drivers.size === 1) expect(fx.km.get([...drivers][0]) ?? 0).toBeGreaterThanOrEqual(0)
        // ponderazione: senza «ostia» ×1; con «ostia» ×3 sotto i 5 km mostrati, altrimenti bonus massimo 30 km
        const total = t.legs.reduce((a, l) => a + (l.driverId ? legMeters(l) : 0), 0)
        const weighted = fx.legs.reduce((a, l) => a + (l.driverId ? l.weightedMeters : 0), 0)
        const flagged = t.legs.some((l) => l.designated)
        if (!flagged || total === 0) expect(weighted).toBeCloseTo(total, 6)
        else if (Math.round(total / 100) * 100 < THRESHOLD_M) expect(weighted).toBeCloseTo(total * 3, 6)
        else expect(weighted).toBeCloseTo(total + Math.min(total, BONUS_CAP_M), 4)
        // il conducente riceve esattamente i km pesati meno la sua quota, tratto per tratto (±1 m di arrotondamento per persona)
        if (drivers.size === 1) {
          const d = [...drivers][0]
          let expected = 0
          for (const l of t.legs) {
            if (!l.driverId) continue
            const mult = fx.legs.find((x) => x.kind === l.kind)!.mult
            const segsOk = !!l.segs?.length && l.stops.length === l.segs.length + 1
            const occ = segsOk ? occupantsBySeg(l) : [[...new Set([l.driverId, ...t.presentIds])]]
            segMeters(l).forEach((m, i) => { const who = occ[i] ?? []; if (who.length) expect(who).toContain(l.driverId); if (who.length) expected += m * mult * (1 - 1 / who.length) })
          }
          expect(Math.abs((fx.km.get(d) ?? 0) - expected)).toBeLessThanOrEqual(t.presentIds.length + 1)
        }
        checked++
      }
    }
    expect(checked).toBe(60 * 80)
  })

  it('saldi del gruppo: somma zero, indipendenti dall\'ordine, annullare un viaggio lo toglie esattamente', () => {
    for (let seed = 100; seed < 130; seed++) {
      const { members, trips, settlements, r } = world(seed, 3 + (seed % 12), 150)
      const b = balances(members, trips, settlements)
      expect(sum(b.km)).toBe(0)
      expect(sum(b.eur)).toBe(0)
      // ordine dei viaggi e dei membri ininfluente
      const shuffled = [...trips].sort(() => r() - 0.5)
      const b2 = balances([...members].reverse(), shuffled, [...settlements].reverse())
      expect(b2.km).toEqual(b.km)
      expect(b2.eur).toEqual(b.eur)
      // annullare un viaggio confermato = toglierlo
      const i = trips.findIndex((t) => t.status === 'confirmed')
      if (i >= 0) {
        const cancelled = trips.map((t, k) => (k === i ? { ...t, status: 'cancelled' as const } : t))
        const without = trips.filter((_, k) => k !== i)
        expect(balances(members, cancelled, settlements)).toEqual(balances(members, without, settlements))
      }
    }
  })

  it('arrotondamento mostrato: multipli di 0,1 km, somma zero, mai più di 0,1 km di scarto', () => {
    for (let seed = 200; seed < 260; seed++) {
      const { members, trips, settlements } = world(seed, 2 + (seed % 15), 60)
      const b = balances(members, trips, settlements)
      const shown = displayRound(b.km)
      expect(sum(shown)).toBe(0)
      for (const [id, v] of Object.entries(shown)) {
        expect(Math.abs(v % 100)).toBe(0)
        expect(Object.is(v, -0)).toBe(false)
        expect(Math.abs(v - b.km[id])).toBeLessThan(100.0001)
      }
    }
  })

  it('rimborsi suggeriti: chiudono tutti i conti al centesimo, al massimo n−1 bonifici', () => {
    for (let seed = 300; seed < 400; seed++) {
      const { members, trips, settlements } = world(seed, 2 + (seed % 15), 40)
      const eur = { ...balances(members, trips, settlements).eur }
      const plan = settleUp(eur)
      const nonzero = Object.values(eur).filter((v) => v !== 0).length
      expect(plan.length).toBeLessThanOrEqual(Math.max(0, nonzero - 1))
      for (const p of plan) { expect(p.cents).toBeGreaterThan(0); expect(Number.isInteger(p.cents)).toBe(true); eur[p.from] += p.cents; eur[p.to] -= p.cents }
      for (const v of Object.values(eur)) expect(v).toBe(0)
    }
  })

  it('suggerimento del conducente: sempre tra i presenti disponibili, col saldo mostrato più basso', () => {
    for (let seed = 400; seed < 460; seed++) {
      const { members, trips, settlements, r } = world(seed, 2 + (seed % 15), 50)
      const bal = balances(members, trips, settlements)
      const present = members.filter(() => r() < 0.6).map((m) => m.id)
      const unavailable = present.filter(() => r() < 0.2)
      const s = suggestDriver(members, present, unavailable, bal, String)
      const avail = present.filter((x) => !unavailable.includes(x))
      if (!avail.length) { expect(s).toBeNull(); continue }
      expect(avail).toContain(s!.id)
      const tenth = (id: ID) => Math.sign(bal.km[id]) * Math.round(Math.abs(bal.km[id]) / 100)
      expect(tenth(s!.id)).toBe(Math.min(...avail.map(tenth)))
    }
  })

  it('dati rovinati (NaN, negativi, enormi, campi mancanti) non rompono nulla e restano a somma zero', () => {
    const { members, trips, settlements } = world(999, 8, 200)
    const bad = (v: number, i: number) => [NaN, -5000, Infinity, 1e12, v][i % 5]
    const broken = trips.map((t, i) => ({
      ...t,
      legs: i % 7 === 0 ? (undefined as unknown as Leg[]) : t.legs.map((l, k) => ({
        ...l,
        actualMeters: i % 3 === 0 ? bad(l.actualMeters ?? 1000, i + k) : l.actualMeters,
        tollOverride: i % 4 === 0 ? bad(l.tollOverride ?? 100, i) : l.tollOverride,
        segs: i % 5 === 0 ? l.segs?.map((s) => ({ ...s, meters: bad(s.meters, i), toll: { ...s.toll, cents: bad(s.toll.cents ?? 0, i + 1) } })) ?? null : l.segs,
      })),
      presentIds: i % 11 === 0 ? (undefined as unknown as ID[]) : t.presentIds,
    }))
    const b = balances(members, broken, [...settlements, { ...settlements[0], cents: NaN } as Settlement, null as unknown as Settlement])
    expect(sum(b.km)).toBe(0)
    expect(sum(b.eur)).toBe(0)
    for (const v of [...Object.values(b.km), ...Object.values(b.eur)]) expect(Number.isFinite(v)).toBe(true)
  })

  it('gruppo enorme: 25 persone e 3.000 uscite si calcolano in meno di un secondo', () => {
    const { members, trips, settlements } = world(4242, 25, 3000)
    const t0 = performance.now()
    const b = balances(members, trips, settlements)
    displayRound(b.km); settleUp(b.eur)
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(sum(b.km)).toBe(0)
  })
})
