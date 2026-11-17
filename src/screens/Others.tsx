import { useState } from 'react'
import { getTheme, setTheme, useApp, type Theme } from '../app'
import { settleUp, tripEffect } from '../lib/calc'
import { fmtDate, fmtEur, fmtEurSigned, fmtKm, parseNum } from '../lib/format'
import { inviteLink, whatsappUrl } from '../lib/share'
import { store } from '../lib/store'
import { resetDemo, setDemoIdentity } from '../lib/store/local'
import { gateName } from '../lib/tolls'
import { uid, type ID, type Place, type Trip } from '../lib/types'
import { Avatar, Btn, Empty, Icon, Seg, Sheet, Switch, useBusy, useToast } from '../ui/kit'
import { PlaceSearch } from '../ui/PlaceSearch'

export function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  const { pop } = useApp()
  return <><div className="nav"><button className="nav-btn" onClick={pop}><Icon n="back" />Indietro</button><span className="spacer" />{right}</div><div style={{ padding: '0 var(--pad) 10px' }}><h1 className="title">{title}</h1></div></>
}

export function StatusPill({ t }: { t: Trip }) {
  if (t.status === 'cancelled') return <span className="pill">Annullato</span>
  if (t.status === 'confirmed') return <span className="pill pos">Confermato</span>
  return t.startsAt < new Date().toISOString() ? <span className="pill warn">Da confermare</span> : <span className="pill accent">In programma</span>
}

