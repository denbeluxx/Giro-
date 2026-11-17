import { useState } from 'react'
import { legMeters, legToll, tripEffect, type LegToll } from '../lib/calc'
import { fmtEur, fmtKm, kmField, parseNum } from '../lib/format'
import { A4_GATES, a4Toll, gateName, pairKey } from '../lib/tolls'
import type { GroupToll, ID, Leg, Member, Trip } from '../lib/types'
import { Avatar, Btn, Notice, Sheet, Switch } from '../ui/kit'

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
  const [km, setKm] = useState(trip.legs.map((l) => kmField(legMeters(l))))
  const [touched, setTouched] = useState(trip.legs.map(() => false))
  const [flag, setFlag] = useState(trip.legs.map((l) => l.designated))
  const values = km.map((k) => parseNum(k, MAX_KM))
  const build = (): Leg[] => trip.legs.map((l, i) => {
    // un campo non toccato lascia i km esattamente come sono (nessun arrotondamento)
    if (!touched[i]) return { ...l, designated: flag[i] }
    const meters = Math.round(values[i]! * 1000)
    const route = l.segs ? l.segs.reduce((a, s) => a + s.meters, 0) : 0
    const same = l.routeState === 'ok' && Math.abs(meters - route) < 1
    return { ...l, designated: flag[i], actualMeters: same ? null : meters }
  })
  const bad = values.some((v, i) => touched[i] && v == null)
  const fx = bad ? null : tripEffect({ ...trip, legs: build() })
  return (
    <Sheet title="Chilometri" onClose={onClose} footer={<Btn disabled={bad} onClick={() => onSave(build())}>Fatto</Btn>}>
      {trip.legs.map((l, i) => (
        <div key={l.kind} style={{ marginBottom: 18 }}>
          <label className="label" htmlFor={`km-${i}`} style={{ display: 'block' }}>{LEG[l.kind]}{l.driverId ? ` · guida ${byId(l.driverId)?.name}` : ''}</label>
          <div className="list">
            <div className="row"><span className="grow t">Km effettivi</span><input id={`km-${i}`} className="num" inputMode="decimal" value={km[i]} aria-invalid={touched[i] && values[i] == null} onChange={(e) => { setKm(km.map((k, j) => (j === i ? e.target.value : k))); setTouched(touched.map((t, j) => t || j === i)) }} style={numInput} /><span className="dim">km</span></div>
            <div className="row"><div className="grow"><div className="t">Conducente designato</div><div className="s wrap">Km ×2; ×3 se in tutta l'uscita questa persona guida meno di 5 km con questa opzione.</div></div><Switch on={flag[i]} label={`Conducente designato, ${LEG[l.kind]}`} onChange={(v) => setFlag(flag.map((f, j) => (j === i ? v : f)))} /></div>
          </div>
          {touched[i] && values[i] == null ? <p className="foot" style={{ color: 'var(--danger)' }}>Scrivi un numero tra 0 e {MAX_KM}, ad esempio 12,5.</p>
            : fx && <p className="foot num">Moltiplicatore ×{fx.legs[i].mult} → {fmtKm(fx.legs[i].weightedMeters)} validi per il saldo</p>}
        </div>
      ))}
    </Sheet>
  )
}

interface TollState { amount: string; touched: boolean; payer: ID | null; from: string; to: string; remember: boolean; t: LegToll }

