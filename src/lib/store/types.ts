import type { Group, GroupData, GroupSettings, ID, Member, Place, Settlement, Trip } from '../types'

export class ConflictError extends Error {
  constructor() { super('Qualcun altro ha appena modificato questo viaggio.') }
}

export interface Session { userId: string; email?: string }
export interface GroupSummary { id: ID; name: string }
export interface InvitePreview { groupId: ID; name: string; unclaimed: { id: ID; name: string }[]; alreadyMember: boolean }

export interface Store {
  /** 'demo' = dati dimostrativi salvati solo su questo dispositivo. */
  mode: 'demo' | 'cloud'
  session(): Promise<Session | null>
  onAuth(cb: (s: Session | null) => void): () => void
  sendCode(email: string): Promise<void>
  verifyCode(email: string, code: string): Promise<void>
  signOut(): Promise<void>

  listGroups(): Promise<GroupSummary[]>
  createGroup(name: string, myName: string): Promise<ID>
  previewInvite(code: string): Promise<InvitePreview>
  joinGroup(code: string, myName: string, claimId?: ID | null): Promise<ID>
  leaveGroup(groupId: ID): Promise<void>

  /** Gruppo a cui appartiene un viaggio (per i link condivisi). */
  findTripGroup(tripId: ID): Promise<ID | null>
  loadGroup(groupId: ID): Promise<GroupData>
  subscribe(groupId: ID, cb: () => void): () => void

  /** expectedVersion null = nuovo viaggio (ripetibile senza duplicati). Altrimenti aggiorna solo se la versione coincide. */
  saveTrip(trip: Trip, expectedVersion: number | null): Promise<Trip>
  addSettlement(s: Settlement): Promise<void>
  deleteSettlement(groupId: ID, id: ID): Promise<void>
  savePlace(groupId: ID, p: Place): Promise<void>
  deletePlace(groupId: ID, id: ID): Promise<void>
  addMember(groupId: ID, name: string): Promise<void>
  updateMe(groupId: ID, patch: { name?: string; home?: Member['home']; homeShared?: boolean }): Promise<void>
  updateGroup(groupId: ID, patch: { name?: string; settings?: GroupSettings }): Promise<Group>
}
