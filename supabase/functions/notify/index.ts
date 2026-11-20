// Shotgun — servizio notifiche (Supabase Edge Function «notify»).
// Le chiavi VAPID le crea il servizio stesso al primo avvio e restano nel database (tabella app_secrets):
// nessuno deve copiarle o incollarle. Deploy con «Verify JWT» disattivato: l'accesso lo controlla il codice.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

// chiave di servizio: quella classica o, nei progetti con le chiavi nuove, la prima «secret»
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || (() => { try { return Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'))[0] as string } catch { return '' } })()
const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } })
const LOW_KM = -70

// Testi delle notifiche: quelli scritti dal creatore del gruppo (groups.settings.notifyTexts) o questi predefiniti.
// Devono restare uguali a NOTIFY_DEFAULTS in src/lib/notifyTexts.ts (lo controlla un test).
type Kind = 'new_trip' | 'shotgun' | 'confirm' | 'low'
const DEFAULTS: Record<Kind, { title: string; body: string }> = {
  new_trip: { title: 'Nuova uscita: {dove}', body: '{quando} · guida {guida}. Il posto davanti va a chi chiama Shotgun per primo.' },
  shotgun: { title: '{chi} ha chiamato Shotgun!', body: 'Il posto davanti per {dove} è suo.' },
  confirm: { title: 'Conferma il viaggio: {dove}', body: 'Era {quando}. Controllate km e pedaggi e confermate.' },
  low: { title: 'Saldo {km} km', body: 'Sei sotto i −70 km: alla prossima uscita il volante è tuo.' },
}
const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
async function texts(groupId: string, kind: Kind, vars: Record<string, string>) {
  const { data } = await db.from('groups').select('settings').eq('id', groupId).maybeSingle()
  const t = data?.settings?.notifyTexts?.[kind]
  const use = t && typeof t.title === 'string' && t.title.trim() && typeof t.body === 'string' ? t : DEFAULTS[kind]
  return { title: fill(use.title, vars).slice(0, 120), body: fill(use.body, vars).slice(0, 300) }
}

