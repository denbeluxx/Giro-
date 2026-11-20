import { useState } from 'react'
import { useApp } from '../app'
import { displayRound, settleUp, tripEffect } from '../lib/calc'
import { fmtDate, fmtDateYear, fmtEur, fmtEurSigned, fmtKm, fmtKmSigned, parseNum } from '../lib/format'
import { inviteLink, whatsappUrl } from '../lib/share'
import { store } from '../lib/store'
import { resetDemo, setDemoIdentity } from '../lib/store/local'
import { TARIFF_DATE, TARIFF_SOURCE, gateName } from '../lib/tolls'
import { nightOwl, recordTripId } from '../lib/eggs'
import { PUSH_TEXT, disablePush, enablePush, usePush } from '../lib/push'
import { uid, type ID, type Place, type Trip } from '../lib/types'
import { Avatar, Btn, Empty, Icon, Seg, Sheet, Switch, useBusy, useToast, led } from '../ui/kit'
import { PlaceSearch } from '../ui/PlaceSearch'
import { useInTabs } from '../ui/Tabs'
import { NotifyTextsSheet } from './NotifyTexts'

export function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  const { pop } = useApp()
  // nelle sezioni affiancate niente «Indietro»: si scorre o si tocca la barra
  if (useInTabs()) return <div className="page-head"><h1 className="title">{title}</h1>{right}</div>
  return <><div className="nav"><button className="nav-btn" onClick={pop}><Icon n="back" />Indietro</button><span className="spacer" />{right}</div><div style={{ padding: '0 var(--pad) 10px' }}><h1 className="title">{title}</h1></div></>
}

export function StatusPill({ t }: { t: Trip }) {
  if (t.status === 'cancelled') return <span className="pill neg">Annullato</span>
  if (t.status === 'confirmed') return <span className="pill pos">Confermato</span>
  return t.startsAt < new Date().toISOString() ? <span className="pill warn">Da confermare</span> : <span className="pill accent">In programma</span>
}

export function History() {
  const { data, byId, push } = useApp()
  const trips = [...data.trips].sort((a, b) => (a.startsAt > b.startsAt ? -1 : 1))
  const record = recordTripId(data.trips)
  return (
    <div className="screen"><Header title="Storico" />
      <div className="scroll">
        {!trips.length ? <Empty icon="history" title="Nessuna uscita" text="Le uscite organizzate e i viaggi confermati compaiono qui, con percorso e calcoli."><Btn onClick={() => push({ s: 'plan', mode: 'plan' })}>Organizza uscita</Btn></Empty> : (
          <div className="list">{trips.map((t) => {
            const e = tripEffect(t)
            const drivers = [...new Set(t.legs.map((l) => l.driverId).filter(Boolean))].map((id) => byId(id)?.name).join(' e ')
            return (
              <button className={`row${t.status === 'cancelled' ? ' cancelled' : ''}`} key={t.id} onClick={() => push({ s: 'trip', id: t.id })}>
                <span className="grow"><div className="t" style={{ fontWeight: 600 }}>{t.dest.name}</div><div className="s wrap">{fmtDateYear(t.startsAt)} · {drivers ? `guida ${drivers}` : 'conducente da decidere'}</div>{(record === t.id || (t.status !== 'cancelled' && nightOwl(t))) && <div className="egg-pills">{record === t.id && <span className="pill trophy">Record</span>}{t.status !== 'cancelled' && nightOwl(t) && <span className="pill owl">Nottambuli</span>}</div>}</span>
                <span style={{ textAlign: 'right', flex: 'none' }}><div className="num" style={{ fontSize: 16 }}>{e.realMeters ? fmtKm(e.realMeters) : '—'}</div><div style={{ marginTop: 3 }}><StatusPill t={t} /></div></span>
                <span className="chev"><Icon n="chev" size={18} /></span>
              </button>
            )
          })}</div>
        )}
      </div>
    </div>
  )
}

