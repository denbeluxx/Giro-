import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { balances, displayRound, type Balances } from './lib/calc'
import { ConflictError, store, type GroupSummary, type InvitePreview, type Session } from './lib/store'
import type { GroupData, ID, Member, Trip } from './lib/types'
import { Home } from './screens/Home'
import { History, Members, Money, Places } from './screens/Others'
import { Plan } from './screens/Plan'
import { TripView } from './screens/TripView'
import { Btn, Empty, Icon, Notice, Skel, ToastHost, openSheets, reducedMotion, sheetNav, useBusy, useToast } from './ui/kit'
import { Tabs } from './ui/Tabs'
import { Guide, guideDone } from './ui/Guide'
import { disablePush, syncPush } from './lib/push'

export type Route =
  | { s: 'home' } | { s: 'members' } | { s: 'places' } | { s: 'history' } | { s: 'money' }
  | { s: 'plan'; mode: 'plan' | 'record'; edit?: Trip; redo?: Trip; at?: 0 | 1 | 2; resume?: boolean }
  | { s: 'trip'; id: ID; fresh?: boolean; shotgun?: boolean }

interface Ctx {
  data: GroupData; bal: Balances; me: Member; byId: (id?: ID | null) => Member | undefined; active: Member[]
  reload: () => Promise<void>; push: (r: Route) => void; pop: () => void; replace: (r: Route) => void; home: () => void
  /** Aggiunge un livello alla cronologia (es. un passo del flusso), così il tasto Indietro del telefono lo annulla. */
  forward: () => void
  /** Riapre la guida dell'app. */
  openGuide: () => void
  /** Registra chi gestisce il tasto Indietro prima del cambio di schermata; restituisce la funzione per toglierlo. */
  onBack: (fn: () => boolean) => () => void
  /** Esce dalla schermata corrente togliendo anche n livelli della cronologia (es. i passi di un flusso). */
  leave: (n: number) => void
  /** Toglie n livelli della cronologia senza cambiare schermata. */
  collapse: (n: number) => void
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
  const t = d.startViewTransition(() => flushSync(fn))
  // una transizione interrotta da quella successiva non è un errore
  for (const k of ['ready', 'finished', 'updateCallbackDone']) t?.[k]?.catch?.(() => {})
}

const params = new URLSearchParams(window.location.search)
/** Sezioni principali, affiancate e scorrevoli: l'ordine è quello della barra in alto. */
const TABS = ['home', 'history', 'money', 'places', 'members'] as const
const TAB_LABEL: Record<(typeof TABS)[number], string> = { home: 'Saldi', history: 'Storico', money: 'Pedaggi', places: 'Luoghi', members: 'Gruppo' }
/** Soglia dell'avviso «saldo molto negativo». */
const LOW_M = -70000
/** Uscita volontaria in corso: non va confusa con una sessione scaduta. */
export const signingOut = { current: false }
const clearParams = () => { try { history.replaceState(history.state, '', window.location.pathname) } catch { /* */ } }

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [groupId, setGroupId] = useState<ID | null>(null)
  const [invite, setInvite] = useState<string | null>(params.get('invito'))
  const [deepTrip, setDeepTrip] = useState<string | null>(params.get('t'))
  const [err, setErr] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  const [expired, setExpired] = useState(false)
  const had = useRef(false)
  useEffect(() => {
    store.session().then((s) => { had.current = !!s; setSession(s) }).catch(() => setSession(null))
    return store.onAuth((s) => {
      // la sessione è sparita senza che l'utente sia uscito: è scaduta o revocata
      if (!s && had.current && !signingOut.current) setExpired(true)
      had.current = !!s
      setSession(s)
    })
  }, [])

  const loadGroups = useCallback(async () => {
    setErr(null)
    try {
      const gs = await store.listGroups()
      setGroups(gs)
      let pick: ID | null = null
      if (deepTrip) { pick = await store.findTripGroup(deepTrip); if (!pick) { setDeepTrip(null); setMissing(true); clearParams() } }
      if (!pick) { let last: string | null = null; try { last = localStorage.getItem('shotgun-group') } catch { /* */ } pick = gs.find((g) => g.id === last)?.id ?? gs[0]?.id ?? null }
      setGroupId(pick)
    } catch (e: any) { setErr(e?.message ?? 'Connessione non riuscita') }
  }, [deepTrip])
  useEffect(() => { if (session && !invite) loadGroups() }, [session?.userId, invite]) // eslint-disable-line react-hooks/exhaustive-deps

  const switchGroup = useCallback((id: ID | null) => { transition('fade', () => setGroupId(id)); if (id) try { localStorage.setItem('shotgun-group', id) } catch { /* */ } }, [])

  let body: ReactNode
  if (session === undefined) body = <Splash />
  else if (!session) body = <Auth invite={!!invite} expired={expired} />
  else if (invite) body = <Invite code={invite} done={(id) => { clearParams(); setInvite(null); if (id) try { localStorage.setItem('shotgun-group', id) } catch { /* */ } }} />
  else if (err) body = <div className="screen"><div className="scroll" style={{ paddingTop: 120 }}><Empty icon="alert" title="Connessione non riuscita" text="Non riesco a caricare i tuoi gruppi. Controlla la rete e riprova."><Btn onClick={loadGroups}>Riprova</Btn></Empty></div></div>
  else if (!groups) body = <Splash />
  else if (!groupId) body = <Groups groups={groups} onOpen={switchGroup} onCreated={async (id) => { await loadGroups(); switchGroup(id) }} />
  else body = <GroupProvider key={groupId} groupId={groupId} groups={groups} switchGroup={switchGroup} deepTrip={deepTrip} missing={missing} clearDeep={() => { setDeepTrip(null); setMissing(false); clearParams() }} />
  return <ToastHost><div className="app"><Guard>{body}</Guard></div></ToastHost>
}