async function secret(name: string): Promise<string | null> {
  const { data } = await db.from('app_secrets').select('value').eq('name', name).maybeSingle()
  return data?.value ?? null
}
async function vapid(): Promise<string> {
  let pub = await secret('vapid_public'), priv = await secret('vapid_private')
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys()
    await db.from('app_secrets').upsert([{ name: 'vapid_public', value: k.publicKey }, { name: 'vapid_private', value: k.privateKey }], { onConflict: 'name', ignoreDuplicates: true })
    pub = await secret('vapid_public'); priv = await secret('vapid_private')
  }
  webpush.setVapidDetails('mailto:denbeluxx@gmail.com', pub!, priv!)
  return pub!
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
async function groupMembers(groupId: string) {
  const { data } = await db.from('members').select('id, user_id, name').eq('group_id', groupId).is('left_at', null)
  return (data ?? []) as { id: string; user_id: string | null; name: string }[]
}
async function loadTrip(id: string) {
  const { data } = await db.from('trips').select('id, group_id, status, starts_at, data').eq('id', id).maybeSingle()
  return data as { id: string; group_id: string; status: string; starts_at: string; data: any } | null
}
const when = (iso: string) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const driverOf = (t: any): string | null => (t.data?.legs ?? []).find((l: any) => l?.driverId)?.driverId ?? null
const nameOf = (name?: string) => (name ?? '').trim().replace(/\s+/g, ' ') || 'Qualcuno'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (req.method === 'GET') return json({ publicKey: await vapid() })
    const body = await req.json().catch(() => ({}))

    // Ogni mattina (pg_cron): i viaggi di ieri sera ancora da confermare
    if (body.type === 'daily') {
      if (!req.headers.get('x-cron') || req.headers.get('x-cron') !== (await secret('cron'))) return json({ error: 'non autorizzato' }, 401)
      const from = new Date(Date.now() - 40 * 3600e3).toISOString(), to = new Date(Date.now() - 4 * 3600e3).toISOString()
      const { data: trips } = await db.from('trips').select('id, group_id, status, starts_at, data').eq('status', 'planned').gte('starts_at', from).lte('starts_at', to)
      let sent = 0
      for (const t of trips ?? []) {
        if (!(await once(`confirm:${t.id}`))) continue
        const ms = await groupMembers(t.group_id)
        const present = new Set<string>(t.data?.presentIds ?? [])
        const drv = ms.find((m) => m.id === driverOf(t))
        const txt = await texts(t.group_id, 'confirm', { dove: t.data?.dest?.name ?? 'uscita', quando: when(t.starts_at), guida: drv ? nameOf(drv.name) : 'da decidere' })
        sent += await send(ms.filter((m) => present.has(m.id)).map((m) => m.user_id), { ...txt, url: `?t=${t.id}`, tag: `confirm-${t.id}` })
      }
      return json({ sent })
    }

    const uid = await callerUser(req)
    if (!uid) return json({ error: 'accesso richiesto' }, 401)

    // Prova: una notifica ai propri dispositivi (al massimo una al minuto)
    if (body.type === 'test') {
      if (!(await once(`test:${uid}:${new Date().toISOString().slice(0, 16)}`))) return json({ sent: 0 })
      return json({ sent: await send([uid], { title: 'Notifiche attive', body: 'Da ora ti avvisiamo di nuove uscite, Shotgun e viaggi da confermare.', url: './', tag: 'test' }) })
    }

    if (body.type === 'new_trip' || body.type === 'shotgun') {
      const t = await loadTrip(String(body.tripId ?? ''))
      if (!t) return json({ error: 'uscita non trovata' }, 404)
      const ms = await groupMembers(t.group_id)
      const me = ms.find((m) => m.user_id === uid)
      if (!me) return json({ error: 'accesso negato' }, 403)
      const byId = new Map(ms.map((m) => [m.id, m]))
      const dest = t.data?.dest?.name ?? 'uscita'
      const present = new Set<string>(t.data?.presentIds ?? [])
      const driver = driverOf(t)

      if (body.type === 'new_trip') {
        if (t.status !== 'planned' || !(await once(`new:${t.id}`))) return json({ sent: 0 })
        const others = ms.filter((m) => m.user_id !== uid)
        // a chi viene ed è passeggero arriva anche il tasto «Shotgun!»
        const riders = others.filter((m) => present.has(m.id) && m.id !== driver)
        const rest = others.filter((m) => !riders.includes(m))
        const txt = await texts(t.group_id, 'new_trip', { dove: dest, quando: when(t.starts_at), guida: driver ? nameOf(byId.get(driver)?.name) : 'da decidere', chi: nameOf(me.name) })
        const base = { ...txt, url: `?t=${t.id}`, tag: `trip-${t.id}` }
        const sent = (await send(riders.map((m) => m.user_id), { ...base, actions: [{ action: 'shotgun', title: 'Shotgun!' }] }))
          + (await send(rest.map((m) => m.user_id), base))
        return json({ sent })
      }

      const { data: claim } = await db.from('trip_shotgun').select('member_id').eq('trip_id', t.id).maybeSingle()
      if (!claim || claim.member_id !== me.id || !(await once(`shotgun:${t.id}`))) return json({ sent: 0 })
      const to = ms.filter((m) => m.id !== me.id && (present.has(m.id) || m.id === driver))
      const txt = await texts(t.group_id, 'shotgun', { chi: nameOf(me.name), dove: dest, quando: when(t.starts_at) })
      return json({ sent: await send(to.map((m) => m.user_id), { ...txt, url: `?t=${t.id}`, tag: `shotgun-${t.id}` }) })
    }

    // Saldo sceso sotto −70 km: avviso a chi ci è finito (al massimo uno al giorno)
    if (body.type === 'low') {
      const groupId = String(body.groupId ?? '')
      const ms = await groupMembers(groupId)
      if (!ms.some((m) => m.user_id === uid)) return json({ error: 'accesso negato' }, 403)
      const target = ms.find((m) => m.id === body.memberId)
      const km = Number(body.km)
      if (!target || !Number.isFinite(km) || km > LOW_KM) return json({ sent: 0 })
      if (!(await once(`low:${target.id}:${new Date().toISOString().slice(0, 10)}`))) return json({ sent: 0 })
      const shown = km.toFixed(1).replace('.', ',').replace('-', '−')
      const txt = await texts(groupId, 'low', { chi: nameOf(target.name), km: shown })
      return json({ sent: await send([target.user_id], { ...txt, url: './', tag: `low-${target.id}` }) })
    }
    return json({ error: 'richiesta sconosciuta' }, 400)
  } catch (e: any) {
    console.error(e)
    return json({ error: 'errore interno' }, 500)
  }
})
