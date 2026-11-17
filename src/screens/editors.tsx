import { useState } from 'react'
import { legMeters, legToll, tripEffect } from '../lib/calc'
import { fmtEur, fmtKm, parseNum } from '../lib/format'
import { A4_GATES, a4Toll, gateName, pairKey } from '../lib/tolls'
import type { GroupToll, ID, Leg, Member, Toll, Trip } from '../lib/types'
import { Avatar, Btn, Icon, Notice, Sheet, Switch } from '../ui/kit'

const LEG = { andata: 'Andata', ritorno: 'Ritorno' } as const

/** Il nuovo conducente smette di essere passeggero; quello di prima sale alla partenza e scende all'arrivo. */
export function swapDriver(leg: Leg, driverId: ID | null, presentIds: ID[]): Leg {
  if (leg.driverId === driverId) return leg
  const old = leg.driverId
  const stops = leg.stops.map((s) => ({ ...s, on: s.on.filter((x) => x !== driverId), off: s.off.filter((x) => x !== driverId) }))
  if (old && presentIds.includes(old) && stops.length > 1) { stops[0].on.push(old); stops[stops.length - 1].off.push(old) }
  return { ...leg, driverId, stops, tollPayerId: null }
}

export function tollLabel(t: Toll & { manual?: boolean }): { text: string; pill?: 'warn' | 'accent' } {
  if (t.status === 'none') return { text: 'Nessun pedaggio' }
  if (t.status === 'out') return { text: 'Fuori copertura', pill: 'warn' }
  if (t.status === 'verify') return { text: t.cents != null ? `${fmtEur(t.cents)} · da verificare` : 'Da verificare', pill: 'warn' }
  return { text: fmtEur(t.cents ?? 0) }
}

