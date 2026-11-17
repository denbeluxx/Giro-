import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Member } from '../lib/types'

// ---- Icone: un'unica famiglia a tratto arrotondato ----
const P: Record<string, ReactNode> = {
  car: <><path d="M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11" /><rect x="3" y="11" width="18" height="6" rx="2" /><path d="M6.5 17v1.5M17.5 17v1.5" /><circle cx="7.5" cy="14" r=".6" fill="currentColor" /><circle cx="16.5" cy="14" r=".6" fill="currentColor" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 5l-7 7 7 7" />,
  chev: <path d="M9 6l6 6-6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  up: <path d="M6 15l6-6 6 6" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  pin: <><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19c.4-3.2 2.9-5 6-5s5.6 1.8 6 5" /><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8M18 14.4c1.7.7 2.8 2.300 3 4.600" /></>,
  home: <><path d="M4 11l8-6.5 8 6.500" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" /></>,
  euro: <><circle cx="12" cy="12" r="8.5" /><path d="M15 8.6a4 4 0 1 0 0 6.800M7.500 11h5.500M7.500 13.300h5" /></>,
  share: <><path d="M12 15V4M8 7.500L12 4l4 3.500" /><path d="M6 11v7.500h12V11" /></>,
  grip: <path d="M5 9h14M5 15h14" />,
  search: <><circle cx="11" cy="11" r="6.500" /><path d="M16 16l4 4" /></>,
  history: <><path d="M4 12a8 8 0 1 0 2.600-5.900" /><path d="M4 5v4h4M12 8v4.300l2.800 1.700" /></>,
  flag: <><path d="M6 21V4" /><path d="M6 5h11l-2 3.500 2 3.500H6" /></>,
  edit: <><path d="M5 19l1-4L16.500 4.500l3 3L9 18z" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1" /><path d="M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" /></>,
  alert: <><path d="M12 4l9 15.500H3z" /><path d="M12 10v4.500M12 17.300v.2" /></>,
  info: <><circle cx="12" cy="12" r="8.500" /><path d="M12 11v5.500M12 7.800v.2" /></>,
  repeat: <><path d="M5 11V9.500A2.500 2.500 0 0 1 7.500 7H19M16 4l3 3-3 3" /><path d="M19 13v1.500a2.500 2.500 0 0 1-2.500 2.500H5M8 20l-3-3 3-3" /></>,
  swap: <path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3" />,
  trash: <><path d="M5 7h14M10 7V4.500h4V7M7 7l.8 12h8.400L17 7" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3.500v2.200M12 18.300v2.200M3.500 12h2.200M18.300 12h2.200M6 6l1.600 1.600M16.400 16.400L18 18M6 18l1.600-1.600M16.400 7.600L18 6" /></>,
  wa: <><path d="M4.500 19.500l1.100-3.900A7.800 7.800 0 1 1 8.700 18.500z" /><path d="M9.300 8.700c-.3 2.800 2.600 5.900 5.500 6l1.100-1.200-1.900-1-.8.700c-.9-.4-1.700-1.200-2.100-2.100l.7-.8-1-1.900z" /></>,
}
export function Icon({ n, size = 22, sw = 1.9 }: { n: keyof typeof P | string; size?: number; sw?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[n]}</svg>
}