export function Places() {
  const { data, active, reload } = useApp()
  const [add, setAdd] = useState(false)
  const [draft, setDraft] = useState<Place | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, run] = useBusy()
  const toast = useToast()
  const homes = active.filter((m) => m.home && m.homeShared)
  const kinds = { locale: 'Locale', ritrovo: 'Punto di ritrovo', altro: 'Altro' } as const
  return (
    <div className="screen"><Header title="Luoghi" right={<button className="nav-btn" onClick={() => setAdd(true)} aria-label="Aggiungi luogo"><Icon n="plus" /></button>} />
      <div className="scroll">
        {!data.places.length ? <Empty icon="pin" title="Nessun luogo salvato" text="Salva locali, discoteche e punti di ritrovo: li ritrovi con un tocco quando organizzi un'uscita."><Btn onClick={() => setAdd(true)}>Aggiungi un luogo</Btn></Empty> : (
          <div className="list">{data.places.map((p) => (
            <button className="row" key={p.id} onClick={() => setDraft(p)}>
              <span className="avatar ic-tile"><Icon n={p.kind === 'ritrovo' ? 'flag' : 'pin'} size={19} /></span>
              <span className="grow"><div className="t">{p.name}</div><div className="s">{kinds[p.kind]}{p.address ? ` · ${p.address}` : ''}</div></span>
              <span className="chev"><Icon n="chev" size={18} /></span>
            </button>
          ))}</div>
        )}
        {homes.length > 0 && <div className="section"><div className="section-h"><h2>Case condivise</h2></div>
          <div className="list">{homes.map((m) => <div className="row" key={m.id}><Avatar m={m} /><div className="grow"><div className="t">Casa di {m.name}</div><div className="s">{m.home!.label}</div></div></div>)}</div>
          <p className="foot">Ognuno decide dal proprio profilo se rendere la casa disponibile al gruppo.</p></div>}
      </div>
      {add && <Sheet title="Nuovo luogo" onClose={() => setAdd(false)}><PlaceSearch autoFocus onPick={(f) => { const dup = data.places.find((p) => Math.abs(p.lat - f.lat) < 0.0008 && Math.abs(p.lng - f.lng) < 0.0008); setAdd(false); if (dup) { toast(`«${dup.name}» è già tra i luoghi salvati`); setDraft(dup) } else setDraft({ id: uid(), name: f.name, address: f.address, lat: f.lat, lng: f.lng, kind: 'locale' }) }} /></Sheet>}
      {draft && <Sheet title={data.places.some((p) => p.id === draft.id) ? 'Modifica luogo' : 'Salva luogo'} onClose={() => setDraft(null)}
        footer={<><Btn busy={busy} disabled={!draft.name.trim()} onClick={() => run(async () => { await store.savePlace(data.group.id, { ...draft, name: draft.name.trim() }); await reload(); setDraft(null) })}>Salva</Btn>
          {data.places.some((p) => p.id === draft.id) && <Btn kind="danger" onClick={() => setConfirmDel(true)}>Elimina luogo</Btn>}</>}>
        <label className="label" htmlFor="pn">Nome</label>
        <input id="pn" className="field" maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        {draft.address && <p className="foot">{draft.address}</p>}
        <div style={{ height: 16 }} />
        <Seg value={draft.kind} onChange={(kind) => setDraft({ ...draft, kind })} options={[{ v: 'locale', l: 'Locale' }, { v: 'ritrovo', l: 'Ritrovo' }, { v: 'altro', l: 'Altro' }]} />
      </Sheet>}
      {confirmDel && draft && <Sheet title={`Eliminare «${draft.name}»?`} onClose={() => setConfirmDel(false)} footer={<><Btn busy={busy} className="btn-danger" onClick={() => run(async () => { await store.deletePlace(data.group.id, draft.id); await reload(); setConfirmDel(false); setDraft(null); toast('Luogo eliminato') })}>Elimina luogo</Btn><div style={{ height: 8 }} /><Btn kind="gray" onClick={() => setConfirmDel(false)}>Annulla</Btn></>}>
        <p style={{ margin: '0 4px', lineHeight: 1.4 }}>Non comparirà più tra le scelte rapide. Le uscite già fatte non cambiano.</p></Sheet>}
    </div>
  )
}

