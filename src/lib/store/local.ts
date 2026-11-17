import { buildStops, newLeg, reverseStops } from '../plan'
import { estimateRoute } from '../routing'
import { pairKey } from '../tolls'
import { uid, type Group, type GroupData, type ID, type Leg, type Member, type Place, type Trip } from '../types'
import { sanitizeTrips } from '../validate'
import { ConflictError, type Store } from './types'

const KEY = 'giro-demo-v4'
interface G { group: Group; members: Member[]; places: Place[]; trips: Trip[]; settlements: GroupData['settlements'] }
interface DB { groups: Record<ID, G> }

const mem: { db?: string } = {}
function read(): DB {
  try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s) } catch { if (mem.db) return JSON.parse(mem.db) }
  const db = seed()
  write(db, false)
  return db
}
let chan: BroadcastChannel | null = null
try { chan = new BroadcastChannel('giro-demo') } catch { /* non disponibile */ }
const listeners = new Set<() => void>()
function write(db: DB, notify = true) {
  const s = JSON.stringify(db)
  mem.db = s
  try { localStorage.setItem(KEY, s) } catch { /* solo memoria */ }
  if (notify) { chan?.postMessage('x'); listeners.forEach((l) => l()) }
}
if (chan) chan.onmessage = () => listeners.forEach((l) => l())
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === KEY) listeners.forEach((l) => l()) })

/** In demo si può «entrare» come un altro membro, per provare due sessioni affiancate. */
const ME_KEY = 'giro-demo-me'
export function demoIdentity(groupId: ID): ID | null { try { return sessionStorage.getItem(`${ME_KEY}-${groupId}`) } catch { return null } }
export function setDemoIdentity(groupId: ID, memberId: ID) { try { sessionStorage.setItem(`${ME_KEY}-${groupId}`, memberId) } catch { /* */ } listeners.forEach((l) => l()) }
export function resetDemo() { try { localStorage.removeItem(KEY) } catch { /* */ } mem.db = undefined; write(seed()) }

function seed(): DB {
  const gid = 'demo-group'
  const day = (n: number, h = 21, m = 30) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString() }
  const mk = (id: string, name: string, color: number, lat: number, lng: number, label: string, joined: number): Member =>
    ({ id, groupId: gid, userId: id === 'm-daniele' ? 'demo-user' : `u-${id}`, name, color, home: { lat, lng, label }, homeShared: true, joinedAt: day(joined), leftAt: null })
  const members = [
    mk('m-daniele', 'Daniele', 0, 45.6862, 9.7255, 'Via Dante 8, Seriate', -200),
    mk('m-matteo', 'Matteo', 1, 45.6953, 9.6701, 'Via Paleocapa 3, Bergamo', -199),
    mk('m-filippo', 'Filippo', 2, 45.6498, 9.6052, 'Via Verdi 21, Dalmine', -198),
    mk('m-alessia', 'Alessia', 3, 45.7312, 9.7281, 'Via Roma 5, Alzano Lombardo', -197),
    mk('m-andrea', 'Andrea', 4, 45.6588, 9.6517, 'Via Galilei 2, Stezzano', -40),
  ]
  const places: Place[] = [
    { id: 'p-bolgia', name: 'Bolgia', address: 'Via Vaccarezza, Osio Sopra', lat: 45.6255, lng: 9.5905, kind: 'locale' },
    { id: 'p-setai', name: 'Setai Club', address: 'Via Portico, Orio al Serio', lat: 45.6727, lng: 9.7022, kind: 'locale' },
    { id: 'p-navigli', name: 'Navigli', address: 'Ripa di Porta Ticinese, Milano', lat: 45.4523, lng: 9.1746, kind: 'locale' },
    { id: 'p-malp', name: 'Parcheggio Malpensata', address: 'Via Carnovali, Bergamo', lat: 45.6853, lng: 9.6726, kind: 'ritrovo' },
  ]
  const tolls = { [pairKey('seriate', 'milano-est')]: { cents: 440, by: 'm-daniele', on: day(-30) }, [pairKey('bergamo', 'milano-est')]: { cents: 380, by: 'm-matteo', on: day(-30) } }
  const trip = (id: string, when: string, status: Trip['status'], driver: ID, present: ID[], place: Place, designated = false): Trip => {
    const go = newLeg('andata', driver, buildStops('andata', members, present, driver, place))
    const back = newLeg('ritorno', driver, reverseStops(go.stops))
    const legs: Leg[] = [go, back].map((l) => { const r = estimateRoute(l.stops, tolls, true); return { ...l, designated, time: l.kind === 'andata' ? '21:30' : '02:00', segs: r.segs, geometry: r.geometry, routeState: 'ok' } })
    return { id, groupId: gid, status, version: 1, startsAt: when, dest: { name: place.name, lat: place.lat, lng: place.lng, address: place.address }, presentIds: present, unavailableIds: [], legs, createdBy: driver, updatedBy: driver, updatedAt: when, confirmedAt: status === 'confirmed' ? when : null }
  }
  const trips = [
    trip('t-1', day(-23), 'confirmed', 'm-daniele', ['m-daniele', 'm-matteo', 'm-filippo'], places[0]),
    trip('t-2', day(-16), 'confirmed', 'm-matteo', ['m-daniele', 'm-matteo', 'm-alessia', 'm-andrea'], places[2]),
    trip('t-3', day(-9), 'confirmed', 'm-alessia', ['m-daniele', 'm-alessia', 'm-filippo'], places[1], true),
    trip('t-4', day(-1), 'planned', 'm-filippo', ['m-daniele', 'm-matteo', 'm-filippo', 'm-andrea'], places[0]),
  ]
  return { groups: { [gid]: { group: { id: gid, name: 'Amici', inviteCode: 'demo1234', settings: { tolls } }, members, places, trips, settlements: [] } } }
}

