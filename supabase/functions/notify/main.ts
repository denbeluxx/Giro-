// Shotgun — servizio notifiche (Supabase Edge Function «notify»). SORGENTE.
// Il file da pubblicare è index.ts, generato da questo con `npm run build:notify`: include i calcoli dei saldi
// e i testi predefiniti dell'app (src/lib), così servizio e app non possono andare fuori sincronia.
// Le chiavi VAPID le crea il servizio stesso al primo avvio e restano nel database (tabella app_secrets):
// nessuno deve copiarle o incollarle. Deploy con «Verify JWT» disattivato: l'accesso lo controlla il codice.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { balances, displayRound } from '../../../src/lib/calc'
import { fillText, textFor, type NotifyKind, type NotifyTexts } from '../../../src/lib/notifyTexts'
import type { Member, Settlement } from '../../../src/lib/types'
import { sanitizeTrips } from '../../../src/lib/validate'

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void }

// chiave di servizio: quella classica o, nei progetti con le chiavi nuove, la prima «secret»
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || (() => { try { return Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'))[0] as string } catch { return '' } })()
const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } })
/** Soglia dell'avviso: saldo mostrato (al decimo di km) uguale o sotto −70 km. */
const LOW_M = -70000

/** Taglia ai caratteri interi (un'emoji non si spezza a metà). */
const cut = (s: string, n: number) => { const c = Array.from(s); return c.length > n ? c.slice(0, n - 1).join('') + '…' : s }
async function texts(groupId: string, kind: NotifyKind, vars: Record<string, string>) {
  const { data } = await db.from('groups').select('settings').eq('id', groupId).maybeSingle()
  const t = textFor(data?.settings?.notifyTexts as NotifyTexts | undefined, kind)
  return { title: cut(fillText(t.title, vars), 120), body: cut(fillText(t.body, vars), 300) }
}

async function secret(name: string): Promise<string | null> {
  const { data } = await db.from('app_secrets').select('value').eq('name', name).maybeSingle()
  return data?.value ?? null
}
const pair = (s: string | null): { pub: string; priv: string } | null => { try { const v = JSON.parse(s ?? ''); return v?.pub && v?.priv ? v : null } catch { return null } }
/** Chiavi VAPID in un'unica riga (pubblica e privata sempre della stessa coppia). */
async function vapid(): Promise<string> {
  let v = pair(await secret('vapid'))
  if (!v) {
    // prima versione: due righe separate; se mancano, una coppia nuova
    const pub = await secret('vapid_public'), priv = await secret('vapid_private')
    const k = pub && priv ? { pub, priv } : (() => { const g = webpush.generateVAPIDKeys(); return { pub: g.publicKey, priv: g.privateKey } })()
    await db.from('app_secrets').upsert({ name: 'vapid', value: JSON.stringify(k) }, { onConflict: 'name', ignoreDuplicates: true })
    v = pair(await secret('vapid'))
    if (!v) throw new Error('chiavi delle notifiche non disponibili')
  }
  webpush.setVapidDetails('mailto:denbeluxx@gmail.com', v.pub, v.priv)
  return v.pub
}

/** Una notifica con questa chiave parte una volta sola. */
async function once(key: string): Promise<boolean> {
  const { error } = await db.from('notify_log').insert({ key })
  return !error
}

interface Payload { title: string; body: string; url: string; tag: string; actions?: { action: string; title: string }[] }
async function send(userIds: (string | null)[], p: Payload): Promise<number> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))]
  if (!ids.length) return 0
  await vapid()
  const { data: subs } = await db.from('push_subscriptions').select('*').in('user_id', ids)
  let n = 0
  await Promise.all((subs ?? []).map(async (s: any) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(p), { TTL: 12 * 3600, urgency: 'high' })
      n++
    } catch (e: any) {
      // dispositivo disiscritto o app rimossa: lo togliamo
      if (e?.statusCode === 404 || e?.statusCode === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
      else console.error('push', e?.statusCode, e?.body)
    }
  }))
  return n
}