export function TollSheet({ trip, people, groupTolls, meId, onSave, onClose }: { trip: Trip; people: Member[]; groupTolls?: Record<string, GroupToll>; meId: ID; onSave: (legs: Leg[], remember: Record<string, GroupToll>) => void; onClose: () => void }) {
  const init = (): TollState[] => trip.legs.map((l) => {
    const t = legToll(l)
    // se nel frattempo il gruppo ha confermato la tariffa di questi caselli, la proponiamo subito
    const known = t.from && t.to ? groupTolls?.[pairKey(t.from, t.to)] : undefined
    const cents = known && !t.manual ? known.cents : t.status === 'out' ? (t.known || null) : t.cents
    return { amount: cents ? (cents / 100).toFixed(2).replace('.', ',') : '', touched: !!known && !t.manual && t.cents !== known.cents, payer: l.tollPayerId ?? l.driverId, from: t.from ?? '', to: t.to ?? '', remember: false, t }
  })
  const [st, setSt] = useState<TollState[]>(init)
  const set = (i: number, p: Partial<TollState>) => setSt((prev) => prev.map((s, j) => (j === i ? { ...s, ...p } : s)))
  const values = st.map((s) => (s.amount.trim() === '' ? null : parseNum(s.amount, MAX_EUR)))
  const bad = st.some((s, i) => s.touched && s.amount.trim() !== '' && values[i] == null)

  const typeAmount = (i: number, v: string) => {
    setSt((prev) => prev.map((s, j) => {
      if (j === i) return { ...s, amount: v, touched: true, remember: !!(s.from && s.to && s.from !== s.to && s.t.status !== 'ok') }
      // stessa coppia di caselli al ritorno, ancora da compilare: proponiamo lo stesso importo
      const me = prev[i]
      if (!s.touched && s.amount === '' && me.from && s.from && pairKey(me.from, me.to) === pairKey(s.from, s.to)) return { ...s, amount: v }
      return s
    }))
  }
  const pick = (i: number, from: string, to: string) => {
    const t = from && to && from !== to ? a4Toll(from, to, groupTolls) : null
    // nuova coppia: importo della tabella se c'è, altrimenti vuoto (mai l'importo della coppia precedente)
    set(i, { from, to, touched: true, amount: t?.cents ? (t.cents / 100).toFixed(2).replace('.', ',') : '', remember: false })
  }
  const save = () => {
    const remember: Record<string, GroupToll> = {}
    const legs = trip.legs.map((l, i) => {
      const s = st[i]
      const payer = s.payer && s.payer !== l.driverId ? s.payer : null
      if (!s.touched) return { ...l, tollPayerId: payer } // nulla di cambiato: resta il calcolo automatico
      const v = values[i]
      if (v == null) return { ...l, tollPayerId: payer, tollOverride: null, tollGates: s.from && s.to ? { from: s.from, to: s.to } : null } // campo vuoto: resta da verificare
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
            {s.t.status === 'verify' && !s.touched && <div className="mb12"><Notice>{s.t.note ?? 'Importo da verificare'}. Controlla la cifra: confermandola l'app la ricorda per il gruppo.</Notice></div>}
            <div className="list">
              <div className="row"><label className="grow t" htmlFor={`tl-${i}`}>Importo{trip.legs.length > 1 ? ' della tratta' : ''}</label><input id={`tl-${i}`} className="num" inputMode="decimal" placeholder={s.t.status === 'none' ? '0,00' : 'da inserire'} value={s.amount} aria-invalid={s.touched && s.amount !== '' && values[i] == null} onChange={(e) => typeAmount(i, e.target.value)} style={numInput} /><span className="dim">€</span></div>
              {a4 && <div className="row gates"><span className="t" style={{ flex: 'none' }}>Caselli A4</span>
                <select aria-label="Casello di entrata" value={s.from} onChange={(e) => pick(i, e.target.value, s.to)}><option value="">Entrata</option>{A4_GATES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
                <select aria-label="Casello di uscita" value={s.to} onChange={(e) => pick(i, s.from, e.target.value)}><option value="">Uscita</option>{A4_GATES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
              </div>}
              {a4 && s.from && s.to && s.from !== s.to && <div className="row"><div className="grow"><div className="t">Ricorda per il gruppo</div><div className="s wrap">{gateName(s.from)} ⇄ {gateName(s.to)}: la prossima volta l'importo si compila da solo.</div></div><Switch on={s.remember} label="Ricorda questa tariffa per il gruppo" onChange={(v) => set(i, { remember: v })} /></div>}
            </div>
            {s.touched && s.amount !== '' && values[i] == null && <p className="foot" style={{ color: 'var(--danger)' }}>Scrivi un importo tra 0 e {MAX_EUR} €, ad esempio 4,40.</p>}
            {s.touched && s.amount === '' && s.t.status !== 'none' && <p className="foot">Lasciato vuoto, il pedaggio resta da verificare. Scrivi 0 se non c'era.</p>}
            <p className="label" style={{ marginTop: 14 }}>Ha pagato</p>
            <div className="chips">{people.map((m) => <button key={m.id} className="chip" aria-pressed={s.payer === m.id} onClick={() => set(i, { payer: m.id })}><Avatar m={m} size={34} />{m.name}</button>)}</div>
          </div>
        )
      })}
      <p className="foot">Il pedaggio si divide tra chi era in auto nei tratti a pagamento, conducente compreso.</p>
    </Sheet>
  )
}
