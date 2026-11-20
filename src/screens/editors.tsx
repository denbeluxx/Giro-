import { useState } from 'react'
import { legMeters, legToll, tripEffect, type LegToll } from '../lib/calc'
import { fmtEur, fmtKm, kmField, parseNum } from '../lib/format'
import { A4_GATES, a4Toll, gateName, pairKey } from '../lib/tolls'
import type { GroupToll, ID, Leg, Member, Trip } from '../lib/types'
import { Avatar, Btn, Notice, Sheet, Switch, led } from '../ui/kit'

const LEG = { andata: 'Andata', ritorno: 'Ritorno' } as const
const MAX_KM = 2000
const MAX_EUR = 500

/** Testo breve del pedaggio, da mostrare dopo il numero dei km. */
export function tollText(t: LegToll | (LegToll & { manual?: boolean })): string {
  if (t.status === 'none') return 'Nessun pedaggio'
  if (t.status === 'out') return t.known ? `Pedaggio ${fmtEur(t.known)} + da inserire` : 'Pedaggio fuori copertura'
  if (t.status === 'verify') return t.cents != null ? `Pedaggio ${fmtEur(t.cents)} da verificare` : 'Pedaggio da verificare'
  return `Pedaggio ${fmtEur(t.cents ?? 0)}`
}

const numInput = { width: 104, textAlign: 'right' as const, border: 0, background: 'var(--fill)', borderRadius: 10, minHeight: 44, padding: '0 12px', fontSize: 18, fontWeight: 600 }

export function KmSheet({ trip, byId, onSave, onClose }: { trip: Trip; byId: (id?: ID | null) => Member | undefined; onSave: (legs: Leg[]) => void; onClose: () => void }) {
  // tratta senza percorso né km: il campo parte vuoto e va compilato
  const empty = trip.legs.map((l) => !l.segs && l.actualMeters == null)
  const [km, setKm] = useState(trip.legs.map((l, i) => (empty[i] ? '' : kmField(legMeters(l)))))
  const [touched, setTouched] = useState(trip.legs.map(() => false))
  const [flag, setFlag] = useState(trip.legs.some((l) => l.designated))
  const values = km.map((k) => parseNum(k, MAX_KM))
  const build = (): Leg[] => trip.legs.map((l, i) => {
    // un campo non toccato lascia i km esattamente come sono (nessun arrotondamento);
    // per una distanza stimata, «Fatto» vale come conferma della stima
    if (!touched[i] && !empty[i]) return { ...l, designated: flag, actualMeters: l.routeState === 'stimato' && l.actualMeters == null ? Math.round(legMeters(l)) : l.actualMeters }
    const meters = Math.round(values[i]! * 1000)
    const route = l.segs ? l.segs.reduce((a, s) => a + s.meters, 0) : 0
    const same = l.routeState === 'ok' && meters === route
    return { ...l, designated: flag, actualMeters: same ? null : meters }
  })
  const bad = values.some((v, i) => (touched[i] || empty[i]) && v == null)
  const fx = bad ? null : tripEffect({ ...trip, legs: build() })
  return (
    <Sheet title="Chilometri" onClose={onClose} footer={<Btn disabled={bad} onClick={() => onSave(build())}>{trip.legs.some((l, i) => l.routeState === 'stimato' && l.actualMeters == null && !touched[i]) ? 'Conferma i km' : 'Fatto'}</Btn>}>
      {trip.legs.map((l, i) => (
        <div key={l.kind} style={{ marginBottom: 18 }}>
          <label className="label" htmlFor={`km-${i}`} style={{ display: 'block' }}>{LEG[l.kind]}{l.driverId ? ` · guida ${byId(l.driverId)?.name}` : ''}</label>
          <div className="list">
            <div className="row"><span className="grow t">Km effettivi</span><input id={`km-${i}`} className="num" inputMode="decimal" value={km[i]} aria-invalid={touched[i] && values[i] == null} onChange={(e) => { setKm(km.map((k, j) => (j === i ? e.target.value : k))); setTouched(touched.map((t, j) => t || j === i)) }} style={numInput} /><span className="dim">km</span></div>
          </div>
          {empty[i] && !touched[i] ? <p className="foot">Scrivi i km percorsi in questa tratta.</p>
            : touched[i] && values[i] == null ? <p className="foot" style={{ color: 'var(--danger)' }}>Scrivi un numero tra 0 e {MAX_KM}, ad esempio 12,5.</p>
            : fx && <p className="foot num">{Number.isInteger(fx.legs[i].mult) ? `Moltiplicatore ×${fx.legs[i].mult}` : 'Doppio sui primi 30 km dell\'uscita'} → {fmtKm(fx.legs[i].weightedMeters)} validi per il saldo</p>}
        </div>
      ))}
      <div className="list"><div className="row"><div className="grow"><div className="t">Non posso bere ostia</div><div className="s wrap">Guidi tu e non bevi: valgono doppio i primi 30 km dell'uscita (triplo se l'uscita è sotto i 5 km).</div></div><Switch on={flag} label="Non posso bere ostia" onChange={setFlag} /></div></div>
    </Sheet>
  )
}

