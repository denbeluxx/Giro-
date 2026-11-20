import { useEffect, useState } from 'react'
import { useApp } from '../app'
import { displayRound } from '../lib/calc'
import { fmtDate, fmtEur, fmtKmSigned, fmtTime, kmNum, roundKm } from '../lib/format'
import { SIM } from '../lib/routing'
import { store } from '../lib/store'
import type { Trip } from '../lib/types'
import { Avatar, Btn, Count, Icon, Sheet, led } from '../ui/kit'
import { clearDraft, loadDraft } from './Plan'
import { frontSeat, lostDays, perfectEven, saint, titles } from '../lib/eggs'
import { enablePush, usePush } from '../lib/push'

export const tone = (v: number) => (roundKm(v) > 0 ? 'pos' : roundKm(v) < 0 ? 'neg' : 'dim')

export function Home() {
  const { data, bal, me, active, push, byId } = useApp()
  // saldi arrotondati al decimo con somma visibile zero; compare anche chi ha lasciato il gruppo con un saldo aperto
  const shown = displayRound(bal.km)
  const left = data.members.filter((m) => m.leftAt && (shown[m.id] ?? 0) !== 0)
  const my = shown[me.id] ?? 0, myEur = bal.eur[me.id] ?? 0
  const pari = perfectEven(me.id, shown, data.trips)
  const planned = data.trips.filter((t) => t.status === 'planned').sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))
  const now = new Date().toISOString()
  const due = planned.filter((t) => t.startsAt < now).reverse()
  const next = planned.find((t) => t.startsAt >= now)
  const meaning = pari ? 'Pari perfetto: neanche un metro di differenza con il gruppo.' : my > 0 ? 'Hai guidato più della tua quota: il gruppo ti deve dei passaggi.' : my < 0 ? 'Hai usato più passaggi di quanti ne hai dati: tocca a te recuperare.' : 'Sei in pari: hai guidato esattamente la tua quota.'
  const ranked = [...active, ...left].sort((a, b) => (shown[a.id] ?? 0) - (shown[b.id] ?? 0))
  const [, force] = useState(0)
  // easter egg: titoli, medaglia, dispersi, pari perfetto
  const ttl = titles(shown, active.map((m) => m.id))
  const santo = saint(data.trips)
  const [party, setParty] = useState(false)
  useEffect(() => {
    // festa una volta sola, quando il tuo saldo arriva a 0,0 da un valore diverso
    const k = `shotgun-lastbal-${data.group.id}-${me.id}`
    let prev: string | null = null
    try { prev = localStorage.getItem(k); localStorage.setItem(k, String(my)) } catch { /* */ }
    if (pari && prev != null && Number(prev) !== 0) { setParty(true); const t = setTimeout(() => setParty(false), 3200); return () => clearTimeout(t) }
  }, [my, pari, data.group.id, me.id])
  const [ask, setAsk] = useState(false)
  const draft = loadDraft(data.group.id)
  const [push$, setPush] = usePush()
  const [pushHidden, setPushHidden] = useState(() => { try { return localStorage.getItem('shotgun-push-hidden') === '1' } catch { return false } })
  const [pushBusy, setPushBusy] = useState(false)
  const [pushErr, alertMsg] = useState<string | undefined>()
  const hidePush = () => { setPushHidden(true); try { localStorage.setItem('shotgun-push-hidden', '1') } catch { /* */ } }
  const turnOn = async () => {
    if (pushBusy) return
    setPushBusy(true)
    try { const s = await enablePush(); setPush(s); if (s === 'on') hidePush() } catch (e: any) { setPush('off'); alertMsg(e?.message) } finally { setPushBusy(false) }
  }

  const banner = (t: Trip, hot: boolean) => {
    const d = byId(t.legs[0]?.driverId)
    return (
      <button key={t.id} className={`banner lit${hot ? ' hot' : ''}`} onClick={() => push({ s: 'trip', id: t.id })} style={{ marginTop: 12, ...(hot ? {} : led(d)) }}>
        <span className="ic"><Icon n={hot ? 'check' : 'clock'} size={24} /></span>
        <span className="grow" style={{ flex: 1, minWidth: 0 }}>
          <div className="kicker">{hot ? 'Conferma il viaggio' : 'Prossima uscita'}</div>
          <div className="bt">{t.dest.name}</div>
          <div className="s">{fmtDate(t.startsAt)} {fmtTime(t.startsAt)} · {d ? `${hot ? 'guidava' : 'guida'} ${d.name}` : 'conducente da decidere'}{!hot && (() => { const h = frontSeat(t, data.shotguns, me.id).holder; return h ? ` · davanti ${h === me.id ? 'tu' : byId(h)?.name}` : '' })()}</div>
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
        <button onClick={() => push({ s: 'members' })} style={{ display: 'block' }}><div className="kicker">Gruppo</div><h1 className="title">{data.group.name}</h1></button>

        <div className={`card hero lit${my > 0 ? ' lit-pos' : my < 0 ? ' lit-neg' : ''}${pari ? ' pari' : ''}${party ? ' party' : ''}`} style={{ marginTop: 16 }}>
          <div className="k">Il tuo saldo di guida{pari && <span className="pill rainbow" style={{ marginLeft: 8 }}>Pari perfetto</span>}</div>
          <div className="big"><span className="chrome-t num"><Count id={`km-${me.id}`} value={my} format={(v) => { const x = roundKm(v); return `${x > 0 ? '+' : x < 0 ? '−' : ''}${kmNum(x)}` }} /></span><small>km</small></div>
          <p className="caption">{meaning}</p>
          <button className="hchip" onClick={() => push({ s: 'money' })}><span className="k">Pedaggi<Icon n="chev" size={14} /></span><span className="v">{myEur > 0 ? 'Ti devono ' : myEur < 0 ? 'Devi ' : 'In pari'}{myEur !== 0 && <b className={`num ${myEur > 0 ? 'pos' : 'neg'}`}>{fmtEur(myEur)}</b>}</span></button>
        </div>

        {draft && <div className="banner draft" style={{ marginTop: 12 }}>
          <span className="ic"><Icon n="edit" size={22} /></span>
          <button className="grow" style={{ flex: 1, minWidth: 0, textAlign: 'left' }} onClick={() => push({ s: 'plan', mode: draft.mode, resume: true })}>
            <div style={{ fontWeight: 600 }}>Riprendi l'uscita in preparazione</div>
            <div className="s">{draft.dest?.name ?? 'Destinazione da scegliere'} · {draft.present.length} {draft.present.length === 1 ? 'persona' : 'persone'}</div>
          </button>
          <button className="nav-btn" aria-label="Elimina la bozza" onClick={() => { clearDraft(data.group.id); force((x) => x + 1) }}><Icon n="x" size={20} /></button>
        </div>}
        {!pushHidden && (push$ === 'off' || push$ === 'needs-home') && <div className="notify-banner">
          <Icon n="bell" size={24} />
          <span className="grow" style={{ flex: 1, minWidth: 0 }}>
            <div className="t">{push$ === 'off' ? 'Attiva le notifiche' : 'Notifiche su iPhone'}</div>
            <div className="s">{pushErr ?? (push$ === 'off' ? 'Ti avvisiamo delle nuove uscite, così puoi chiamare Shotgun per primo.' : 'Aggiungi Shotgun alla schermata Home (Condividi → «Aggiungi alla schermata Home») e aprila da lì.')}</div>
          </span>
          {push$ === 'off' && <Btn small busy={pushBusy} onClick={turnOn}>Attiva</Btn>}
          <button className="nav-btn" aria-label="Non ora" onClick={hidePush}><Icon n="x" size={20} /></button>
        </div>}
        {due.slice(0, 2).map((t) => banner(t, true))}
        {due.length > 2 && <button className="link-under" onClick={() => push({ s: 'history' })}>Altri {due.length - 2} viaggi da confermare nello storico</button>}
        {next && banner(next, false)}

        <div className="section">
          <div className="section-h"><h2>Saldi di guida</h2></div>
          <div className="list">
            {ranked.map((m) => (
              <div className="row" key={m.id}>
                <Avatar m={m} />
                <div className="grow">
                  <div className="name-line"><span className="t">{m.name}{m.id === me.id && <span className="dim"> · tu</span>}</span>
                    {ttl.pilota === m.id && <span className="pill pos">Pilota</span>}
                    {ttl.parassita === m.id && <span className="pill neg">Parassita</span>}
                    {santo?.id === m.id && <span className="pill saint" title={`Ha guidato le ultime ${santo.streak} uscite`}>Santo protettore</span>}
                  </div>
                  <div className="s">{(() => {
                    if (m.leftAt) return 'Ha lasciato il gruppo'
                    const lost = lostDays(m, data.trips)
                    if (lost != null) return `Disperso da ${lost} giorni`
                    return bal.lastDrove[m.id] ? `Ultima guida ${fmtDate(bal.lastDrove[m.id]!)}` : 'Non ha ancora guidato'
                  })()}</div></div>
                <div className={`v strong ${tone(shown[m.id] ?? 0)}`}><Count id={`km-row-${m.id}`} value={shown[m.id] ?? 0} format={fmtKmSigned} /></div>
              </div>
            ))}
          </div>
        </div>

        <div className="section tiles">
          <button className="tile" onClick={() => push({ s: 'history' })}><span className="ic"><Icon n="history" size={26} /></span><span className="t">Storico</span></button>
          <button className="tile" onClick={() => push({ s: 'places' })}><span className="ic"><Icon n="pin" size={26} /></span><span className="t">Luoghi</span></button>
        </div>

        <div className="section">
          <div className="list"><button className="row" onClick={() => push({ s: 'plan', mode: 'record' })}>
            <span className="avatar ic-tile gray"><Icon n="plus" size={20} /></span>
            <span className="grow"><div className="t wrap-t">Registra un viaggio già fatto</div></span><span className="chev"><Icon n="chev" size={18} /></span>
          </button></div>
        </div>
      </div>
      <div className="cta"><Btn icon="car" onClick={() => (draft ? setAsk(true) : push({ s: 'plan', mode: 'plan' }))}>Organizza uscita</Btn></div>
      {ask && draft && <Sheet title="Hai un'uscita in preparazione" onClose={() => setAsk(false)} footer={<><Btn onClick={() => { setAsk(false); push({ s: 'plan', mode: draft.mode, resume: true }) }}>Riprendi {draft.dest?.name ?? 'la bozza'}</Btn><div style={{ height: 8 }} /><Btn kind="gray" onClick={() => { clearDraft(data.group.id); setAsk(false); push({ s: 'plan', mode: 'plan' }) }}>Nuova uscita (elimina la bozza)</Btn></>}>
        <p style={{ margin: '0 4px', lineHeight: 1.4 }}>Vuoi continuare quella o ricominciare da capo?</p></Sheet>}
    </div>
  )
}