async function callerUser(req: Request): Promise<string | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await db.auth.getUser(token)
  return data.user?.id ?? null
}
interface Row { id: string; user_id: string | null; name: string; left_at: string | null; joined_at: string; color: number }
/** Tutti i membri (anche chi è uscito, per i nomi); le notifiche vanno solo a chi è ancora nel gruppo. */
async function groupMembers(groupId: string) {
  const { data } = await db.from('members').select('id, user_id, name, left_at, joined_at, color').eq('group_id', groupId)
  const all = (data ?? []) as Row[]
  return { all, active: all.filter((m) => !m.left_at), name: (id?: string | null) => nameOf(all.find((m) => m.id === id)?.name) }
}
async function loadTrip(id: string) {
  const { data } = await db.from('trips').select('id, group_id, status, starts_at, data').eq('id', id).maybeSingle()
  return data as { id: string; group_id: string; status: string; starts_at: string; data: any } | null
}
/** Saldo km mostrato nell'app (stessa funzione dell'app, arrotondato al decimo). */
async function shownKm(groupId: string, all: Row[]): Promise<Record<string, number>> {
  const [{ data: t }, { data: s }] = await Promise.all([
    db.from('trips').select('*').eq('group_id', groupId).eq('status', 'confirmed'),
    db.from('settlements').select('*').eq('group_id', groupId),
  ])
  const members: Member[] = all.map((m) => ({ id: m.id, groupId, userId: m.user_id, name: m.name, color: m.color ?? 0, home: null, homeShared: false, joinedAt: m.joined_at, leftAt: m.left_at }))
  const trips = sanitizeTrips((t ?? []).map((r: any) => ({ ...r.data, id: r.id, groupId: r.group_id, status: r.status, version: r.version, startsAt: r.starts_at, createdBy: r.created_by, updatedBy: r.updated_by, updatedAt: r.updated_at, confirmedAt: r.confirmed_at })))
  const settlements: Settlement[] = (s ?? []).map((r: any) => ({ id: r.id, groupId: r.group_id, from: r.from_member, to: r.to_member, cents: r.cents, createdAt: r.created_at, createdBy: r.created_by }))
  return displayRound(balances(members, trips, settlements).km)
}
const when = (iso: string) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const legsOf = (t: any): any[] => (Array.isArray(t.data?.legs) ? t.data.legs : [])
const driverOf = (t: any): string | null => legsOf(t).find((l) => l?.driverId)?.driverId ?? null
const driversOf = (t: any) => new Set<string>(legsOf(t).map((l) => l?.driverId).filter((x): x is string => typeof x === 'string'))
const nameOf = (name?: string) => (name ?? '').trim().replace(/\s+/g, ' ') || 'Qualcuno'
const fmtKm = (m: number) => (m / 1000).toFixed(1).replace('.', ',').replace('-', '−')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (req.method === 'GET') return json({ publicKey: await vapid() })
    const raw = await req.json().catch(() => null)
    const body: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}

    // Ogni mattina (pg_cron): i viaggi di ieri sera ancora da confermare
    if (body.type === 'daily') {
      if (!req.headers.get('x-cron') || req.headers.get('x-cron') !== (await secret('cron'))) return json({ error: 'non autorizzato' }, 401)
      const from = new Date(Date.now() - 40 * 3600e3).toISOString(), to = new Date(Date.now() - 4 * 3600e3).toISOString()
      const { data: trips } = await db.from('trips').select('id, group_id, status, starts_at, data').eq('status', 'planned').gte('starts_at', from).lte('starts_at', to)
      let sent = 0
      for (const t of trips ?? []) {
        if (!(await once(`confirm:${t.id}`))) continue
        const g = await groupMembers(t.group_id)
        const present = new Set<string>(t.data?.presentIds ?? [])
        const d = driverOf(t)
        const txt = await texts(t.group_id, 'confirm', { dove: t.data?.dest?.name ?? 'uscita', quando: when(t.starts_at), guida: d ? g.name(d) : 'da decidere' })
        sent += await send(g.active.filter((m) => present.has(m.id)).map((m) => m.user_id), { ...txt, url: `?t=${t.id}`, tag: `confirm-${t.id}` })
      }
      return json({ sent })
    }

    const uid = await callerUser(req)
    if (!uid) return json({ error: 'accesso richiesto' }, 401)

    // Prova: una notifica ai propri dispositivi (al massimo una al minuto)
    if (body.type === 'test') {
      if (!(await once(`test:${uid}:${new Date().toISOString().slice(0, 16)}`))) return json({ sent: 0, reason: 'attendi' })
      return json({ sent: await send([uid], { title: 'Notifiche attive', body: 'Da ora ti avvisiamo di nuove uscite, Shotgun e viaggi da confermare.', url: './', tag: 'test' }) })
    }

    if (body.type === 'new_trip' || body.type === 'shotgun') {
      const t = await loadTrip(String(body.tripId ?? ''))
      if (!t) return json({ error: 'uscita non trovata' }, 404)
      const g = await groupMembers(t.group_id)
      const me = g.active.find((m) => m.user_id === uid)
      if (!me) return json({ error: 'accesso negato' }, 403)
      if (t.status !== 'planned') return json({ sent: 0 })
      const dest = t.data?.dest?.name ?? 'uscita'
      const present = new Set<string>(t.data?.presentIds ?? [])
      const drivers = driversOf(t), driver = driverOf(t)

      if (body.type === 'new_trip') {
        if (!(await once(`new:${t.id}`))) return json({ sent: 0 })
        const others = g.active.filter((m) => m.user_id !== uid)
        // a chi viene come passeggero (non guida né all'andata né al ritorno) arriva anche il tasto «Shotgun!»
        const riders = others.filter((m) => present.has(m.id) && !drivers.has(m.id))
        const rest = others.filter((m) => !riders.includes(m))
        const txt = await texts(t.group_id, 'new_trip', { dove: dest, quando: when(t.starts_at), guida: driver ? g.name(driver) : 'da decidere', chi: nameOf(me.name) })
        const base = { ...txt, url: `?t=${t.id}`, tag: `trip-${t.id}` }
        const sent = (await send(riders.map((m) => m.user_id), { ...base, actions: [{ action: 'shotgun', title: 'Shotgun!' }] }))
          + (await send(rest.map((m) => m.user_id), base))
        return json({ sent })
      }

      const { data: claim } = await db.from('trip_shotgun').select('member_id').eq('trip_id', t.id).maybeSingle()
      if (!claim || claim.member_id !== me.id || !(await once(`shotgun:${t.id}:${me.id}`))) return json({ sent: 0 })
      const to = g.active.filter((m) => m.id !== me.id && (present.has(m.id) || drivers.has(m.id)))
      const txt = await texts(t.group_id, 'shotgun', { chi: nameOf(me.name), dove: dest, quando: when(t.starts_at) })
      return json({ sent: await send(to.map((m) => m.user_id), { ...txt, url: `?t=${t.id}`, tag: `shotgun-${t.id}` }) })
    }

    // Saldo sceso sotto −70 km: il servizio ricalcola il saldo da sé (non si fida del numero mandato dall'app)
    if (body.type === 'low') {
      const groupId = String(body.groupId ?? '')
      const g = await groupMembers(groupId)
      if (!g.active.some((m) => m.user_id === uid)) return json({ error: 'accesso negato' }, 403)
      const target = g.active.find((m) => m.id === body.memberId)
      if (!target?.user_id) return json({ sent: 0 })
      const km = (await shownKm(groupId, g.all))[target.id] ?? 0
      if (km > LOW_M) return json({ sent: 0 })
      if (!(await once(`low:${target.id}:${new Date().toISOString().slice(0, 10)}`))) return json({ sent: 0 })
      const txt = await texts(groupId, 'low', { chi: nameOf(target.name), km: fmtKm(km) })
      return json({ sent: await send([target.user_id], { ...txt, url: './', tag: `low-${target.id}` }) })
    }
    return json({ error: 'richiesta sconosciuta' }, 400)
  } catch (e: any) {
    console.error(e)
    return json({ error: 'errore interno' }, 500)
  }
})
