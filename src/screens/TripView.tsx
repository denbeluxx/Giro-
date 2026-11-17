import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../app'
import { displayRound, legToll, tripEffect, type TripEffect } from '../lib/calc'
import { fmtDate, fmtDateLong, fmtEur, fmtEurSigned, fmtKm, fmtKmSigned, fmtTime } from '../lib/format'
import { shareText, whatsappUrl } from '../lib/share'
import { store } from '../lib/store'
import { gateName, refreshTolls } from '../lib/tolls'
import type { GroupToll, ID, Leg, Member, Trip } from '../lib/types'
import { Avatar, Btn, Empty, Icon, Notice, Sheet, useBusy, useToast, ledHex } from '../ui/kit'
import { MapView } from '../ui/MapView'
import { KmSheet, TollSheet } from './editors'
import { tone } from './Home'
import { StatusPill } from './Others'

/** Vicino alla soglia dei 5 km con conducente designato mostriamo i metri, così ×3 e ×2 non sembrano contraddirsi. */
function fmtKmFine(m: number, t: Trip): string {
  const flagged = t.legs.some((l) => l.designated)
  return flagged && m > 4900 && m < 5100 && Math.round(m) !== 5000 ? `${(Math.round(m) / 1000).toFixed(3).replace('.', ',')}\u00a0km` : fmtKm(m)
}

/** Le uscite per cui il foglio di condivisione si è già aperto da solo. */
const sharedOnce = new Set<ID>()

export function ShareSheet({ trip, members, onClose }: { trip: Trip; members: Member[]; onClose: () => void }) {
  const toast = useToast()
  const text = shareText(trip, members)
  return (
    <Sheet title="Condividi il piano" onClose={onClose} footer={<>
      <a className="btn primary" style={{ textDecoration: 'none' }} href={whatsappUrl(text)} target="_blank" rel="noreferrer" onClick={onClose}><span className="btn-l"><Icon n="wa" size={21} />Apri WhatsApp</span></a>
      <div style={{ height: 8 }} /><Btn kind="gray" onClick={async () => { try { await navigator.clipboard.writeText(text); toast('Testo copiato') } catch { toast('Copia non riuscita: seleziona il testo a mano') } }}>Copia testo</Btn></>}>
      <div className="list share-text">{text}</div>
    </Sheet>
  )
}

export function Done({ trip, fx, meId, onClose }: { trip: Trip; fx: TripEffect; meId: ID; onClose: () => void }) {
  const km = displayRound(Object.fromEntries(fx.km))[meId] ?? 0, eur = fx.eur.get(meId) ?? 0
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'Tab') { e.preventDefault(); (document.querySelector('.done .btn') as HTMLElement | null)?.focus() } }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="done glass" role="alertdialog" aria-modal="true" aria-labelledby="done-t">
      <svg width="96" height="96" viewBox="0 0 96 96" fill="none" stroke="var(--pos)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="48" cy="48" r="40" transform="rotate(-90 48 48)" /><path d="M31 49.5l11.5 11.5L66 37" /></svg>
      <h2 id="done-t" className="pop" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 8 }}>Viaggio registrato</h2>
      <p className="pop dim num">{trip.dest.name} · {fmtKm(fx.realMeters)}</p>
      <div className="pop card" style={{ padding: '14px 22px', marginTop: 10 }}>
        <div className="caption">Variazione del tuo saldo</div>
        <div className={`num ${tone(km)}`} style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em' }}>{fmtKmSigned(km)}</div>
        {eur !== 0 && <div className={`num ${eur > 0 ? 'pos' : 'neg'}`} style={{ fontSize: 16 }}>{fmtEurSigned(eur)} di pedaggi</div>}
      </div>
      <div className="pop" style={{ width: '100%', maxWidth: 320, marginTop: 18 }}><Btn onClick={onClose} autoFocus>Fine</Btn></div>
    </div>
  )
}

