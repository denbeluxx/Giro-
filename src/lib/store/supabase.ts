import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Group, GroupData, Member, Place, Settlement, Trip } from '../types'
import { ConflictError, type Store } from './types'

const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}
const toMember = (r: any): Member => ({ id: r.id, groupId: r.group_id, userId: r.user_id, name: r.name, color: r.color ?? 0, home: r.home, homeShared: !!r.home_shared, joinedAt: r.joined_at, leftAt: r.left_at })
const toGroup = (r: any): Group => ({ id: r.id, name: r.name, inviteCode: r.invite_code, settings: r.settings ?? {} })
const toTrip = (r: any): Trip => ({ ...r.data, id: r.id, groupId: r.group_id, status: r.status, version: r.version, startsAt: r.starts_at, createdBy: r.created_by, updatedBy: r.updated_by, updatedAt: r.updated_at, confirmedAt: r.confirmed_at })
const tripRow = (t: Trip) => ({
  id: t.id, group_id: t.groupId, status: t.status, starts_at: t.startsAt, created_by: t.createdBy, updated_by: t.updatedBy, confirmed_at: t.confirmedAt,
  data: { dest: t.dest, presentIds: t.presentIds, unavailableIds: t.unavailableIds, legs: t.legs },
})

export function supabaseStore(url: string, key: string): Store {
  const sb: SupabaseClient = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  const uidOrThrow = async () => { const { data } = await sb.auth.getSession(); if (!data.session) throw new Error('Sessione scaduta: accedi di nuovo'); return data.session.user.id }

  return {
    mode: 'cloud',
    async session() { const { data } = await sb.auth.getSession(); return data.session ? { userId: data.session.user.id, email: data.session.user.email } : null },
    onAuth(cb) { const { data } = sb.auth.onAuthStateChange((_e, s) => cb(s ? { userId: s.user.id, email: s.user.email } : null)); return () => data.subscription.unsubscribe() },
    async sendCode(email) { const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: window.location.href } }); if (error) throw new Error(error.message) },
    async verifyCode(email, code) { const { error } = await sb.auth.verifyOtp({ email, token: code, type: 'email' }); if (error) throw new Error('Codice non valido o scaduto') },
    async signOut() { await sb.auth.signOut() },

    async listGroups() {
      const me = await uidOrThrow()
      const rows = must(await sb.from('members').select('group_id, groups(id, name)').eq('user_id', me).is('left_at', null)) as any[]
      return rows.filter((r) => r.groups).map((r) => ({ id: r.groups.id, name: r.groups.name }))
    },
    async createGroup(name, myName) { return must(await sb.rpc('create_group', { p_name: name, p_member_name: myName })) as string },
    async previewInvite(code) {
      const d = must(await sb.rpc('invite_preview', { p_code: code })) as any
      if (!d) throw new Error('Invito non valido o scaduto')
      return { groupId: d.group_id, name: d.name, unclaimed: d.unclaimed ?? [], alreadyMember: !!d.already_member }
    },
    async joinGroup(code, myName, claimId) { return must(await sb.rpc('join_group', { p_code: code, p_name: myName, p_claim: claimId ?? null })) as string },
    async leaveGroup(groupId) { must(await sb.rpc('leave_group', { p_group: groupId })) },

    async findTripGroup(tripId) { const r = await sb.from('trips').select('group_id').eq('id', tripId).maybeSingle(); return r.data?.group_id ?? null },
    async loadGroup(groupId) {
      const me = await uidOrThrow()
      const [g, m, p, t, s, h] = await Promise.all([
        sb.from('groups').select('*').eq('id', groupId).single(),
        sb.from('members').select('*').eq('group_id', groupId).order('joined_at'),
        sb.from('places').select('*').eq('group_id', groupId).order('name'),
        sb.from('trips').select('*').eq('group_id', groupId).order('starts_at', { ascending: false }),
        sb.from('settlements').select('*').eq('group_id', groupId).order('created_at', { ascending: false }),
        sb.from('private_homes').select('*').eq('group_id', groupId).eq('user_id', me).maybeSingle(),
      ])
      const members = (must(m) as any[]).map(toMember)
      const mine = members.find((x) => x.userId === me && !x.leftAt)
      if (!mine) throw new Error('Non fai parte di questo gruppo')
      // la casa non condivisa resta nella tabella privata: la vede solo chi l'ha salvata
      if (!mine.home && h.data?.home) mine.home = h.data.home
      return {
        group: toGroup(must(g)), members, meId: mine.id,
        places: (must(p) as any[]).map((r): Place => ({ id: r.id, name: r.name, address: r.address ?? undefined, lat: r.lat, lng: r.lng, kind: r.kind })),
        trips: (must(t) as any[]).map(toTrip),
        settlements: (must(s) as any[]).map((r): Settlement => ({ id: r.id, groupId: r.group_id, from: r.from_member, to: r.to_member, cents: r.cents, createdAt: r.created_at, createdBy: r.created_by })),
      } satisfies GroupData
    },
    subscribe(groupId, cb) {
      let timer: any
      const fire = () => { clearTimeout(timer); timer = setTimeout(cb, 150) }
      const ch = sb.channel(`group-${groupId}`)
      for (const table of ['trips', 'members', 'settlements', 'places']) ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `group_id=eq.${groupId}` }, fire)
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'groups', filter: `id=eq.${groupId}` }, fire)
      ch.subscribe()
      const vis = () => { if (document.visibilityState === 'visible') fire() }
      document.addEventListener('visibilitychange', vis)
      return () => { document.removeEventListener('visibilitychange', vis); sb.removeChannel(ch) }
    },

    async saveTrip(trip, expectedVersion) {
      if (expectedVersion == null) {
        // id generato dal dispositivo: un secondo invio dello stesso viaggio non crea doppioni
        const r = await sb.from('trips').upsert({ ...tripRow(trip), version: 1 }, { onConflict: 'id', ignoreDuplicates: true }).select()
        if (r.error) throw new Error(r.error.message)
        if (r.data?.length) return toTrip(r.data[0])
        return toTrip(must(await sb.from('trips').select('*').eq('id', trip.id).single()))
      }
      const { id: _id, group_id: _g, created_by: _c, ...patch } = tripRow(trip)
      const rows = must(await sb.from('trips').update({ ...patch, version: expectedVersion + 1 }).eq('id', trip.id).eq('version', expectedVersion).select()) as any[]
      if (!rows.length) throw new ConflictError()
      return toTrip(rows[0])
    },
    async addSettlement(s) { must(await sb.from('settlements').upsert({ id: s.id, group_id: s.groupId, from_member: s.from, to_member: s.to, cents: s.cents, created_by: s.createdBy }, { onConflict: 'id', ignoreDuplicates: true }).select()) },
    async deleteSettlement(_g, id) { must(await sb.from('settlements').delete().eq('id', id).select()) },
    async savePlace(groupId, p) { must(await sb.from('places').upsert({ id: p.id, group_id: groupId, name: p.name, address: p.address ?? null, lat: p.lat, lng: p.lng, kind: p.kind }).select()) },
    async deletePlace(_g, id) { must(await sb.from('places').delete().eq('id', id).select()) },
    async addMember(groupId, name) { must(await sb.from('members').insert({ group_id: groupId, name, color: Math.floor(Math.random() * 8) }).select()) },
    async updateMe(groupId, patch) {
      const me = await uidOrThrow()
      const cur = toMember(must(await sb.from('members').select('*').eq('group_id', groupId).eq('user_id', me).single()))
      const upd: any = {}
      if (patch.name != null) upd.name = patch.name
      if (patch.home !== undefined || patch.homeShared !== undefined) {
        const priv = await sb.from('private_homes').select('home').eq('group_id', groupId).eq('user_id', me).maybeSingle()
        const home = patch.home !== undefined ? patch.home : cur.home ?? priv.data?.home ?? null
        const shared = patch.homeShared ?? cur.homeShared
        must(await sb.from('private_homes').upsert({ group_id: groupId, user_id: me, home }).select())
        upd.home = shared ? home : null
        upd.home_shared = shared
      }
      if (Object.keys(upd).length) must(await sb.from('members').update(upd).eq('id', cur.id).select())
    },
    async updateGroup(groupId, patch) { return toGroup(must(await sb.from('groups').update(patch).eq('id', groupId).select().single())) },
  }
}
