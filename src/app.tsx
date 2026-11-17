import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { balances, type Balances } from './lib/calc'
import { ConflictError, store, type GroupSummary, type InvitePreview, type Session } from './lib/store'
import type { GroupData, ID, Member, Trip } from './lib/types'
import { Home } from './screens/Home'
import { History, Members, Money, Places } from './screens/Others'
import { Plan } from './screens/Plan'
import { TripView } from './screens/TripView'
import { Btn, Empty, Icon, Notice, Skel, ToastHost, reducedMotion, useBusy, useToast } from './ui/kit'

export type Route =
  | { s: 'home' } | { s: 'members' } | { s: 'places' } | { s: 'history' } | { s: 'money' }
  | { s: 'plan'; mode: 'plan' | 'record'; edit?: Trip; redo?: Trip }
  | { s: 'trip'; id: ID; fresh?: boolean }

interface Ctx {
  data: GroupData; bal: Balances; me: Member; byId: (id?: ID | null) => Member | undefined; active: Member[]
  reload: () => Promise<void>; push: (r: Route) => void; pop: () => void; replace: (r: Route) => void; home: () => void
  /** Salva un viaggio; se un altro dispositivo l'ha già cambiato ricarica e avvisa. */
  saveTrip: (t: Trip, expected: number | null) => Promise<Trip | null>
  groups: GroupSummary[]; switchGroup: (id: ID | null) => void; signOut: () => void
}
const C = createContext<Ctx>(null as any)
export const useApp = () => useContext(C)

/** Cambio schermata con transizione nativa del browser, quando disponibile. */
export function transition(dir: 'push' | 'pop' | 'fade', fn: () => void) {
  const d = document as any
  if (!d.startViewTransition || reducedMotion()) return fn()
  document.documentElement.dataset.nav = dir
  d.startViewTransition(() => flushSync(fn))
}

export type Theme = 'auto' | 'light' | 'dark'
export function getTheme(): Theme { try { return (localStorage.getItem('giro-theme') as Theme) || 'auto' } catch { return 'auto' } }
export function setTheme(t: Theme) {
  try { localStorage.setItem('giro-theme', t) } catch { /* */ }
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t
  window.dispatchEvent(new Event('giro-theme'))
}

const params = new URLSearchParams(window.location.search)
const clearParams = () => { try { history.replaceState(null, '', window.location.pathname) } catch { /* */ } }

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [groupId, setGroupId] = useState<ID | null>(null)
  const [invite, setInvite] = useState<string | null>(params.get('invito'))
  const [deepTrip, setDeepTrip] = useState<string | null>(params.get('t'))
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { setTheme(getTheme()); store.session().then(setSession).catch(() => setSession(null)); return store.onAuth(setSession) }, [])

  const loadGroups = useCallback(async () => {
    setErr(null)
    try {
      const gs = await store.listGroups()
      setGroups(gs)
      let pick: ID | null = null
      if (deepTrip) { pick = await store.findTripGroup(deepTrip); if (!pick) setDeepTrip(null) }
      if (!pick) { let last: string | null = null; try { last = localStorage.getItem('giro-group') } catch { /* */ } pick = gs.find((g) => g.id === last)?.id ?? gs[0]?.id ?? null }
      setGroupId(pick)
    } catch (e: any) { setErr(e?.message ?? 'Connessione non riuscita') }
  }, [deepTrip])
  useEffect(() => { if (session && !invite) loadGroups() }, [session?.userId, invite]) // eslint-disable-line react-hooks/exhaustive-deps

  const switchGroup = useCallback((id: ID | null) => { transition('fade', () => setGroupId(id)); if (id) try { localStorage.setItem('giro-group', id) } catch { /* */ } }, [])

  let body: ReactNode
  if (session === undefined) body = <Splash />
  else if (!session) body = <Auth invite={!!invite} />
  else if (invite) body = <Invite code={invite} done={(id) => { clearParams(); setInvite(null); if (id) try { localStorage.setItem('giro-group', id) } catch { /* */ } }} />
  else if (err) body = <div className="screen"><div className="scroll" style={{ paddingTop: 120 }}><Empty icon="alert" title="Connessione non riuscita" text="Non riesco a caricare i tuoi gruppi. Controlla la rete e riprova."><Btn onClick={loadGroups}>Riprova</Btn></Empty></div></div>
  else if (!groups) body = <Splash />
  else if (!groupId) body = <Groups groups={groups} onOpen={switchGroup} onCreated={async (id) => { await loadGroups(); switchGroup(id) }} />
  else body = <GroupProvider key={groupId} groupId={groupId} groups={groups} switchGroup={switchGroup} deepTrip={deepTrip} clearDeep={() => { setDeepTrip(null); clearParams() }} />
  return <ToastHost><div className="app">{body}</div></ToastHost>
}