export function TripView({ id, fresh }: { id: ID; fresh?: boolean }) {
  const app = useApp()
  const { data, byId, me, pop, push, home, saveTrip, onBack, forward } = app
  const stored = data.trips.find((t) => t.id === id)
  const toast = useToast()
  const [sheet, setSheet] = useState<null | 'km' | 'toll' | 'share' | 'cancel' | 'detail'>(() => (fresh && !sharedOnce.has(id) ? (sharedOnce.add(id), 'share') : null))
  const [tab, setTab] = useState(0)
  const [done, setDone] = useState<TripEffect | null>(null)
  const [busy, run] = useBusy()
  const tolls = data.group.settings.tolls
  // per le uscite in programma usiamo le tariffe confermate dal gruppo anche dopo il salvataggio
  const trip = useMemo(() => (stored && stored.status === 'planned' ? { ...stored, legs: refreshTolls(stored.legs, tolls) } : stored), [stored, tolls])
  // tasto Indietro: chiude prima il foglio aperto; dopo una conferma torna in home
  const live$ = useRef({ sheet, done: !!done })
  live$.current = { sheet, done: !!done }
  useEffect(() => onBack(() => {
    if (live$.current.done) { forward(); home(); return true }
    if (live$.current.sheet) { setSheet(null); forward(); return true }
    return false
  }), [onBack, forward, home])
  // annullato da un altro dispositivo mentre si correggeva: si chiude il foglio invece di salvare
  useEffect(() => {
    if (stored?.status === 'cancelled' && (sheet === 'km' || sheet === 'toll')) { setSheet(null); toast('Questo viaggio è stato appena annullato da un altro dispositivo.') }
  }, [stored?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!trip) return <div className="screen"><div className="nav"><button className="nav-btn" onClick={pop}><Icon n="back" />Indietro</button></div><div className="scroll"><Empty icon="alert" title="Uscita non trovata" text="Potrebbe appartenere a un altro gruppo o essere stata rimossa." /></div></div>

  const fx = tripEffect(trip)
  const shown = displayRound(Object.fromEntries(fx.km))
  const present = trip.presentIds.map((p) => byId(p)).filter(Boolean) as Member[]
  const editable = trip.status !== 'cancelled'
  const drivers = trip.legs.map((l) => byId(l.driverId))
  const sameDriver = drivers.every((d) => d?.id === drivers[0]?.id)
  const missingDriver = trip.legs.some((l) => !l.driverId)
  const noStops = trip.legs.some((l) => l.stops.length < 2)
  const missingRoute = trip.legs.some((l) => l.actualMeters == null && (!l.segs || l.routeState !== 'ok'))
  const past = trip.startsAt < new Date().toISOString()
  const leg = trip.legs[Math.min(tab, trip.legs.length - 1)]
  const myKm = shown[me.id] ?? 0, myEur = fx.eur.get(me.id) ?? 0
  const tolls$ = trip.legs.map((l) => legToll(l))
  const tollTotal = tolls$.reduce((a, t) => a + (t.status === 'out' ? t.known : t.cents ?? 0), 0)
  const worst = tolls$.find((t) => t.status === 'out') ?? tolls$.find((t) => t.status === 'verify')
  const unpriced = tolls$.some((t) => (t.status === 'verify' && t.cents == null) || t.status === 'out')
  const payers = [...new Set(fx.legs.filter((l) => (l.toll.cents ?? l.toll.known) > 0).map((l) => byId(l.payerId)?.name))].filter(Boolean).join(' e ')
  const unknown = missingDriver || noStops
  const editAt = (at: 0 | 1 | 2) => push({ s: 'plan', mode: trip.status === 'planned' ? 'plan' : 'record', edit: trip, at })

  const patch = (legs: Leg[], extra: Partial<Trip> = {}) => run(async () => {
    const next = { ...trip, ...extra, legs }
    if (JSON.stringify([next.legs, next.status]) === JSON.stringify([trip.legs, trip.status]) && !Object.keys(extra).length) { setSheet(null); return } // niente da salvare
    const saved = await saveTrip({ ...next, updatedBy: me.id, updatedAt: new Date().toISOString() }, trip.version)
    if (saved) setSheet(null)
  })
  const confirm = () => run(async () => {
    const next: Trip = { ...trip, status: 'confirmed', confirmedAt: new Date().toISOString(), updatedBy: me.id, updatedAt: new Date().toISOString() }
    const saved = await saveTrip(next, trip.version)
    if (saved) { setDone(tripEffect(saved)); toast(`Viaggio a ${trip.dest.name} confermato`) }
  })
  const saveTolls = (legs: Leg[], remember: Record<string, GroupToll>) => run(async () => {
    for (const [k, v] of Object.entries(remember)) await store.setGroupToll(data.group.id, k, v)
    const saved = await saveTrip({ ...trip, legs, updatedBy: me.id, updatedAt: new Date().toISOString() }, trip.version)
    if (saved) { setSheet(null); if (Object.keys(remember).length) { await app.reload(); toast('Tariffa ricordata per il gruppo') } }
  })

  const Row = ({ label, value, sub, onClick, pill }: { label: string; value: React.ReactNode; sub?: React.ReactNode; onClick?: () => void; pill?: React.ReactNode }) => {
    const inner = <><span className="grow"><div className="s" style={{ fontSize: 13 }}>{label}</div><div className="t" style={{ whiteSpace: 'normal', fontWeight: 500 }}>{value}</div>{sub && <div className="s wrap num">{sub}</div>}</span>{pill}{onClick && editable && <span className="chev"><Icon n="chev" size={18} /></span>}</>
    return onClick && editable ? <button className="row" onClick={onClick}>{inner}</button> : <div className="row">{inner}</div>
  }
  const name = (x: ID) => byId(x)?.name ?? '?'

  return (
    <div className="screen">
      <div className="nav"><button className="nav-btn" onClick={pop}><Icon n="back" />Indietro</button><span className="spacer" />
        {editable && <button className="nav-btn" onClick={() => setSheet('share')} aria-label="Condividi"><Icon n="share" /></button>}</div>
      <div className="scroll has-cta">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}><StatusPill t={trip} /></div>
        <h1 className="title">{trip.dest.name}</h1>
        <p className="subtitle">{fmtDateLong(trip.startsAt).replace(/^./, (c) => c.toUpperCase())} · {fmtTime(trip.startsAt)}{trip.legs[1]?.time ? ` · ritorno ${trip.legs[1].time}` : ''}</p>

        <div className="map-static card" style={{ marginTop: 16 }}>
          <MapView interactive={false} color={leg?.driverId ? ledHex(byId(leg.driverId)) : undefined} geometry={leg?.geometry} stops={(leg?.stops ?? []).map((s, i, a) => ({ ...s, label: String(i + 1), end: i === a.length - 1, title: s.name }))} destDot={leg?.stops.length ? null : trip.dest} padBottom={8} padTop={56} />
          {trip.legs.length > 1 && <div className="seg glass map-seg" role="group">{trip.legs.map((l, i) => <button key={l.kind} aria-pressed={tab === i} onClick={() => setTab(i)}>{l.kind === 'andata' ? 'Andata' : 'Ritorno'}</button>)}</div>}
        </div>

        {trip.status === 'planned' && missingDriver && <div style={{ marginTop: 12 }}><Notice kind="info">Conducente ancora da decidere. Potete condividere il piano e sceglierlo dopo.</Notice></div>}

        <div className="section">
          <div className="list">
            <Row label={sameDriver ? 'Conducente' : 'Conducenti'} onClick={() => editAt(1)}
              value={!drivers.some(Boolean) ? 'Da decidere' : sameDriver ? drivers[0]?.name : trip.legs.map((l, i) => `${l.kind === 'andata' ? 'Andata' : 'Ritorno'} ${drivers[i]?.name ?? 'da decidere'}`).join(' · ')} />
            <Row label="Partecipanti, data e destinazione" onClick={() => editAt(0)}
              value={<span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="stack">{present.map((m) => <Avatar key={m.id} m={m} size={28} />)}</span><span className="dim" style={{ fontSize: 15 }}>{present.length} in auto</span></span>} />
            <Row label={trip.status === 'planned' && !past ? 'Km previsti' : 'Km effettivi'} onClick={unknown ? () => editAt(missingDriver ? 1 : 2) : () => setSheet('km')} value={<span className="num">{unknown ? '—' : fmtKmFine(fx.realMeters, trip)}</span>}
              sub={!unknown && trip.legs.length > 1 ? fx.legs.map((l) => `${l.kind} ${fmtKm(l.realMeters)}`).join(' · ') : unknown ? (missingDriver ? 'Si calcolano quando scegliete chi guida' : 'Manca la partenza: impostala nel percorso') : undefined}
              pill={!unknown && trip.legs.some((l) => l.routeState === 'stimato' && l.actualMeters == null) ? <span className="pill warn">Stima</span> : undefined} />
            {!unknown && <Row label="Validi per il saldo" onClick={() => setSheet('km')} value={<span className="num">{fmtKm(fx.weightedMeters)}</span>}
              sub={fx.legs.map((l) => `×${l.mult}${fx.legs.length > 1 ? ` ${l.kind}` : ''}`).join(' · ') + (trip.legs.some((l) => l.designated) ? ' · conducente designato' : '')} />}
            <Row label="Pedaggio" onClick={unknown ? undefined : () => setSheet('toll')}
              value={<span className="num">{unknown ? '—' : worst?.status === 'out' && !tollTotal ? 'Fuori copertura' : worst?.status === 'verify' && !tollTotal ? 'Da verificare' : tollTotal ? `${fmtEur(tollTotal)}${unpriced ? ' + da inserire' : ''}` : 'Nessun pedaggio'}</span>}
              sub={unknown ? undefined : [tolls$.filter((t) => t.from).map((t) => `${gateName(t.from)} → ${gateName(t.to)}`).join(' · '), payers && `paga ${payers}`, !tollTotal && worst?.note].filter(Boolean).join(' · ') || undefined}
              pill={!unknown && worst ? <span className="pill warn">{worst.status === 'out' ? 'A mano' : 'Verifica'}</span> : undefined} />
            {!unknown && <Row label={trip.status === 'confirmed' ? 'Variazione del tuo saldo' : 'Il tuo saldo, se va così'} onClick={() => setSheet('detail')}
              value={<span className="num"><b className={tone(myKm)}>{fmtKmSigned(myKm)}</b>{myEur !== 0 && <span className={myEur > 0 ? 'pos' : 'neg'}> · {fmtEurSigned(myEur)}</span>}</span>} sub="Tocca per vedere gli altri" />}
          </div>
          <p className="foot">{trip.status === 'planned' ? 'I saldi cambiano solo quando confermate il viaggio. ' : ''}Ultima modifica: {byId(trip.updatedBy)?.name ?? '—'}, {fmtDate(trip.updatedAt)} alle {fmtTime(trip.updatedAt)}.</p>
        </div>

        {trip.legs.some((l) => l.stops.length) && <div className="section">
          <div className="section-h"><h2>Tappe</h2>{editable && <button className="link" onClick={() => editAt(2)}>Modifica</button>}</div>
          {trip.legs.map((l) => l.stops.length > 0 && (
            <div key={l.kind} style={{ marginBottom: 12 }}>
              {trip.legs.length > 1 && <p className="label">{l.kind === 'andata' ? 'Andata' : 'Ritorno'}{l.time ? ` · ${l.time}` : ''}{l.driverId ? ` · guida ${name(l.driverId)}` : ''}</p>}
              <div className="list">{l.stops.map((s, i) => (
                <div className="row" key={s.id}><span className={`stop-n${i === l.stops.length - 1 ? ' end' : ''}`}>{i + 1}</span><span className="grow"><div className="t">{s.name}</div>
                  <div className="s wrap">{[i === 0 && l.driverId ? `Parte ${name(l.driverId)}` : '', s.on.length ? `Sale ${s.on.map(name).join(', ')}` : '', s.off.length && i < l.stops.length - 1 ? `Scende ${s.off.map(name).join(', ')}` : '', i === l.stops.length - 1 ? 'Arrivo' : ''].filter(Boolean).join(' · ')}</div></span></div>
              ))}</div>
            </div>
          ))}
        </div>}

        <div className="section"><div className="list">
          <button className="row" onClick={() => push({ s: 'plan', mode: 'plan', redo: trip })}><span className="row-ic"><Icon n="repeat" /></span><span className="grow t">Rifai questa uscita</span><span className="chev"><Icon n="chev" size={18} /></span></button>
          {editable ? <button className="row" onClick={() => setSheet('cancel')}><span className="row-ic danger"><Icon n="trash" /></span><span className="grow t danger-t">{trip.status === 'confirmed' ? 'Annulla viaggio' : 'Annulla uscita'}</span></button>
            : <button className="row" onClick={() => run(async () => { const s = await saveTrip({ ...trip, status: trip.confirmedAt ? 'confirmed' : 'planned', updatedBy: me.id, updatedAt: new Date().toISOString() }, trip.version); if (s) toast(s.status === 'confirmed' ? 'Viaggio ripristinato: torna nei saldi' : 'Uscita ripristinata') })}><span className="row-ic"><Icon n="history" /></span><span className="grow t">Ripristina</span></button>}
        </div></div>
      </div>

      {trip.status === 'planned' && (
        <div className="cta col">
          {missingDriver ? <Btn onClick={() => editAt(1)}>Scegli chi guida</Btn>
            : noStops ? <Btn onClick={() => editAt(2)}>Imposta la partenza</Btn>
            : !past ? <><p className="cta-hint">Potrete confermare il viaggio dopo la partenza.</p><Btn icon="wa" onClick={() => setSheet('share')}>Condividi il piano</Btn></>
            : missingRoute ? <Btn onClick={() => setSheet('km')}>Inserisci i km</Btn>
            : <>{unpriced && <p className="cta-hint warn">Pedaggio senza importo: non sarà conteggiato finché non lo inserisci.</p>}<Btn busy={busy} icon="check" className="led-warn" onClick={confirm}>Conferma viaggio</Btn></>}
        </div>
      )}

      {sheet === 'share' && <ShareSheet trip={trip} members={data.members} onClose={() => setSheet(null)} />}
      {sheet === 'km' && <KmSheet trip={trip} byId={byId} onClose={() => setSheet(null)} onSave={(legs) => patch(legs)} />}
      {sheet === 'toll' && <TollSheet trip={trip} people={present} groupTolls={tolls} meId={me.id} onClose={() => setSheet(null)} onSave={saveTolls} />}
      {sheet === 'detail' && <Sheet title="Variazione dei saldi" onClose={() => setSheet(null)}>
        <div className="list">{present.map((m) => <div className="row" key={m.id}><Avatar m={m} /><span className="grow t">{m.name}</span><span className="num" style={{ textAlign: 'right' }}><div className={tone(shown[m.id] ?? 0)} style={{ fontWeight: 600 }}>{fmtKmSigned(shown[m.id] ?? 0)}</div>{(fx.eur.get(m.id) ?? 0) !== 0 && <div className="s">{fmtEurSigned(fx.eur.get(m.id) ?? 0)}</div>}</span></div>)}</div>
        <p className="foot">Al conducente vanno i km validi; ogni occupante, conducente compreso, ne paga una quota uguale per i tratti percorsi.</p></Sheet>}
      {sheet === 'cancel' && <Sheet title={trip.status === 'confirmed' ? 'Annullare il viaggio?' : 'Annullare l\'uscita?'} onClose={() => setSheet(null)} footer={<><Btn busy={busy} className="btn-danger" onClick={() => patch(trip.legs, { status: 'cancelled' })}>Annulla {trip.status === 'confirmed' ? 'viaggio' : 'uscita'}</Btn><div style={{ height: 8 }} /><Btn kind="gray" onClick={() => setSheet(null)}>Non annullare</Btn></>}>
        <p style={{ margin: '0 4px', lineHeight: 1.4 }}>{trip.status === 'confirmed' ? 'Chilometri e pedaggi di questo viaggio vengono tolti dai saldi di tutti. Resta nello storico e si può ripristinare.' : 'L\'uscita resta nello storico come annullata. I saldi non cambiano.'}</p></Sheet>}
      {done && <Done trip={trip} fx={done} meId={me.id} onClose={home} />}
    </div>
  )
}