export function Money() {
  const { data, bal, me, active, byId, reload } = useApp()
  const toast = useToast()
  const [pay, setPay] = useState<{ from: ID; to: ID | null; amount: string } | null>(null)
  const [ask, setAsk] = useState<null | { title: string; text: string; ok: string; run: () => Promise<void> }>(null)
  const [busy, run] = useBusy()
  const plan = settleUp(Object.fromEntries(Object.entries(bal.eur)))
  const tolls = Object.entries(data.group.settings.tolls ?? {})
  const any = Object.values(bal.eur).some((v) => v !== 0)
  // anche chi ha lasciato il gruppo con pedaggi aperti resta visibile, così i conti tornano
  const people = [...active, ...data.members.filter((m) => m.leftAt && (bal.eur[m.id] ?? 0) !== 0)]
  const amount = pay ? parseNum(pay.amount, 10000) : null
  const amountOk = amount != null && amount >= 0.01
  const save = () => run(async () => {
    const v = amount
    if (!v || v < 0.01 || !pay?.to) throw new Error('Inserisci un importo valido')
    await store.addSettlement({ id: uid(), groupId: data.group.id, from: pay!.from, to: pay!.to, cents: Math.round(v * 100), createdAt: new Date().toISOString(), createdBy: me.id })
    await reload(); setPay(null); toast('Rimborso registrato')
  })
  return (
    <div className="screen"><Header title="Pedaggi" />
      <div className="scroll">
        <div className="list">{people.map((m) => (
          <div className="row" key={m.id}><Avatar m={m} /><div className="grow"><div className="t">{m.name}{m.id === me.id && <span className="dim"> · tu</span>}</div>{m.leftAt && <div className="s">Ha lasciato il gruppo</div>}</div>
            <div className={`v strong num ${(bal.eur[m.id] ?? 0) > 0 ? 'pos' : (bal.eur[m.id] ?? 0) < 0 ? 'neg' : ''}`}>{fmtEurSigned(bal.eur[m.id] ?? 0)}</div></div>
        ))}</div>
        <p className="foot">Chi paga il pedaggio lo anticipa per tutti gli occupanti del tratto, sé compreso.</p>

        <div className="section"><div className="section-h"><h2>Per andare in pari</h2></div>
          {!plan.length ? <p className="caption" style={{ margin: '0 6px' }}>{any ? 'Saldi residui inferiori al centesimo.' : 'Nessun rimborso da fare: siete in pari.'}</p> : (
            <div className="list">{plan.map((p, i) => (
              <button className="row" key={i} onClick={() => setPay({ from: p.from, to: p.to, amount: (p.cents / 100).toFixed(2).replace('.', ',') })}>
                <Avatar m={byId(p.from)} size={32} /><span className="grow"><div className="t">{byId(p.from)?.name} → {byId(p.to)?.name}</div><div className="s">Tocca per registrare il rimborso</div></span><span className="v num" style={{ color: 'var(--text)', fontWeight: 600 }}>{fmtEur(p.cents)}</span>
              </button>
            ))}</div>
          )}
          <div style={{ height: 12 }} />
          {people.length > 1 && <Btn kind="tinted" onClick={() => setPay({ from: me.id, to: null, amount: '' })}>Registra un rimborso</Btn>}
        </div>

        {data.settlements.length > 0 && <div className="section"><div className="section-h"><h2>Rimborsi registrati</h2></div>
          <div className="list">{data.settlements.map((s) => (
            <div className="row" key={s.id}><div className="grow"><div className="t">{byId(s.from)?.name} → {byId(s.to)?.name}</div><div className="s">{fmtDate(s.createdAt)} · inserito da {byId(s.createdBy)?.name}</div></div><span className="v num">{fmtEur(s.cents)}</span>
              <button className="nav-btn" style={{ color: 'var(--danger)' }} aria-label="Elimina rimborso" onClick={() => setAsk({ title: 'Eliminare il rimborso?', text: `${byId(s.from)?.name} → ${byId(s.to)?.name}, ${fmtEur(s.cents)}. I saldi in euro tornano come prima del rimborso.`, ok: 'Elimina rimborso', run: async () => { await store.deleteSettlement(data.group.id, s.id); await reload(); toast('Rimborso eliminato') } })}><Icon n="trash" size={20} /></button></div>
          ))}</div></div>}

        {tolls.length > 0 && <div className="section"><div className="section-h"><h2>Tariffe scritte dal gruppo</h2></div>
            <div className="list">{tolls.map(([k, t]) => { const [a, b] = k.split('|'); return (
              <div className="row" key={k}><div className="grow"><div className="t">{gateName(a)} ⇄ {gateName(b)}</div><div className="s">Classe A · scritta da {byId(t.by)?.name ?? 'un membro'} il {fmtDate(t.on)}</div></div><span className="v num">{fmtEur(t.cents)}</span>
                <button className="nav-btn" style={{ color: 'var(--danger)' }} aria-label="Rimuovi tariffa" onClick={() => setAsk({ title: 'Rimuovere la tariffa?', text: `${gateName(a)} ⇄ ${gateName(b)}, ${fmtEur(t.cents)}. Tornerà a valere la tariffa ufficiale.`, ok: 'Rimuovi tariffa', run: async () => { await store.setGroupToll(data.group.id, k, null); await reload() } })}><Icon n="trash" size={20} /></button></div>
            ) })}</div>
</div>}
        <p className="foot" style={{ marginTop: 18 }}>I pedaggi dell'A4 tra Milano Est e Brescia Est si calcolano da soli con le tariffe ufficiali (classe A, {TARIFF_SOURCE}, aggiornate al {TARIFF_DATE.split('-').reverse().join('/')}). A35 e altre autostrade si scrivono a mano.</p>
      </div>
      {pay && <Sheet title="Rimborso" onClose={() => setPay(null)} footer={<>{!pay.to && <p className="cta-hint">Scegli a chi va il rimborso.</p>}<Btn busy={busy} disabled={!pay.to || pay.from === pay.to || !amountOk} onClick={save}>Registra rimborso</Btn></>}>
        <p className="label">Chi paga</p>
        <div className="chips">{people.map((m) => <button key={m.id} className="chip" style={led(m)} aria-pressed={pay.from === m.id} onClick={() => setPay({ ...pay, from: m.id, to: pay.to === m.id ? null : pay.to })}><Avatar m={m} size={34} />{m.name}</button>)}</div>
        <p className="label" style={{ marginTop: 18 }}>A chi</p>
        <div className="chips">{people.filter((m) => m.id !== pay.from).map((m) => <button key={m.id} className="chip" style={led(m)} aria-pressed={pay.to === m.id} onClick={() => setPay({ ...pay, to: m.id })}><Avatar m={m} size={34} />{m.name}</button>)}</div>
        <label className="label" htmlFor="am" style={{ display: 'block', marginTop: 18 }}>Importo in euro</label>
        <input id="am" className="field num" inputMode="decimal" placeholder="0,00" value={pay.amount} aria-invalid={pay.amount !== '' && !amountOk} onChange={(e) => setPay({ ...pay, amount: e.target.value })} style={{ fontSize: 22 }} />
        {pay.amount !== '' && !amountOk && <p className="foot" style={{ color: 'var(--danger)' }}>Scrivi un importo di almeno 0,01 €, ad esempio 2,20.</p>}
      </Sheet>}
      {ask && <Sheet title={ask.title} onClose={() => setAsk(null)} footer={<><Btn busy={busy} className="btn-danger" onClick={() => run(async () => { await ask.run(); setAsk(null) })}>{ask.ok}</Btn><div style={{ height: 8 }} /><Btn kind="gray" onClick={() => setAsk(null)}>Annulla</Btn></>}>
        <p style={{ margin: '0 4px', lineHeight: 1.4 }}>{ask.text}</p></Sheet>}
    </div>
  )
}

