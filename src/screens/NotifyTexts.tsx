import { useRef, useState } from 'react'
import { useApp } from '../app'
import { BODY_MAX, NOTIFY_DEFAULTS, NOTIFY_INFO, NOTIFY_KINDS, TITLE_MAX, preview, textFor, unknownVars, type NotifyKind, type NotifyText, type NotifyTexts } from '../lib/notifyTexts'
import { store } from '../lib/store'
import { Btn, Sheet, useBusy, useToast } from '../ui/kit'

/** Testi delle notifiche: li scrive chi ha creato il gruppo, gli altri li leggono. */
export function NotifyTextsSheet({ onClose }: { onClose: () => void }) {
  const { data, me, reload } = useApp()
  const toast = useToast()
  const [busy, run] = useBusy()
  const owner = data.group.owner ?? null
  const mine = !!owner && owner === me.userId
  const ownerName = data.members.find((m) => m.userId === owner)?.name
  const [draft, setDraft] = useState<Record<NotifyKind, NotifyText>>(() => Object.fromEntries(NOTIFY_KINDS.map((k) => [k, { ...textFor(data.group.settings.notifyTexts, k) }])) as Record<NotifyKind, NotifyText>)
  const fields = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({})
  const last = useRef<{ k: NotifyKind; f: 'title' | 'body' } | null>(null)

  const set = (k: NotifyKind, f: 'title' | 'body', v: string) => setDraft((d) => ({ ...d, [k]: { ...d[k], [f]: v } }))
  /** Inserisce {parola} dove si trova il cursore (nell'ultimo campo toccato di quella notifica). */
  const insert = (k: NotifyKind, word: string) => {
    const f = last.current?.k === k ? last.current.f : 'body'
    const el = fields.current[`${k}-${f}`]
    const cur = draft[k][f], tag = `{${word}}`
    const max = f === 'title' ? TITLE_MAX : BODY_MAX
    if (cur.length + tag.length > max) { toast('Testo già al massimo della lunghezza'); return }
    const a = el?.selectionStart ?? cur.length, b = el?.selectionEnd ?? cur.length
    set(k, f, cur.slice(0, a) + tag + cur.slice(b))
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + tag.length, a + tag.length) })
  }
  const bad = NOTIFY_KINDS.some((k) => !draft[k].title.trim() || unknownVars(k, draft[k].title + draft[k].body).length)
  const save = () => run(async () => {
    const out: NotifyTexts = {}
    for (const k of NOTIFY_KINDS) {
      const t = { title: draft[k].title.trim(), body: draft[k].body.trim() }
      if (t.title !== NOTIFY_DEFAULTS[k].title || t.body !== NOTIFY_DEFAULTS[k].body) out[k] = t
    }
    await store.setNotifyTexts(data.group.id, Object.keys(out).length ? out : null)
    await reload()
    toast('Testi delle notifiche salvati', 'pos')
    onClose()
  })

  return (
    <Sheet title="Testi delle notifiche" onClose={onClose} footer={mine ? <><Btn busy={busy} disabled={bad} onClick={save}>Salva testi</Btn></> : undefined}>
      <p className="caption" style={{ margin: '0 4px 12px' }}>{mine
        ? 'Scrivi tu cosa arriva sul telefono. Le parole tra graffe si riempiono da sole: tocca un\'etichetta per inserirla dove sei.'
        : `Questi testi li sceglie ${ownerName ?? 'chi ha creato il gruppo'}.`}</p>
      {NOTIFY_KINDS.map((k) => {
        const info = NOTIFY_INFO[k], t = draft[k], p = preview(k, t)
        const unknown = unknownVars(k, t.title + t.body)
        const changed = t.title !== NOTIFY_DEFAULTS[k].title || t.body !== NOTIFY_DEFAULTS[k].body
        return (
          <div className="card nt-card" key={k}>
            <div className="nt-h"><b>{info.label}</b>{mine && changed && <button className="link" onClick={() => setDraft((d) => ({ ...d, [k]: { ...NOTIFY_DEFAULTS[k] } }))}>Testo originale</button>}</div>
            <p className="nt-when">{info.when}</p>
            <label className="label" htmlFor={`${k}-title`}>Titolo</label>
            <input id={`${k}-title`} className="field on-card" value={t.title} maxLength={TITLE_MAX} readOnly={!mine}
              ref={(el) => { fields.current[`${k}-title`] = el }} onFocus={() => { last.current = { k, f: 'title' } }} onChange={(e) => set(k, 'title', e.target.value)} />
            <label className="label" htmlFor={`${k}-body`} style={{ marginTop: 10 }}>Messaggio</label>
            <textarea id={`${k}-body`} className="field on-card nt-body" rows={2} value={t.body} maxLength={BODY_MAX} readOnly={!mine}
              ref={(el) => { fields.current[`${k}-body`] = el }} onFocus={() => { last.current = { k, f: 'body' } }} onChange={(e) => set(k, 'body', e.target.value)} />
            {mine && <div className="nt-vars" aria-label="Parole da inserire">{info.vars.map((v) => (
              <button key={v.k} type="button" className="nt-var" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(k, v.k)}>{`{${v.k}}`}<span>{v.hint}</span></button>
            ))}</div>}
            {unknown.length > 0 && <p className="nt-warn">Parole non valide per questa notifica: {unknown.map((u) => `{${u}}`).join(', ')}</p>}
            {!t.title.trim() && <p className="nt-warn">Il titolo non può restare vuoto.</p>}
            <div className="nt-preview" aria-label="Anteprima">
              <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={34} height={34} />
              <span className="grow"><span className="nt-app">SHOTGUN · ora</span><b>{p.title || ' '}</b><span>{p.body}</span>
                {k === 'new_trip' && <span className="nt-action">Shotgun!</span>}</span>
            </div>
          </div>
        )
      })}
    </Sheet>
  )
}