interface TollState { amount: string; touched: boolean; mirror: boolean; payer: ID | null; from: string; to: string; remember: boolean; t: LegToll }

export function TollSheet({ trip, people, groupTolls, meId, onSave, onClose }: { trip: Trip; people: Member[]; groupTolls?: Record<string, GroupToll>; meId: ID; onSave: (legs: Leg[], remember: Record<string, GroupToll>) => void; onClose: () => void }) {
  const init = (): TollState[] => trip.legs.map((l) => {
    const t = legToll(l)
    // se nel frattempo il gruppo ha confermato la tariffa di questi caselli, la proponiamo subito
    const known = t.from && t.to ? groupTolls?.[pairKey(t.from, t.to)] : undefined
    const cents = known && !t.manual ? known.cents : t.status === 'out' ? (t.known || null) : t.cents
    // un importo scritto a mano resta tale, anche se è 0: non viene sovrascritto dall'altra tratta
    const manual = l.tollOverride != null
    return { amount: manual ? (l.tollOverride! / 100).toFixed(2).replace('.', ',') : cents ? (cents / 100).toFixed(2).replace('.', ',') : '', touched: manual || (!!known && !t.manual && t.cents !== known.cents), mirror: false, payer: l.tollPayerId ?? l.driverId, from: t.from ?? '', to: t.to ?? '', remember: false, t }
  })
  const [st, setSt] = useState<TollState[]>(init)
  const set = (i: number, p: Partial<TollState>) => setSt((prev) => prev.map((s, j) => (j === i ? { ...s, ...p } : s)))
  const values = st.map((s) => (s.amount.trim() === '' ? null : parseNum(s.amount, MAX_EUR)))
  const bad = st.some((s, i) => s.touched && s.amount.trim() !== '' && values[i] == null)

  const typeAmount = (i: number, v: string) => {
    setSt((prev) => prev.map((s, j) => {
      if (j === i) return { ...s, amount: v, touched: true, mirror: false, remember: false }
      // stessa coppia di caselli nell'altra tratta, non ancora scritta a mano: segue l'importo, tasto per tasto
      const me = prev[i]
      const samePair = me.from && s.from && pairKey(me.from, me.to) === pairKey(s.from, s.to)
      const free = s.mirror || (!s.touched && s.amount === '')
      if (samePair && free && (v === '' || parseNum(v, MAX_EUR) != null)) return { ...s, amount: v, touched: true, mirror: true }
      return s
    }))
  }
  const pick = (i: number, from: string, to: string) => {
    const t = from && to && from !== to ? a4Toll(from, to, groupTolls) : null
    // nuova coppia: importo della tabella se c'è, altrimenti vuoto (mai l'importo della coppia precedente)
    set(i, { from, to, touched: true, mirror: false, amount: t?.cents ? (t.cents / 100).toFixed(2).replace('.', ',') : '', remember: false })
  }
  const save = () => {
    const remember: Record<string, GroupToll> = {}
    const legs = trip.legs.map((l, i) => {
      const s = st[i]
      const payer = s.payer && s.payer !== l.driverId ? s.payer : null
      // «Ricorda» acceso a mano su un importo proposto vale come conferma di quell'importo
      if (!s.touched && !(s.remember && values[i] != null)) return { ...l, tollPayerId: payer } // nulla di cambiato: resta il calcolo automatico
      const v = values[i]
      if (v == null) return { ...l, tollPayerId: payer, tollOverride: null, tollGates: s.from && s.to && s.from !== s.to ? { from: s.from, to: s.to } : null } // campo vuoto: resta da verificare
      const cents = Math.round(v * 100)
      if (s.remember && s.from && s.to && s.from !== s.to && cents > 0) remember[pairKey(s.from, s.to)] = { cents, by: meId, on: new Date().toISOString() }
      return { ...l, tollOverride: cents, tollPayerId: payer, tollGates: s.from && s.to ? { from: s.from, to: s.to } : null }
    })
    onSave(legs, remember)
  }
  return (
    <Sheet title="Pedaggio" onClose={onClose} footer={<Btn disabled={bad} onClick={save}>Fatto</Btn>}>
      {trip.legs.map((l, i) => {
        const s = st[i]
        const a4 = s.t.road !== 'A35' && !(s.t.status === 'out' && s.t.road && s.t.road !== 'A4')
        return (
          <div key={l.kind} style={{ marginBottom: 20 }}>
            {trip.legs.length > 1 && <p className="label">{LEG[l.kind]}</p>}
            {s.t.status === 'out' && <div className="mb12"><Notice>{s.t.note ?? 'Fuori copertura'}. Scrivi l'importo totale della tratta, se lo conosci.</Notice></div>}
            {s.t.status === 'verify' && !s.touched && <div className="mb12"><Notice>{s.t.note ?? 'Importo da verificare'}. {s.t.cents != null ? 'Controlla caselli e cifra.' : 'Scegli i caselli o scrivi l\'importo.'}</Notice></div>}
            <div className="list">
              <div className="row"><label className="grow t" htmlFor={`tl-${i}`}>Importo</label><input id={`tl-${i}`} className="num" inputMode="decimal" placeholder={s.t.status === 'none' ? '0,00' : '—'} value={s.amount} aria-invalid={s.touched && s.amount !== '' && values[i] == null} onChange={(e) => typeAmount(i, e.target.value)} style={numInput} /><span className="dim">€</span></div>
              {a4 && <div className="row gates">
                <label className="gate"><span className="gate-l">Entrata A4</span><select value={s.from} onChange={(e) => pick(i, e.target.value, s.to)}><option value="">—</option>{A4_GATES.map((g) => <option key={g.id} value={g.id}>{g.name.split('-')[0]}</option>)}</select></label>
                <label className="gate"><span className="gate-l">Uscita A4</span><select value={s.to} onChange={(e) => pick(i, s.from, e.target.value)}><option value="">—</option>{A4_GATES.map((g) => <option key={g.id} value={g.id}>{g.name.split('-')[0]}</option>)}</select></label>
              </div>}
            </div>
            {s.touched && s.amount !== '' && values[i] == null && <p className="foot" style={{ color: 'var(--danger)' }}>Scrivi un importo tra 0 e {MAX_EUR} €, ad esempio 4,40.</p>}
            {s.mirror && <p className="foot">Stessi caselli: proposto lo stesso importo dell'altra tratta.</p>}
            {s.touched && s.amount === '' && s.t.status !== 'none' && <p className="foot">{s.from && s.to && s.from !== s.to ? 'Lasciato vuoto, il pedaggio resta da verificare per i caselli scelti.' : 'Lasciato vuoto, torna il calcolo automatico.'} Scrivi 0 se non c'era.</p>}
            <p className="label" style={{ marginTop: 14 }}>Ha pagato</p>
            <div className="chips">{people.map((m) => <button key={m.id} className="chip" style={led(m)} aria-pressed={s.payer === m.id} onClick={() => set(i, { payer: m.id })}><Avatar m={m} size={34} />{m.name}</button>)}</div>
          </div>
        )
      })}
      <p className="foot">Il pedaggio si divide tra chi era in auto nei tratti a pagamento, conducente compreso.</p>
    </Sheet>
  )
}