/** Se qualcosa si rompe durante il disegno di una schermata, l'app mostra un messaggio invece di una pagina bianca. */
class Guard extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidCatch(err: Error) { console.error('Errore di interfaccia', err) }
  render() {
    if (!this.state.err) return this.props.children
    return <div className="screen"><div className="scroll" style={{ paddingTop: 120 }}><Empty icon="alert" title="Qualcosa non ha funzionato" text="Questa schermata non si è caricata. I dati salvati non sono stati toccati.">
      <Btn onClick={() => { this.setState({ err: null }); window.location.reload() }}>Ricarica l'app</Btn></Empty></div></div>
  }
}

function Splash() {
  return <div className="screen"><div className="scroll" style={{ paddingTop: 'calc(var(--sat) + 70px)' }} aria-busy="true"><Skel w={180} h={34} /><div style={{ height: 22 }} /><Skel h={150} r={22} /><div style={{ height: 26 }} /><Skel h={240} r={14} /></div></div>
}

function GroupProvider({ groupId, groups, switchGroup, deepTrip, missing, clearDeep }: { groupId: ID; groups: GroupSummary[]; switchGroup: (id: ID | null) => void; deepTrip: string | null; missing?: boolean; clearDeep: () => void }) {
  const [data, setData] = useState<GroupData | null>(null)
  const dataRef = useRef<GroupData | null>(null)
  dataRef.current = data
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
  useEffect(() => { if (data && missing) { toast('Il link apre un\'uscita che non esiste o non è di questo gruppo.'); clearDeep() } }, [data, missing]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data && deepTrip) { clearDeep(); if (data.trips.some((t) => t.id === deepTrip)) { forward(); setStack([{ s: 'home' }, { s: 'trip', id: deepTrip, shotgun: params.get('shotgun') === '1' }]) } else toast('Questa uscita non è più disponibile.') } }, [data, deepTrip]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Navigazione legata alla cronologia: il tasto o il gesto Indietro del telefono torna indietro di un livello ----
  const level = useRef(0)
  const goingHome = useRef(false)
  // passi indietro fatti dall'app (non dall'utente), nell'ordine in cui arriveranno; scadono se il browser non li esegue
  const pending = useRef<{ k: 'leave' | 'collapse'; at: number }[]>([])
  const silent = (k: 'leave' | 'collapse', n: number) => { const s = Math.min(n, level.current); if (s <= 0) return false; pending.current.push({ k, at: Date.now() }); history.go(-s); return true }
  const handlers = useRef<(() => boolean)[]>([])
  const popStack = useCallback(() => transition('pop', () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))), [])
  useEffect(() => {
    // dopo una ricarica a metà flusso la cronologia ha ancora i livelli di prima: torniamo alla base
    const d0 = typeof history.state?.d === 'number' ? history.state.d : 0
    if (d0 > 0) { level.current = d0; silent('collapse', d0) }
    else try { history.replaceState({ d: 0 }, '') } catch { /* */ }
    const onPop = (e: PopStateEvent) => {
      const d = typeof e.state?.d === 'number' ? e.state.d : 0
      if (goingHome.current) { goingHome.current = false; level.current = d; transition('pop', () => setStack([{ s: 'home' }])); return }
      pending.current = pending.current.filter((p) => Date.now() - p.at < 2000)
      const p = pending.current.shift()
      if (p) { level.current = d; if (p.k === 'leave') popStack(); return }
      if (d >= level.current) { level.current = d; return }
      level.current = d
      // prima si chiude un foglio aperto, restando sulla stessa schermata
      // il livello era del foglio aperto: si chiude il foglio
      if (openSheets.length) { openSheets[openSheets.length - 1](); return }
      const h = handlers.current[handlers.current.length - 1]
      if (h && h()) return
      popStack()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [popStack])
  const forward = useCallback(() => { level.current += 1; try { history.pushState({ d: level.current }, '') } catch { /* */ } }, [])
  // sezione aperta (Saldi, Storico…): lasciando Saldi si aggiunge un livello, così il tasto Indietro del telefono ci riporta
  const [tab, setTab] = useState(0)
  // guida: parte da sola al primo accesso su questo telefono, si riapre da Gruppo
  const [guide, setGuide] = useState(false)
  const tabEntry = useRef(false)
  const tabState = useRef({ tab: 0, depth: 1 })
  tabState.current = { tab, depth: stack.length }
  const forwardRef = useRef(forward)
  forwardRef.current = forward
  const guideEntry = useRef(false)
  const openGuide = useCallback(() => { if (!guideEntry.current) { guideEntry.current = true; forwardRef.current() } setGuide(true) }, [])
  const closeGuide = useCallback((viaBack?: boolean) => {
    setGuide(false)
    // si tolgono in un colpo solo i livelli della guida e delle sezioni, e si torna su Saldi
    const k = (guideEntry.current && !viaBack ? 1 : 0) + (tabEntry.current ? 1 : 0)
    guideEntry.current = false; tabEntry.current = false
    setTab(0)
    if (k > 0) silent('collapse', k)
  }, [])
  /** La guida mostra le sezioni senza aggiungere livelli alla cronologia. */
  const showTab = useCallback((i: number) => setTab(i), [])
  /** il dito sta lasciando Saldi: il livello di cronologia c'è già prima che lo scorrimento finisca */
  const leaveHome = useCallback(() => { if (!tabEntry.current) { tabEntry.current = true; forwardRef.current() } }, [])
  const [tabReq, setTabReq] = useState(0)
  const goTab = useCallback((i: number) => {
    setTab(i)
    if (i !== 0 && !tabEntry.current) { tabEntry.current = true; forwardRef.current() }
    else if (i === 0 && tabEntry.current) { tabEntry.current = false; silent('collapse', 1) }
  }, [])
  useEffect(() => {
    const fn = () => {
      if (tabState.current.depth !== 1 || (!tabEntry.current && tabState.current.tab === 0)) return false
      // anche a metà di uno scorrimento: si torna su Saldi
      tabEntry.current = false; setTab(0); setTabReq((n) => n + 1); return true
    }
    handlers.current.unshift(fn)
    return () => { handlers.current = handlers.current.filter((h) => h !== fn) }
  }, [])
  const onBack = useCallback((fn: () => boolean) => { handlers.current.push(fn); return () => { handlers.current = handlers.current.filter((h) => h !== fn) } }, [])
  const push = useCallback((r: Route) => {
    const t = (TABS as readonly string[]).indexOf(r.s)
    if (t >= 0) return goTab(t) // le sezioni non si impilano: si scorre a quella giusta
    forward(); transition('push', () => setStack((s) => [...s, r]))
  }, [forward, goTab])
  const pop = useCallback(() => { if (level.current > 0) history.back(); else popStack() }, [popStack])
  const leave = useCallback((n: number) => { if (!silent('leave', n)) popStack() }, [popStack]) // eslint-disable-line react-hooks/exhaustive-deps
  const collapse = useCallback((n: number) => { silent('collapse', n) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // fogli: ognuno aggiunge un livello quando si apre; chiuso dal pulsante, il livello si toglie
  useEffect(() => {
    sheetNav.open = () => forwardRef.current()
    sheetNav.close = (byBack) => { if (!byBack) silent('collapse', 1) }
    return () => { sheetNav.open = () => {}; sheetNav.close = () => {} }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const replace = useCallback((r: Route) => transition('fade', () => setStack((s) => [...s.slice(0, -1), r])), [])
  const home = useCallback(() => {
    tabEntry.current = false; setTab(0)
    if (level.current > 0) { goingHome.current = true; history.go(-level.current) }
    else transition('pop', () => setStack([{ s: 'home' }]))
  }, [])
  const saveTrip = useCallback(async (t: Trip, expected: number | null) => {
    try {
      const saved = await store.saveTrip(t, expected)
      const before = dataRef.current
      setData((d) => d && { ...d, trips: d.trips.some((x) => x.id === saved.id) ? d.trips.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...d.trips] })
      // avviso a chi scende sotto i −70 km con questo viaggio (lo manda il servizio notifiche, al massimo uno al giorno)
      if (before) {
        const after = before.trips.some((x) => x.id === saved.id) ? before.trips.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...before.trips]
        const a = displayRound(balances(before.members, before.trips, before.settlements).km), b = displayRound(balances(before.members, after, before.settlements).km)
        for (const m of before.members) if (!m.leftAt && m.userId && (a[m.id] ?? 0) > LOW_M && (b[m.id] ?? 0) <= LOW_M) store.notify({ type: 'low', groupId, memberId: m.id }).catch(() => {})
      }
      return saved
    } catch (e) {
      if (e instanceof ConflictError) {
        const fresh = await store.loadGroup(groupId).catch(() => null)
        if (fresh) setData(fresh)
        const now = fresh?.trips.find((x) => x.id === t.id)
        // la risposta precedente era andata persa ma il salvataggio era riuscito: nessun conflitto vero
        const same = (a: Trip, b: Trip) => a.status === b.status && a.startsAt === b.startsAt && JSON.stringify([a.legs, a.dest, a.presentIds, a.unavailableIds]) === JSON.stringify([b.legs, b.dest, b.presentIds, b.unavailableIds])
        if (now && same(now, t)) return now
        toast('Aggiornato da un altro dispositivo: dati ricaricati')
        return null
      }
      throw e
    }
  }, [reload, toast])

  const ctx = useMemo<Ctx | null>(() => {
    if (!data) return null
    const map = new Map(data.members.map((m) => [m.id, m]))
    return {
      data, bal: balances(data.members, data.trips, data.settlements), me: map.get(data.meId)!, byId: (id) => (id ? map.get(id) : undefined),
      active: data.members.filter((m) => !m.leftAt), reload, push, pop, replace, home, forward, onBack, leave, collapse, saveTrip, groups, openGuide,
      // cambiando gruppo si azzera la cronologia di questo, così Indietro non resta «a vuoto»
      switchGroup: (id) => { silent('collapse', level.current); switchGroup(id) },
      // uscendo, questo telefono smette di ricevere le notifiche dell'account
      signOut: () => { signingOut.current = true; disablePush().catch(() => {}).finally(() => store.signOut()) },
    }
  }, [data, reload, push, pop, replace, home, forward, onBack, leave, collapse, saveTrip, groups, switchGroup, openGuide])
  // le sezioni sono sempre gli stessi elementi: cambiare sezione non ridisegna le pagine (gruppi con centinaia di uscite)
  const pages = useMemo(() => TABS.map((k) => ({
    key: k, label: TAB_LABEL[k],
    page: k === 'home' ? <Home /> : k === 'history' ? <History /> : k === 'money' ? <Money /> : k === 'places' ? <Places /> : <Members />,
  })), [])
  const ready = !!ctx && stack.length === 1 && !deepTrip
  const hadMissing = useRef(false)
  if (missing) hadMissing.current = true
  // telefono già iscritto alle notifiche: l'iscrizione segue l'account con cui si è entrati
  const synced = useRef(false)
  useEffect(() => { if (ctx && !synced.current) { synced.current = true; syncPush().catch(() => {}) } }, [ctx])
  useEffect(() => {
    if (!ready || guideDone()) return
    // dopo l'avviso «il link apre un'uscita che non esiste» si lascia il tempo di leggerlo
    const id = setTimeout(openGuide, hadMissing.current ? 3600 : 700)
    return () => clearTimeout(id)
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !data) return <div className="screen"><div className="scroll" style={{ paddingTop: 120 }}><Empty icon="alert" title="Gruppo non disponibile" text={err}><Btn onClick={reload}>Riprova</Btn><div style={{ height: 10 }} /><Btn kind="gray" onClick={() => switchGroup(null)}>I miei gruppi</Btn></Empty></div></div>
  if (!ctx) return <Splash />
  const r = stack[stack.length - 1]
  return (
    <C.Provider value={ctx}>
      {(TABS as readonly string[]).includes(r.s) && <Tabs index={tab} req={tabReq} onIndex={(i, user) => (user ? goTab(i) : setTab(i))} onLeave={leaveHome} tabs={pages} />}
      {guide && (TABS as readonly string[]).includes(r.s) && <Guide onClose={closeGuide} showTab={showTab} />}
      {r.s === 'plan' && <Plan key={`${r.edit?.id ?? r.redo?.id ?? 'new'}-${stack.length}`} mode={r.mode} edit={r.edit} redo={r.redo} at={r.at} resume={r.resume} />}
      {r.s === 'trip' && <TripView key={r.id} id={r.id} fresh={r.fresh} autoShotgun={r.shotgun} />}
    </C.Provider>
  )
}

// ---- Accesso -------------------------------------------------------------------

function Auth({ invite, expired }: { invite: boolean; expired?: boolean }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, run] = useBusy()
  return (
    <div className="screen"><div className="scroll" style={{ paddingTop: 'calc(var(--sat) + 72px)' }}>
      <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={72} height={72} style={{ display: 'block', borderRadius: 18, boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.18), 0 0 26px rgba(56, 225, 255, 0.18)', marginBottom: 20 }} />
      <h1 className="title">Shotgun</h1>
      {expired && <div style={{ marginBottom: 16 }}><Notice kind="info">Sessione scaduta: accedi di nuovo. Le uscite in preparazione sono ancora salvate su questo telefono.</Notice></div>}
      <p className="subtitle" style={{ fontSize: 17, marginBottom: 28 }}>{invite ? 'Accedi per entrare nel gruppo che ti ha invitato.' : 'Chi guida stasera? Chilometri, turni e pedaggi tra amici.'}</p>
      {!sent ? (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await store.sendCode(email.trim()); setSent(true) }) }}>
          <label className="label" htmlFor="em">La tua email</label>
          <input id="em" className="field" type="email" inputMode="email" autoComplete="email" required placeholder="nome@esempio.it" value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="foot" style={{ marginBottom: 18 }}>Ti mandiamo un'email per entrare. Nessuna password da ricordare.</p>
          <Btn busy={busy} disabled={!email.includes('@')}>Continua</Btn>
        </form>
      ) : (
        <form className="enter" onSubmit={(e) => { e.preventDefault(); run(() => store.verifyCode(email.trim(), code.trim())) }}>
          <label className="label" htmlFor="cd">Codice ricevuto via email</label>
          <input id="cd" className="field num" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={8} required placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ fontSize: 24, letterSpacing: '0.2em', textAlign: 'center' }} autoFocus />
          <p className="foot" style={{ marginBottom: 18 }}>Inviato a {email}. In alternativa al codice puoi toccare «entra direttamente» nell'email, ma solo da questo dispositivo. Resterai collegato.</p>
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
      {store.mode === 'cloud' && <><div style={{ height: 20 }} /><Btn kind="danger" onClick={() => { signingOut.current = true; disablePush().catch(() => {}).finally(() => store.signOut()) }}>Esci da questo dispositivo</Btn></>}
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
      <p className="subtitle" style={{ marginBottom: 24 }}>{p.rejoinName ? `Bentornato, ${p.rejoinName}: ritrovi il tuo saldo di prima.` : claim ? 'Ti colleghi al nome scelto, con il suo saldo attuale.' : 'Entri con saldo zero: i viaggi già fatti non ti vengono attribuiti.'}</p>
      {!p.rejoinName && p.unclaimed.length > 0 && <>
        <p className="label">Sei già in elenco?</p>
        <div className="chips" style={{ marginBottom: 20 }}>
          {p.unclaimed.map((m) => <button key={m.id} className="chip plain" aria-pressed={claim === m.id} onClick={() => setClaim(claim === m.id ? null : m.id)}>Sono {m.name}</button>)}
        </div>
      </>}
      {!claim && !p.rejoinName && <><label className="label" htmlFor="nm">Il tuo nome</label><input id="nm" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" placeholder="Come ti chiamano gli amici" /></>}
      <div style={{ height: 20 }} />
      <Btn busy={busy} disabled={!claim && !p.rejoinName && !name.trim()} onClick={() => run(async () => { try { done(await store.joinGroup(code, name.trim() || p.rejoinName || 'Amico', claim)) } catch (e) { setClaim(null); load(); throw e } })}>{p.rejoinName ? 'Rientra nel gruppo' : 'Entra nel gruppo'}</Btn>
      {store.mode === 'demo' && <><div style={{ height: 14 }} /><Notice kind="info">Modalità dimostrativa: i dati restano solo su questo dispositivo.</Notice></>}
    </div></div>
  )
}