function Splash() {
  return <div className="screen"><div className="scroll" style={{ paddingTop: 'calc(var(--sat) + 70px)' }} aria-busy="true"><Skel w={180} h={34} /><div style={{ height: 22 }} /><Skel h={150} r={22} /><div style={{ height: 26 }} /><Skel h={240} r={14} /></div></div>
}

function GroupProvider({ groupId, groups, switchGroup, deepTrip, clearDeep }: { groupId: ID; groups: GroupSummary[]; switchGroup: (id: ID | null) => void; deepTrip: string | null; clearDeep: () => void }) {
  const [data, setData] = useState<GroupData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [stack, setStack] = useState<Route[]>([{ s: 'home' }])
  const toast = useToast()
  const seq = useRef(0)
  const reload = useCallback(async () => {
    const n = ++seq.current
    try { const d = await store.loadGroup(groupId); if (n === seq.current) { setData(d); setErr(null) } }
    catch (e: any) { if (n === seq.current) setErr(e?.message ?? 'Errore') }
  }, [groupId])
  useEffect(() => { reload(); return store.subscribe(groupId, reload) }, [groupId, reload])
  useEffect(() => { if (data && deepTrip) { if (data.trips.some((t) => t.id === deepTrip)) setStack([{ s: 'home' }, { s: 'trip', id: deepTrip }]); clearDeep() } }, [data, deepTrip]) // eslint-disable-line react-hooks/exhaustive-deps

  const push = useCallback((r: Route) => transition('push', () => setStack((s) => [...s, r])), [])
  const pop = useCallback(() => transition('pop', () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))), [])
  const replace = useCallback((r: Route) => transition('fade', () => setStack((s) => [...s.slice(0, -1), r])), [])
  const home = useCallback(() => transition('pop', () => setStack([{ s: 'home' }])), [])
  const saveTrip = useCallback(async (t: Trip, expected: number | null) => {
    try {
      const saved = await store.saveTrip(t, expected)
      setData((d) => d && { ...d, trips: d.trips.some((x) => x.id === saved.id) ? d.trips.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...d.trips] })
      return saved
    } catch (e) {
      if (e instanceof ConflictError) { await reload(); toast('Viaggio appena aggiornato da un altro dispositivo: ho ricaricato i dati.'); return null }
      throw e
    }
  }, [reload, toast])

  const ctx = useMemo<Ctx | null>(() => {
    if (!data) return null
    const map = new Map(data.members.map((m) => [m.id, m]))
    return {
      data, bal: balances(data.members, data.trips, data.settlements), me: map.get(data.meId)!, byId: (id) => (id ? map.get(id) : undefined),
      active: data.members.filter((m) => !m.leftAt), reload, push, pop, replace, home, saveTrip, groups, switchGroup,
      signOut: () => { store.signOut() },
    }
  }, [data, reload, push, pop, replace, home, saveTrip, groups, switchGroup])

  if (err && !data) return <div className="screen"><div className="scroll" style={{ paddingTop: 120 }}><Empty icon="alert" title="Gruppo non disponibile" text={err}><Btn onClick={reload}>Riprova</Btn><div style={{ height: 10 }} /><Btn kind="gray" onClick={() => switchGroup(null)}>I miei gruppi</Btn></Empty></div></div>
  if (!ctx) return <Splash />
  const r = stack[stack.length - 1]
  return (
    <C.Provider value={ctx}>
      {r.s === 'home' && <Home />}
      {r.s === 'members' && <Members />}
      {r.s === 'places' && <Places />}
      {r.s === 'history' && <History />}
      {r.s === 'money' && <Money />}
      {r.s === 'plan' && <Plan key={r.edit?.id ?? r.redo?.id ?? 'new'} mode={r.mode} edit={r.edit} redo={r.redo} />}
      {r.s === 'trip' && <TripView key={r.id} id={r.id} fresh={r.fresh} />}
    </C.Provider>
  )
}

// ---- Accesso -------------------------------------------------------------------

function Auth({ invite }: { invite: boolean }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, run] = useBusy()
  return (
    <div className="screen"><div className="scroll" style={{ paddingTop: 'calc(var(--sat) + 72px)' }}>
      <div className="avatar" style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(140deg, var(--accent), #8e5cf0)', marginBottom: 20 }}><Icon n="car" size={34} /></div>
      <h1 className="title">Giro</h1>
      <p className="subtitle" style={{ fontSize: 17, marginBottom: 28 }}>{invite ? 'Accedi per entrare nel gruppo che ti ha invitato.' : 'Chi guida stasera? Chilometri, turni e pedaggi tra amici.'}</p>
      {!sent ? (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await store.sendCode(email.trim()); setSent(true) }) }}>
          <label className="label" htmlFor="em">La tua email</label>
          <input id="em" className="field" type="email" inputMode="email" autoComplete="email" required placeholder="nome@esempio.it" value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="foot" style={{ marginBottom: 18 }}>Ti mandiamo un codice di accesso. Nessuna password da ricordare.</p>
          <Btn busy={busy} disabled={!email.includes('@')}>Continua</Btn>
        </form>
      ) : (
        <form className="enter" onSubmit={(e) => { e.preventDefault(); run(() => store.verifyCode(email.trim(), code.trim())) }}>
          <label className="label" htmlFor="cd">Codice ricevuto via email</label>
          <input id="cd" className="field num" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={8} required placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ fontSize: 24, letterSpacing: '0.2em', textAlign: 'center' }} autoFocus />
          <p className="foot" style={{ marginBottom: 18 }}>Inviato a {email}. Su questo dispositivo resterai collegato.</p>
          <Btn busy={busy} disabled={code.length < 6}>Accedi</Btn>
          <div style={{ height: 8 }} /><Btn kind="gray" type="button" onClick={() => { setSent(false); setCode('') }}>Cambia email</Btn>
        </form>
      )}
    </div></div>
  )
}

