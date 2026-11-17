import { useState } from 'react'
import { useApp } from '../app'
import { legToll, tripEffect, type TripEffect } from '../lib/calc'
import { fmtDate, fmtDateLong, fmtEur, fmtEurSigned, fmtKm, fmtKmSigned, fmtTime } from '../lib/format'
import { shareText, whatsappUrl } from '../lib/share'
import { store } from '../lib/store'
import { gateName } from '../lib/tolls'
import type { GroupToll, ID, Leg, Member, Trip } from '../lib/types'
import { Avatar, Btn, Empty, Icon, Notice, Sheet, useBusy, useToast } from '../ui/kit'
import { MapView } from '../ui/MapView'
import { DriverSheet, KmSheet, TollSheet, tollLabel } from './editors'
import { tone } from './Home'
import { StatusPill } from './Others'

export function ShareSheet({ trip, members, onClose }: { trip: Trip; members: Member[]; onClose: () => void }) {
  const toast = useToast()
  const text = shareText(trip, members)
  return (
    <Sheet title="Condividi il piano" onClose={onClose} footer={<>
      <a className="btn primary" style={{ textDecoration: 'none' }} href={whatsappUrl(text)} target="_blank" rel="noreferrer" onClick={onClose}><Icon n="wa" size={21} />Apri WhatsApp</a>
      <div style={{ height: 8 }} /><Btn kind="gray" onClick={async () => { try { await navigator.clipboard.writeText(text); toast('Testo copiato') } catch { toast('Copia non riuscita: seleziona il testo a mano') } }}>Copia testo</Btn></>}>
      <div className="list" style={{ padding: 14, whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.45, userSelect: 'text' }}>{text}</div>
    </Sheet>
  )
}

export function Done({ trip, fx, meId, onClose }: { trip: Trip; fx: TripEffect; meId: ID; onClose: () => void }) {
  const km = fx.km.get(meId) ?? 0, eur = fx.eur.get(meId) ?? 0
  return (
    <div className="done glass" role="alertdialog" aria-label="Viaggio registrato">
      <svg width="96" height="96" viewBox="0 0 96 96" fill="none" stroke="var(--pos)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="48" cy="48" r="40" transform="rotate(-90 48 48)" /><path d="M31 49.500l11.500 11.500L66 37" /></svg>
      <h2 className="pop" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 8 }}>Viaggio registrato</h2>
      <p className="pop dim num">{trip.dest.name} · {fmtKm(fx.realMeters)}</p>
      <div className="pop card" style={{ padding: '14px 22px', marginTop: 10 }}>
        <div className="caption">Il tuo saldo</div>
        <div className={`num ${tone(km)}`} style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em' }}>{fmtKmSigned(km)}</div>
        {eur !== 0 && <div className={`num ${eur > 0 ? 'pos' : 'neg'}`} style={{ fontSize: 16 }}>{fmtEurSigned(eur)} di pedaggi</div>}
      </div>
      <div className="pop" style={{ width: '100%', maxWidth: 320, marginTop: 18 }}><Btn onClick={onClose} autoFocus>Fine</Btn></div>
    </div>
  )
}

