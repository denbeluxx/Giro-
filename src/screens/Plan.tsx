import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../app'
import { legMeters, legSeconds, legToll, occupantsBySeg, suggestDriver, tripEffect } from '../lib/calc'
import { fmtDur, fmtEurSigned, fmtKm, fmtKmSigned, localInput } from '../lib/format'
import { buildStops, homeName, newLeg, reverseStops, sanitizeStops, stopKey } from '../lib/plan'
import { estimateRoute, matrix, routeStops, type Found, type Route } from '../lib/routing'
import { store } from '../lib/store'
import { uid, type GroupToll, type ID, type Leg, type Member, type Pt, type Stop, type Trip } from '../lib/types'
import { Avatar, Btn, Icon, Notice, Seg, Sheet, Skel, Switch, useBusy, useToast } from '../ui/kit'
import { MapView } from '../ui/MapView'
import { PlaceSearch } from '../ui/PlaceSearch'
import { KmSheet, TollSheet, tollLabel } from './editors'
import { tone } from './Home'
import { Done } from './TripView'

type Named = Pt & { name: string; address?: string }
const ROW = 60

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

export function Plan({ mode, edit, redo }: { mode: 'plan' | 'record'; edit?: Trip; redo?: Trip }) {
  const app = useApp()
  const { data, bal, me, active, byId, pop, replace, home, saveTrip } = app
  const toast = useToast()
  const src = edit ?? redo
  const activeIds = active.map((m) => m.id)
  const tolls = data.group.settings.tolls

  const startStep = edit ? (edit.legs.some((l) => l.stops.length < 2) ? 1 : 2) : 0
  const [step, setStep] = useState(startStep)
  const [present, setPresent] = useState<ID[]>(src ? src.presentIds.filter((p) => activeIds.includes(p)) : activeIds)
  const [unavailable, setUnavailable] = useState<ID[]>(edit?.unavailableIds ?? [])
  const [dest, setDest] = useState<Named | null>(src ? src.dest : null)
  const [when, setWhen] = useState(() => { if (edit) return edit.startsAt; const d = new Date(); if (mode === 'plan') d.setHours(21, 30, 0, 0); return d.toISOString() })
  const [driver, setDriver] = useState<ID | null>(edit?.legs[0]?.driverId ?? null)
  const [undecided, setUndecided] = useState(!!edit && !edit.legs[0]?.driverId)
  const [hasReturn, setHasReturn] = useState(src ? src.legs.length > 1 : true)
  const [legs, setLegs] = useState<Leg[]>(edit?.legs ?? [])
  const [tab, setTab] = useState<Leg['kind']>('andata')
  const [rt, setRt] = useState<Record<string, 'load' | 'err' | undefined>>({})
  const [alts, setAlts] = useState<Record<string, Route[]>>({})
  const [tour, setTour] = useState<{ km: Record<ID, number>; real: boolean } | null>(null)
  const [sheet, setSheet] = useState<null | { k: 'dest' } | { k: 'stop'; i: number } | { k: 'add' } | { k: 'retDriver' } | { k: 'km' } | { k: 'toll' } | { k: 'who' }>(null)
  const [done, setDone] = useState<Trip | null>(null)
  const [tick, setTick] = useState(0)
  const [busy, run] = useBusy()
  const tripId = useRef(edit?.id ?? uid())
  const builtSig = useRef(edit && startStep === 2 ? sigOf() : '')
  const inflight = useRef<Record<string, string>>({})
  const failed = useRef<Record<string, string>>({})

  function sigOf() { return JSON.stringify([[...present].sort(), driver, dest && stopKey(dest), hasReturn]) }

  // ---- Destinazioni recenti e frequenti ----
  const quick = useMemo(() => {
    const seen = new Map<string, { p: Named; n: number; last: string }>()
    for (const t of data.trips) { if (t.status === 'cancelled') continue; const k = t.dest.name; const e = seen.get(k); if (e) { e.n++; if (t.startsAt > e.last) e.last = t.startsAt } else seen.set(k, { p: t.dest, n: 1, last: t.startsAt }) }
    const all = [...seen.values()]
    const recent = [...all].sort((a, b) => (a.last > b.last ? -1 : 1)).slice(0, 3).map((x) => x.p)
    const frequent = [...all].filter((x) => x.n > 1 && !recent.some((r) => r.name === x.p.name)).sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.p)
    const saved = data.places.filter((p) => !recent.some((r) => r.name === p.name) && !frequent.some((r) => r.name === p.name))
    return { recent, frequent, saved }
  }, [data.trips, data.places])

  // ---- Suggerimento e confronto del giro ----
  const suggestion = useMemo(() => suggestDriver(active, present, unavailable, bal, fmtKmSigned), [active, present, unavailable, bal])
  useEffect(() => {
    if (step !== 1 || !dest) return
    let off = false
    const cands = present.filter((p) => !unavailable.includes(p))
    const tours = cands.map((id) => ({ id, stops: buildStops('andata', active, present, id, dest) }))
    const pts = new Map<string, Pt>()
    tours.forEach((t) => t.stops.forEach((s) => pts.set(stopKey(s), s)))
    const keys = [...pts.keys()]
    matrix([...pts.values()]).then(({ m, real }) => {
      if (off) return
      const km: Record<ID, number> = {}
      for (const t of tours) { let d = 0; for (let i = 0; i < t.stops.length - 1; i++) d += m[keys.indexOf(stopKey(t.stops[i]))][keys.indexOf(stopKey(t.stops[i + 1]))] ?? 0; km[t.id] = d * (hasReturn ? 2 : 1) }
      setTour({ km, real })
    })
    return () => { off = true }
  }, [step, present.join(), unavailable.join(), dest, hasReturn]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Costruzione delle tratte quando cambiano presenti, conducente o destinazione ----
  function rebuild() {
    if (!dest) return
    const prev = (k: Leg['kind']) => legs.find((l) => l.kind === k) ?? src?.legs.find((l) => l.kind === k)
    const same = redo && driver === redo.legs[0]?.driverId && [...present].sort().join() === [...redo.presentIds].sort().join()
    const goStops = !driver ? [] : same ? redo!.legs[0].stops.map((s) => ({ ...s, id: uid() })) : buildStops('andata', active, present, driver, dest)
    const hhmm = mode === 'plan' ? new Date(when).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : undefined
    const go = { ...newLeg('andata', driver, goStops), designated: prev('andata')?.designated ?? false, time: prev('andata')?.time ?? hhmm }
    const next = [go]
    if (hasReturn) {
      const backStops = !driver ? [] : same && redo!.legs[1] ? redo!.legs[1].stops.map((s) => ({ ...s, id: uid() })) : reverseStops(goStops)
      next.push({ ...newLeg('ritorno', driver, backStops), designated: prev('ritorno')?.designated ?? go.designated, time: prev('ritorno')?.time })
    }
    failed.current = {}
    setAlts({})
    setLegs(next)
    builtSig.current = sigOf()
  }
  const goTo = (n: number) => { if (n === 2 && builtSig.current !== sigOf()) rebuild(); setStep(n); if (n === 2) setTab('andata') }

  // ---- Calcolo dei percorsi ----
  useEffect(() => {
    if (step !== 2) return
    for (const leg of legs) {
      if (leg.stops.length < 2 || leg.routeState !== 'missing') continue
      const sig = legSig(leg), key = leg.kind
      if (inflight.current[key] === sig || failed.current[key] === sig) continue
      inflight.current[key] = sig
      setRt((r) => ({ ...r, [key]: 'load' }))
      routeStops(leg.stops, tolls)
        .then((routes) => {
          if (!routes.length) throw new Error('vuoto')
          setAlts((a) => ({ ...a, [key]: routes }))
          setLegs((ls) => ls.map((l) => (l.kind === key && legSig(l) === sig ? { ...l, segs: routes[0].segs, geometry: routes[0].geometry, routeState: 'ok', actualMeters: null, tollOverride: null } : l)))
          setRt((r) => ({ ...r, [key]: undefined }))
        })
        .catch(() => { failed.current[key] = sig; setRt((r) => ({ ...r, [key]: 'err' })) })
        .finally(() => { if (inflight.current[key] === sig) delete inflight.current[key] })
    }
  }, [legs, step, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const leg = legs.find((l) => l.kind === tab) ?? legs[0]
  const setLeg = (kind: Leg['kind'], fn: (l: Leg) => Leg) => setLegs((ls) => ls.map((l) => (l.kind === kind ? fn(l) : l)))
  const setStops = (kind: Leg['kind'], stops: Stop[]) => setLeg(kind, (l) => {
    const n = normalize(stops)
    const moved = n.map(stopKey).join('>') !== legSig(l)
    return moved ? { ...l, stops: n, segs: null, geometry: null, routeState: 'missing', actualMeters: null, tollOverride: null } : { ...l, stops: n }
  })
  const pax = (l: Leg) => present.filter((p) => p !== l.driverId)

  const draft = (): Trip => ({
    id: tripId.current, groupId: data.group.id, status: edit?.status ?? 'planned', version: edit?.version ?? 1, startsAt: when,
    dest: dest!, presentIds: present, unavailableIds: unavailable, legs, createdBy: edit?.createdBy ?? me.id, updatedBy: me.id, updatedAt: new Date().toISOString(), confirmedAt: edit?.confirmedAt ?? null,
  })
  const fx = dest && legs.length ? tripEffect(draft()) : null
  const routing = legs.some((l) => rt[l.kind] === 'load')
  const needKm = legs.some((l) => l.stops.length >= 2 && (l.routeState === 'missing' || (l.routeState === 'stimato' && l.actualMeters == null)))
  const recording = mode === 'record' && edit?.status !== 'planned'
  const canSave = !!dest && !routing && (recording ? !!driver && legs.every((l) => l.driverId && l.stops.length >= 2) && !needKm : true)

  const save = () => run(async () => {
    const t = draft()
    t.legs = t.legs.map((l) => { if (l.segs || l.stops.length < 2) return l; const r = estimateRoute(l.stops, tolls, false); return { ...l, segs: r.segs, geometry: r.geometry, routeState: 'stimato' as const } })
    if (recording && !edit) { t.status = 'confirmed'; t.confirmedAt = new Date().toISOString() }
    const saved = await saveTrip(t, edit ? edit.version : null)
    if (!saved) return
    if (edit) { toast('Modifiche salvate'); pop() }
    else if (recording) setDone(saved)
    else replace({ s: 'trip', id: saved.id, fresh: true })
  })

  // ---- Trascinamento delle tappe ----
  const [dragI, setDragI] = useState<{ from: number; dy: number } | null>(null)
  const dragStart = useRef(0)
  const onDown = (i: number) => (e: React.PointerEvent) => { dragStart.current = e.clientY; setDragI({ from: i, dy: 0 }); (e.currentTarget as Element).setPointerCapture(e.pointerId) }
  const onMove = (e: React.PointerEvent) => { if (dragI) setDragI({ ...dragI, dy: e.clientY - dragStart.current }) }
  const target = dragI && leg ? Math.max(0, Math.min(leg.stops.length - 1, dragI.from + Math.round(dragI.dy / ROW))) : 0
  const onUp = () => {
    if (!dragI || !leg) return
    if (target !== dragI.from) { const s = [...leg.stops]; const [x] = s.splice(dragI.from, 1); s.splice(target, 0, x); setStops(leg.kind, s) }
    setDragI(null)
  }
  const moveStop = (i: number, d: number) => { if (!leg) return; const j = i + d; if (j < 0 || j >= leg.stops.length) return; const s = [...leg.stops]; [s[i], s[j]] = [s[j], s[i]]; setStops(leg.kind, s) }

  // ---- Pannello inferiore ----
  const [snap, setSnap] = useState<0 | 1 | 2>(1)
  const [H, setH] = useState(typeof window !== 'undefined' ? window.innerHeight : 800)
  const panel = useRef<HTMLDivElement>(null)
  const pd = useRef<{ y: number; base: number; dy: number } | null>(null)
  useEffect(() => { const f = () => setH(window.innerHeight); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  const panelH = Math.round(H * 0.86)
  const offsets = [panelH - 236, Math.round(panelH - H * 0.5), 0]
  const pDown = (e: React.PointerEvent) => { pd.current = { y: e.clientY, base: offsets[snap], dy: 0 }; (e.currentTarget as Element).setPointerCapture(e.pointerId) }
  const pMove = (e: React.PointerEvent) => {
    if (!pd.current || !panel.current) return
    pd.current.dy = e.clientY - pd.current.y
    panel.current.classList.add('dragging')
    panel.current.style.transform = `translateY(${Math.max(0, Math.min(offsets[0], pd.current.base + pd.current.dy))}px)`
  }
  const pUp = () => {
    if (!pd.current || !panel.current) return
    const y = pd.current.base + pd.current.dy, moved = Math.abs(pd.current.dy) > 6
    pd.current = null
    panel.current.classList.remove('dragging')
    const next = moved ? (offsets.reduce((b, o, i) => (Math.abs(o - y) < Math.abs(offsets[b] - y) ? i : b), 0) as 0 | 1 | 2) : (((snap + 1) % 3) as 0 | 1 | 2)
    panel.current.style.transform = `translateY(${offsets[next]}px)`
    setSnap(next)
  }

  const title = edit ? 'Modifica' : mode === 'record' ? 'Registra viaggio' : 'Organizza uscita'
  const top = (
    <div className={step === 2 ? 'float-top glass' : 'nav'}>
      <button className="nav-btn" onClick={() => (step === startStep ? pop() : goTo(step - 1))} aria-label={step === startStep ? 'Chiudi' : 'Indietro'}><Icon n={step === startStep ? 'x' : 'back'} /></button>
      <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step + 1} aria-label={`Passo ${step + 1} di 3`}>{[0, 1, 2].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
      {edit && step === 2 ? <button className="nav-btn" onClick={() => setSheet({ k: 'who' })} aria-label="Partecipanti"><Icon n="users" /></button> : <span style={{ width: 44 }} />}
    </div>
  )

  // ============================== Passo 1: chi e dove ==============================
  if (step === 0) {
    const pickDest = (p: Named) => { setDest({ name: p.name, lat: p.lat, lng: p.lng, address: p.address }); setSheet(null) }
    const quickRow = (p: Named, icon: string, sub?: string) => (
      <button className="row" key={`${icon}-${p.name}`} onClick={() => pickDest(p)}>
        <span className="avatar" style={{ width: 36, height: 36, background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon n={icon} size={19} /></span>
        <span className="grow"><div className="t">{p.name}</div>{(sub ?? p.address) && <div className="s">{sub ?? p.address}</div>}</span>
      </button>
    )
    return (
      <div className="screen">{top}
        <div className="scroll has-cta">
          <h1 className="title">{title}</h1>
          <div className="section" style={{ marginTop: 18 }}>
            <div className="section-h"><h2>{redo ? 'Chi viene stavolta' : 'Chi viene'}</h2><span className="caption num">{present.length} di {active.length}</span></div>
            <div className="chips">{active.map((m) => (
              <button key={m.id} className="chip" aria-pressed={present.includes(m.id)} onClick={() => setPresent(present.includes(m.id) ? present.filter((p) => p !== m.id) : [...present, m.id])}><Avatar m={m} size={34} />{m.name}</button>
            ))}</div>
          </div>

          <div className="section">
            <div className="section-h"><h2>Dove andate</h2></div>
            {dest ? (
              <div className="list enter"><button className="row" onClick={() => setSheet({ k: 'dest' })}>
                <span className="avatar" style={{ width: 40, height: 40, background: 'var(--accent)', color: '#fff' }}><Icon n="pin" size={21} /></span>
                <span className="grow"><div className="t" style={{ fontWeight: 600 }}>{dest.name}</div>{dest.address && <div className="s">{dest.address}</div>}</span><span className="v" style={{ color: 'var(--accent)' }}>Cambia</span>
              </button>
                <div style={{ height: 150, position: 'relative', isolation: 'isolate' }}><MapView interactive={false} stops={[{ ...dest, label: '', end: true, title: dest.name }]} /></div>
              </div>
            ) : (
              <PlaceSearch onPick={pickDest}>
                {(quick.recent.length > 0 || quick.frequent.length > 0 || quick.saved.length > 0) ? <div className="list">
                  {quick.recent.map((p) => quickRow(p, 'clock', 'Recente'))}
                  {quick.frequent.map((p) => quickRow(p, 'repeat', 'Ci andate spesso'))}
                  {quick.saved.map((p) => quickRow(p, p.kind === 'ritrovo' ? 'flag' : 'pin'))}
                </div> : <p className="caption" style={{ padding: '6px' }}>Cerca un locale o un indirizzo. Le destinazioni che usate compariranno qui.</p>}
              </PlaceSearch>
            )}
          </div>

          <div className="section"><div className="list">
            <label className="row"><span className="grow t">{mode === 'record' ? 'Quando è stato' : 'Quando'}</span>
              <input type="datetime-local" className="num" aria-label="Data e ora" value={localInput(when)} onChange={(e) => e.target.value && setWhen(new Date(e.target.value).toISOString())} style={{ border: 0, background: 'var(--fill)', borderRadius: 10, minHeight: 40, padding: '0 10px', fontSize: 15, maxWidth: 210 }} /></label>
          </div></div>
        </div>
        <div className="cta"><Btn disabled={!dest || present.length < 1} onClick={() => goTo(1)}>Continua</Btn></div>
        {sheet?.k === 'dest' && <Sheet title="Destinazione" onClose={() => setSheet(null)}><PlaceSearch autoFocus onPick={pickDest}><div className="list">{[...quick.recent, ...quick.frequent, ...quick.saved].map((p) => quickRow(p, 'pin'))}</div></PlaceSearch></Sheet>}
      </div>
    )
  }

  // ============================== Passo 2: chi guida ==============================
  if (step === 1) {
    const people = present.map((p) => byId(p)).filter(Boolean) as Member[]
    const sKm = suggestion && tour?.km[suggestion.id]
    const compare = tour && suggestion && driver && driver !== suggestion.id && tour.km[driver] != null && sKm != null && Math.abs(tour.km[driver] - sKm) > 500
      ? `Con ${byId(suggestion.id)?.name} ${fmtKm(sKm)} · Con ${byId(driver)?.name} ${fmtKm(tour.km[driver])}` : null
    const best = tour && Object.entries(tour.km).sort((a, b) => a[1] - b[1])[0]
    const compareIdle = !compare && tour && suggestion && best && best[0] !== suggestion.id && sKm != null && sKm - best[1] > 1000
      ? `Con ${byId(suggestion.id)?.name} ${fmtKm(sKm)} · Con ${byId(best[0])?.name} ${fmtKm(best[1])}` : null
    return (
      <div className="screen">{top}
        <div className="scroll has-cta">
          <h1 className="title">{mode === 'record' ? 'Chi ha guidato?' : 'Chi guida?'}</h1>
          <p className="subtitle">{suggestion ? suggestion.reason : 'Nessuno dei presenti è disponibile a guidare.'} Decidete voi.</p>
          {(compare ?? compareIdle) && <div className="enter" style={{ marginTop: 12 }}><Notice kind="info"><b className="num">{compare ?? compareIdle}</b><br /><span className="dim">Giro delle case{hasReturn ? ', andata e ritorno' : ''}{tour && !tour.real ? ' (stima)' : ''}.</span></Notice></div>}

          <div role="radiogroup" aria-label="Conducente" style={{ marginTop: 18 }}>
            {people.map((m) => {
              const off = unavailable.includes(m.id)
              return (
                <button key={m.id} role="radio" aria-checked={driver === m.id && !undecided} disabled={off} className={`driver${off ? ' off' : ''}`} onClick={() => { setDriver(m.id); setUndecided(false) }}>
                  <Avatar m={m} size={44} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontWeight: 600 }}>{m.name}</span>{suggestion?.id === m.id && <span className="pill accent">Suggerito</span>}</div>
                    <div className="s num" style={{ fontSize: 14, color: 'var(--text2)' }}>{off ? 'Non disponibile stasera' : <>Saldo <span className={tone(bal.km[m.id] ?? 0)}>{fmtKmSigned(bal.km[m.id] ?? 0)}</span>{tour?.km[m.id] != null && <> · giro {fmtKm(tour.km[m.id])}</>}</>}</div>
                  </span>
                  <span className="radio"><Icon n="check" size={15} sw={3} /></span>
                </button>
              )
            })}
            {mode !== 'record' && <button role="radio" aria-checked={undecided} className="driver" onClick={() => { setUndecided(true); setDriver(null) }}>
              <span className="avatar" style={{ width: 44, height: 44, background: 'var(--fill)', color: 'var(--text2)' }}><Icon n="clock" size={22} /></span>
              <span style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>Conducente da decidere</div><div className="s" style={{ fontSize: 14, color: 'var(--text2)' }}>Salvate l'uscita e scegliete dopo</div></span>
              <span className="radio"><Icon n="check" size={15} sw={3} /></span>
            </button>}
          </div>

          <div className="section">
            <p className="label">Chi non può guidare stasera?</p>
            <div className="chips">{people.map((m) => <button key={m.id} className="chip plain" aria-pressed={unavailable.includes(m.id)} onClick={() => { const on = unavailable.includes(m.id); setUnavailable(on ? unavailable.filter((u) => u !== m.id) : [...unavailable, m.id]); if (!on && driver === m.id) setDriver(null) }}>{m.name}</button>)}</div>
          </div>
        </div>
        <div className="cta"><Btn disabled={!driver && !undecided} onClick={() => goTo(2)}>Continua</Btn></div>
      </div>
    )
  }

  // ============================== Passo 3: percorso ==============================
  const state = leg ? rt[leg.kind] : undefined
  const toll = leg ? legToll(leg) : null
  const tl = toll ? tollLabel(toll) : null
  const visible = panelH - offsets[snap]
  const occ = leg ? occupantsBySeg(leg) : []
  const myKm = fx?.km.get(me.id) ?? 0, myEur = fx?.eur.get(me.id) ?? 0
  const routes = leg ? alts[leg.kind] ?? [] : []
  const homes = active.filter((m) => m.home && present.includes(m.id))
  const cur = sheet?.k === 'stop' && leg ? leg.stops[sheet.i] : null

  return (
    <div className="screen">
      <MapView geometry={leg?.geometry} padTop={70} padBottom={Math.min(visible, H * 0.55)}
        stops={(leg?.stops ?? []).map((s, i, a) => ({ ...s, label: String(i + 1), end: i === a.length - 1, title: s.name }))}
        dots={!leg?.stops.length && dest ? [dest, ...homes.map((m) => m.home!)] : []} />
      {top}
      <div ref={panel} className="panel glass" style={{ height: panelH, transform: `translateY(${offsets[snap]}px)` }}>
        <div onPointerDown={pDown} onPointerMove={pMove} onPointerUp={pUp} onPointerCancel={pUp} style={{ touchAction: 'none', flex: 'none' }}>
          <button className="grab" aria-label="Espandi o riduci il pannello"><i /></button>
          <div style={{ padding: '0 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dest?.name}</h2>
              {leg?.driverId && <span className="pill"><Avatar m={byId(leg.driverId)} size={18} />{byId(leg.driverId)?.name}</span>}
            </div>
            <div className="stats num" aria-live="polite">
              {!leg?.stops.length ? <span>Percorso calcolato quando scegliete chi guida</span>
                : state === 'load' || (leg.routeState === 'missing' && state !== 'err') ? <><Skel w={84} h={26} /><Skel w={60} h={16} /><Skel w={90} h={16} /></>
                : leg.routeState === 'missing' ? <span>Percorso non calcolato</span>
                : <><b>{fmtKm(legMeters(leg))}</b>{leg.routeState === 'ok' && <span>{fmtDur(legSeconds(leg))}</span>}<span className={tl?.pill ? '' : undefined} style={tl?.pill ? { color: 'var(--warn)', fontWeight: 600 } : undefined}>{toll?.status === 'none' ? 'Nessun pedaggio' : `Pedaggio ${tl!.text}`}</span></>}
            </div>
          </div>
        </div>

        <div className="panel-body" style={{ paddingBottom: 110 }}>
          {legs.length > 1 && <div style={{ marginBottom: 12 }}><Seg value={tab} onChange={setTab} options={[{ v: 'andata', l: 'Andata' }, { v: 'ritorno', l: 'Ritorno' }]} /></div>}

          {leg && state === 'err' && leg.routeState === 'missing' && <div style={{ marginBottom: 12 }}><Notice actions={<>
            <button className="btn small tinted" onClick={() => { failed.current = {}; setTick((t) => t + 1) }}>Riprova</button>
            <button className="btn small gray" onClick={() => { const r = estimateRoute(leg.stops, tolls, false); setLeg(leg.kind, (l) => ({ ...l, segs: r.segs, geometry: r.geometry, routeState: 'stimato' })); setRt((x) => ({ ...x, [leg.kind]: undefined })) }}>Inserisco i km a mano</button></>}>
            Il servizio dei percorsi non risponde. Tappe e scelte restano salvate.</Notice></div>}
          {leg && leg.routeState === 'stimato' && <div style={{ marginBottom: 12 }}><Notice kind="info" actions={<button className="btn small tinted" onClick={() => setSheet({ k: 'km' })}>{leg.actualMeters == null ? 'Inserisci i km' : 'Correggi i km'}</button>}>
            {leg.actualMeters == null ? 'Distanza stimata in linea d\'aria: non è un percorso reale.' : 'Km inseriti a mano.'}{mode === 'plan' && leg.actualMeters == null ? ' Potete correggerla alla conferma.' : ''}</Notice></div>}
          {toll && toll.status === 'out' && <div style={{ marginBottom: 12 }}><Notice actions={<button className="btn small tinted" onClick={() => setSheet({ k: 'toll' })}>Inserisci importo</button>}>{toll.note}. L'importo non viene compilato in automatico.</Notice></div>}
          {toll && toll.status === 'verify' && <div style={{ marginBottom: 12 }}><Notice actions={<button className="btn small tinted" onClick={() => setSheet({ k: 'toll' })}>Verifica importo</button>}>Pedaggio A4 da verificare{toll.cents != null ? `: ${tl!.text.replace(' · da verificare', '')} è una tariffa indicativa` : ''}.</Notice></div>}

          {routes.length > 1 && leg && <div className="chips" style={{ marginBottom: 12 }}>{routes.map((r, i) => { const m = r.segs.reduce((a, s) => a + s.meters, 0); const on = leg.geometry?.length === r.geometry.length && leg.segs?.[0]?.meters === r.segs[0].meters
            return <button key={i} className="chip plain num" aria-pressed={on} onClick={() => setLeg(leg.kind, (l) => ({ ...l, segs: r.segs, geometry: r.geometry, actualMeters: null, tollOverride: null }))}>Percorso {i + 1} · {fmtKm(m)}</button> })}</div>}

          {leg && leg.stops.length > 0 && (
            <div onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              {leg.stops.map((s, i) => {
                const shift = dragI ? (i === dragI.from ? dragI.dy : dragI.from < target && i > dragI.from && i <= target ? -ROW : dragI.from > target && i < dragI.from && i >= target ? ROW : 0) : 0
                const who = [s.on.length ? `Sale ${s.on.map((x) => byId(x)?.name).join(', ')}` : '', s.off.length && i < leg.stops.length - 1 ? `Scende ${s.off.map((x) => byId(x)?.name).join(', ')}` : '', i === 0 && leg.driverId ? `Parte ${byId(leg.driverId)?.name}` : ''].filter(Boolean).join(' · ')
                return (
                  <div key={s.id} className={`stop${dragI?.from === i ? ' lift' : ''}`} style={{ transform: shift ? `translateY(${shift}px)` : undefined, transition: dragI?.from === i ? 'box-shadow .2s' : undefined }}>
                    <span className={`n${i === leg.stops.length - 1 ? ' end' : ''}`}>{i + 1}</span>
                    <button className="main" onClick={() => setSheet({ k: 'stop', i })} aria-label={`Tappa ${i + 1}: ${s.name}. ${who}. Modifica`}>
                      <div className="t" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>{s.name}</div>
                      <div className="caption num" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{who || (i < leg.stops.length - 1 && occ[i] ? `${occ[i].length} in auto` : 'Arrivo')}</div>
                    </button>
                    <button className="handle" aria-label={`Trascina per spostare ${s.name}`} onPointerDown={onDown(i)}><Icon n="grip" size={20} /></button>
                  </div>
                )
              })}
            </div>
          )}
          {leg && leg.driverId && <div style={{ marginTop: 10 }}><Btn small kind="tinted" icon="plus" onClick={() => setSheet({ k: 'add' })}>Aggiungi tappa</Btn></div>}
          {leg && leg.driverId && leg.stops.length < 2 && <div style={{ marginTop: 12 }}><Notice kind="info">Manca la partenza: {byId(leg.driverId)?.name} non ha una casa disponibile. Aggiungi una tappa di partenza.</Notice></div>}

          {fx && legs.some((l) => l.segs) && (
            <button className="list" style={{ width: '100%', marginTop: 16 }} onClick={() => setSheet({ k: 'who' })}>
              <span className="row"><span className="grow"><div className="s">{recording ? 'Variazione del tuo saldo' : 'Anteprima del tuo saldo, se va così'}</div>
                <div className="t num"><b className={tone(myKm)}>{fmtKmSigned(myKm)}</b>{myEur !== 0 && <span className={myEur > 0 ? 'pos' : 'neg'}> · {fmtEurSigned(myEur)}</span>}</div></span><span className="chev"><Icon n="chev" size={18} /></span></span>
            </button>
          )}

          {leg && <>
            <p className="label" style={{ marginTop: 22 }}>Opzioni {legs.length > 1 ? (tab === 'andata' ? 'dell\'andata' : 'del ritorno') : ''}</p>
            <div className="list">
              <div className="row"><div className="grow"><div className="t">Conducente designato</div><div className="s wrap">I km di questa tratta valgono doppio (triplo sotto i 5 km).</div></div><Switch on={leg.designated} label="Conducente designato" onChange={(v) => setLeg(leg.kind, (l) => ({ ...l, designated: v }))} /></div>
              <label className="row"><span className="grow t">Orario di partenza</span><input type="time" className="num" aria-label="Orario di partenza" value={leg.time ?? ''} onChange={(e) => setLeg(leg.kind, (l) => ({ ...l, time: e.target.value || undefined }))} style={{ border: 0, background: 'var(--fill)', borderRadius: 10, minHeight: 40, padding: '0 10px', fontSize: 16 }} /></label>
              {leg.kind === 'ritorno' && <button className="row" onClick={() => setSheet({ k: 'retDriver' })}><span className="grow t">Guida al ritorno</span><span className="v">{byId(leg.driverId)?.name ?? 'Da decidere'}</span><span className="chev"><Icon n="chev" size={18} /></span></button>}
              {leg.kind === 'ritorno' && legs[0].stops.length > 1 && leg.driverId === legs[0].driverId && <button className="row" onClick={() => setStops('ritorno', reverseStops(legs[0].stops))}><span className="grow t" style={{ color: 'var(--accent)' }}>Usa le tappe dell'andata al contrario</span></button>}
              {(leg.segs || leg.stops.length >= 2) && <button className="row" onClick={() => setSheet({ k: 'km' })}><span className="grow t">Correggi i chilometri</span><span className="chev"><Icon n="chev" size={18} /></span></button>}
              {leg.segs && <button className="row" onClick={() => setSheet({ k: 'toll' })}><span className="grow t">Pedaggio e pagante</span><span className="chev"><Icon n="chev" size={18} /></span></button>}
            </div>
            {tab === 'andata' && !edit && <div className="list" style={{ marginTop: 12 }}><div className="row"><div className="grow"><div className="t">Ritorno</div><div className="s wrap">Stesse tappe al contrario; lo puoi cambiare.</div></div><Switch on={hasReturn} label="Prevedi il ritorno" onChange={(v) => {
              setHasReturn(v)
              setLegs((ls) => v ? [...ls.filter((l) => l.kind === 'andata'), { ...newLeg('ritorno', ls[0].driverId, reverseStops(ls[0].stops)), designated: ls[0].designated }] : ls.filter((l) => l.kind === 'andata'))
              builtSig.current = JSON.stringify([[...present].sort(), driver, dest && stopKey(dest), v])
            }} /></div></div>}
          </>}
        </div>
      </div>

      <div className="cta" style={{ zIndex: 40 }}>
        <Btn busy={busy} disabled={!canSave} onClick={save}>{edit ? 'Salva modifiche' : recording ? 'Registra viaggio' : 'Salva uscita'}</Btn>
      </div>

      {sheet?.k === 'stop' && leg && cur && (
        <Sheet title={cur.name} onClose={() => setSheet(null)}>
          {pax(leg).length > 0 && <>
            <p className="label">Sale qui</p>
            <div className="chips">{pax(leg).map((p) => <button key={p} className="chip" aria-pressed={cur.on.includes(p)} onClick={() => setStops(leg.kind, leg.stops.map((s, j) => (j === sheet.i ? { ...s, on: s.on.includes(p) ? s.on.filter((x) => x !== p) : [...s.on, p] } : { ...s, on: s.on.filter((x) => x !== p) })))}><Avatar m={byId(p)} size={34} />{byId(p)?.name}</button>)}</div>
            <p className="label" style={{ marginTop: 16 }}>Scende qui</p>
            <div className="chips">{pax(leg).map((p) => <button key={p} className="chip" aria-pressed={cur.off.includes(p)} onClick={() => setStops(leg.kind, leg.stops.map((s, j) => (j === sheet.i ? { ...s, off: s.off.includes(p) ? s.off.filter((x) => x !== p) : [...s.off, p] } : { ...s, off: s.off.filter((x) => x !== p) })))}><Avatar m={byId(p)} size={34} />{byId(p)?.name}</button>)}</div>
            <p className="foot">Chi non sale in nessuna tappa non partecipa a questa tratta.</p>
          </>}
          <div className="list" style={{ marginTop: 18 }}>
            <button className="row" disabled={sheet.i === 0} onClick={() => { moveStop(sheet.i, -1); setSheet({ k: 'stop', i: sheet.i - 1 }) }} style={{ opacity: sheet.i === 0 ? 0.35 : 1 }}><Icon n="up" /><span className="grow t">Sposta prima</span></button>
            <button className="row" disabled={sheet.i === leg.stops.length - 1} onClick={() => { moveStop(sheet.i, 1); setSheet({ k: 'stop', i: sheet.i + 1 }) }} style={{ opacity: sheet.i === leg.stops.length - 1 ? 0.35 : 1 }}><Icon n="down" /><span className="grow t">Sposta dopo</span></button>
            <button className="row" disabled={leg.stops.length <= 2} onClick={() => { setStops(leg.kind, leg.stops.filter((_, j) => j !== sheet.i)); setSheet(null) }} style={{ color: 'var(--danger)', opacity: leg.stops.length <= 2 ? 0.35 : 1 }}><Icon n="trash" /><span className="grow t">Rimuovi tappa</span></button>
          </div>
        </Sheet>
      )}
      {sheet?.k === 'add' && leg && (
        <Sheet title="Aggiungi tappa" onClose={() => setSheet(null)}>
          <PlaceSearch autoFocus near={dest ?? undefined} onPick={(f: Found) => addStop(f)}>
            <div className="list">
              {homes.filter((m) => !leg.stops.some((s) => s.homeOf === m.id)).map((m) => <button className="row" key={m.id} onClick={() => addStop({ ...m.home!, name: homeName(m) }, m.id)}><Avatar m={m} /><span className="grow"><div className="t">{homeName(m)}</div><div className="s">{m.home!.label}</div></span></button>)}
              {data.places.map((p) => <button className="row" key={p.id} onClick={() => addStop(p)}><span className="avatar" style={{ width: 36, height: 36, background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon n={p.kind === 'ritrovo' ? 'flag' : 'pin'} size={19} /></span><span className="grow"><div className="t">{p.name}</div><div className="s">{p.address}</div></span></button>)}
            </div>
          </PlaceSearch>
          <p className="foot">La tappa viene inserita prima dell'arrivo{leg.stops.length < 2 ? ' (o come partenza, se manca)' : ''}. Poi la puoi trascinare.</p>
        </Sheet>
      )}
      {sheet?.k === 'retDriver' && (
        <Sheet title="Chi guida al ritorno" onClose={() => setSheet(null)}>
          <div role="radiogroup">{(present.map((p) => byId(p)).filter(Boolean) as Member[]).map((m) => (
            <button key={m.id} role="radio" aria-checked={legs[1]?.driverId === m.id} className="driver" onClick={() => {
              setLeg('ritorno', (l) => ({ ...newLeg('ritorno', m.id, m.id === legs[0].driverId ? reverseStops(legs[0].stops) : buildStops('ritorno', active, present, m.id, dest!)), designated: l.designated, time: l.time })); setSheet(null)
            }}><Avatar m={m} size={40} /><span style={{ flex: 1, fontWeight: 500 }}>{m.name}</span><span className="radio"><Icon n="check" size={15} sw={3} /></span></button>
          ))}</div>
          <p className="foot">Con un conducente diverso il ritorno termina a casa sua, e i calcoli valgono per ciascuno.</p>
        </Sheet>
      )}
      {sheet?.k === 'km' && <KmSheet trip={draft()} byId={byId} onClose={() => setSheet(null)} onSave={(l) => { setLegs(l); setSheet(null) }} />}
      {sheet?.k === 'toll' && <TollSheet trip={draft()} people={present.map((p) => byId(p)).filter(Boolean) as Member[]} groupTolls={tolls} meId={me.id} onClose={() => setSheet(null)} onSave={(l, remember: Record<string, GroupToll>) => {
        setLegs(l); setSheet(null)
        if (Object.keys(remember).length) store.updateGroup(data.group.id, { settings: { ...data.group.settings, tolls: { ...(tolls ?? {}), ...remember } } }).then(() => { app.reload(); toast('Tariffa ricordata per il gruppo') }).catch(() => toast('Tariffa non salvata: riprova dalla conferma'))
      }} />}
      {sheet?.k === 'who' && (
        <Sheet title={edit ? 'Partecipanti e saldi' : 'Anteprima dei saldi'} onClose={() => setSheet(null)}>
          {edit && <><p className="label">Chi c'era</p><div className="chips" style={{ marginBottom: 18 }}>{active.map((m) => <button key={m.id} className="chip" aria-pressed={present.includes(m.id)} disabled={legs.some((l) => l.driverId === m.id)} onClick={() => {
            const on = present.includes(m.id), next = on ? present.filter((p) => p !== m.id) : [...present, m.id]
            setPresent(next)
            setLegs((ls) => ls.map((l) => ({ ...l, stops: normalize(on ? sanitizeStops(l.stops, l.driverId, next) : l.stops.map((s, i) => (i === 0 ? { ...s, on: [...s.on, m.id] } : s))) })))
            builtSig.current = JSON.stringify([[...next].sort(), driver, dest && stopKey(dest), hasReturn])
          }}><Avatar m={m} size={34} />{m.name}</button>)}</div></>}
          {fx && <div className="list">{(present.map((p) => byId(p)).filter(Boolean) as Member[]).map((m) => <div className="row" key={m.id}><Avatar m={m} /><span className="grow t">{m.name}</span><span className="num" style={{ textAlign: 'right' }}><div className={tone(fx.km.get(m.id) ?? 0)} style={{ fontWeight: 600 }}>{fmtKmSigned(fx.km.get(m.id) ?? 0)}</div>{(fx.eur.get(m.id) ?? 0) !== 0 && <div className="s">{fmtEurSigned(fx.eur.get(m.id) ?? 0)}</div>}</span></div>)}</div>}
          <p className="foot">{recording ? 'Ogni occupante paga una quota uguale dei tratti percorsi.' : 'È una previsione: i saldi cambiano solo alla conferma del viaggio.'}</p>
        </Sheet>
      )}
      {done && fx && <Done trip={done} fx={tripEffect(done)} meId={me.id} onClose={home} />}
    </div>
  )

  function addStop(p: Named, homeOf?: ID) {
    if (!leg) return
    const s: Stop = { id: uid(), name: p.name, lat: p.lat, lng: p.lng, on: homeOf && homeOf !== leg.driverId && leg.kind === 'andata' ? [homeOf] : [], off: homeOf && homeOf !== leg.driverId && leg.kind === 'ritorno' ? [homeOf] : [], homeOf }
    const stops = leg.stops.map((x) => ({ ...x }))
    if (stops.length < 2) {
      // manca la partenza (andata) o l'arrivo (ritorno): la nuova tappa lo diventa
      if (leg.kind === 'andata') { s.on = pax(leg); stops.unshift(s) } else { s.off = pax(leg); stops.push(s) }
    } else stops.splice(stops.length - 1, 0, s)
    if (homeOf && leg.kind === 'andata') stops.forEach((x) => { if (x.id !== s.id) x.on = x.on.filter((y) => y !== homeOf) })
    if (homeOf && leg.kind === 'ritorno') stops.forEach((x) => { if (x.id !== s.id) x.off = x.off.filter((y) => y !== homeOf) })
    setStops(leg.kind, stops)
    setSheet(null)
  }
}