export function DriverSheet({ legs, people, presentIds, onSave, onClose }: { legs: Leg[]; people: Member[]; presentIds: ID[]; onSave: (legs: Leg[]) => void; onClose: () => void }) {
  const [sel, setSel] = useState<(ID | null)[]>(legs.map((l) => l.driverId))
  return (
    <Sheet title="Chi ha guidato" onClose={onClose} footer={<Btn onClick={() => onSave(legs.map((l, i) => swapDriver(l, sel[i], presentIds)))}>Fatto</Btn>}>
      {legs.map((l, i) => (
        <div key={l.kind} style={{ marginBottom: 18 }}>
          {legs.length > 1 && <p className="label">{LEG[l.kind]}</p>}
          <div role="radiogroup" aria-label={`Conducente ${LEG[l.kind]}`}>
            {people.map((m) => (
              <button key={m.id} role="radio" aria-checked={sel[i] === m.id} className="driver" onClick={() => setSel(sel.map((s, j) => (j === i ? m.id : s)))}>
                <Avatar m={m} size={40} /><span style={{ flex: 1, fontWeight: 500 }}>{m.name}</span><span className="radio"><Icon n="check" size={15} sw={3} /></span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Sheet>
  )
}

export function KmSheet({ trip, byId, onSave, onClose }: { trip: Trip; byId: (id?: ID | null) => Member | undefined; onSave: (legs: Leg[]) => void; onClose: () => void }) {
  const [km, setKm] = useState(trip.legs.map((l) => (legMeters(l) / 1000).toFixed(1).replace('.', ',')))
  const [flag, setFlag] = useState(trip.legs.map((l) => l.designated))
  const build = (): Leg[] => trip.legs.map((l, i) => {
    const v = parseNum(km[i])
    const route = l.segs ? l.segs.reduce((a, s) => a + s.meters, 0) : 0
    const meters = v == null ? l.actualMeters : Math.round(v * 1000)
    const same = meters != null && l.routeState === 'ok' && Math.abs(meters - route) < 50
    return { ...l, designated: flag[i], actualMeters: same ? null : meters }
  })
  const fx = tripEffect({ ...trip, legs: build() })
  return (
    <Sheet title="Chilometri" onClose={onClose} footer={<Btn disabled={km.some((k) => parseNum(k) == null)} onClick={() => onSave(build())}>Fatto</Btn>}>
      {trip.legs.map((l, i) => (
        <div key={l.kind} style={{ marginBottom: 18 }}>
          <label className="label" htmlFor={`km-${i}`} style={{ display: 'block' }}>{LEG[l.kind]}{l.driverId ? ` · guida ${byId(l.driverId)?.name}` : ''}</label>
          <div className="list">
            <div className="row"><span className="grow t">Km effettivi</span><input id={`km-${i}`} className="num" inputMode="decimal" value={km[i]} onChange={(e) => setKm(km.map((k, j) => (j === i ? e.target.value : k)))} style={{ width: 96, textAlign: 'right', border: 0, background: 'var(--fill)', borderRadius: 10, minHeight: 40, padding: '0 12px', fontSize: 18, fontWeight: 600 }} /><span className="dim">km</span></div>
            <div className="row"><div className="grow"><div className="t">Conducente designato</div><div className="s wrap">Vale doppio; triplo se guida meno di 5 km con il flag in tutta l'uscita.</div></div><Switch on={flag[i]} label={`Conducente designato, ${LEG[l.kind]}`} onChange={(v) => setFlag(flag.map((f, j) => (j === i ? v : f)))} /></div>
          </div>
          <p className="foot num">Moltiplicatore ×{fx.legs[i].mult} → {fmtKm(fx.legs[i].weightedMeters)} validi per il saldo</p>
        </div>
      ))}
    </Sheet>
  )
}

export function TollSheet({ trip, people, groupTolls, meId, onSave, onClose }: { trip: Trip; people: Member[]; groupTolls?: Record<string, GroupToll>; meId: ID; onSave: (legs: Leg[], remember: Record<string, GroupToll>) => void; onClose: () => void }) {
  const init = trip.legs.map((l) => { const t = legToll(l); return { amount: t.cents ? (t.cents / 100).toFixed(2).replace('.', ',') : '', payer: l.tollPayerId ?? l.driverId, from: t.from ?? '', to: t.to ?? '', remember: t.status === 'verify' && !!t.from, t } })
  const [st, setSt] = useState(init)
  const set = (i: number, p: Partial<(typeof init)[0]>) => setSt(st.map((s, j) => (j === i ? { ...s, ...p } : s)))
  const save = () => {
    const remember: Record<string, GroupToll> = {}
    const legs = trip.legs.map((l, i) => {
      const s = st[i]
      const cents = Math.round((parseNum(s.amount) ?? 0) * 100)
      const auto = legToll({ ...l, tollOverride: null })
      const untouched = auto.status !== 'verify' && (auto.cents ?? 0) === cents && s.from === (auto.from ?? '') && s.to === (auto.to ?? '')
      if (s.remember && s.from && s.to && s.from !== s.to && cents > 0) remember[pairKey(s.from, s.to)] = { cents, by: meId, on: new Date().toISOString() }
      return { ...l, tollOverride: untouched ? null : cents, tollPayerId: s.payer && s.payer !== l.driverId ? s.payer : null }
    })
    onSave(legs, remember)
  }
  return (
    <Sheet title="Pedaggio" onClose={onClose} footer={<Btn onClick={save}>Fatto</Btn>}>
      {trip.legs.map((l, i) => {
        const s = st[i]
        const pick = (from: string, to: string) => { const t = from && to && from !== to ? a4Toll(from, to, groupTolls) : null; set(i, { from, to, amount: t?.cents ? (t.cents / 100).toFixed(2).replace('.', ',') : s.amount, remember: !!t && t.status !== 'ok' }) }
        return (
          <div key={l.kind} style={{ marginBottom: 20 }}>
            <p className="label">{LEG[l.kind]}</p>
            {s.t.status === 'out' && <div style={{ marginBottom: 10 }}><Notice>{s.t.note}. L'importo non viene compilato: inseriscilo a mano se lo conosci.</Notice></div>}
            {s.t.status === 'verify' && <div style={{ marginBottom: 10 }}><Notice>{s.t.note ?? 'Importo da verificare'}. Controlla la cifra: una volta confermata, l'app la ricorda per il gruppo.</Notice></div>}
            <div className="list">
              <div className="row"><label className="grow t" htmlFor={`tl-${i}`}>Importo</label><input id={`tl-${i}`} className="num" inputMode="decimal" placeholder="0,00" value={s.amount} onChange={(e) => set(i, { amount: e.target.value })} style={{ width: 96, textAlign: 'right', border: 0, background: 'var(--fill)', borderRadius: 10, minHeight: 40, padding: '0 12px', fontSize: 18, fontWeight: 600 }} /><span className="dim">€</span></div>
              <div className="row"><span className="t" style={{ flex: 'none' }}>Caselli</span>
                <select aria-label="Casello di entrata" value={s.from} onChange={(e) => pick(e.target.value, s.to)} style={{ border: 0, background: 'var(--fill)', borderRadius: 10, minHeight: 40, padding: '0 8px', flex: 1, minWidth: 0, fontSize: 15 }}><option value="">Entrata</option>{A4_GATES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
                <select aria-label="Casello di uscita" value={s.to} onChange={(e) => pick(s.from, e.target.value)} style={{ border: 0, background: 'var(--fill)', borderRadius: 10, minHeight: 40, padding: '0 8px', flex: 1, minWidth: 0, fontSize: 15 }}><option value="">Uscita</option>{A4_GATES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
              </div>
              {s.from && s.to && s.from !== s.to && <div className="row"><div className="grow"><div className="t">Ricorda per il gruppo</div><div className="s wrap">{gateName(s.from)} ⇄ {gateName(s.to)}: la prossima volta si compila da solo.</div></div><Switch on={s.remember} label="Ricorda questa tariffa per il gruppo" onChange={(v) => set(i, { remember: v })} /></div>}
            </div>
            <p className="label" style={{ marginTop: 14 }}>Ha pagato</p>
            <div className="chips">{people.map((m) => <button key={m.id} className="chip" aria-pressed={s.payer === m.id} onClick={() => set(i, { payer: m.id })}><Avatar m={m} size={34} />{m.name}</button>)}</div>
          </div>
        )
      })}
      <p className="foot">Il pedaggio si divide tra chi era in auto nel tratto a pagamento, conducente compreso.</p>
    </Sheet>
  )
}