export function Members() {
  const { data, me, active, bal, reload, groups, switchGroup, signOut } = useApp()
  const toast = useToast()
  const [sheet, setSheet] = useState<null | 'add' | 'home' | 'homeOff' | 'leave' | 'name' | 'invite' | 'member' | 'memberOff' | 'group' | 'texts'>(null)
  const [editing, setEditing] = useState<ID | null>(null)
  const [name, setName] = useState('')
  const [busy, run] = useBusy()
  const link = inviteLink(data.group.inviteCode)
  const left = data.members.filter((m) => m.leftAt)
  const byIdM = (id: ID) => data.members.find((m) => m.id === id)
  const balNote = (id: ID) => {
    const km = displayRound(bal.km)[id] ?? 0, eur = bal.eur[id] ?? 0
    if (!km && !eur) return 'Il saldo è in pari.'
    return `${id === me.id ? 'Hai' : 'Ha'} ancora un saldo aperto: ${km ? fmtKmSigned(km) : ''}${km && eur ? ' e ' : ''}${eur ? fmtEurSigned(eur) + ' di pedaggi' : ''}.`
  }
  const dupName = (n: string, except?: ID | null) => active.some((m) => m.id !== except && m.name.trim().replace(/\s+/g, ' ').toLowerCase() === n.trim().replace(/\s+/g, ' ').toLowerCase())
  const [push$, setPush] = usePush()
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast('Link copiato') } catch { toast('Copia non riuscita: tieni premuto sul link') } }
  return (
    <div className="screen"><Header title="Gruppo" />
      <div className="scroll">
        <div className="list" style={{ marginBottom: 14 }}><button className="row" onClick={() => { setName(data.group.name); setSheet('group') }}><span className="grow t">Nome del gruppo</span><span className="v">{data.group.name}</span><span className="chev"><Icon n="chev" size={18} /></span></button></div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Invita gli amici</div>
          <p className="caption" style={{ marginBottom: 12 }}>Chi apre il link entra nel gruppo con saldo zero. Il gruppo è privato: lo vede solo chi ne fa parte, quindi condividi il link solo con gli amici.</p>
          <div className="field on-card num" style={{ display: 'flex', alignItems: 'center', fontSize: 13, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', userSelect: 'all', minHeight: 40 }}>{link}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <a className="btn primary small" style={{ flex: 1, textDecoration: 'none' }} href={whatsappUrl(`Entra nel gruppo «${data.group.name}» su Shotgun:${link}`)} target="_blank" rel="noreferrer"><span className="btn-l"><Icon n="wa" size={20} />WhatsApp</span></a>
            <Btn small kind="gray" icon="link" onClick={copy} style={{ flex: 1 }}>Copia link</Btn>
          </div>
          <button className="link-under" onClick={() => setSheet('invite')}>Crea un nuovo link</button>
        </div>

        <div className="section"><div className="section-h"><h2>Membri</h2><button className="link" onClick={() => { setName(''); setSheet('add') }}>Aggiungi</button></div>
          <div className="list">{active.map((m) => {
            const inner = <><Avatar m={m} /><div className="grow"><div className="t">{m.name}{m.id === me.id && <span className="dim"> · tu</span>}</div>
              <div className="s">{!m.userId ? 'Senza app · tocca per modificare' : m.home && m.homeShared ? m.home.label : 'Casa non condivisa'}</div></div></>
            return !m.userId && m.id !== me.id ? <button className="row" key={m.id} onClick={() => { setName(m.name); setEditing(m.id); setSheet('member') }}>{inner}<span className="chev"><Icon n="chev" size={18} /></span></button> : <div className="row" key={m.id}>{inner}</div>
          })}</div>
          {left.length > 0 && <><p className="foot" style={{ marginTop: 14 }}>Hanno lasciato il gruppo (restano nello storico): {left.map((m) => `${m.name} (${fmtKmSigned(displayRound(bal.km)[m.id] ?? 0)})`).join(', ')}</p></>}
        </div>

        <div className="section"><div className="section-h"><h2>Il tuo profilo</h2></div>
          <div className="list">
            <button className="row" onClick={() => { setName(me.name); setSheet('name') }}><span className="grow t">Nome</span><span className="v">{me.name}</span><span className="chev"><Icon n="chev" size={18} /></span></button>
            <button className="row" onClick={() => setSheet('home')}><span className="grow"><div className="t">Casa</div><div className="s">{me.home ? me.home.label : 'Serve per il giro delle case'}</div></span><span className="v">{me.home ? 'Cambia' : 'Imposta'}</span><span className="chev"><Icon n="chev" size={18} /></span></button>
            <div className="row"><div className="grow"><div className="t">Condividi casa con il gruppo</div><div className="s wrap">Gli altri possono usarla come tappa quando organizzano.</div></div>
              <Switch on={me.homeShared && !!me.home} label="Condividi casa con il gruppo" onChange={(v) => run(async () => { await store.updateMe(data.group.id, { homeShared: v }); await reload() })} /></div>
          </div>
        </div>

        {push$ && <div className="section"><div className="section-h"><h2>Notifiche</h2></div>
          <div className="list"><div className="row"><span className="row-ic"><Icon n="bell" /></span><div className="grow"><div className="t">Notifiche su questo telefono</div><div className="s wrap">{PUSH_TEXT[push$]}</div></div>
            {(push$ === 'on' || push$ === 'off') && <Switch on={push$ === 'on'} label="Notifiche su questo telefono" onChange={(v) => run(async () => { const s = v ? await enablePush() : await disablePush(); setPush(s); toast(s === 'on' ? 'Notifiche attive su questo telefono' : s === 'denied' ? 'Notifiche bloccate: riattivale dalle impostazioni del telefono' : 'Notifiche disattivate') })} />}</div>
            <button className="row" onClick={() => setSheet('texts')}><span className="row-ic"><Icon n="edit" /></span><span className="grow"><div className="t">Testi delle notifiche</div>
              <div className="s">{data.group.owner && data.group.owner === me.userId ? (data.group.settings.notifyTexts ? 'Scritti da te' : 'Scrivili tu') : `Li sceglie ${data.members.find((m) => m.userId === data.group.owner)?.name ?? 'chi ha creato il gruppo'}`}</div></span><span className="chev"><Icon n="chev" size={18} /></span></button></div>
          {push$ === 'on' && <p className="foot">Ogni telefono si attiva a parte. Il promemoria dei viaggi da confermare arriva la mattina dopo l'uscita. <button className="link" onClick={() => { store.notify({ type: 'test' }).catch(() => {}); toast('Notifica di prova inviata') }}>Invia una prova</button></p>}
        </div>}

        {store.mode === 'demo' && <div className="section"><div className="section-h"><h2>Modalità dimostrativa</h2></div>
          <p className="caption" style={{ margin: '0 6px 10px' }}>Entra come un altro membro per vedere gli stessi dati dal suo punto di vista. I dati restano su questo dispositivo.</p>
          <div className="chips">{active.map((m) => <button key={m.id} className="chip" style={led(m)} aria-pressed={m.id === me.id} onClick={() => { setDemoIdentity(data.group.id, m.id); reload() }}><Avatar m={m} size={34} />{m.name}</button>)}</div>
          <div style={{ height: 12 }} /><Btn kind="gray" onClick={() => { resetDemo(); reload(); toast('Dati dimostrativi ripristinati') }}>Ripristina i dati dimostrativi</Btn></div>}

        <div className="section"><div className="list">
          {groups.length > 1 && <button className="row" onClick={() => switchGroup(null)}><span className="grow t">Cambia gruppo</span><span className="chev"><Icon n="chev" size={18} /></span></button>}
          <button className="row" onClick={() => switchGroup(null)}><span className="grow t">Crea un altro gruppo</span><span className="chev"><Icon n="chev" size={18} /></span></button>
          <button className="row" onClick={() => setSheet('leave')}><span className="grow t" style={{ color: 'var(--danger)' }}>Lascia il gruppo</span></button>
          {store.mode === 'cloud' && <button className="row" onClick={signOut}><span className="grow t" style={{ color: 'var(--danger)' }}>Esci dall'account</span></button>}
        </div></div>
      </div>

      {sheet === 'add' && <Sheet title="Aggiungi membro" onClose={() => setSheet(null)} footer={<Btn busy={busy} disabled={!name.trim() || dupName(name)} onClick={() => run(async () => { await store.addMember(data.group.id, name.trim()); await reload(); setSheet(null) })}>Aggiungi</Btn>}>
        <input className="field" placeholder="Nome" aria-label="Nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
        {dupName(name) && <p className="foot" style={{ color: 'var(--danger)' }}>C'è già qualcuno con questo nome nel gruppo.</p>}
        <p className="foot">Parte da zero: i viaggi già fatti non gli vengono attribuiti. Quando aprirà l'invito potrà collegarsi a questo nome.</p></Sheet>}
      {sheet === 'name' && <Sheet title="Il tuo nome" onClose={() => setSheet(null)} footer={<Btn busy={busy} disabled={!name.trim() || dupName(name, me.id)} onClick={() => run(async () => { await store.updateMe(data.group.id, { name: name.trim() }); await reload(); setSheet(null) })}>Salva</Btn>}>
        <input className="field" aria-label="Nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
        {dupName(name, me.id) && <p className="foot" style={{ color: 'var(--danger)' }}>C'è già qualcuno con questo nome nel gruppo: aggiungi l'iniziale del cognome.</p>}</Sheet>}
      {sheet === 'home' && <Sheet title="Casa tua" onClose={() => setSheet(null)}>
        {me.home && <><p className="label">Indirizzo attuale</p><div className="list" style={{ marginBottom: 16 }}><div className="row"><Icon n="home" /><span className="grow t wrap-t">{me.home.label}</span></div></div><p className="label">Nuovo indirizzo</p></>}
        <PlaceSearch autoFocus={!me.home} placeholder="Via e comune" onPick={(f) => run(async () => { await store.updateMe(data.group.id, { home: { lat: f.lat, lng: f.lng, label: [f.name, f.address].filter(Boolean).join(', ') } }); await reload(); setSheet(null); toast('Casa salvata') })}>
          {me.home && <Btn kind="danger" onClick={() => setSheet('homeOff')}>Rimuovi la casa salvata</Btn>}
        </PlaceSearch></Sheet>}
      {sheet === 'homeOff' && <Sheet title="Rimuovere la casa?" onClose={() => setSheet('home')} footer={<><Btn busy={busy} className="btn-danger" onClick={() => run(async () => { await store.updateMe(data.group.id, { home: null }); await reload(); setSheet(null); toast('Casa rimossa') })}>Rimuovi</Btn><div style={{ height: 8 }} /><Btn kind="gray" onClick={() => setSheet('home')}>Annulla</Btn></>}>
        <p style={{ margin: '0 4px', lineHeight: 1.4 }}>Nelle prossime uscite salirai alla partenza del conducente. Le uscite già salvate non cambiano.</p></Sheet>}
      {sheet === 'member' && editing && <Sheet title="Membro senza account" onClose={() => setSheet(null)} footer={<><Btn busy={busy} disabled={!name.trim() || dupName(name, editing)} onClick={() => run(async () => { await store.renameMember(data.group.id, editing, name.trim()); await reload(); setSheet(null) })}>Salva nome</Btn><div style={{ height: 8 }} /><Btn kind="danger" onClick={() => setSheet('memberOff')}>Togli dal gruppo</Btn></>}>
        <input className="field" aria-label="Nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        {dupName(name, editing) && <p className="foot" style={{ color: 'var(--danger)' }}>C'è già qualcuno con questo nome nel gruppo.</p>}
        <p className="foot">Quando aprirà l'invito potrà collegarsi a questo nome. Se lo togli, i viaggi a cui ha partecipato restano nello storico.</p></Sheet>}
      {sheet === 'memberOff' && editing && <Sheet title={`Togliere ${byIdM(editing)?.name} dal gruppo?`} onClose={() => setSheet('member')} footer={<><Btn busy={busy} className="btn-danger" onClick={() => run(async () => { await store.removeMember(data.group.id, editing); await reload(); setSheet(null); toast('Membro tolto dal gruppo: resta nello storico') })}>Togli dal gruppo</Btn><div style={{ height: 8 }} /><Btn kind="gray" onClick={() => setSheet('member')}>Annulla</Btn></>}>
        <p style={{ margin: '0 4px', lineHeight: 1.4 }}>{balNote(editing)} I viaggi a cui ha partecipato restano nello storico.</p></Sheet>}
      {sheet === 'group' && <Sheet title="Nome del gruppo" onClose={() => setSheet(null)} footer={<Btn busy={busy} disabled={!name.trim() || name.trim() === data.group.name} onClick={() => run(async () => { await store.renameGroup(data.group.id, name.trim()); await reload(); setSheet(null); toast('Gruppo rinominato') })}>Salva nome</Btn>}>
        <input className="field" aria-label="Nome del gruppo" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <p className="foot">Lo vedono tutti i membri.</p></Sheet>}
      {sheet === 'texts' && <NotifyTextsSheet onClose={() => setSheet(null)} />}
      {sheet === 'invite' && <Sheet title="Nuovo link di invito" onClose={() => setSheet(null)} footer={<><Btn busy={busy} onClick={() => run(async () => { await store.regenerateInvite(data.group.id); await reload(); setSheet(null); toast('Nuovo link pronto: il vecchio non funziona più') })}>Crea nuovo link</Btn><div style={{ height: 8 }} /><Btn kind="gray" onClick={() => setSheet(null)}>Annulla</Btn></>}>
        <p style={{ margin: '0 4px', lineHeight: 1.4 }}>Il link attuale smette di funzionare. Chi è già nel gruppo resta dentro. Utile se il link è finito nelle mani sbagliate.</p></Sheet>}
      {sheet === 'leave' && <Sheet title="Lasciare il gruppo?" onClose={() => setSheet(null)} footer={<><Btn busy={busy} className="btn-danger" onClick={() => run(async () => { await store.leaveGroup(data.group.id); window.location.reload() })}>Lascia il gruppo</Btn><div style={{ height: 8 }} /><Btn kind="gray" onClick={() => setSheet(null)}>Resta nel gruppo</Btn></>}>
        <p style={{ margin: '0 4px', lineHeight: 1.4 }}>{balNote(me.id)} I tuoi viaggi restano nello storico e i saldi degli altri non cambiano. Non vedrai più i dati del gruppo finché non rientri con un invito; rientrando ritroverai lo stesso saldo.</p></Sheet>}
    </div>
  )
}