// colori degli avatar: su quelli chiari le iniziali sono scure per restare leggibili
const COLORS: [string, string, string][] = [['#7d7aff', '#5856d6', '#fff'], ['#ffb340', '#ff9500', '#3a2000'], ['#5ac8fa', '#0a84ff', '#fff'], ['#ff6f91', '#ff2d55', '#fff'], ['#63e6be', '#12b886', '#003d2b'], ['#ffd43b', '#f59f00', '#3a2a00'], ['#da77f2', '#ae3ec9', '#fff'], ['#a9b1bd', '#6b7280', '#fff']]
export function Avatar({ m, size = 36 }: { m?: Pick<Member, 'name' | 'color'> | null; size?: number }) {
  const c = COLORS[(m?.color ?? 7) % COLORS.length]
  const initials = (m?.name ?? '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return <span className="avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.4, color: c[2], '--a1': c[0], '--a2': c[1] } as CSSProperties}>{initials}</span>
}

export function Btn({ kind = 'primary', busy, small, icon, children, ...p }: { kind?: 'primary' | 'tinted' | 'gray' | 'danger'; busy?: boolean; small?: boolean; icon?: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...p} className={`btn ${kind}${small ? ' small' : ''}${busy ? ' busy' : ''} ${p.className ?? ''}`} aria-busy={busy || undefined} disabled={p.disabled}>
      {busy && <span className="spinner" role="status" aria-label="In corso" />}
      <span className="btn-l">{icon && <Icon n={icon} size={20} />}{children}</span>
    </button>
  )
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" onClick={() => onChange(!on)} />
}
export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return <div className="seg" role="group">{options.map((o) => <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.l}</button>)}</div>
}

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Foglio modale dal basso: si chiude con trascinamento, tocco sullo sfondo o Esc. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const [out, setOut] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; dy: number } | null>(null)
  // chi aveva il fuoco prima dell'apertura (letto al primo disegno, prima dell'autoFocus del campo)
  const opener = useRef<HTMLElement | null>(typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null)
  const close = useCallback(() => { if (reducedMotion()) return onClose(); setOut(true); setTimeout(onClose, 220) }, [onClose])
  useEffect(() => {
    const before = opener.current
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close()
      if (e.key !== 'Tab' || !ref.current) return
      // il fuoco resta dentro il foglio
      const f = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select, [tabindex]:not([tabindex="-1"])')]
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', k)
    // se un campo ha già il fuoco (autoFocus) lo lasciamo: su iPhone apre la tastiera
    if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus()
    return () => { window.removeEventListener('keydown', k); if (before && document.contains(before)) before.focus({ preventScroll: true }) }
  }, [close])
  const down = (e: React.PointerEvent) => { drag.current = { y: e.clientY, dy: 0 }; (e.target as Element).setPointerCapture(e.pointerId) }
  const move = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return
    drag.current.dy = Math.max(0, e.clientY - drag.current.y)
    ref.current.classList.add('dragging')
    ref.current.style.transform = `translateY(${drag.current.dy}px)`
  }
  const up = () => {
    if (!drag.current || !ref.current) return
    const dy = drag.current.dy
    drag.current = null
    ref.current.classList.remove('dragging')
    if (dy > 90) { ref.current.style.transition = 'transform .22s ease-in'; ref.current.style.transform = 'translateY(100%)'; setTimeout(onClose, 200) }
    else { ref.current.style.transition = 'transform .3s cubic-bezier(.32,.72,0,1)'; ref.current.style.transform = ''; setTimeout(() => ref.current && (ref.current.style.transition = ''), 300) }
  }
  return (
    <>
      <div className={`backdrop${out ? ' out' : ''}`} onClick={close} />
      <div ref={ref} className={`sheet${out ? ' out' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <button className="grab" aria-label="Chiudi" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={() => !drag.current && undefined}><i /></button>
        <div className="sheet-h"><h3>{title}</h3><button className="nav-btn" onClick={close} aria-label="Chiudi" style={{ color: 'var(--text2)' }}><Icon n="x" /></button></div>
        <div className="sheet-b">{children}</div>
        {footer && <div style={{ padding: '10px 16px 14px' }}>{footer}</div>}
      </div>
    </>
  )
}

const ToastCtx = createContext<(msg: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastHost({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; k: number } | null>(null)
  const show = useCallback((msg: string) => setT({ msg, k: Date.now() }), [])
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), 3200); return () => clearTimeout(id) }, [t])
  return <ToastCtx.Provider value={show}>{children}{t && <div key={t.k} className="toast glass" role="status">{t.msg}</div>}</ToastCtx.Provider>
}

/** Cifra che scorre brevemente dal valore precedente a quello nuovo. */
const lastShown = new Map<string, number>()
export function Count({ id, value, format }: { id: string; value: number; format: (v: number) => string }) {
  const [v, setV] = useState(() => lastShown.get(id) ?? value)
  useEffect(() => {
    const from = lastShown.get(id) ?? value
    lastShown.set(id, value)
    if (from === value || reducedMotion()) { setV(value); return }
    const t0 = performance.now(), dur = 600
    let raf = 0
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); setV(from + (value - from) * e); if (p < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [id, value])
  return <span className="num">{format(v)}</span>
}

export function Skel({ w = '100%', h = 18, r }: { w?: number | string; h?: number; r?: number }) {
  return <div className="skel" style={{ width: w, height: h, borderRadius: r }} />
}
export function Empty({ icon, title, text, children }: { icon: string; title: string; text: string; children?: ReactNode }) {
  return <div className="empty enter"><div className="ic"><Icon n={icon} size={30} /></div><h3>{title}</h3><p>{text}</p>{children}</div>
}
export function Notice({ kind = 'warn', children, actions }: { kind?: 'warn' | 'info'; children: ReactNode; actions?: ReactNode }) {
  return <div className={`notice ${kind === 'info' ? 'info' : ''}`} role={kind === 'warn' ? 'alert' : undefined}><span className="ic"><Icon n={kind === 'info' ? 'info' : 'alert'} size={20} /></span><div style={{ flex: 1 }}>{children}{actions && <div className="acts">{actions}</div>}</div></div>
}

/** Esegue un'azione asincrona una sola volta per tocco e segnala errori. */
export function useBusy() {
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const toast = useToast()
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try { await fn() } catch (e: any) { toast(e?.message ?? 'Qualcosa non ha funzionato. Riprova.') } finally { lock.current = false; setBusy(false) }
  }, [toast])
  return [busy, run] as const
}