export function History() {
  const { data, byId, push } = useApp()
  const trips = [...data.trips].sort((a, b) => (a.startsAt > b.startsAt ? -1 : 1))
  return (
    <div className="screen"><Header title="Storico" />
      <div className="scroll">
        {!trips.length ? <Empty icon="history" title="Nessuna uscita" text="Le uscite organizzate e i viaggi confermati compaiono qui, con percorso e calcoli."><Btn onClick={() => push({ s: 'plan', mode: 'plan' })}>Organizza uscita</Btn></Empty> : (
          <div className="list">{trips.map((t) => {
            const e = tripEffect(t)
            const drivers = [...new Set(t.legs.map((l) => l.driverId).filter(Boolean))].map((id) => byId(id)?.name).join(' e ')
            return (
              <button className="row" key={t.id} onClick={() => push({ s: 'trip', id: t.id })} style={{ viewTransitionName: `trip-${t.id}`, opacity: t.status === 'cancelled' ? 0.55 : 1 }}>
                <span className="grow"><div className="t" style={{ fontWeight: 600 }}>{t.dest.name}</div><div className="s">{fmtDate(t.startsAt)} · {drivers ? `guida ${drivers}` : 'conducente da decidere'}</div></span>
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
  const [busy, run] = useBusy()
  const homes = active.filter((m) => m.home && m.homeShared)
  const kinds = { locale: 'Locale', ritrovo: 'Punto di ritrovo', altro: 'Altro' } as const
  return (
    <div className="screen"><Header title="Luoghi" right={<button className="nav-btn" onClick={() => setAdd(true)} aria-label="Aggiungi luogo"><Icon n="plus" /></button>} />
      <div className="scroll">
        {!data.places.length ? <Empty icon="pin" title="Nessun luogo salvato" text="Salva locali, discoteche e punti di ritrovo: li ritrovi con un tocco quando organizzi un'uscita."><Btn onClick={() => setAdd(true)}>Aggiungi un luogo</Btn></Empty> : (
          <div className="list">{data.places.map((p) => (
            <button className="row" key={p.id} onClick={() => setDraft(p)}>
              <span className="avatar" style={{ width: 36, height: 36, background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon n={p.kind === 'ritrovo' ? 'flag' : 'pin'} size={19} /></span>
              <span className="grow"><div className="t">{p.name}</div><div className="s">{kinds[p.kind]}{p.address ? ` · ${p.address}` : ''}</div></span>
              <span className="chev"><Icon n="chev" size={18} /></span>
            </button>
          ))}</div>
        )}
        {homes.length > 0 && <div className="section"><div className="section-h"><h2>Case condivise</h2></div>
          <div className="list">{homes.map((m) => <div className="row" key={m.id}><Avatar m={m} /><div className="grow"><div className="t">Casa di {m.name}</div><div className="s">{m.home!.label}</div></div></div>)}</div>
          <p className="foot">Ognuno decide dal proprio profilo se rendere la casa disponibile al gruppo.</p></div>}
      </div>
      {add && <Sheet title="Nuovo luogo" onClose={() => setAdd(false)}><PlaceSearch autoFocus onPick={(f) => { setAdd(false); setDraft({ id: uid(), name: f.name, address: f.address, lat: f.lat, lng: f.lng, kind: 'locale' }) }} /></Sheet>}
      {draft && <Sheet title={data.places.some((p) => p.id === draft.id) ? 'Modifica luogo' : 'Salva luogo'} onClose={() => setDraft(null)}
        footer={<><Btn busy={busy} disabled={!draft.name.trim()} onClick={() => run(async () => { await store.savePlace(data.group.id, draft); await reload(); setDraft(null) })}>Salva</Btn>
          {data.places.some((p) => p.id === draft.id) && <Btn kind="danger" onClick={() => run(async () => { await store.deletePlace(data.group.id, draft.id); await reload(); setDraft(null) })}>Elimina luogo</Btn>}</>}>
        <label className="label" htmlFor="pn">Nome</label>
        <input id="pn" className="field" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        {draft.address && <p className="foot">{draft.address}</p>}
        <div style={{ height: 16 }} />
        <Seg value={draft.kind} onChange={(kind) => setDraft({ ...draft, kind })} options={[{ v: 'locale', l: 'Locale' }, { v: 'ritrovo', l: 'Ritrovo' }, { v: 'altro', l: 'Altro' }]} />
      </Sheet>}
    </div>
  )
}

export function Money() {
  const { data, bal, me, active, byId, reload } = useApp()
  const toast = useToast()
  const [pay, setPay] = useState<{ from: ID; to: ID; amount: string } | null>(null)
  const [busy, run] = useBusy()
  const plan = settleUp(Object.fromEntries(Object.entries(bal.eur)))
  const tolls = Object.entries(data.group.settings.tolls ?? {})
  const any = Object.values(bal.eur).some((v) => v !== 0)
  const save = () => run(async () => {
    const v = parseNum(pay!.amount)
    if (!v || v <= 0) throw new Error('Inserisci un importo valido')
    await store.addSettlement({ id: uid(), groupId: data.group.id, from: pay!.from, to: pay!.to, cents: Math.round(v * 100), createdAt: new Date().toISOString(), createdBy: me.id })
    await reload(); setPay(null); toast('Rimborso registrato')
  })
  return (
    <div className="screen"><Header title="Pedaggi" />
      <div className="scroll">
        <div className="list">{active.map((m) => (
          <div className="row" key={m.id}><Avatar m={m} /><div className="grow"><div className="t">{m.name}{m.id === me.id && <span className="dim"> · tu</span>}</div><div className="s">{(bal.eur[m.id] ?? 0) > 0 ? 'Deve ricevere' : (bal.eur[m.id] ?? 0) < 0 ? 'Deve dare' : 'In pari'}</div></div>
            <div className={`v num ${(bal.eur[m.id] ?? 0) > 0 ? 'pos' : (bal.eur[m.id] ?? 0) < 0 ? 'neg' : ''}`} style={{ fontWeight: 600 }}>{fmtEurSigned(bal.eur[m.id] ?? 0)}</div></div>
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
          <Btn kind="tinted" onClick={() => setPay({ from: me.id, to: active.find((m) => m.id !== me.id)?.id ?? me.id, amount: '' })}>Registra un rimborso</Btn>
        </div>

        {data.settlements.length > 0 && <div className="section"><div className="section-h"><h2>Rimborsi registrati</h2></div>
          <div className="list">{data.settlements.map((s) => (
            <div className="row" key={s.id}><div className="grow"><div className="t">{byId(s.from)?.name} → {byId(s.to)?.name}</div><div className="s">{fmtDate(s.createdAt)} · inserito da {byId(s.createdBy)?.name}</div></div><span className="v num">{fmtEur(s.cents)}</span>
              <button className="nav-btn" style={{ color: 'var(--danger)' }} aria-label="Elimina rimborso" onClick={() => run(async () => { await store.deleteSettlement(data.group.id, s.id); await reload(); toast('Rimborso eliminato') })}><Icon n="trash" size={20} /></button></div>
          ))}</div></div>}

        <div className="section"><div className="section-h"><h2>Tariffe A4 confermate</h2></div>
          {!tolls.length ? <p className="caption" style={{ margin: '0 6px' }}>Quando confermate l'importo di una tratta, l'app lo ricorda e lo compila da sola le volte successive.</p> : (
            <div className="list">{tolls.map(([k, t]) => { const [a, b] = k.split('|'); return (
              <div className="row" key={k}><div className="grow"><div className="t">{gateName(a)} ⇄ {gateName(b)}</div><div className="s">Classe A · confermata da {byId(t.by)?.name ?? 'un membro'} il {fmtDate(t.on)}</div></div><span className="v num">{fmtEur(t.cents)}</span>
                <button className="nav-btn" style={{ color: 'var(--danger)' }} aria-label="Rimuovi tariffa" onClick={() => run(async () => { const next = { ...(data.group.settings.tolls ?? {}) }; delete next[k]; await store.updateGroup(data.group.id, { settings: { ...data.group.settings, tolls: next } }); await reload() })}><Icon n="trash" size={20} /></button></div>
            ) })}</div>
          )}
          <p className="foot">Copertura: A4 tra Milano Est e Brescia Ovest. A35 e altre autostrade sono segnalate «fuori copertura» e si inseriscono a mano.</p>
        </div>
      </div>
      {pay && <Sheet title="Rimborso" onClose={() => setPay(null)} footer={<Btn busy={busy} disabled={pay.from === pay.to || !parseNum(pay.amount)} onClick={save}>Registra rimborso</Btn>}>
        <p className="label">Chi paga</p>
        <div className="chips">{active.map((m) => <button key={m.id} className="chip" aria-pressed={pay.from === m.id} onClick={() => setPay({ ...pay, from: m.id })}><Avatar m={m} size={34} />{m.name}</button>)}</div>
        <p className="label" style={{ marginTop: 18 }}>A chi</p>
        <div className="chips">{active.filter((m) => m.id !== pay.from).map((m) => <button key={m.id} className="chip" aria-pressed={pay.to === m.id} onClick={() => setPay({ ...pay, to: m.id })}><Avatar m={m} size={34} />{m.name}</button>)}</div>
        <label className="label" htmlFor="am" style={{ display: 'block', marginTop: 18 }}>Importo in euro</label>
        <input id="am" className="field num" inputMode="decimal" placeholder="0,00" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} style={{ fontSize: 22 }} />
      </Sheet>}
    </div>
  )
}

export function Members() {
  const { data, me, active, bal, reload, groups, switchGroup, signOut } = useApp()
  const toast = useToast()
  const [theme, setT] = useState<Theme>(getTheme())
  const [sheet, setSheet] = useState<null | 'add' | 'home' | 'leave' | 'name'>(null)
  const [name, setName] = useState('')
  const [busy, run] = useBusy()
  const link = inviteLink(data.group.inviteCode)
  const left = data.members.filter((m) => m.leftAt)
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast('Link copiato') } catch { toast('Copia non riuscita: tieni premuto sul link') } }
  return (
    <div className="screen"><Header title={data.group.name} />
      <div className="scroll">
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Invita gli amici</div>
          <p className="caption" style={{ marginBottom: 12 }}>Chi apre il link entra nel gruppo con saldo zero. Il gruppo è privato: lo vede solo chi ne fa parte.</p>
          <div className="field on-card num" style={{ display: 'flex', alignItems: 'center', fontSize: 13, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', userSelect: 'all', minHeight: 40 }}>{link}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <a className="btn primary small" style={{ flex: 1, textDecoration: 'none' }} href={whatsappUrl(`Entra nel gruppo «${data.group.name}» su Giro: ${link}`)} target="_blank" rel="noreferrer"><Icon n="wa" size={20} />WhatsApp</a>
            <Btn small kind="gray" icon="link" onClick={copy} style={{ flex: 1 }}>Copia link</Btn>
          </div>
        </div>

        <div className="section"><div className="section-h"><h2>Membri</h2><button className="link" onClick={() => { setName(''); setSheet('add') }}>Aggiungi</button></div>
          <div className="list">{active.map((m) => (
            <div className="row" key={m.id}><Avatar m={m} /><div className="grow"><div className="t">{m.name}{m.id === me.id && <span className="dim"> · tu</span>}</div>
              <div className="s">{!m.userId ? 'Non ha ancora l\'app' : m.home && m.homeShared ? m.home.label : 'Casa non condivisa'}</div></div></div>
          ))}</div>
          {left.length > 0 && <><p className="foot" style={{ marginTop: 14 }}>Hanno lasciato il gruppo (restano nello storico): {left.map((m) => `${m.name} (${(bal.km[m.id] ?? 0) / 1000 >= 0 ? '+' : '−'}${Math.abs((bal.km[m.id] ?? 0) / 1000).toFixed(1).replace('.', ',')} km)`).join(', ')}</p></>}
        </div>

        <div className="section"><div className="section-h"><h2>Il tuo profilo</h2></div>
          <div className="list">
            <button className="row" onClick={() => { setName(me.name); setSheet('name') }}><span className="grow t">Nome</span><span className="v">{me.name}</span><span className="chev"><Icon n="chev" size={18} /></span></button>
            <button className="row" onClick={() => setSheet('home')}><span className="grow"><div className="t">Casa</div><div className="s">{me.home ? me.home.label : 'Serve per il giro delle case'}</div></span><span className="v">{me.home ? 'Cambia' : 'Imposta'}</span><span className="chev"><Icon n="chev" size={18} /></span></button>
            <div className="row"><div className="grow"><div className="t">Condividi casa con il gruppo</div><div className="s wrap">Gli altri possono usarla come tappa quando organizzano.</div></div>
              <Switch on={me.homeShared} label="Condividi casa con il gruppo" onChange={(v) => run(async () => { await store.updateMe(data.group.id, { homeShared: v }); await reload() })} /></div>
          </div>
        </div>

        <div className="section"><div className="section-h"><h2>Aspetto</h2></div>
          <Seg value={theme} onChange={(t) => { setT(t); setTheme(t) }} options={[{ v: 'auto', l: 'Automatico' }, { v: 'light', l: 'Chiaro' }, { v: 'dark', l: 'Scuro' }]} />
        </div>

        {store.mode === 'demo' && <div className="section"><div className="section-h"><h2>Modalità dimostrativa</h2></div>
          <p className="caption" style={{ margin: '0 6px 10px' }}>Entra come un altro membro per vedere gli stessi dati dal suo punto di vista. I dati restano su questo dispositivo.</p>
          <div className="chips">{active.map((m) => <button key={m.id} className="chip" aria-pressed={m.id === me.id} onClick={() => { setDemoIdentity(data.group.id, m.id); reload() }}><Avatar m={m} size={34} />{m.name}</button>)}</div>
          <div style={{ height: 12 }} /><Btn kind="gray" onClick={() => { resetDemo(); reload(); toast('Dati dimostrativi ripristinati') }}>Ripristina i dati dimostrativi</Btn></div>}

        <div className="section"><div className="list">
          {groups.length > 1 && <button className="row" onClick={() => switchGroup(null)}><span className="grow t">Cambia gruppo</span><span className="chev"><Icon n="chev" size={18} /></span></button>}
          <button className="row" onClick={() => switchGroup(null)}><span className="grow t">Crea un altro gruppo</span><span className="chev"><Icon n="chev" size={18} /></span></button>
          <button className="row" onClick={() => setSheet('leave')}><span className="grow t" style={{ color: 'var(--danger)' }}>Lascia il gruppo</span></button>
          {store.mode === 'cloud' && <button className="row" onClick={signOut}><span className="grow t" style={{ color: 'var(--danger)' }}>Esci dall'account</span></button>}
        </div></div>
      </div>

      {sheet === 'add' && <Sheet title="Aggiungi membro" onClose={() => setSheet(null)} footer={<Btn busy={busy} disabled={!name.trim()} onClick={() => run(async () => { await store.addMember(data.group.id, name.trim()); await reload(); setSheet(null) })}>Aggiungi</Btn>}>
        <input className="field" placeholder="Nome" aria-label="Nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
        <p className="foot">Parte da zero: i viaggi già fatti non gli vengono attribuiti. Quando aprirà l'invito potrà collegarsi a questo nome.</p></Sheet>}
      {sheet === 'name' && <Sheet title="Il tuo nome" onClose={() => setSheet(null)} footer={<Btn busy={busy} disabled={!name.trim()} onClick={() => run(async () => { await store.updateMe(data.group.id, { name: name.trim() }); await reload(); setSheet(null) })}>Salva</Btn>}>
        <input className="field" aria-label="Nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus /></Sheet>}
      {sheet === 'home' && <Sheet title="Casa tua" onClose={() => setSheet(null)}>
        <PlaceSearch autoFocus placeholder="Via e comune" onPick={(f) => run(async () => { await store.updateMe(data.group.id, { home: { lat: f.lat, lng: f.lng, label: [f.name, f.address].filter(Boolean).join(', ') } }); await reload(); setSheet(null); toast('Casa salvata') })}>
          {me.home && <Btn kind="danger" onClick={() => run(async () => { await store.updateMe(data.group.id, { home: null }); await reload(); setSheet(null) })}>Rimuovi la casa salvata</Btn>}
        </PlaceSearch></Sheet>}
      {sheet === 'leave' && <Sheet title="Lasciare il gruppo?" onClose={() => setSheet(null)} footer={<Btn busy={busy} style={{ background: 'var(--danger)' }} onClick={() => run(async () => { await store.leaveGroup(data.group.id); window.location.reload() })}>Lascia il gruppo</Btn>}>
        <p style={{ margin: '0 4px', lineHeight: 1.4 }}>I tuoi viaggi restano nello storico e i saldi degli altri non cambiano. Non vedrai più i dati del gruppo finché non rientri con un invito.</p></Sheet>}
    </div>
  )
}