function Groups({ groups, onOpen, onCreated }: { groups: GroupSummary[]; onOpen: (id: ID) => void; onCreated: (id: ID) => void }) {
  const [name, setName] = useState('')
  const [me, setMe] = useState('')
  const [busy, run] = useBusy()
  return (
    <div className="screen"><div className="nav" /><div className="scroll">
      <h1 className="title">I tuoi gruppi</h1>
      {groups.length > 0 && <div className="list" style={{ marginTop: 18 }}>{groups.map((g) => <button className="row" key={g.id} onClick={() => onOpen(g.id)}><span className="grow t">{g.name}</span><span className="chev"><Icon n="chev" size={18} /></span></button>)}</div>}
      <div className="section"><div className="section-h"><h2>Nuovo gruppo</h2></div>
        <form onSubmit={(e) => { e.preventDefault(); run(async () => onCreated(await store.createGroup(name.trim(), me.trim()))) }}>
          <input className="field" placeholder="Nome del gruppo" aria-label="Nome del gruppo" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          <div style={{ height: 10 }} />
          <input className="field" placeholder="Il tuo nome" aria-label="Il tuo nome" value={me} onChange={(e) => setMe(e.target.value)} maxLength={40} autoComplete="given-name" required />
          <p className="foot" style={{ marginBottom: 16 }}>Ogni gruppo ha saldi indipendenti. Gli amici entrano con il link di invito.</p>
          <Btn busy={busy} disabled={!name.trim() || !me.trim()}>Crea gruppo</Btn>
        </form>
      </div>
      <div style={{ height: 20 }} /><Btn kind="danger" onClick={() => store.signOut()}>Esci</Btn>
    </div></div>
  )
}

function Invite({ code, done }: { code: string; done: (groupId: ID | null) => void }) {
  const [p, setP] = useState<InvitePreview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [claim, setClaim] = useState<ID | null>(null)
  const [busy, run] = useBusy()
  const load = useCallback(() => { setErr(null); store.previewInvite(code).then((x) => { if (x.alreadyMember) done(x.groupId); else setP(x) }).catch((e) => setErr(e?.message ?? 'Invito non valido')) }, [code]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load])
  if (err) return <div className="screen"><div className="scroll" style={{ paddingTop: 120 }}><Empty icon="link" title="Invito non valido" text="Il link potrebbe essere incompleto. Chiedi a chi ti ha invitato di rimandarlo."><Btn onClick={load}>Riprova</Btn><div style={{ height: 10 }} /><Btn kind="gray" onClick={() => done(null)}>Vai ai miei gruppi</Btn></Empty></div></div>
  if (!p) return <Splash />
  return (
    <div className="screen"><div className="scroll" style={{ paddingTop: 'calc(var(--sat) + 64px)' }}>
      <p className="caption" style={{ textTransform: 'uppercase', fontWeight: 600, letterSpacing: '.03em' }}>Invito al gruppo</p>
      <h1 className="title">{p.name}</h1>
      <p className="subtitle" style={{ marginBottom: 24 }}>Entri con saldo zero: i viaggi già fatti non ti vengono attribuiti.</p>
      {p.unclaimed.length > 0 && <>
        <p className="label">Sei già in elenco?</p>
        <div className="chips" style={{ marginBottom: 20 }}>
          {p.unclaimed.map((m) => <button key={m.id} className="chip plain" aria-pressed={claim === m.id} onClick={() => setClaim(claim === m.id ? null : m.id)}>Sono {m.name}</button>)}
        </div>
      </>}
      {!claim && <><label className="label" htmlFor="nm">Il tuo nome</label><input id="nm" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" placeholder="Come ti chiamano gli amici" /></>}
      <div style={{ height: 20 }} />
      <Btn busy={busy} disabled={!claim && !name.trim()} onClick={() => run(async () => done(await store.joinGroup(code, name.trim(), claim)))}>Entra nel gruppo</Btn>
      {store.mode === 'demo' && <><div style={{ height: 14 }} /><Notice kind="info">Modalità dimostrativa: i dati restano solo su questo dispositivo.</Notice></>}
    </div></div>
  )
}
