export type ID = string

export interface Pt { lat: number; lng: number }

export interface Place extends Pt {
  id: ID
  name: string
  address?: string
  kind: 'locale' | 'ritrovo' | 'altro'
}

export interface Member {
  id: ID
  groupId: ID
  userId: string | null // null = aggiunto a mano, non ha ancora l'app
  name: string
  color: number
  home: (Pt & { label: string }) | null
  homeShared: boolean
  joinedAt: string
  leftAt: string | null
}

/** Tariffa confermata dal gruppo per una coppia di caselli (chiave "a|b" ordinata). */
export interface GroupToll { cents: number; by: ID; on: string }
export interface GroupSettings { tolls?: Record<string, GroupToll> }
export interface Group { id: ID; name: string; inviteCode: string; settings: GroupSettings }

export interface Stop extends Pt {
  id: ID
  name: string
  on: ID[] // chi sale qui (il conducente è sempre a bordo)
  off: ID[] // chi scende qui
  homeOf?: ID
}

export type TollStatus = 'none' | 'ok' | 'verify' | 'out'
export interface Toll {
  status: TollStatus
  cents: number | null
  road?: string
  from?: string // id casello
  to?: string
  note?: string
  estimate?: boolean // ricavato da una distanza stimata: mai certo
}

/** Tratto tra due tappe consecutive: gli occupanti non cambiano. */
export interface Seg { meters: number; seconds: number; toll: Toll }

export interface Leg {
  kind: 'andata' | 'ritorno'
  driverId: ID | null
  designated: boolean // flag «Conducente designato»
  time?: string // "21:30"
  stops: Stop[]
  segs: Seg[] | null
  geometry: [number, number][] | null // [lat,lng]
  routeState: 'ok' | 'stimato' | 'missing'
  actualMeters: number | null // km effettivi corretti a mano
  tollPayerId: ID | null // null = paga il conducente
  tollOverride: number | null // centesimi inseriti a mano per l'intera tratta
  tollGates?: { from: string; to: string } | null // caselli scelti a mano
}

export interface Trip {
  id: ID
  groupId: ID
  status: 'planned' | 'confirmed' | 'cancelled'
  version: number
  startsAt: string
  dest: Pt & { name: string; address?: string }
  presentIds: ID[]
  unavailableIds: ID[]
  legs: Leg[]
  createdBy: ID
  updatedBy: ID
  updatedAt: string
  confirmedAt: string | null
}

export interface Settlement {
  id: ID
  groupId: ID
  from: ID
  to: ID
  cents: number
  createdAt: string
  createdBy: ID
}

export interface GroupData {
  group: Group
  members: Member[]
  places: Place[]
  trips: Trip[]
  settlements: Settlement[]
  meId: ID
}

export const uid = (): ID =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })
