import { useEffect, useRef, useState, type ReactNode } from 'react'
import { searchPlaces, type Found } from '../lib/routing'
import type { Pt } from '../lib/types'
import { Icon, Notice, Skel } from './kit'

/** Ricerca di luoghi e indirizzi con suggerimenti. Senza testo mostra le scelte rapide passate come figli. */
export function PlaceSearch({ onPick, placeholder = 'Cerca un luogo o un indirizzo', near, children, autoFocus }: { onPick: (f: Found) => void; placeholder?: string; near?: Pt; children?: ReactNode; autoFocus?: boolean }) {
  const [q, setQ] = useState('')
  const [state, setState] = useState<{ s: 'idle' | 'load' | 'ok' | 'err'; items: Found[]; err?: string }>({ s: 'idle', items: [] })
  const [tick, setTick] = useState(0)
  const ctl = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ctl.current?.abort()
    if (q.trim().length < 2) { setState({ s: 'idle', items: [] }); return }
    setState((p) => ({ ...p, s: 'load' }))
    const c = new AbortController(); ctl.current = c
    const id = setTimeout(async () => {
      try { const items = await searchPlaces(q.trim(), near, c.signal); if (!c.signal.aborted) setState({ s: 'ok', items }) }
      catch (e: any) { if (!c.signal.aborted) setState({ s: 'err', items: [], err: e?.message }) }
    }, 320)
    return () => { clearTimeout(id); c.abort() }
  }, [q, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <label className="search"><Icon n="search" size={19} /><span className="sr">{placeholder}</span>
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false} />
        {q && <button type="button" className="clear" onClick={() => { setQ(''); input.current?.focus() }} aria-label="Cancella la ricerca"><Icon n="x" size={17} /></button>}
      </label>
      <div style={{ marginTop: 12, minHeight: 120 }}>
        {state.s === 'idle' && children}
        {state.s === 'load' && <div className="list">{[0, 1, 2].map((i) => <div className="row" key={i}><Skel w={36} h={36} r={18} /><div className="grow"><Skel w="55%" h={15} /><div style={{ height: 6 }} /><Skel w="80%" h={12} /></div></div>)}</div>}
        {state.s === 'err' && <Notice actions={<button className="btn small tinted" onClick={() => setTick((t) => t + 1)}>Riprova</button>}>La ricerca non risponde. Quello che hai inserito è al sicuro.</Notice>}
        {state.s === 'ok' && !state.items.length && <p className="caption" style={{ padding: '16px 6px' }}>Nessun risultato per «{q}». Prova con via e comune.</p>}
        {state.s === 'ok' && !!state.items.length && (
          <div className="list enter">{state.items.map((f, i) => (
            <button className="row" key={i} onClick={() => onPick(f)}>
              <span className="avatar" style={{ width: 36, height: 36, background: 'var(--fill)', color: 'var(--accent)' }}><Icon n="pin" size={19} /></span>
              <span className="grow"><div className="t">{f.name}</div>{f.address && <div className="s">{f.address}</div>}</span>
            </button>
          ))}</div>
        )}
      </div>
    </div>
  )
}
