import { useRef, useState } from 'react'
import { useApp } from '../app'
import { BODY_MAX, NOTIFY_DEFAULTS, NOTIFY_INFO, NOTIFY_KINDS, TITLE_MAX, preview, strayBraces, textFor, textsEditor, unknownVars, visible, type NotifyKind, type NotifyText, type NotifyTexts } from '../lib/notifyTexts'
import { store } from '../lib/store'
import { Btn, Sheet, useBusy, useToast } from '../ui/kit'

/** Testi delle notifiche: li scrive chi ha creato il gruppo, gli altri li leggono. */
export function NotifyTextsSheet({ onClose }: { onClose: () => void }) {
  const { data, me, reload } = useApp()
  const toast = useToast()
  const [busy, run] = useBusy()
  const owner = textsEditor(data.group, data.members)
  const mine = !!owner && owner === me.userId
  const ownerName = data.members.find((m) => m.userId === owner)?.name
  const [draft, setDraft] = useState<Record<NotifyKind, NotifyText>>(() => Object.fromEntries(NOTIFY_KINDS.map((k) => [k, { ...textFor(data.group.settings.notifyTexts, k) }])) as Record<NotifyKind, NotifyText>)
  const fields = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({})
  // ultimo campo toccato per ogni notifica, con la posizione del cursore
  const last = useRef<Partial<Record<NotifyKind, 'title' | 'body'>>>({})
  const touched = useRef(new Set<string>())
  const initial = useRef(JSON.stringify(draft))
  const [askLeave, setAskLeave] = useState(false)
  const dirty = mine && JSON.stringify(draft) !== initial.current

  const set = (k: NotifyKind, f: 'title' | 'body', v: string) => setDraft((d) => ({ ...d, [k]: { ...d[k], [f]: v } }))
  /** Inserisce {parola} dove si trova il cursore, nell'ultimo campo toccato di quella notifica; se non se n'è toccato nessuno, in fondo al messaggio. */
  const insert = (k: NotifyKind, word: string) => {
    const f = last.current[k] ?? 'body'
    const el = fields.current[`${k}-${f}`]
    const cur = draft[k][f]
    const wasTouched = touched.current.has(`${k}-${f}`)
    const a = wasTouched ? el?.selectionStart ?? cur.length : cur.length, b = wasTouched ? el?.selectionEnd ?? cur.length : cur.length
    const tag = (!wasTouched && cur && !/\s$/.test(cur) ? ' ' : '') + `{${word}}`
    const max = f === 'title' ? TITLE_MAX : BODY_MAX
    if (cur.length - (b - a) + tag.length > max) { toast(`Non c'è più spazio: al massimo ${max} caratteri`); return }
    set(k, f, cur.slice(0, a) + tag + cur.slice(b))
    touched.current.add(`${k}-${f}`)
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + tag.length, a + tag.length) })
  }
  const problem = (k: NotifyKind) => !visible(draft[k].title) ? 'title' : unknownVars(k, draft[k].title + draft[k].body).length || strayBraces(k, draft[k].title + draft[k].body) ? 'vars' : null
  const bad = NOTIFY_KINDS.some((k) => problem(k))
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
    <>
    <Sheet title="Testi delle notifiche" onClose={onClose} guard={() => { if (dirty) { setAskLeave(true); return false } return true }} footer={mine ? <>{bad && <p className="cta-hint warn" style={{ marginBottom: 8 }}>Correggi le parti segnate in rosso per salvare.</p>}<Btn busy={busy} disabled={bad} onClick={save}>Salva testi</Btn></> : undefined}>
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
            <input id={`${k}-title`} className="field on-card" value={t.title} maxLength={TITLE_MAX} readOnly={!mine} aria-invalid={!visible(t.title) || undefined}
              ref={(el) => { fields.current[`${k}-title`] = el }} onFocus={() => { last.current[k] = 'title'; touched.current.add(`${k}-title`) }} onChange={(e) => set(k, 'title', e.target.value)} />
            <label className="label" htmlFor={`${k}-body`} style={{ marginTop: 10 }}>Messaggio</label>
            <textarea id={`${k}-body`} className="field on-card nt-body" rows={4} value={t.body} maxLength={BODY_MAX} readOnly={!mine} aria-invalid={problem(k) === 'vars' || undefined}
              ref={(el) => { fields.current[`${k}-body`] = el }} onFocus={() => { last.current[k] = 'body'; touched.current.add(`${k}-body`) }} onChange={(e) => set(k, 'body', e.target.value)} />
            {mine && <div className="nt-vars" aria-label="Parole da inserire">{info.vars.map((v) => (
              <button key={v.k} type="button" className="nt-var" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(k, v.k)}>{`{${v.k}}`}<span>{v.hint}</span></button>
            ))}</div>}
            {unknown.length > 0 ? <p className="nt-warn">Parole non valide per questa notifica: {unknown.map((u) => `{${u}}`).join(', ')}</p>
              : strayBraces(k, t.title + t.body) && <p className="nt-warn">Ci sono graffe in più: le parole vanno scritte come {'{dove}'}, senza spazi né graffe doppie.</p>}
            {!visible(t.title) && <p className="nt-warn">Il titolo non può restare vuoto.</p>}
            <div className="nt-preview" aria-label="Anteprima">
              <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={34} height={34} />
              <span className="grow"><span className="nt-app">SHOTGUN · ora</span><b>{p.title || ' '}</b><span>{p.body}</span>
                {k === 'new_trip' && <span className="nt-action">Shotgun!</span>}</span>
            </div>
          </div>
        )
      })}
    </Sheet>
    {askLeave && <Sheet title="Uscire senza salvare?" onClose={() => setAskLeave(false)} footer={<><Btn kind="gray" onClick={() => setAskLeave(false)}>Continua a modificare</Btn><div style={{ height: 8 }} /><Btn className="btn-danger" onClick={() => { setAskLeave(false); onClose() }}>Esci senza salvare</Btn></>}>
      <p style={{ margin: '0 4px', lineHeight: 1.4 }}>Le modifiche ai testi delle notifiche andranno perse.</p></Sheet>}
    </>
  )
}
