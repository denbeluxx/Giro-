import { useEffect, useMemo, useRef, useState } from 'react'
import { transition, useApp } from '../app'
import { displayRound, legMeters, legSeconds, legToll, occupantsBySeg, suggestDriver, tripEffect } from '../lib/calc'
import { fmtDur, fmtEur, fmtEurSigned, fmtKm, fmtKmSigned, fmtTime, localInput } from '../lib/format'
import { buildStops, extraStops, homeName, newLeg, reverseStops, sanitizeStops, stopKey, usableHome, withExtras } from '../lib/plan'
import { RouteError, estimateRoute, matrix, routeStops, type Found, type Route } from '../lib/routing'
import { store } from '../lib/store'
import { haversine } from '../lib/tolls'
import { uid, type GroupToll, type ID, type Leg, type Member, type Pt, type Stop, type Trip } from '../lib/types'
import { Avatar, Btn, Icon, Notice, Seg, Sheet, Skel, Switch, useBusy, useToast } from '../ui/kit'
import { MapView } from '../ui/MapView'
import { PlaceSearch } from '../ui/PlaceSearch'
import { KmSheet, TollSheet, tollText } from './editors'
import { tone } from './Home'
import { Done } from './TripView'

type Named = Pt & { name: string; address?: string }
type Step = 0 | 1 | 2
const ROW = 60

// ---- Bozza: l'uscita in preparazione sopravvive a ricarica o chiusura dell'app ----
interface Draft { v: 1; ts: number; mode: 'plan' | 'record'; redoId?: ID; tripId: ID; step: Step; present: ID[]; unavailable: ID[]; dest: Named | null; when: string; driver: ID | null; undecided: boolean; hasReturn: boolean; legs: Leg[]; start: Named | null }
const draftKey = (g: ID) => `giro-draft-${g}`
export function loadDraft(groupId: ID): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(groupId)) ?? 'null') as Draft | null
    if (!d || d.v !== 1 || Date.now() - d.ts > 24 * 3600e3 || !Array.isArray(d.present)) return null
    return d
  } catch { return null }
}
export const clearDraft = (groupId: ID) => { try { localStorage.removeItem(draftKey(groupId)) } catch { /* */ } }

/** Orario proposto: stasera alle 21:30 se è ancora futuro, altrimenti la prossima mezz'ora. */
function defaultWhen(mode: 'plan' | 'record'): string {
  const d = new Date()
  if (mode === 'record') { d.setSeconds(0, 0); return d.toISOString() }
  const t = new Date(d); t.setHours(21, 30, 0, 0)
  if (t.getTime() > d.getTime() + 15 * 60e3) return t.toISOString()
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0)
  if (d.getTime() - Date.now() < 15 * 60e3) d.setMinutes(d.getMinutes() + 30)
  return d.toISOString()
}
const hhmm = (iso: string) => fmtTime(iso)

/** Chi è salito scende al più tardi all'ultima tappa; nessuno scende prima di salire. */
function normalize(stops: Stop[]): Stop[] {
  const out = stops.map((s) => ({ ...s, on: [...new Set(s.on)], off: [...new Set(s.off)] }))
  const ids = new Set(out.flatMap((s) => s.on))
  for (const s of out) s.off = s.off.filter((id) => ids.has(id))
  for (const id of ids) {
    const first = out.findIndex((s) => s.on.includes(id))
    out.forEach((s, i) => { if (i !== first) s.on = s.on.filter((x) => x !== id); if (i <= first) s.off = s.off.filter((x) => x !== id) })
    const offs = out.map((s, i) => (s.off.includes(id) ? i : -1)).filter((i) => i >= 0)
    if (!offs.length) out[out.length - 1].off.push(id)
    else out.forEach((s, i) => { if (i !== offs[0]) s.off = s.off.filter((x) => x !== id) })
  }
  return out
}
const legSig = (l: Leg) => l.stops.map(stopKey).join('>')
const routeless = (l: Leg): Leg => ({ ...l, segs: null, geometry: null, routeState: 'missing', actualMeters: null, tollOverride: null, tollGates: null })