const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms))
const meOf = (g: G): ID => {
  const id = demoIdentity(g.group.id)
  if (id && g.members.some((m) => m.id === id && !m.leftAt)) return id
  return g.members.find((m) => m.userId === 'demo-user' && !m.leftAt)?.id ?? g.members.find((m) => !m.leftAt)!.id
}

export const localStore: Store = {
  mode: 'demo',
  async session() { return { userId: 'demo-user' } },
  onAuth() { return () => {} },
  async sendCode() {}, async verifyCode() {}, async signOut() {},

  async listGroups() { return Object.values(read().groups).filter((g) => g.members.some((m) => m.userId === 'demo-user' && !m.leftAt)).map((g) => ({ id: g.group.id, name: g.group.name })) },
  async createGroup(name, myName) {
    const db = read(), id = uid()
    db.groups[id] = { group: { id, name, inviteCode: uid().slice(0, 8), settings: {} }, members: [{ id: uid(), groupId: id, userId: 'demo-user', name: myName, color: 0, home: null, homeShared: false, joinedAt: new Date().toISOString(), leftAt: null }], places: [], trips: [], settlements: [] }
    write(db); return id
  },
  async previewInvite(code) {
    const g = Object.values(read().groups).find((x) => x.group.inviteCode === code)
    if (!g) throw new Error('Invito non valido o scaduto')
    return { groupId: g.group.id, name: g.group.name, unclaimed: g.members.filter((m) => !m.userId && !m.leftAt).map((m) => ({ id: m.id, name: m.name })), alreadyMember: g.members.some((m) => m.userId === 'demo-user' && !m.leftAt), rejoinName: g.members.find((m) => m.userId === 'demo-user' && m.leftAt)?.name ?? null }
  },
  async joinGroup(code, myName, claimId) {
    const db = read()
    const g = Object.values(db.groups).find((x) => x.group.inviteCode === code)
    if (!g) throw new Error('Invito non valido o scaduto')
    const mine = g.members.find((m) => m.userId === 'demo-user')
    if (mine) mine.leftAt = null
    else if (claimId) { const m = g.members.find((x) => x.id === claimId && !x.userId); if (!m) throw new Error('Questo nome è appena stato scelto da un altro account. Scegli di nuovo.'); m.userId = 'demo-user' }
    else if (g.members.some((m) => !m.leftAt && m.name.trim().toLowerCase() === myName.trim().toLowerCase())) throw new Error('Nel gruppo c\'è già qualcuno con questo nome: aggiungi l\'iniziale del cognome.')
    else g.members.push({ id: uid(), groupId: g.group.id, userId: 'demo-user', name: myName, color: g.members.length % 8, home: null, homeShared: false, joinedAt: new Date().toISOString(), leftAt: null })
    write(db); return g.group.id
  },
  async regenerateInvite(groupId) { const db = read(); const g = db.groups[groupId]; g.group.inviteCode = uid().replace(/-/g, '').slice(0, 18); write(db); return g.group.inviteCode },
  async leaveGroup(groupId) { const db = read(); const g = db.groups[groupId]; const m = g.members.find((x) => x.id === meOf(g)); if (m) m.leftAt = new Date().toISOString(); write(db) },

  async findTripGroup(tripId) { return Object.values(read().groups).find((g) => g.trips.some((t) => t.id === tripId))?.group.id ?? null },
  async loadGroup(groupId) {
    await wait(120)
    const g = read().groups[groupId]
    if (!g) throw new Error('Gruppo non trovato')
    const c = structuredClone(g)
    return { ...c, trips: sanitizeTrips(c.trips), meId: meOf(g) }
  },
  subscribe(_id, cb) { listeners.add(cb); return () => listeners.delete(cb) },

  async saveTrip(trip, expectedVersion) {
    await wait()
    const db = read(), g = db.groups[trip.groupId]
    const i = g.trips.findIndex((t) => t.id === trip.id)
    if (expectedVersion == null) {
      if (i >= 0) return g.trips[i] // stesso id già registrato: nessun doppione
      const t = { ...trip, version: 1 }
      g.trips.push(t); write(db); return t
    }
    if (i < 0 || g.trips[i].version !== expectedVersion) throw new ConflictError()
    const t = { ...trip, version: expectedVersion + 1 }
    g.trips[i] = t; write(db); return t
  },
  async addSettlement(s) {
    await wait(); const db = read(), g = db.groups[s.groupId]
    if (s.from === s.to || !g.members.some((m) => m.id === s.from) || !g.members.some((m) => m.id === s.to)) throw new Error('Il rimborso deve essere tra due membri diversi del gruppo')
    if (!g.settlements.some((x) => x.id === s.id)) g.settlements.push(s); write(db)
  },
  async deleteSettlement(groupId, id) { const db = read(); const g = db.groups[groupId]; g.settlements = g.settlements.filter((s) => s.id !== id); write(db) },
  async savePlace(groupId, p) { const db = read(); const g = db.groups[groupId]; const i = g.places.findIndex((x) => x.id === p.id); if (i >= 0) g.places[i] = p; else g.places.push(p); write(db) },
  async deletePlace(groupId, id) { const db = read(); const g = db.groups[groupId]; g.places = g.places.filter((p) => p.id !== id); write(db) },
  async addMember(groupId, name) { const db = read(); const g = db.groups[groupId]; g.members.push({ id: uid(), groupId, userId: null, name, color: g.members.length % 8, home: null, homeShared: false, joinedAt: new Date().toISOString(), leftAt: null }); write(db) },
  async renameMember(groupId, id, name) { const db = read(); const m = db.groups[groupId].members.find((x) => x.id === id && !x.userId); if (!m) throw new Error('Questo membro ha già un account: può cambiare nome solo lui.'); m.name = name; write(db) },
  async removeMember(groupId, id) { const db = read(); const m = db.groups[groupId].members.find((x) => x.id === id && !x.userId); if (!m) throw new Error('Si possono togliere solo i membri senza account'); m.leftAt = new Date().toISOString(); write(db) },
  async updateMe(groupId, patch) { const db = read(); const g = db.groups[groupId]; const m = g.members.find((x) => x.id === meOf(g))!; Object.assign(m, patch); write(db) },
  async setGroupToll(groupId, key, toll) { const db = read(); const g = db.groups[groupId].group; const t = { ...(g.settings.tolls ?? {}) }; if (toll) t[key] = toll; else delete t[key]; g.settings = { ...g.settings, tolls: t }; write(db) },
  async updateGroup(groupId, patch) { const db = read(); const g = db.groups[groupId]; Object.assign(g.group, patch); write(db); return g.group },
}