export function TripView({ id, fresh }: { id: ID; fresh?: boolean }) {
  const app = useApp()
  const { data, byId, me, pop, push, home, saveTrip } = app
  const trip = data.trips.find((t) => t.id === id)
  const toast = useToast()
  const [sheet, setSheet] = useState<null | 'driver' | 'km' | 'toll' | 'share' | 'cancel' | 'detail'>(fresh ? 'share' : null)
  const [tab, setTab] = useState(0)
  const [done, setDone] = useState<TripEffect | null>(null)
  const [busy, run] = useBusy()
  if (!trip) return <div className="screen"><div className="nav"><button className="nav-btn" onClick={pop}><Icon n="back" />Indietro</button></div><div className="scroll"><Empty icon="alert" title="Uscita non trovata" text="Potrebbe appartenere a un altro gruppo o essere stata rimossa." /></div></div>

  const fx = tripEffect(trip)
  const present = trip.presentIds.map((p) => byId(p)).filter(Boolean) as Member[]
  const editable = trip.status !== 'cancelled'
  const drivers = trip.legs.map((l) => byId(l.driverId))
  const sameDriver = drivers.every((d) => d?.id === drivers[0]?.id)
  const missingDriver = trip.legs.some((l) => !l.driverId)
  const missingRoute = trip.legs.some((l) => !l.segs || (l.routeState !== 'ok' && l.actualMeters == null))
  const noStops = trip.legs.some((l) => l.stops.length < 2)
  const pickDriver = () => (noStops ? push({ s: 'plan', mode: 'plan', edit: trip }) : setSheet('driver'))
  const past = trip.startsAt < new Date().toISOString()
  const leg = trip.legs[Math.min(tab, trip.legs.length - 1)]
  const myKm = fx.km.get(me.id) ?? 0, myEur = fx.eur.get(me.id) ?? 0
  const tolls = trip.legs.map((l) => legToll(l))
  const tollTotal = tolls.reduce((a, t) => a + (t.status === 'out' ? 0 : t.cents ?? 0), 0)
  const worst = tolls.find((t) => t.status === 'out') ?? tolls.find((t) => t.status === 'verify')
  const payers = [...new Set(fx.legs.filter((l) => (l.toll.cents ?? 0) > 0).map((l) => byId(l.payerId)?.name))].filter(Boolean).join(' e ')

  const patch = (legs: Leg[], extra: Partial<Trip> = {}) => run(async () => {
    const saved = await saveTrip({ ...trip, ...extra, legs, updatedBy: me.id, updatedAt: new Date().toISOString() }, trip.version)
    if (saved) setSheet(null)
  })
  const confirm = () => run(async () => {
    const next: Trip = { ...trip, status: 'confirmed', confirmedAt: new Date().toISOString(), updatedBy: me.id, updatedAt: new Date().toISOString() }
    const saved = await saveTrip(next, trip.version)
    if (saved) setDone(tripEffect(saved))
  })
  const saveTolls = (legs: Leg[], remember: Record<string, GroupToll>) => run(async () => {
    if (Object.keys(remember).length) await store.updateGroup(data.group.id, { settings: { ...data.group.settings, tolls: { ...(data.group.settings.tolls ?? {}), ...remember } } })
    const saved = await saveTrip({ ...trip, legs, updatedBy: me.id, updatedAt: new Date().toISOString() }, trip.version)
    if (saved) { setSheet(null); if (Object.keys(remember).length) { await app.reload(); toast('Tariffa ricordata per il gruppo') } }
  })

  const Row = ({ label, value, sub, onClick, pill }: { label: string; value: React.ReactNode; sub?: React.ReactNode; onClick?: () => void; pill?: React.ReactNode }) => {
    const inner = <><span className="grow"><div className="s" style={{ fontSize: 13 }}>{label}</div><div className="t" style={{ whiteSpace: 'normal', fontWeight: 500 }}>{value}</div>{sub && <div className="s wrap num">{sub}</div>}</span>{pill}{onClick && <span className="chev"><Icon n="chev" size={18} /></span>}</>
    return onClick && editable ? <button className="row" onClick={onClick}>{inner}</button> : <div className="row">{inner}</div>
  }

  return (
    <div className="screen">
      <div className="nav"><button className="nav-btn" onClick={pop}><Icon n="back" />Indietro</button><span className="spacer" />
        {editable && <button className="nav-btn" onClick={() => setSheet('share')} aria-label="Condividi"><Icon n="share" /></button>}</div>
      <div className="scroll has-cta">
        <div style={{ viewTransitionName: `trip-${trip.id}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}><StatusPill t={trip} /></div>
          <h1 className="title">{trip.dest.name}</h1>
          <p className="subtitle">{fmtDateLong(trip.startsAt).replace(/^./, (c) => c.toUpperCase())} · {trip.legs[0]?.time ?? fmtTime(trip.startsAt)}</p>
        </div>

        <div className="map-static card" style={{ marginTop: 16 }}>
          <MapView interactive={false} geometry={leg?.geometry} stops={(leg?.stops ?? []).map((s, i, a) => ({ ...s, label: String(i + 1), end: i === a.length - 1, title: s.name }))} dots={leg?.stops.length ? [] : [trip.dest]} padBottom={8} padTop={8} />
          {trip.legs.length > 1 && <div className="seg glass" style={{ position: 'absolute', left: 10, top: 10, zIndex: 500, width: 170 }} role="group">{trip.legs.map((l, i) => <button key={l.kind} aria-pressed={tab === i} onClick={() => setTab(i)}>{l.kind === 'andata' ? 'Andata' : 'Ritorno'}</button>)}</div>}
        </div>

        {trip.status === 'planned' && missingDriver && <div style={{ marginTop: 12 }}><Notice kind="info">Conducente ancora da decidere. Potete condividere il piano e sceglierlo dopo.</Notice></div>}

        <div className="section">
          <div className="list">
            <Row label={sameDriver ? 'Conducente' : 'Conducenti'} onClick={pickDriver}
              value={missingDriver && !drivers.some(Boolean) ? 'Da decidere' : sameDriver ? drivers[0]?.name : trip.legs.map((l, i) => `${l.kind === 'andata' ? 'Andata' : 'Ritorno'} ${drivers[i]?.name ?? 'da decidere'}`).join(' · ')} />
            <Row label="Partecipanti" onClick={trip.status === 'planned' ? () => push({ s: 'plan', mode: 'plan', edit: trip }) : () => push({ s: 'plan', mode: 'record', edit: trip })}
              value={<span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="stack">{present.map((m) => <Avatar key={m.id} m={m} size={28} />)}</span><span className="dim" style={{ fontSize: 15 }}>{present.length} in auto</span></span>} />
            <Row label="Km effettivi" onClick={() => setSheet('km')} value={<span className="num">{missingRoute && !fx.realMeters ? 'Da inserire' : fmtKm(fx.realMeters)}</span>}
              sub={trip.legs.length > 1 ? fx.legs.map((l) => `${l.kind === 'andata' ? 'andata' : 'ritorno'} ${fmtKm(l.realMeters)}`).join(' · ') : undefined}
              pill={trip.legs.some((l) => l.routeState === 'stimato' && l.actualMeters == null) ? <span className="pill warn">Stima</span> : undefined} />
            <Row label="Validi per il saldo" onClick={() => setSheet('km')} value={<span className="num">{fmtKm(fx.weightedMeters)}</span>}
              sub={fx.legs.map((l) => `×${l.mult}${fx.legs.length > 1 ? ` ${l.kind}` : ''}`).join(' · ') + (trip.legs.some((l) => l.designated) ? ' · conducente designato' : '')} />
            <Row label="Pedaggio" onClick={() => setSheet('toll')}
              value={<span className="num">{worst?.status === 'out' && !tollTotal ? 'Fuori copertura' : worst?.status === 'verify' && !tollTotal ? 'Da verificare' : tollTotal ? fmtEur(tollTotal) : 'Nessun pedaggio'}</span>}
              sub={tollTotal ? `${tolls.filter((t) => t.from).map((t) => `${gateName(t.from)} → ${gateName(t.to)}`).join(' · ')}${payers ? `${tolls.some((t) => t.from) ? ' · ' : ''}paga ${payers}` : ''}` : worst?.note}
              pill={worst ? <span className="pill warn">{worst.status === 'out' ? 'A mano' : 'Verifica'}</span> : undefined} />
            <Row label={trip.status === 'confirmed' ? 'Il tuo saldo per questo viaggio' : 'Il tuo saldo, se va così'} onClick={() => setSheet('detail')}
              value={<span className="num"><b className={tone(myKm)}>{fmtKmSigned(myKm)}</b>{myEur !== 0 && <span className={myEur > 0 ? 'pos' : 'neg'}> · {fmtEurSigned(myEur)}</span>}</span>} sub="Tocca per vedere gli altri" />
          </div>
          <p className="foot">{trip.status === 'planned' ? 'I saldi cambiano solo quando confermate il viaggio. ' : ''}Ultima modifica: {byId(trip.updatedBy)?.name ?? '—'}, {fmtDate(trip.updatedAt)} alle {fmtTime(trip.updatedAt)}.</p>
        </div>

        <div className="section"><div className="list">
          {editable && <button className="row" onClick={() => push({ s: 'plan', mode: trip.status === 'planned' ? 'plan' : 'record', edit: trip })}><span style={{ color: 'var(--accent)' }}><Icon n="edit" /></span><span className="grow t">Modifica percorso e tappe</span><span className="chev"><Icon n="chev" size={18} /></span></button>}
          <button className="row" onClick={() => push({ s: 'plan', mode: 'plan', redo: trip })}><span style={{ color: 'var(--accent)' }}><Icon n="repeat" /></span><span className="grow t">Rifai questa uscita</span><span className="chev"><Icon n="chev" size={18} /></span></button>
          {editable ? <button className="row" onClick={() => setSheet('cancel')}><span style={{ color: 'var(--danger)' }}><Icon n="trash" /></span><span className="grow t" style={{ color: 'var(--danger)' }}>{trip.status === 'confirmed' ? 'Annulla viaggio' : 'Annulla uscita'}</span></button>
            : <button className="row" onClick={() => patch(trip.legs, { status: trip.confirmedAt ? 'confirmed' : 'planned' })}><span style={{ color: 'var(--accent)' }}><Icon n="history" /></span><span className="grow t">Ripristina</span></button>}
        </div></div>
      </div>

      {trip.status === 'planned' && (
        <div className="cta">
          {missingDriver ? <Btn onClick={pickDriver}>Scegli chi guida</Btn>
            : missingRoute ? <Btn onClick={() => setSheet('km')}>Inserisci i km</Btn>
            : past ? <Btn busy={busy} icon="check" onClick={confirm}>Conferma viaggio</Btn>
            : <><Btn kind="tinted" busy={busy} onClick={confirm} style={{ flex: 1 }} aria-label="Conferma viaggio">Conferma</Btn><Btn icon="wa" onClick={() => setSheet('share')} style={{ flex: 1.3 }}>Condividi</Btn></>}
        </div>
      )}

      {sheet === 'share' && <ShareSheet trip={trip} members={data.members} onClose={() => setSheet(null)} />}
      {sheet === 'driver' && <DriverSheet legs={trip.legs} people={present} presentIds={trip.presentIds} onClose={() => setSheet(null)} onSave={(legs) => patch(legs)} />}
      {sheet === 'km' && <KmSheet trip={trip} byId={byId} onClose={() => setSheet(null)} onSave={(legs) => patch(legs)} />}
      {sheet === 'toll' && <TollSheet trip={trip} people={present} groupTolls={data.group.settings.tolls} meId={me.id} onClose={() => setSheet(null)} onSave={saveTolls} />}
      {sheet === 'detail' && <Sheet title="Variazione dei saldi" onClose={() => setSheet(null)}>
        <div className="list">{present.map((m) => <div className="row" key={m.id}><Avatar m={m} /><span className="grow t">{m.name}</span><span className="num" style={{ textAlign: 'right' }}><div className={tone(fx.km.get(m.id) ?? 0)} style={{ fontWeight: 600 }}>{fmtKmSigned(fx.km.get(m.id) ?? 0)}</div>{(fx.eur.get(m.id) ?? 0) !== 0 && <div className="s">{fmtEurSigned(fx.eur.get(m.id) ?? 0)}</div>}</span></div>)}</div>
        <p className="foot">Al conducente vanno i km validi; ogni occupante, conducente compreso, ne paga una quota uguale per i tratti percorsi.</p></Sheet>}
      {sheet === 'cancel' && <Sheet title={trip.status === 'confirmed' ? 'Annullare il viaggio?' : 'Annullare l\'uscita?'} onClose={() => setSheet(null)} footer={<Btn busy={busy} style={{ background: 'var(--danger)' }} onClick={() => patch(trip.legs, { status: 'cancelled' })}>Annulla {trip.status === 'confirmed' ? 'viaggio' : 'uscita'}</Btn>}>
        <p style={{ margin: '0 4px', lineHeight: 1.4 }}>{trip.status === 'confirmed' ? 'Chilometri e pedaggi di questo viaggio vengono tolti dai saldi di tutti. Resta nello storico e si può ripristinare.' : 'L\'uscita resta nello storico come annullata. I saldi non cambiano.'}</p></Sheet>}
      {done && <Done trip={trip} fx={done} meId={me.id} onClose={home} />}
    </div>
  )
}
