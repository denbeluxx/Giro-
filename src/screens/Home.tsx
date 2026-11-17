import { useApp } from '../app'
import { tripEffect } from '../lib/calc'
import { fmtDate, fmtEur, fmtKm, fmtKmSigned, fmtTime, kmNum } from '../lib/format'
import { SIM } from '../lib/routing'
import { store } from '../lib/store'
import type { Trip } from '../lib/types'
import { Avatar, Btn, Count, Icon } from '../ui/kit'

export const tone = (v: number) => (Math.round(v / 100) > 0 ? 'pos' : Math.round(v / 100) < 0 ? 'neg' : 'dim')

export function Home() {
  const { data, bal, me, active, push, byId } = useApp()
  const my = bal.km[me.id] ?? 0, myEur = bal.eur[me.id] ?? 0
  const planned = data.trips.filter((t) => t.status === 'planned').sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))
  const now = new Date().toISOString()
  const due = planned.find((t) => t.startsAt < now)
  const next = planned.find((t) => t.startsAt >= now)
  const confirmed = data.trips.filter((t) => t.status === 'confirmed')
  const r = Math.round(my / 100)
  const meaning = r > 0 ? 'Hai guidato più della tua quota: il gruppo ti deve dei passaggi.' : r < 0 ? 'Hai usato più passaggi di quanti ne hai dati: tocca a te recuperare.' : 'Sei in pari: hai guidato esattamente la tua quota.'
  const ranked = [...active].sort((a, b) => (bal.km[a.id] ?? 0) - (bal.km[b.id] ?? 0))

  const banner = (t: Trip, hot: boolean) => {
    const d = byId(t.legs[0]?.driverId)
    return (
      <button className={`banner${hot ? ' hot' : ''}`} onClick={() => push({ s: 'trip', id: t.id })} style={{ viewTransitionName: `trip-${t.id}`, marginTop: 12 }}>
        <span className="ic"><Icon n={hot ? 'check' : 'clock'} size={24} /></span>
        <span className="grow" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{hot ? 'Conferma il viaggio' : 'Prossima uscita'}</div>
          <div className="s" style={{ fontSize: 14, color: hot ? undefined : 'var(--text2)' }}>{t.dest.name} · {fmtDate(t.startsAt)}{hot ? '' : ` ${fmtTime(t.startsAt)}`} · {d ? `guida ${d.name}` : 'conducente da decidere'}</div>
        </span>
        <Icon n="chev" size={18} />
      </button>
    )
  }

  return (
    <div className="screen">
      <div className="nav">
        {(store.mode === 'demo') && <span className="demo-flag" style={{ marginLeft: 10 }}>{SIM ? 'Anteprima · dati e percorsi dimostrativi' : 'Dati dimostrativi'}</span>}
        <span className="spacer" />
        <button className="nav-btn" onClick={() => push({ s: 'members' })} aria-label="Membri e impostazioni">
          <span className="stack">{active.slice(0, 3).map((m) => <Avatar key={m.id} m={m} size={30} />)}</span>
        </button>
      </div>
      <div className="scroll has-cta">
        <button onClick={() => push({ s: 'members' })} style={{ display: 'block' }}><h1 className="title">{data.group.name}</h1></button>

        <div className="card hero" style={{ marginTop: 16 }}>
          <div className="k">Il tuo saldo di guida</div>
          <div className={`big ${tone(my)}`}><Count id={`km-${me.id}`} value={my} format={(v) => { const x = Math.round(v / 100) * 100; return `${x > 0 ? '+' : x < 0 ? '−' : ''}${kmNum(x)}` }} /><small>km</small></div>
          <p className="caption" style={{ fontSize: 15 }}>{meaning}</p>
        </div>

        {due && banner(due, true)}
        {next && banner(next, false)}

        <div className="section">
          <div className="section-h"><h2>Saldi di guida</h2><button className="link" onClick={() => push({ s: 'members' })}>Membri</button></div>
          <div className="list">
            {ranked.map((m) => (
              <div className="row" key={m.id}>
                <Avatar m={m} />
                <div className="grow"><div className="t">{m.name}{m.id === me.id && <span className="dim"> · tu</span>}</div>
                  <div className="s">{bal.lastDrove[m.id] ? `Ultima guida ${fmtDate(bal.lastDrove[m.id]!)}` : 'Non ha ancora guidato'}</div></div>
                <div className={`v ${tone(bal.km[m.id] ?? 0)}`} style={{ fontWeight: 600 }}><Count id={`km-row-${m.id}`} value={bal.km[m.id] ?? 0} format={fmtKmSigned} /></div>
              </div>
            ))}
          </div>
          <p className="foot">Positivo: ha guidato più della sua quota. Negativo: ha usato più passaggi. La somma del gruppo è sempre zero.</p>
        </div>

        <div className="section">
          <button className="list" style={{ width: '100%' }} onClick={() => push({ s: 'money' })}>
            <span className="row">
              <span className="avatar" style={{ width: 36, height: 36, background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon n="euro" size={20} /></span>
              <span className="grow"><div className="t">Pedaggi</div><div className="s">{myEur > 0 ? 'Ti devono' : myEur < 0 ? 'Devi' : 'Sei in pari'}{myEur !== 0 && <b className={`num ${myEur > 0 ? 'pos' : 'neg'}`}> {fmtEur(myEur)}</b>}</div></span>
              <span className="chev"><Icon n="chev" size={18} /></span>
            </span>
          </button>
        </div>

        <div className="section tiles">
          <button className="tile" onClick={() => push({ s: 'history' })}><span className="ic"><Icon n="history" size={26} /></span><span><div className="t">Storico</div><div className="s">{confirmed.length ? `${confirmed.length} ${confirmed.length === 1 ? 'viaggio' : 'viaggi'} · ${fmtKm(confirmed.reduce((a, t) => a + tripEffect(t).realMeters, 0))}` : 'Ancora nessun viaggio'}</div></span></button>
          <button className="tile" onClick={() => push({ s: 'places' })}><span className="ic"><Icon n="pin" size={26} /></span><span><div className="t">Luoghi</div><div className="s">{data.places.length ? `${data.places.length} salvati` : 'Locali e ritrovi'}</div></span></button>
        </div>

        <div className="section">
          <div className="list"><button className="row" onClick={() => push({ s: 'plan', mode: 'record' })}>
            <span className="avatar" style={{ width: 36, height: 36, background: 'var(--fill)', color: 'var(--text)' }}><Icon n="plus" size={20} /></span>
            <span className="grow"><div className="t">Registra un viaggio già fatto</div></span><span className="chev"><Icon n="chev" size={18} /></span>
          </button></div>
        </div>
      </div>
      <div className="cta"><Btn icon="car" onClick={() => push({ s: 'plan', mode: 'plan' })}>Organizza uscita</Btn></div>
    </div>
  )
}
