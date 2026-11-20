import { describe, expect, it } from 'vitest'
import { frontSeat, lostDays, nightOwl, perfectEven, recordTripId, saint, tiedForDriver, titles } from './eggs'
import type { Member, Trip } from './types'

const mem = (id: string, joinedAt = '2026-01-01T00:00:00Z'): Member => ({ id, groupId: 'g', userId: null, name: id, color: 0, home: null, homeShared: false, joinedAt, leftAt: null })
const trip = (id: string, startsAt: string, driver: string, present: string[], km = 10, back?: string, status: Trip['status'] = 'confirmed'): Trip => ({
  id, groupId: 'g', status, version: 1, startsAt, dest: { name: 'X', lat: 45, lng: 9 }, presentIds: present, unavailableIds: [],
  legs: [{ kind: 'andata', driverId: driver, designated: false, stops: [], segs: null, geometry: null, routeState: 'ok', actualMeters: km * 1000, tollPayerId: null, tollOverride: null },
    ...(back ? [{ kind: 'ritorno' as const, driverId: driver, designated: false, time: back, stops: [], segs: null, geometry: null, routeState: 'ok' as const, actualMeters: km * 1000, tollPayerId: null, tollOverride: null }] : [])],
  createdBy: driver, updatedBy: driver, updatedAt: startsAt, confirmedAt: startsAt,
})

describe('easter egg', () => {
  it('Pilota e Parassita solo senza pareggi', () => {
    expect(titles({ A: 300, B: -100, C: -200 }, ['A', 'B', 'C'])).toEqual({ pilota: 'A', parassita: 'C' })
    expect(titles({ A: 300, B: 300, C: -600 }, ['A', 'B', 'C'])).toEqual({ pilota: undefined, parassita: 'C' })
    expect(titles({ A: 0, B: 0 }, ['A', 'B'])).toEqual({ pilota: undefined, parassita: undefined })
  })
  it('Santo protettore dopo 5 uscite di fila', () => {
    const t = [1, 2, 3, 4].map((d) => trip(`t${d}`, `2026-11-0${d}T21:00:00Z`, 'A', ['A', 'B']))
    expect(saint(t)).toBeNull()
    expect(saint([...t, trip('t5', '2026-11-05T21:00:00Z', 'A', ['A', 'B'])])).toEqual({ id: 'A', streak: 5 })
    expect(saint([...t, trip('t5', '2026-11-05T21:00:00Z', 'A', ['A']), trip('t6', '2026-11-06T21:00:00Z', 'B', ['A', 'B'])])).toBeNull()
  })
  it('Disperso da 15 giorni', () => {
    const now = Date.parse('2026-11-20T12:00:00Z')
    const t = [trip('t1', '2026-11-01T21:00:00Z', 'A', ['A', 'B']), trip('t2', '2026-11-18T21:00:00Z', 'A', ['A'])]
    expect(lostDays(mem('B'), t, now)).toBe(18)
    expect(lostDays(mem('A'), t, now)).toBeNull()
    expect(lostDays(mem('C', '2026-11-15T00:00:00Z'), t, now)).toBeNull()
  })
  it('Record e Nottambuli', () => {
    const t = [trip('t1', '2026-11-01T21:00:00Z', 'A', ['A'], 10, '04:30'), trip('t2', '2026-11-02T21:00:00Z', 'A', ['A'], 50, '02:00'), trip('t3', '2026-11-03T21:00:00Z', 'A', ['A'], 90, undefined, 'cancelled')]
    expect(recordTripId(t)).toBe('t2')
    expect(nightOwl(t[0])).toBe('04:30')
    expect(nightOwl(t[1])).toBeNull()
  })
  it('Pari perfetto solo per chi ha già viaggiato', () => {
    const t = [trip('t1', '2026-11-01T21:00:00Z', 'A', ['A', 'B'])]
    expect(perfectEven('B', { B: 0 }, t)).toBe(true)
    expect(perfectEven('C', { C: 0 }, t)).toBe(false)
  })
  it('Roulette tra i pari merito al decimo', () => {
    const bal = { km: { A: -1040, B: -1010, C: 500 }, eur: {}, lastDrove: {} }
    expect(tiedForDriver([mem('A'), mem('B'), mem('C')], ['A', 'B', 'C'], [], bal)).toEqual(['A', 'B'])
    expect(tiedForDriver([mem('A'), mem('B'), mem('C')], ['A', 'B', 'C'], ['B'], bal)).toEqual([])
  })
  it('Shotgun: chi guida non lo chiama, il primo lo tiene, un posto non più valido torna libero', () => {
    const t = trip('t', new Date(Date.now() + 86400e3).toISOString(), 'A', ['A', 'B', 'C'], 10, undefined, 'planned')
    expect(frontSeat(t, {}, 'A')).toMatchObject({ holder: undefined, canCall: false, why: 'guidi' })
    expect(frontSeat(t, {}, 'B')).toMatchObject({ holder: undefined, canCall: true })
    expect(frontSeat(t, { t: 'B' }, 'C')).toMatchObject({ holder: 'B', canCall: false })
    expect(frontSeat({ ...t, presentIds: ['A', 'C'] }, { t: 'B' }, 'C')).toMatchObject({ holder: undefined, canCall: true })
    // chi ha lasciato il gruppo non tiene il posto
    expect(frontSeat(t, { t: 'B' }, 'C', Date.now(), new Set(['A', 'C']))).toMatchObject({ holder: undefined, canCall: true })
    expect(frontSeat(t, {}, 'Z').why).toBe('assente')
    expect(frontSeat({ ...t, status: 'confirmed' }, { t: 'B' }, 'C').canCall).toBe(false)
    expect(frontSeat({ ...t, startsAt: new Date(Date.now() - 3 * 3600e3).toISOString() }, {}, 'B').canCall).toBe(false)
  })
})