export function Plan({ mode, edit, redo, at, resume }: { mode: 'plan' | 'record'; edit?: Trip; redo?: Trip; at?: Step; resume?: boolean }) {
  const app = useApp()
  const { data, bal, me, active, byId, pop, replace, home, saveTrip, forward, onBack, leave, collapse } = app
  const toast = useToast()
  const draft0 = useMemo(() => (resume && !edit ? loadDraft(data.group.id) : null), []) // eslint-disable-line react-hooks/exhaustive-deps
  const src = edit ?? redo
  const activeIds = active.map((m) => m.id)
  const tolls = data.group.settings.tolls
  const live = edit ? data.trips.find((t) => t.id === edit.id) ?? edit : undefined

  const entry: Step = draft0 ? draft0.step : at ?? (edit ? (edit.legs.some((l) => l.stops.length < 2) ? 1 : 2) : 0)
  const [step, setStep] = useState<Step>(entry)
  // riprendendo una bozza si può sempre tornare ai passi precedenti
  const stepStack = useRef<Step[]>(draft0 ? ([0, 1, 2] as Step[]).slice(0, entry + 1) : [entry])
  const [present, setPresent] = useState<ID[]>(draft0?.present ?? (edit ? edit.presentIds : src ? src.presentIds.filter((p) => activeIds.includes(p)) : activeIds))
  const [unavailable, setUnavailable] = useState<ID[]>(draft0?.unavailable ?? edit?.unavailableIds ?? [])
  const [dest, setDest] = useState<Named | null>(draft0?.dest ?? (src ? src.dest : null))
  const [when, setWhen] = useState(() => draft0?.when ?? edit?.startsAt ?? defaultWhen(mode))
  const [driver, setDriver] = useState<ID | null>(draft0?.driver ?? edit?.legs[0]?.driverId ?? null)
  const [undecided, setUndecided] = useState(draft0?.undecided ?? (!!edit && !edit.legs[0]?.driverId))
  const [hasReturn, setHasReturn] = useState(draft0?.hasReturn ?? (src ? src.legs.length > 1 : true))
  const [legs, setLegs] = useState<Leg[]>(draft0?.legs ?? edit?.legs ?? [])
  const [start, setStart] = useState<Named | null>(() => {
    if (draft0) return draft0.start
    const go = src?.legs.find((l) => l.kind === 'andata')
    const s0 = go?.stops[0]
    return s0 && go!.stops.length >= 2 && !s0.homeOf ? { name: s0.name, lat: s0.lat, lng: s0.lng } : null
  })
  const [tab, setTab] = useState<Leg['kind']>('andata')
  const [rt, setRt] = useState<Record<string, { s: 'load' } | { s: 'err'; msg: string } | undefined>>({})
  const [alts, setAlts] = useState<Record<string, Route[]>>({})
  const [tour, setTour] = useState<{ km: Record<ID, number>; real: boolean } | null>(null)
  type SheetK = null | { k: 'dest' } | { k: 'stop'; i: number } | { k: 'add' } | { k: 'retDriver' } | { k: 'km' } | { k: 'toll' } | { k: 'who' } | { k: 'start' } | { k: 'exit' }
  const [sheet, setSheet] = useState<SheetK>(null)
  const [done, setDone] = useState<Trip | null>(null)
  const [conflict, setConflict] = useState(false)
  const [tick, setTick] = useState(0)
  const [busy, run] = useBusy()
  const tripId = useRef(draft0?.tripId ?? edit?.id ?? uid())
  const sigOf = (p = present, d = driver, ds = dest, r = hasReturn, st = start, u = unavailable) => JSON.stringify([[...p].sort(), d, ds && stopKey(ds), r, st && stopKey(st), [...u].sort()])
  const builtSig = useRef(legs.length && (draft0 || edit) ? sigOf() : '')
  const leaving = useRef(false)
  const inflight = useRef<Record<string, string>>({})
  const failed = useRef<Record<string, string>>({})
  const removedReturn = useRef<Leg | null>(null)
  const snapshot = () => JSON.stringify([present, unavailable, dest, when, legs, driver, undecided, hasReturn])
  const initial = useRef(snapshot())
  const saved = useRef(false)
  const dirty = !saved.current && snapshot() !== initial.current

  // ---- Tasto Indietro del telefono: chiude un foglio, torna al passo precedente, chiede prima di perdere i dati ----
  const live$ = useRef({ step, sheet, dirty, done: false as boolean })
  live$.current = { step, sheet, dirty, done: !!done }
  useEffect(() => {
    // una bozza ripresa a metà: una voce di cronologia per ogni passo precedente
    if (draft0) for (let i = 1; i < stepStack.current.length; i++) forward()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onBack(() => {
    const { sheet: sh, dirty: dy, done: dn } = live$.current
    if (leaving.current) return false
    if (dn) { leaving.current = true; forward(); home(); return true } // viaggio già registrato: si torna in home
    if (sh?.k === 'exit') { forward(); exit(); return true } // secondo Indietro sulla domanda: si esce
    if (sh) { setSheet(null); forward(); return true }
    if (stepStack.current.length > 1) { stepStack.current.pop(); const n = stepStack.current[stepStack.current.length - 1]; transition('pop', () => setStep(n)); return true }
    if (dy && edit) { setSheet({ k: 'exit' }); forward(); return true }
    if (dy && !edit) toast('Bozza salvata: la ritrovi in home')
    return false
  }), [onBack, forward]) // eslint-disable-line react-hooks/exhaustive-deps
  const goTo = (n: Step) => {
    if (n === 2 && (builtSig.current !== sigOf() || !legs.length)) rebuild()
    const at = stepStack.current.indexOf(n)
    if (at >= 0) {
      // il passo è già nella cronologia: ci si torna invece di aggiungerne un altro
      const k = stepStack.current.length - 1 - at
      stepStack.current.length = at + 1
      collapse(k)
      transition('pop', () => setStep(n))
      return
    }
    stepStack.current.push(n); forward()
    transition('push', () => { setStep(n); if (n === 2) setTab('andata') })
  }
  const back = () => {
    if (leaving.current) return
    if (stepStack.current.length > 1) return pop()
    if (dirty && edit) return setSheet({ k: 'exit' })
    if (dirty) toast('Bozza salvata: la ritrovi in home')
    leaving.current = true
    pop()
  }

  // ---- Salvataggio automatico della bozza (solo uscite nuove) ----
  useEffect(() => {
    if (edit || saved.current || (!dest && step === 0)) return
    const d: Draft = { v: 1, ts: Date.now(), mode, redoId: redo?.id, tripId: tripId.current, step, present, unavailable, dest, when, driver, undecided, hasReturn, legs, start }
    try { localStorage.setItem(draftKey(data.group.id), JSON.stringify(d)) } catch { /* */ }
  }, [step, present, unavailable, dest, when, driver, undecided, hasReturn, legs, start]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Persone in ordine fisso del gruppo (più chi ha lasciato il gruppo ma era nel viaggio) ----
  const chipPeople = useMemo(() => [...active, ...data.members.filter((m) => m.leftAt && present.includes(m.id))], [active, data.members, present])
  const presentPeople = chipPeople.filter((m) => present.includes(m.id))
  const togglePresent = (id: ID) => {
    const on = present.includes(id)
    const next = on ? present.filter((p) => p !== id) : [...present, id]
    setPresent(next)
    if (on) {
      setUnavailable((u) => u.filter((x) => x !== id))
      if (driver === id) setDriver(null) // chi non viene non può restare conducente
    }
  }

  // ---- Destinazioni recenti, frequenti e salvate (per luogo, non per nome) ----
  const quick = useMemo(() => {
    const now = new Date().toISOString()
    const seen = new Map<string, { p: Named; n: number; last: string }>()
    for (const t of data.trips) {
      if (t.status === 'cancelled' || t.startsAt > now) continue
      const k = [...seen.keys()].find((x) => haversine(seen.get(x)!.p, t.dest) < 80) ?? stopKey(t.dest), e = seen.get(k)
      if (e) { e.n++; if (t.startsAt > e.last) { e.last = t.startsAt; e.p = t.dest } } else seen.set(k, { p: t.dest, n: 1, last: t.startsAt })
    }
    const all = [...seen.values()]
    const recent = [...all].sort((a, b) => (a.last > b.last ? -1 : 1)).slice(0, 3).map((x) => x.p)
    const isIn = (list: Named[], p: Pt) => list.some((r) => haversine(r, p) < 80)
    const frequent = [...all].filter((x) => x.n > 1 && !isIn(recent, x.p)).sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.p)
    const saved = data.places.filter((p) => !isIn(recent, p) && !isIn(frequent, p))
    return { recent, frequent, saved }
  }, [data.trips, data.places])

  // ---- Suggerimento e confronto del giro ----
  const recording = mode === 'record' && edit?.status !== 'planned'
  const balShown = useMemo(() => ({ ...bal, km: displayRound(bal.km) }), [bal])
  const suggestion = useMemo(() => (recording ? null : suggestDriver(active, present, unavailable, balShown, fmtKmSigned)), [active, present, unavailable, balShown, recording])
  const noBase = (id: ID) => !usableHome(byId(id)) && !start
  useEffect(() => {
    if (step !== 1 || !dest) return
    let off = false
    setTour(null)
    const cands = present.filter((p) => !unavailable.includes(p))
    const tours = cands.map((id) => ({ id, stops: buildStops('andata', data.members, present, id, dest, start) }))
    const pts = new Map<string, Pt>()
    tours.forEach((t) => t.stops.forEach((s) => pts.set(stopKey(s), s)))
    const keys = [...pts.keys()]
    matrix([...pts.values()]).then(({ m, real }) => {
      if (off) return
      const km: Record<ID, number> = {}
      for (const t of tours) {
        if (noBase(t.id)) continue
        let d = 0
        for (let i = 0; i < t.stops.length - 1; i++) d += m[keys.indexOf(stopKey(t.stops[i]))]?.[keys.indexOf(stopKey(t.stops[i + 1]))] ?? 0
        km[t.id] = d * (hasReturn ? 2 : 1)
      }
      setTour({ km, real })
    })
    return () => { off = true }
  }, [step, present.join(), unavailable.join(), dest, hasReturn, start]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Costruzione delle tratte: conserva tappe aggiunte a mano, conducente del ritorno e opzioni ----
  function buildLegs(opts: { dest: Named; present: ID[]; driver: ID | null; start: Named | null; hasReturn: boolean; prev: Leg[] }): Leg[] {
    const { dest: ds, present: pr, driver: dv, start: st, prev } = opts
    const prevGo = prev.find((l) => l.kind === 'andata'), prevBack = prev.find((l) => l.kind === 'ritorno')
    const homesOk = (l?: Leg) => !l || l.stops.every((s) => !s.homeOf || !!usableHome(byId(s.homeOf)))
    const same = !prev.length && redo && dv === redo.legs[0]?.driverId && [...pr].sort().join() === [...redo.presentIds].sort().join() && homesOk(redo.legs[0]) && homesOk(redo.legs[1])
    const goExtras = extraStops((prevGo ?? redo?.legs[0])?.stops ?? [])
    const goStops = !dv ? [] : same ? redo!.legs[0].stops.map((s) => ({ ...s, id: uid() })) : withExtras('andata', buildStops('andata', data.members, pr, dv, ds, st), goExtras)
    const go: Leg = { ...newLeg('andata', dv, goStops), designated: prevGo?.designated ?? redo?.legs[0]?.designated ?? false }
    if (!opts.hasReturn) return [go]
    const srcBack = prevBack ?? redo?.legs[1]
    const wantBack = srcBack?.driverId && srcBack.driverId !== (prevGo ?? redo?.legs[0])?.driverId ? srcBack.driverId : null
    const backDriver = wantBack && pr.includes(wantBack) && !unavailable.includes(wantBack) ? wantBack : dv
    let backStops: Stop[] = []
    if (backDriver) {
      if (same && redo!.legs[1] && redo!.legs[1].driverId === backDriver) backStops = redo!.legs[1].stops.map((s) => ({ ...s, id: uid() }))
      else if (backDriver === dv) backStops = withExtras('ritorno', reverseStops(goStops), prevBack ? extraStops(prevBack.stops).filter((x) => !goExtras.some((g) => stopKey(g) === stopKey(x))) : [])
      else backStops = withExtras('ritorno', buildStops('ritorno', data.members, pr, backDriver, ds), prevBack ? extraStops(prevBack.stops) : [])
    }
    return [go, { ...newLeg('ritorno', backDriver, backStops), designated: srcBack?.designated ?? go.designated, time: prevBack?.time ?? srcBack?.time }]
  }
  function rebuild(over: Partial<{ dest: Named; start: Named | null; hasReturn: boolean }> = {}) {
    const ds = over.dest ?? dest
    if (!ds) return
    const st = over.start !== undefined ? over.start : start
    const hr = over.hasReturn ?? hasReturn
    failed.current = {}
    setAlts({})
    removedReturn.current = null // un ritorno tolto prima non vale più per il nuovo giro
    if (legs.some((l) => l.actualMeters != null)) toast('Il giro è cambiato: i km inseriti a mano vanno ricontrollati')
    setLegs(buildLegs({ dest: ds, present, driver, start: st, hasReturn: hr, prev: legs }))
    builtSig.current = sigOf(present, driver, ds, hr, st)
  }

  // ---- Calcolo dei percorsi ----
  useEffect(() => {
    if (step !== 2) return
    for (const leg of legs) {
      if (leg.stops.length < 2 || leg.routeState !== 'missing') continue
      const sig = legSig(leg), key = leg.kind
      if (inflight.current[key] === sig || failed.current[key] === sig) continue
      inflight.current[key] = sig
      setRt((r) => ({ ...r, [key]: { s: 'load' } }))
      routeStops(leg.stops, tolls)
        .then((routes) => {
          if (!routes.length) throw new Error('vuoto')
          setAlts((a) => ({ ...a, [key]: routes }))
          setLegs((ls) => ls.map((l) => (l.kind === key && legSig(l) === sig ? { ...l, segs: routes[0].segs, geometry: routes[0].geometry, routeState: 'ok', tollOverride: null, tollGates: null } : l)))
          setRt((r) => ({ ...r, [key]: undefined }))
        })
        .catch((e) => { failed.current[key] = sig; setRt((r) => ({ ...r, [key]: { s: 'err', msg: e instanceof RouteError ? e.message : 'Il servizio dei percorsi non risponde. Tappe e scelte restano salvate.' } })) })
        .finally(() => { if (inflight.current[key] === sig) delete inflight.current[key] })
    }
  }, [legs, step, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const leg = legs.find((l) => l.kind === tab) ?? legs[0]
  const setLeg = (kind: Leg['kind'], fn: (l: Leg) => Leg) => setLegs((ls) => ls.map((l) => (l.kind === kind ? fn(l) : l)))
  const setStops = (kind: Leg['kind'], stops: Stop[]) => setLeg(kind, (l) => {
    const n = normalize(stops)
    if (n.map(stopKey).join('>') === legSig(l)) return { ...l, stops: n }
    if (l.actualMeters != null) toast('Tappe cambiate: i km inseriti a mano vanno ricontrollati')
    return { ...routeless(l), stops: n }
  })
  const withEstimates = (ls: Leg[]) => ls.map((l) => {
    if (l.segs || l.stops.length < 2 || l.actualMeters == null) return l
    const r = estimateRoute(l.stops, tolls, false)
    return { ...l, segs: r.segs, geometry: r.geometry, routeState: 'stimato' as const }
  })
  const pax = (l: Leg) => present.filter((p) => p !== l.driverId)
  // l'arrivo dell'andata e la partenza del ritorno sono la destinazione: restano fissi
  const fixedEnd = (l: Leg, s?: Stop) => !!s && (!s.homeOf || s.homeOf === l.driverId)
  const isLocked = (l: Leg, i: number) => (l.kind === 'andata' ? i === l.stops.length - 1 || (i === 0 && fixedEnd(l, l.stops[0])) : i === 0 || (i === l.stops.length - 1 && fixedEnd(l, l.stops[i])))

  const draft = (): Trip => ({
    id: tripId.current, groupId: data.group.id, status: live?.status ?? 'planned', version: live?.version ?? 1, startsAt: when,
    dest: dest!, presentIds: present, unavailableIds: unavailable,
    legs: legs.map((l) => (l.kind === 'andata' ? { ...l, time: hhmm(when) } : l)),
    createdBy: edit?.createdBy ?? me.id, updatedBy: me.id, updatedAt: new Date().toISOString(), confirmedAt: live?.confirmedAt ?? null,
  })
  const fx = dest && legs.length ? tripEffect(draft()) : null
  const routing = legs.some((l) => rt[l.kind]?.s === 'load')
  const needKm = legs.some((l) => l.stops.length >= 2 && (l.routeState === 'missing' || (l.routeState === 'stimato' && l.actualMeters == null)))
  const now = Date.now()
  const futureRecord = recording && new Date(when).getTime() > now + 5 * 60e3
  const driverOk = !!driver && present.includes(driver) && !unavailable.includes(driver)
  const legDriversOk = legs.every((l) => !l.driverId || (present.includes(l.driverId) && !unavailable.includes(l.driverId)))
  const canSave = !!dest && legs.length > 0 && legDriversOk && !routing && !futureRecord && (undecided || driverOk) && (recording ? legs.every((l) => l.driverId && l.stops.length >= 2) && !needKm : true)

  const save = () => run(async () => {
    if (leaving.current) return
    if (driver && !present.includes(driver)) throw new Error('Il conducente scelto non è tra i presenti: sceglilo di nuovo.')
    if (!legs.length) throw new Error('Il percorso non è pronto: torna indietro e scegli chi guida.')
    if (edit && !dirty) { leaving.current = true; leave(stepStack.current.length); return } // niente da salvare
    if (edit && live?.status === 'cancelled') throw new Error('Questa uscita è stata annullata nel frattempo: ripristinala prima di modificarla.')
    const t = draft()
    t.legs = t.legs.map((l) => { if (l.segs || l.stops.length < 2) return l; const r = estimateRoute(l.stops, tolls, false); return { ...l, segs: r.segs, geometry: r.geometry, routeState: 'stimato' as const } })
    if (recording && !edit) { t.status = 'confirmed'; t.confirmedAt = new Date().toISOString() }
    const expected = edit ? (conflict ? live!.version : edit.version) : null
    const out = await saveTrip(t, expected)
    if (!out) { setConflict(true); return }
    saved.current = true
    if (!edit) clearDraft(data.group.id)
    if (edit) { leaving.current = true; toast('Modifiche salvate'); leave(stepStack.current.length) }
    else if (recording) setDone(out)
    else { collapse(stepStack.current.length - 1); replace({ s: 'trip', id: out.id, fresh: true }) }
  })
  const exit = () => { if (leaving.current) return; leaving.current = true; saved.current = true; if (!edit) clearDraft(data.group.id); setSheet(null); leave(stepStack.current.length) }

  // ---- Trascinamento delle tappe ----
  const [dragI, setDragI] = useState<{ from: number; dy: number } | null>(null)
  const dragStart = useRef(0)
  const lo = leg ? (isLocked(leg, 0) ? 1 : 0) : 0
  const hi = leg ? (isLocked(leg, leg.stops.length - 1) ? leg.stops.length - 2 : leg.stops.length - 1) : 0
  const onDown = (i: number) => (e: React.PointerEvent) => { dragStart.current = e.clientY; setDragI({ from: i, dy: 0 }); (e.currentTarget as Element).setPointerCapture(e.pointerId) }
  const onMove = (e: React.PointerEvent) => { if (dragI) setDragI({ ...dragI, dy: e.clientY - dragStart.current }) }
  const target = dragI && leg ? Math.max(lo, Math.min(hi, dragI.from + Math.round(dragI.dy / ROW))) : 0
  const onUp = () => {
    if (!dragI || !leg) return
    if (target !== dragI.from) { const s = [...leg.stops]; const [x] = s.splice(dragI.from, 1); s.splice(target, 0, x); setStops(leg.kind, s) }
    setDragI(null)
  }
  const moveStop = (i: number, d: number) => { if (!leg) return; const j = i + d; if (j < lo || j > hi) return; const s = [...leg.stops]; [s[i], s[j]] = [s[j], s[i]]; setStops(leg.kind, s) }
  const removeStop = (i: number) => {
    if (!leg || leg.stops.length <= 2) return
    const s = leg.stops.map((x) => ({ ...x, on: [...x.on], off: [...x.off] }))
    const gone = s[i]
    const prev = s[i - 1], next = s[i + 1]
    // chi saliva o scendeva qui sale o scende alla tappa vicina: nessuno sparisce dal viaggio
    ;(prev ?? next)!.on.push(...gone.on)
    ;(next ?? prev)!.off.push(...gone.off)
    s.splice(i, 1)
    setStops(leg.kind, s)
    if (gone.on.length || gone.off.length) toast(`${[...gone.on, ...gone.off].map((x) => byId(x)?.name).join(', ')}: salita o discesa spostata alla tappa vicina`)
  }

  // ---- Pannello inferiore: due o tre posizioni a seconda dell'altezza dello schermo ----
  const [H, setH] = useState(typeof window !== 'undefined' ? window.innerHeight : 800)
  useEffect(() => { const f = () => setH(window.innerHeight); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  const panelH = Math.round(H * 0.86)
  const closedVis = Math.min(236, Math.round(panelH * 0.45))
  const snaps = H < 600 ? [panelH - closedVis, 0] : [panelH - closedVis, Math.min(panelH - closedVis - 120, Math.round(panelH - H * 0.52)), 0]
  const [snapI, setSnapI] = useState(1)
  const snap = Math.min(snapI, snaps.length - 1)
  const panel = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const [headH, setHeadH] = useState(110)
  useEffect(() => { if (head.current) setHeadH(head.current.offsetHeight) })
  const pd = useRef<{ y: number; base: number; dy: number; t0: number } | null>(null)
  const dragged = useRef(false)
  const pDown = (e: React.PointerEvent) => { pd.current = { y: e.clientY, base: snaps[snap], dy: 0, t0: e.timeStamp }; dragged.current = false }
  const pMove = (e: React.PointerEvent) => {
    if (!pd.current || !panel.current) return
    pd.current.dy = e.clientY - pd.current.y
    // la cattura parte solo quando il dito si muove davvero: un tocco resta un tocco sui pulsanti
    if (!dragged.current && Math.abs(pd.current.dy) > 6) { dragged.current = true; try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* */ } }
    if (!dragged.current) return
    panel.current.classList.add('dragging')
    const raw = pd.current.base + pd.current.dy, max = snaps[0]
    const y = raw < 0 ? raw / 4 : raw > max ? max + (raw - max) / 4 : raw // resistenza elastica ai bordi
    panel.current.style.transform = `translateY(${y}px)`
  }
  const pUp = (e: React.PointerEvent) => {
    if (!pd.current || !panel.current) return
    const p = pd.current
    pd.current = null
    panel.current.classList.remove('dragging')
    if (!dragged.current) return
    const y = p.base + p.dy
    const fast = Math.abs(p.dy) > 30 && e.timeStamp - p.t0 < 280 // colpo rapido: passa alla posizione successiva
    let next = snaps.reduce((b, o, i) => (Math.abs(o - y) < Math.abs(snaps[b] - y) ? i : b), 0)
    if (fast && next === snap) next = Math.max(0, Math.min(snaps.length - 1, snap + (p.dy < 0 ? 1 : -1)))
    panel.current.style.transform = `translateY(${snaps[next]}px)`
    setSnapI(next)
    setTimeout(() => { dragged.current = false }, 0) // il clic generato dal trascinamento è già passato
  }
  const cycle = () => { if (dragged.current) { dragged.current = false; return } setSnapI((snap + 1) % snaps.length); if (panel.current) panel.current.style.transform = '' }
  const visible = panelH - snaps[snap]

  const title = edit ? 'Modifica uscita' : mode === 'record' ? 'Registra un viaggio' : 'Organizza uscita'
  const isEntry = stepStack.current.length <= 1
  const top = (
    <div className={step === 2 ? 'float-top glass' : 'nav'}>
      <button className="nav-btn" onClick={back} aria-label={isEntry ? 'Chiudi' : 'Indietro'}><Icon n={isEntry ? 'x' : 'back'} /></button>
      <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step + 1} aria-label={`Passo ${step + 1} di 3`}>{[0, 1, 2].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
      <span style={{ width: 44 }} />
    </div>
  )
  const exitSheet = sheet?.k === 'exit' && (
    <Sheet title={edit ? 'Uscire senza salvare?' : 'Lasciare l\'uscita?'} onClose={() => setSheet(null)} footer={<><Btn kind="gray" onClick={() => setSheet(null)}>Continua a modificare</Btn><div style={{ height: 8 }} /><Btn kind="danger" onClick={exit}>{edit ? 'Esci senza salvare' : 'Elimina la bozza'}</Btn></>}>
      <p style={{ margin: '0 4px', lineHeight: 1.4 }}>{edit ? 'Le modifiche fatte qui andranno perse.' : 'Presenti, destinazione e percorso scelti finora andranno persi.'}</p>
    </Sheet>
  )
  const whenRow = (
    <label className="row"><span className="grow"><div className="t">{recording ? 'Quando è stato' : 'Quando'}</div>{!recording && new Date(when).getTime() < now - 5 * 60e3 && <div className="s wrap" style={{ color: 'var(--warn)' }}>Orario già passato: l'uscita sarà subito da confermare.</div>}{futureRecord && <div className="s wrap" style={{ color: 'var(--warn)' }}>Per un viaggio già fatto scegli una data passata.</div>}</span>
      <input type="datetime-local" className="num field-inline" aria-label="Data e ora di partenza" value={localInput(when)} max={recording ? localInput(new Date().toISOString()) : undefined} onChange={(e) => e.target.value && setWhen(new Date(e.target.value).toISOString())} /></label>
  )

  // ============================== Passo 1: chi, quando e dove ==============================
  if (step === 0) {
    const pickDest = (p: Named) => { setDest({ name: p.name, lat: p.lat, lng: p.lng, address: p.address }); setSheet(null) }
    const quickRow = (p: Named, icon: string, sub?: string) => (
      <button className="row" key={`${icon}-${stopKey(p)}`} onClick={() => pickDest(p)}>
        <span className="avatar ic-tile"><Icon n={icon} size={19} /></span>
        <span className="grow"><div className="t">{p.name}</div><div className="s">{[sub, p.address].filter(Boolean).join(' · ')}</div></span>
      </button>
    )
    const quickList = <div className="list">{quick.recent.map((p) => quickRow(p, 'clock', 'Recente'))}{quick.frequent.map((p) => quickRow(p, 'repeat', 'Ci andate spesso'))}{quick.saved.map((p) => quickRow(p, p.kind === 'ritrovo' ? 'flag' : 'pin'))}</div>
    const hasQuick = quick.recent.length + quick.frequent.length + quick.saved.length > 0
    const why = !present.length ? 'Scegli almeno una persona.' : !dest ? (recording ? 'Scegli dove siete andati.' : 'Scegli dove andate.') : futureRecord ? 'La data è nel futuro.' : ''
    return (
      <div className="screen">{top}
        <div className="scroll has-cta" key="s0">
          <h1 className="title">{title}</h1>
          <div className="section" style={{ marginTop: 18 }}>
            <div className="section-h"><h2>{recording ? 'Chi c\'era' : redo ? 'Chi viene stavolta' : 'Chi viene'}</h2><span className="caption num">{present.length} di {chipPeople.length}</span></div>
            <div className="chips">{chipPeople.map((m) => (
              <button key={m.id} className="chip" aria-pressed={present.includes(m.id)} onClick={() => togglePresent(m.id)}><Avatar m={m} size={34} />{m.name}</button>
            ))}</div>
          </div>
          <div className="section"><div className="list">{whenRow}</div></div>
          <div className="section">
            <div className="section-h"><h2>{recording ? 'Dove siete andati' : 'Dove andate'}</h2></div>
            {dest ? (
              <div className="list enter"><button className="row" onClick={() => setSheet({ k: 'dest' })}>
                <span className="avatar ic-tile solid"><Icon n="pin" size={21} /></span>
                <span className="grow"><div className="t" style={{ fontWeight: 600 }}>{dest.name}</div>{dest.address && <div className="s">{dest.address}</div>}</span><span className="v link-v">Cambia</span>
              </button>
                <div style={{ height: 150, position: 'relative', isolation: 'isolate' }}><MapView interactive={false} stops={[{ ...dest, label: '', end: true, title: dest.name }]} /></div>
              </div>
            ) : (
              <PlaceSearch onPick={pickDest}>
                {hasQuick ? quickList : <p className="caption" style={{ padding: '6px' }}>Cerca un locale o un indirizzo. Le destinazioni che usate compariranno qui.</p>}
              </PlaceSearch>
            )}
          </div>
        </div>
        <div className="cta col">{why && <p className="cta-hint">{why}</p>}<Btn disabled={!!why} onClick={() => goTo(1)}>Continua</Btn></div>
        {sheet?.k === 'dest' && <Sheet title="Destinazione" onClose={() => setSheet(null)}><PlaceSearch autoFocus onPick={pickDest}>{hasQuick && quickList}</PlaceSearch></Sheet>}
        {exitSheet}
      </div>
    )
  }

  // ============================== Passo 2: chi guida ==============================
  if (step === 1) {
    const cands = presentPeople.filter((m) => !unavailable.includes(m.id))
    const sKm = suggestion && tour?.km[suggestion.id]
    const compare = tour && suggestion && driver && driver !== suggestion.id && tour.km[driver] != null && sKm != null && Math.abs(tour.km[driver] - sKm) > 500
      ? `Con ${byId(suggestion.id)?.name} ${fmtKm(sKm)} · Con ${byId(driver)?.name} ${fmtKm(tour.km[driver])}` : null
    const best = tour && Object.entries(tour.km).sort((a, b) => a[1] - b[1])[0]
    const compareIdle = !compare && tour && suggestion && best && best[0] !== suggestion.id && sKm != null && sKm - best[1] > 1000
      ? `Con ${byId(suggestion.id)?.name} ${fmtKm(sKm)} · Con ${byId(best[0])?.name} ${fmtKm(best[1])}` : null
    const showTourBox = !recording && cands.length > 1
    const why = !driverOk && !undecided ? (recording ? 'Scegli chi ha guidato.' : 'Scegli chi guida, oppure «Da decidere».') : ''
    return (
      <div className="screen">{top}
        <div className="scroll has-cta" key="s1">
          <h1 className="title">{recording ? 'Chi ha guidato?' : 'Chi guida?'}</h1>
          <p className="subtitle">{recording ? (edit ? 'I saldi cambiano quando salvi le modifiche.' : 'Il saldo cambia quando registri il viaggio.') : suggestion ? `${suggestion.reason} Decidete voi.` : 'Nessuno dei presenti può guidare: salvate con «Da decidere».'}</p>
          {showTourBox && <div className="tour-box">
            {!tour ? <Notice kind="info"><Skel w="80%" h={16} /><div style={{ height: 6 }} /><Skel w="45%" h={13} /></Notice>
              : (compare ?? compareIdle) ? <Notice kind="info"><b className="num">{compare ?? compareIdle}</b><br /><span className="dim">Giro delle case{hasReturn ? ', andata e ritorno' : ''}{!tour.real ? ' (stima)' : ''}.</span></Notice>
              : <p className="caption" style={{ margin: '0 6px' }}>Per ognuno, i km del giro delle case{hasReturn ? ' (andata e ritorno)' : ''}{!tour.real ? ', stimati' : ''}.</p>}
          </div>}

          {!recording && presentPeople.length > 1 && <div style={{ marginTop: 14 }}>
            <p className="label">Chi non può guidare questa volta?</p>
            <div className="chips">{presentPeople.map((m) => <button key={m.id} className="chip plain" aria-pressed={unavailable.includes(m.id)} onClick={() => { const on = unavailable.includes(m.id); setUnavailable(on ? unavailable.filter((u) => u !== m.id) : [...unavailable, m.id]); if (!on && driver === m.id) setDriver(null) }}>{m.name}</button>)}</div>
          </div>}
          <div role="radiogroup" aria-label="Conducente" style={{ marginTop: 14 }} onKeyDown={(e) => {
            if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return
            const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]:not([disabled])')]
            const i = items.indexOf(document.activeElement as HTMLButtonElement)
            if (i < 0) return
            e.preventDefault()
            const next = items[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]
            next.focus(); next.click()
          }}>
            {presentPeople.map((m) => {
              const off = unavailable.includes(m.id)
              return (
                <button key={m.id} role="radio" aria-checked={driver === m.id && !undecided} disabled={off} className={`driver${off ? ' off' : ''}`} onClick={() => { setDriver(m.id); setUndecided(false) }}>
                  <Avatar m={m} size={44} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontWeight: 600 }}>{m.name}</span>{suggestion?.id === m.id && <span className="pill accent">Suggerito</span>}</div>
                    <div className="s num">{off ? 'Non disponibile' : <>Saldo <span className={tone(balShown.km[m.id] ?? 0)}>{fmtKmSigned(balShown.km[m.id] ?? 0)}</span>{showTourBox && (noBase(m.id) ? <> · giro: partenza da definire</> : tour?.km[m.id] != null ? <> · giro {fmtKm(tour.km[m.id])}</> : null)}</>}</div>
                  </span>
                  <span className="radio"><Icon n="check" size={15} sw={3} /></span>
                </button>
              )
            })}
            {!recording && <button role="radio" aria-checked={undecided} className="driver" onClick={() => { setUndecided(true); setDriver(null) }}>
              <span className="avatar ic-tile gray" style={{ width: 44, height: 44 }}><Icon n="clock" size={22} /></span>
              <span style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>Da decidere</div><div className="s">Salvate l'uscita e scegliete dopo</div></span>
              <span className="radio"><Icon n="check" size={15} sw={3} /></span>
            </button>}
          </div>


        </div>
        <div className="cta col">{why && <p className="cta-hint">{why}</p>}<Btn disabled={!!why} onClick={() => goTo(2)}>Continua</Btn></div>
        {exitSheet}
      </div>
    )
  }

  // ============================== Passo 3: percorso ==============================
  const rstate = leg ? rt[leg.kind] : undefined
  const toll = leg ? legToll(leg) : null
  const occ = leg ? occupantsBySeg(leg) : []
  const myKm = fx?.km.get(me.id) ?? 0, myEur = fx?.eur.get(me.id) ?? 0
  const routes = leg ? alts[leg.kind] ?? [] : []
  const homes = data.members.filter((m) => usableHome(m) && present.includes(m.id))
  const cur = sheet?.k === 'stop' && leg ? leg.stops[sheet.i] : null
  const driverNoHome = leg?.driverId && !usableHome(byId(leg.driverId)) && !(leg.kind === 'andata' && start)
  const boardIdx = (l: Leg, p: ID) => l.stops.findIndex((s) => s.on.includes(p))
  const changeDest = (p: Named) => { const d = { name: p.name, lat: p.lat, lng: p.lng, address: p.address }; setDest(d); setSheet(null); rebuild({ dest: d }) }
  const pickStart = (p: Named | null) => { setStart(p); setSheet(null); rebuild({ start: p }) }
  const shownKm = fx ? displayRound(Object.fromEntries(fx.km)) : {}

  return (
    <div className="screen">
      <MapView geometry={leg?.geometry} padTop={70} padBottom={Math.min(visible, H * 0.55)}
        stops={(leg?.stops ?? []).map((s, i, a) => ({ ...s, label: String(i + 1), end: i === a.length - 1, title: s.name }))}
        dots={!leg?.stops.length && dest ? homes.map((m) => usableHome(m)!) : []} destDot={!leg?.stops.length ? dest : null} />
      {top}
      <div ref={panel} className="panel glass" style={{ height: panelH, transform: `translateY(${snaps[snap]}px)` }}>
        <div ref={head} onPointerDown={pDown} onPointerMove={pMove} onPointerUp={pUp} onPointerCancel={pUp} style={{ touchAction: 'none', flex: 'none' }}>
          <button className="grab" aria-label="Espandi o riduci il pannello" aria-expanded={snap === snaps.length - 1} onClick={cycle}><i /></button>
          <div style={{ padding: '0 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="panel-title" onClick={() => { if (dragged.current) { dragged.current = false; return } setSheet({ k: 'dest' }) }} aria-label={`Destinazione: ${dest?.name}. Cambia`}><span>{dest?.name}</span><Icon n="down" size={18} /></button>
              {leg?.driverId && <span className="pill"><Avatar m={byId(leg.driverId)} size={18} />{byId(leg.driverId)?.name}</span>}
            </div>
            <div className="stats num" aria-live="polite">
              {!leg?.stops.length ? <span>Percorso calcolato quando scegliete chi guida</span>
                : rstate?.s === 'load' || (leg.routeState === 'missing' && rstate?.s !== 'err') ? <><Skel w={84} h={24} /><Skel w={60} h={14} /><Skel w={90} h={14} /></>
                : leg.routeState === 'missing' ? <span>{leg.actualMeters != null ? <><b>{fmtKm(leg.actualMeters)}</b> inseriti a mano</> : 'Percorso non calcolato'}</span>
                : <><b>{fmtKm(legMeters(leg))}</b>{leg.routeState === 'ok' && leg.actualMeters == null && <span>{fmtDur(legSeconds(leg))}</span>}<span style={toll && (toll.status === 'out' || toll.status === 'verify') ? { color: 'var(--warn)', fontWeight: 600 } : undefined}>{tollText(toll!)}</span></>}
            </div>
          </div>
        </div>

        <div className="panel-body" style={{ height: Math.max(0, visible - headH), paddingBottom: 110 }}>
          {legs.length > 1 && <div style={{ marginBottom: 12 }}><Seg value={tab} onChange={setTab} options={[{ v: 'andata', l: 'Andata' }, { v: 'ritorno', l: 'Ritorno' }]} /></div>}

          {leg && rstate?.s === 'err' && leg.routeState === 'missing' && <div className="mb12"><Notice actions={<>
            <button className="btn small tinted" onClick={() => { failed.current = {}; setTick((t) => t + 1) }}>Riprova</button>
            <button className="btn small gray" onClick={() => { const r = estimateRoute(leg.stops, tolls, false); setLeg(leg.kind, (l) => ({ ...l, segs: r.segs, geometry: r.geometry, routeState: 'stimato' })); setRt((x) => ({ ...x, [leg.kind]: undefined })); setSheet({ k: 'km' }) }}>Inserisci i km a mano</button></>}>
            {rstate.msg}</Notice></div>}
          {leg && leg.routeState === 'stimato' && <div className="mb12"><Notice kind="info" actions={<button className="btn small tinted" onClick={() => setSheet({ k: 'km' })}>{leg.actualMeters == null ? 'Inserisci i km' : 'Correggi i km'}</button>}>
            {leg.actualMeters == null ? 'Distanza stimata in linea d\'aria: non è un percorso reale.' : 'Km inseriti a mano.'}{!recording && leg.actualMeters == null ? ' Potete correggerla alla conferma.' : ''}</Notice></div>}
          {toll && toll.status === 'out' && <div className="mb12"><Notice actions={<button className="btn small tinted" onClick={() => setSheet({ k: 'toll' })}>Inserisci importo</button>}>{toll.note ?? 'Pedaggio fuori copertura'}. {toll.known ? `Noti ${fmtEur(toll.known)}; il resto` : 'L\'importo'} va inserito a mano.</Notice></div>}
          {toll && toll.status === 'verify' && <div className="mb12"><Notice actions={<button className="btn small tinted" onClick={() => setSheet({ k: 'toll' })}>Verifica importo</button>}>{toll.note ?? 'Pedaggio da verificare'}{toll.cents != null ? `: proposti ${fmtEur(toll.cents)}` : ''}.</Notice></div>}
          {leg && driverNoHome && leg.stops.length >= 2 && leg.kind === 'andata' && <div className="mb12"><Notice kind="info" actions={<button className="btn small tinted" onClick={() => setSheet({ k: 'start' })}>Imposta la partenza</button>}>{byId(leg.driverId)?.name} non ha una casa condivisa: il giro parte da «{leg.stops[0].name}».</Notice></div>}

          {routes.length > 1 && leg && <div className="chips mb12">{routes.map((r, i) => {
            const m = r.segs.reduce((a, s) => a + s.meters, 0), sec = r.segs.reduce((a, s) => a + s.seconds, 0)
            const t = legToll({ ...leg, segs: r.segs, actualMeters: null, tollOverride: null })
            const on = leg.geometry?.length === r.geometry.length && leg.segs?.[0]?.meters === r.segs[0].meters
            return <button key={i} className="chip plain num" aria-pressed={on} onClick={() => setLeg(leg.kind, (l) => ({ ...l, segs: r.segs, geometry: r.geometry, actualMeters: null, tollOverride: null, tollGates: null }))}>{fmtKm(m)} · {fmtDur(sec)}{t.status !== 'none' ? ` · ${t.cents != null ? fmtEur(t.cents) : 'pedaggio'}` : ''}</button>
          })}</div>}

          {leg && leg.stops.length > 0 && (
            <div onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              {leg.stops.map((s, i) => {
                const locked = isLocked(leg, i)
                const shift = dragI ? (i === dragI.from ? dragI.dy : dragI.from < target && i > dragI.from && i <= target ? -ROW : dragI.from > target && i < dragI.from && i >= target ? ROW : 0) : 0
                const who = [i === 0 && leg.driverId ? `Parte ${byId(leg.driverId)?.name}` : '', s.on.length ? `Sale ${s.on.map((x) => byId(x)?.name).join(', ')}` : '', s.off.length && i < leg.stops.length - 1 ? `Scende ${s.off.map((x) => byId(x)?.name).join(', ')}` : ''].filter(Boolean).join(' · ')
                return (
                  <div key={s.id} className={`stop${dragI?.from === i ? ' lift' : ''}${dragI ? ' dragging' : ''}`} style={{ transform: shift ? `translateY(${shift}px)` : undefined }}>
                    <span className={`n${i === leg.stops.length - 1 ? ' end' : ''}`}>{i + 1}</span>
                    <button className="main" onClick={() => setSheet({ k: 'stop', i })} aria-label={`Tappa ${i + 1}: ${s.name}. ${who}. Modifica`}>
                      <div className="t stop-t">{s.name}</div>
                      <div className="caption num stop-s">{who || (i < leg.stops.length - 1 && occ[i] ? `${occ[i].length} in auto` : 'Arrivo')}</div>
                    </button>
                    {locked ? <span className="handle" aria-hidden="true"><Icon n="pin" size={18} /></span>
                      : <button className="handle" aria-label={`Trascina per spostare ${s.name}. Con la tastiera usa le frecce`} onPointerDown={onDown(i)} onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); moveStop(i, -1) } if (e.key === 'ArrowDown') { e.preventDefault(); moveStop(i, 1) } }}><Icon n="grip" size={20} /></button>}
                  </div>
                )
              })}
            </div>
          )}
          {leg && leg.driverId && <div style={{ marginTop: 10 }}><Btn small kind="tinted" icon="plus" onClick={() => setSheet({ k: 'add' })}>Aggiungi tappa</Btn></div>}
          {leg && leg.driverId && leg.stops.length < 2 && <div style={{ marginTop: 12 }}><Notice kind="info">{leg.kind === 'andata' ? `Manca la partenza: ${byId(leg.driverId)?.name} non ha una casa condivisa. Aggiungi da dove partite.` : 'Manca l\'arrivo del ritorno: aggiungi dove finisce il giro.'}</Notice></div>}

          {routing && legs.some((l) => l.segs) && <div className="list" style={{ marginTop: 16, padding: '12px 16px' }}><Skel w="45%" h={13} /><div style={{ height: 8 }} /><Skel w="30%" h={18} /><div style={{ height: 8 }} /><Skel w="60%" h={13} /></div>}
          {!routing && fx && legs.some((l) => l.segs) && (
            <button className="list" style={{ width: '100%', marginTop: 16 }} onClick={() => setSheet({ k: 'who' })}>
              <span className="row"><span className="grow"><div className="s">{recording ? 'Variazione del tuo saldo' : 'Il tuo saldo, se va così'}</div>
                <div className="t num"><b className={tone(shownKm[me.id] ?? myKm)}>{fmtKmSigned(shownKm[me.id] ?? myKm)}</b>{myEur !== 0 && <span className={myEur > 0 ? 'pos' : 'neg'}> · {fmtEurSigned(myEur)}</span>}</div>
                <div className="s num">Validi per il saldo {fmtKm(fx.weightedMeters)} · {fx.legs.map((l) => `×${l.mult}`).join(' ')}</div></span><span className="chev"><Icon n="chev" size={18} /></span></span>
            </button>
          )}

          {leg && <>
            <p className="label" style={{ marginTop: 22 }}>{legs.length > 1 ? (tab === 'andata' ? 'Andata' : 'Ritorno') : 'Opzioni'}</p>
            <div className="list">
              {leg.kind === 'andata' ? whenRow
                : <label className="row"><span className="grow t">Orario del ritorno</span><input type="time" className="num field-inline" aria-label="Orario del ritorno" value={leg.time ?? ''} onChange={(e) => setLeg('ritorno', (l) => ({ ...l, time: e.target.value || undefined }))} /></label>}
              {leg.kind === 'andata' && <button className="row" onClick={() => setSheet({ k: 'start' })}><span className="grow t">Partenza</span><span className="v">{start ? start.name : leg.stops.length < 2 ? 'Da scegliere' : usableHome(byId(driver)) ? 'Casa del conducente' : leg.stops[0].name}</span><span className="chev"><Icon n="chev" size={18} /></span></button>}
              {leg.kind === 'andata' && <button className="row" onClick={() => goTo(1)}><span className="grow t">Conducente</span><span className="v">{byId(driver)?.name ?? 'Da decidere'}</span><span className="chev"><Icon n="chev" size={18} /></span></button>}
              {leg.kind === 'ritorno' && <button className="row" onClick={() => setSheet({ k: 'retDriver' })}><span className="grow t">Guida al ritorno</span><span className="v">{byId(leg.driverId)?.name ?? 'Da decidere'}</span><span className="chev"><Icon n="chev" size={18} /></span></button>}
              <div className="row"><div className="grow"><div className="t">Conducente designato</div><div className="s wrap">Km di questa tratta ×2; ×3 se in tutta l'uscita guida meno di 5 km con questa opzione.</div></div><Switch on={leg.designated} label="Conducente designato" onChange={(v) => setLeg(leg.kind, (l) => ({ ...l, designated: v }))} /></div>
              {leg.kind === 'ritorno' && legs[0].stops.length > 1 && leg.driverId === legs[0].driverId && <button className="row" onClick={() => { setStops('ritorno', reverseStops(legs[0].stops)); toast('Ritorno con le tappe dell\'andata al contrario') }}><span className="grow t link-t">Usa le tappe dell'andata al contrario</span></button>}
              {leg.stops.length >= 2 && <button className="row" onClick={() => setSheet({ k: 'km' })}><span className="grow t">Correggi i chilometri</span><span className="chev"><Icon n="chev" size={18} /></span></button>}
              {leg.segs && <button className="row" onClick={() => setSheet({ k: 'toll' })}><span className="grow t">Pedaggio e pagante</span><span className="chev"><Icon n="chev" size={18} /></span></button>}
            </div>
            {tab === 'andata' && <div className="list" style={{ marginTop: 12 }}><div className="row"><div className="grow"><div className="t">Ritorno</div><div className="s wrap">Proposto con le tappe al contrario; lo puoi cambiare.</div></div><Switch on={hasReturn} label="Prevedi il ritorno" onChange={(v) => {
              setHasReturn(v)
              setLegs((ls) => {
                if (!v) { removedReturn.current = ls.find((l) => l.kind === 'ritorno') ?? null; return ls.filter((l) => l.kind === 'andata') }
                const kept = removedReturn.current
                const fits = kept && dest && kept.stops[0] && stopKey(kept.stops[0]) === stopKey(dest)
                const back = fits ? kept! : { ...newLeg('ritorno', ls[0].driverId, reverseStops(ls[0].stops)), designated: ls[0].designated }
                return [...ls.filter((l) => l.kind === 'andata'), back]
              })
              builtSig.current = sigOf(present, driver, dest, v)
            }} /></div></div>}
          </>}
        </div>
      </div>

      <div className="cta col" style={{ zIndex: 40 }}>
        {recording && legs.some((l) => { const t = legToll(l); return (t.status === 'verify' && t.cents == null) || t.status === 'out' }) && <p className="cta-hint warn">Pedaggio senza importo: non sarà conteggiato finché non lo inserisci.</p>}
        {conflict && <p className="cta-hint warn">Qualcun altro ha appena modificato questa uscita. Salvando sostituisci le sue modifiche.</p>}
        <Btn busy={busy} disabled={!canSave} onClick={save}>{edit ? 'Salva modifiche' : recording ? 'Registra viaggio' : 'Salva uscita'}</Btn>
      </div>

      {sheet?.k === 'dest' && <Sheet title="Destinazione" onClose={() => setSheet(null)}><PlaceSearch autoFocus onPick={changeDest}><div className="list">{[...quick.recent.map((p) => [p, 'clock', 'Recente'] as const), ...quick.frequent.map((p) => [p, 'repeat', 'Ci andate spesso'] as const), ...quick.saved.map((p) => [p, 'pin', ''] as const)].map(([p, ic, sub]) => <button className="row" key={stopKey(p)} onClick={() => changeDest(p)}><span className="avatar ic-tile"><Icon n={ic} size={19} /></span><span className="grow"><div className="t">{p.name}</div><div className="s">{[sub, p.address].filter(Boolean).join(' · ')}</div></span></button>)}</div></PlaceSearch><p className="foot">Il giro viene ricalcolato; le tappe aggiunte a mano restano.</p></Sheet>}
      {sheet?.k === 'start' && (
        <Sheet title="Da dove partite" onClose={() => setSheet(null)}>
          <PlaceSearch autoFocus near={dest ?? undefined} onPick={(f) => pickStart({ name: f.name, lat: f.lat, lng: f.lng })}>
            <div className="list">
              {driver && usableHome(byId(driver)) && <button className="row" onClick={() => pickStart(null)}><Avatar m={byId(driver)} /><span className="grow"><div className="t">{homeName(byId(driver)!)}</div><div className="s">Casa del conducente</div></span>{!start && <Icon n="check" />}</button>}
              {data.places.map((p) => <button className="row" key={p.id} onClick={() => pickStart(p)}><span className="avatar ic-tile"><Icon n={p.kind === 'ritrovo' ? 'flag' : 'pin'} size={19} /></span><span className="grow"><div className="t">{p.name}</div><div className="s">{p.address}</div></span>{start && stopKey(start) === stopKey(p) && <Icon n="check" />}</button>)}
            </div>
          </PlaceSearch>
          <p className="foot">Chi non ha una casa condivisa sale alla partenza.</p>
        </Sheet>
      )}
      {sheet?.k === 'stop' && leg && cur && (() => {
        const i = sheet.i, locked = isLocked(leg, i)
        return (
          <Sheet title={cur.name} onClose={() => setSheet(null)}>
            {pax(leg).length > 0 && <>
              <p className="label">Sale qui</p>
              <div className="chips">{pax(leg).map((p) => {
                const b = boardIdx(leg, p), offAt = leg.stops.findIndex((s) => s.off.includes(p))
                const impossible = i === leg.stops.length - 1 || (offAt >= 0 && offAt <= i && b !== i)
                return <button key={p} className="chip" disabled={impossible} aria-pressed={cur.on.includes(p)} onClick={() => setStops(leg.kind, leg.stops.map((s, j) => (j === i ? { ...s, on: s.on.includes(p) ? s.on.filter((x) => x !== p) : [...s.on, p] } : { ...s, on: s.on.filter((x) => x !== p) })))}><Avatar m={byId(p)} size={34} />{byId(p)?.name}</button>
              })}</div>
              <p className="label" style={{ marginTop: 16 }}>Scende qui</p>
              <div className="chips">{pax(leg).map((p) => {
                const b = boardIdx(leg, p)
                const impossible = i === 0 || b < 0 || b >= i
                return <button key={p} className="chip" disabled={impossible} aria-pressed={cur.off.includes(p)} onClick={() => setStops(leg.kind, leg.stops.map((s, j) => (j === i ? { ...s, off: s.off.includes(p) ? s.off.filter((x) => x !== p) : [...s.off, p] } : { ...s, off: s.off.filter((x) => x !== p) })))}><Avatar m={byId(p)} size={34} />{byId(p)?.name}</button>
              })}</div>
              <p className="foot">Si scende solo dopo essere saliti. Chi non sale in nessuna tappa non partecipa a questa tratta.</p>
            </>}
            {locked ? <p className="foot" style={{ marginTop: 14 }}>{stopKey(cur) === (dest && stopKey(dest)) ? 'È la destinazione: per cambiarla tocca il nome in alto nel pannello.' : leg.kind === 'andata' ? 'È la partenza: per cambiarla usa «Partenza» nelle opzioni.' : 'È l\'arrivo del conducente: resta l\'ultima tappa.'}</p> : (
              <div className="list" style={{ marginTop: 18 }}>
                <button className="row" disabled={i <= lo} onClick={() => { moveStop(i, -1); setSheet({ k: 'stop', i: i - 1 }) }}><Icon n="up" /><span className="grow t">Sposta prima</span></button>
                <button className="row" disabled={i >= hi} onClick={() => { moveStop(i, 1); setSheet({ k: 'stop', i: i + 1 }) }}><Icon n="down" /><span className="grow t">Sposta dopo</span></button>
                <button className="row danger-row" disabled={leg.stops.length <= 2} onClick={() => { removeStop(i); setSheet(null) }}><Icon n="trash" /><span className="grow t">Rimuovi tappa</span></button>
              </div>
            )}
          </Sheet>
        )
      })()}
      {sheet?.k === 'add' && leg && (
        <Sheet title="Aggiungi tappa" onClose={() => setSheet(null)}>
          <PlaceSearch autoFocus near={dest ?? undefined} onPick={(f: Found) => addStop(f)}>
            <div className="list">
              {homes.filter((m) => !leg.stops.some((s) => s.homeOf === m.id)).map((m) => <button className="row" key={m.id} onClick={() => addStop({ ...usableHome(m)!, name: homeName(m) }, m.id)}><Avatar m={m} /><span className="grow"><div className="t">{homeName(m)}</div><div className="s">{usableHome(m)!.label}</div></span></button>)}
              {data.places.map((p) => <button className="row" key={p.id} onClick={() => addStop(p)}><span className="avatar ic-tile"><Icon n={p.kind === 'ritrovo' ? 'flag' : 'pin'} size={19} /></span><span className="grow"><div className="t">{p.name}</div><div className="s">{p.address}</div></span></button>)}
            </div>
          </PlaceSearch>
          <p className="foot">{leg.kind === 'andata' ? 'La tappa viene inserita prima dell\'arrivo' : 'La tappa viene inserita dopo la partenza'}{leg.stops.length < 2 ? (leg.kind === 'andata' ? ' (o come partenza, se manca)' : ' (o come arrivo, se manca)') : ''}. Poi la puoi spostare.</p>
        </Sheet>
      )}
      {sheet?.k === 'retDriver' && (
        <Sheet title="Chi guida al ritorno" onClose={() => setSheet(null)}>
          <div role="radiogroup">{presentPeople.map((m) => {
            const off = unavailable.includes(m.id)
            return (
              <button key={m.id} role="radio" disabled={off} aria-checked={legs[1]?.driverId === m.id} className={`driver${off ? ' off' : ''}`} onClick={() => {
                setLeg('ritorno', (l) => {
                  const stops = m.id === legs[0].driverId ? reverseStops(legs[0].stops) : withExtras('ritorno', buildStops('ritorno', data.members, present, m.id, dest!), extraStops(l.stops))
                  return { ...newLeg('ritorno', m.id, stops), designated: l.designated, time: l.time }
                }); setSheet(null)
              }}><Avatar m={m} size={40} /><span style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{m.name}</div><div className="s num">{off ? 'Non disponibile' : <>Saldo <span className={tone(balShown.km[m.id] ?? 0)}>{fmtKmSigned(balShown.km[m.id] ?? 0)}</span></>}</div></span><span className="radio"><Icon n="check" size={15} sw={3} /></span></button>
            )
          })}</div>
          <p className="foot">Con un conducente diverso il ritorno finisce a casa sua; la soglia dei 5 km vale per ciascuno.</p>
        </Sheet>
      )}
      {sheet?.k === 'km' && <KmSheet trip={draft()} byId={byId} onClose={() => setSheet(null)} onSave={(l) => { setLegs(withEstimates(l)); setSheet(null) }} />}
      {sheet?.k === 'toll' && <TollSheet trip={draft()} people={presentPeople} groupTolls={tolls} meId={me.id} onClose={() => setSheet(null)} onSave={(l, remember: Record<string, GroupToll>) => {
        setLegs(l); setSheet(null)
        if (Object.keys(remember).length) store.updateGroup(data.group.id, { settings: { ...data.group.settings, tolls: { ...(tolls ?? {}), ...remember } } }).then(() => { app.reload(); toast('Tariffa ricordata per il gruppo') }).catch(() => toast('Tariffa non salvata: riprova dal riepilogo'))
      }} />}
      {sheet?.k === 'who' && (
        <Sheet title={recording ? 'Variazione dei saldi' : edit ? 'Partecipanti e saldi' : 'Anteprima dei saldi'} onClose={() => setSheet(null)}>
          {edit && <><p className="label">Chi c'era</p><div className="chips" style={{ marginBottom: 18 }}>{chipPeople.map((m) => <button key={m.id} className="chip" aria-pressed={present.includes(m.id)} disabled={legs.some((l) => l.driverId === m.id)} onClick={() => {
            const on = present.includes(m.id), next = on ? present.filter((p) => p !== m.id) : [...present, m.id]
            setPresent(next)
            if (dest && driver) { setLegs(buildLegs({ dest, present: next, driver, start, hasReturn, prev: legs })); failed.current = {}; setAlts({}) }
            else setLegs((ls) => ls.map((l) => ({ ...l, stops: normalize(sanitizeStops(l.stops, l.driverId, next)) })))
            builtSig.current = sigOf(next)
          }}><Avatar m={m} size={34} />{m.name}</button>)}</div></>}
          {edit && <p className="foot" style={{ marginTop: -10, marginBottom: 14 }}>Il giro delle case viene ricalcolato. Chi guida non si può togliere: cambia prima il conducente.</p>}
          {fx && <div className="list">{presentPeople.map((m) => <div className="row" key={m.id}><Avatar m={m} /><span className="grow t">{m.name}</span><span className="num" style={{ textAlign: 'right' }}><div className={tone(shownKm[m.id] ?? 0)} style={{ fontWeight: 600 }}>{fmtKmSigned(shownKm[m.id] ?? 0)}</div>{(fx.eur.get(m.id) ?? 0) !== 0 && <div className="s">{fmtEurSigned(fx.eur.get(m.id) ?? 0)}</div>}</span></div>)}</div>}
          <p className="foot">{recording ? 'Al conducente i km validi; ogni occupante, conducente compreso, ne paga una quota uguale per i tratti percorsi.' : 'È una previsione: i saldi cambiano solo alla conferma del viaggio.'}</p>
        </Sheet>
      )}
      {exitSheet}
      {done && <Done trip={done} fx={tripEffect(done)} meId={me.id} onClose={home} />}
    </div>
  )

  function addStop(p: Named, homeOf?: ID) {
    if (!leg) return
    const s: Stop = { id: uid(), name: p.name, lat: p.lat, lng: p.lng, on: homeOf && homeOf !== leg.driverId && leg.kind === 'andata' ? [homeOf] : [], off: homeOf && homeOf !== leg.driverId && leg.kind === 'ritorno' ? [homeOf] : [], homeOf }
    const stops = leg.stops.map((x) => ({ ...x }))
    const at = stops.length < 2 ? (leg.kind === 'andata' ? 0 : stops.length) : leg.kind === 'andata' ? stops.length - 1 : 1
    const near = [stops[at - 1], stops[at]].filter(Boolean)
    if (near.some((x) => haversine(x, s) < 60)) { toast('Questa tappa c\'è già.'); return }
    if (stops.length < 2) {
      // manca la partenza (andata) o l'arrivo (ritorno): la nuova tappa lo diventa
      if (leg.kind === 'andata') s.on = [...new Set([...s.on, ...pax(leg)])]
      else s.off = [...new Set([...s.off, ...pax(leg)])]
    }
    stops.splice(at, 0, s)
    if (homeOf && leg.kind === 'andata') stops.forEach((x) => { if (x.id !== s.id) x.on = x.on.filter((y) => y !== homeOf) })
    if (homeOf && leg.kind === 'ritorno') stops.forEach((x) => { if (x.id !== s.id) x.off = x.off.filter((y) => y !== homeOf) })
    setStops(leg.kind, stops)
    setSheet(null)
  }
}
