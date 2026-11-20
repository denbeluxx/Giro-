import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { reducedMotion } from './kit'

/** Vero dentro una sezione affiancata (niente tasto Indietro: si scorre o si tocca la barra). */
export const InTabs = createContext(false)
export const useInTabs = () => useContext(InTabs)

export interface TabDef { key: string; label: string; page: ReactNode }

/** Posizione verticale di ogni sezione: resta uguale quando si apre un'uscita e si torna indietro. */
const scrollTops = new Map<string, number>()

/** Sezioni principali affiancate: si passa dall'una all'altra scorrendo col dito o toccando la barra in alto.
 *  onLeave: si sta lasciando Saldi (anche prima che lo scorrimento finisca), per il tasto Indietro del telefono. */
export function Tabs({ tabs, index, req = 0, onIndex, onLeave, color }: { tabs: TabDef[]; index: number; req?: number; onIndex: (i: number, byUser: boolean) => void; onLeave?: () => void; color?: string }) {
  const pager = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const led = useRef<HTMLSpanElement>(null)
  const settled = useRef(index)
  /** sezione verso cui si sta andando (tocco, tasto Indietro, guida) finché lo scorrimento non finisce */
  const target = useRef<number | null>(null)
  const locked = useRef(-1)
  /** lo spostamento in corso l'ha deciso chi usa l'app (tocco, dito) e non l'app stessa */
  const byUser = useRef(false)
  const lastW = useRef(0)
  const timer = useRef<number>()
  const frame = useRef<number>()
  const cb = useRef({ onIndex, onLeave })
  cb.current = { onIndex, onLeave }

  const btns = () => [...(bar.current?.querySelectorAll<HTMLElement>('[role=tab]') ?? [])]
  /** Barra: la luce segue il dito tra una sezione e l'altra; la sezione attiva resta sempre visibile. */
  const paint = (p: number) => {
    const b = btns(), l = led.current
    if (!b.length || !l) return
    const a = Math.max(0, Math.min(b.length - 1, Math.floor(p))), c = Math.min(b.length - 1, a + 1), f = Math.max(0, Math.min(1, p - a))
    const x = b[a].offsetLeft + (b[c].offsetLeft - b[a].offsetLeft) * f
    const w = b[a].offsetWidth + (b[c].offsetWidth - b[a].offsetWidth) * f
    l.style.transform = `translateX(${x}px)`
    l.style.width = `${w}px`
    const r = Math.max(0, Math.min(b.length - 1, Math.round(p)))
    b.forEach((el, i) => el.classList.toggle('on', i === r))
    const bb = bar.current!, t = b[r]
    if (t.offsetLeft < bb.scrollLeft + 8) bb.scrollLeft = t.offsetLeft - 16
    else if (t.offsetLeft + t.offsetWidth > bb.scrollLeft + bb.clientWidth - 8) bb.scrollLeft = t.offsetLeft + t.offsetWidth - bb.clientWidth + 16
    // la sezione che si vede di più è subito toccabile; le altre no (né col dito, né con la tastiera, né con VoiceOver)
    lock(target.current ?? r)
  }
  const lock = (i: number) => {
    const pages = pager.current?.children
    if (!pages || locked.current === i) return
    locked.current = i
    for (let k = 0; k < pages.length; k++) {
      if (k === i) { pages[k].removeAttribute('inert'); pages[k].removeAttribute('aria-hidden') }
      else { pages[k].setAttribute('inert', ''); pages[k].setAttribute('aria-hidden', 'true') }
    }
  }
  const scrollTo = (i: number, user: boolean) => {
    const el = pager.current!
    target.current = i
    byUser.current = user
    lock(i)
    if (user && i !== 0) cb.current.onLeave?.()
    el.scrollTo({ left: i * el.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  useLayoutEffect(() => {
    const el = pager.current
    if (!el) return
    el.scrollLeft = index * el.clientWidth
    lastW.current = el.clientWidth
    paint(index); lock(index)
    // si ritrova la posizione di ogni sezione com'era prima di aprire un'uscita
    for (const page of Array.from(el.children)) { const sc = page.querySelector('.scroll'); const top = scrollTops.get(page.id); if (sc && top) sc.scrollTop = top }
    const ro = new ResizeObserver(() => {
      // rotazione o ridimensionamento: si resta sulla sezione scelta, anche se lo scorrimento era a metà
      const i = target.current ?? Math.round(el.scrollLeft / (lastW.current || el.clientWidth))
      lastW.current = el.clientWidth
      el.scrollLeft = i * el.clientWidth
      paint(i)
    })
    ro.observe(el)
    return () => {
      ro.disconnect(); clearTimeout(timer.current); cancelAnimationFrame(frame.current!)
      for (const page of Array.from(el.children)) { const sc = page.querySelector('.scroll'); if (sc) scrollTops.set(page.id, sc.scrollTop) }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // sezione scelta da fuori (un tocco su «Pedaggi» in home, il tasto Indietro, la guida)
  useEffect(() => {
    const el = pager.current
    if (!el) return
    // si confronta con la posizione vera: un cambio rapido (avanti e subito indietro) non resta a metà strada
    if (Math.abs(el.scrollLeft - index * el.clientWidth) < 2 && target.current == null) return
    scrollTo(index, false)
  }, [index, req]) // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = pager.current!
    // il dito sta lasciando Saldi: il tasto Indietro deve già riportarci, anche prima che lo scorrimento finisca
    if (target.current == null) { byUser.current = true; if (el.scrollLeft > 8 && settled.current === 0) cb.current.onLeave?.() }
    cancelAnimationFrame(frame.current!)
    frame.current = requestAnimationFrame(() => paint(el.scrollLeft / el.clientWidth))
    clearTimeout(timer.current)
    // fermo: la sezione su cui si è fermato diventa quella attiva; se si è fermato a metà (es. il fuoco della tastiera), si riallinea
    timer.current = window.setTimeout(() => {
      const w = el.clientWidth
      const i = target.current ?? Math.round(el.scrollLeft / w)
      if (Math.abs(el.scrollLeft - i * w) > 2) { el.scrollTo({ left: i * w, behavior: 'auto' }); return }
      target.current = null
      settled.current = i
      lock(i)
      const user = byUser.current
      byUser.current = false
      cb.current.onIndex(i, user)
    }, 120)
  }
  const go = (i: number) => {
    const el = pager.current!
    if (i === settled.current && target.current == null && Math.abs(el.scrollLeft - i * el.clientWidth) < 2) {
      // tocco sulla sezione già aperta: torna in cima
      el.children[i]?.querySelector('.scroll')?.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
      return
    }
    scrollTo(i, true)
  }
  // frecce sinistra e destra sulla barra, come nelle schede dei sistemi operativi
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const cur = target.current ?? settled.current
    const i = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : Math.max(0, Math.min(tabs.length - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1)))
    go(i)
    btns()[i]?.focus()
  }

  return (
    <div className="screen tabs-root" style={color ? ({ '--tab-led': color } as React.CSSProperties) : undefined}>
      <div className="tabbar" ref={bar} role="tablist" aria-label="Sezioni" onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button key={t.key} role="tab" id={`tab-${t.key}`} aria-controls={`page-${t.key}`} aria-selected={i === index} tabIndex={i === index ? 0 : -1} className={i === index ? 'on' : ''} onClick={() => go(i)}>{t.label}</button>
        ))}
        <span className="tab-led" ref={led} aria-hidden />
      </div>
      <div className="pager" ref={pager} onScroll={onScroll} onTouchStart={() => { target.current = null }}>
        {tabs.map((t) => (
          <div key={t.key} className="page" role="tabpanel" id={`page-${t.key}`} aria-labelledby={`tab-${t.key}`}>
            <InTabs.Provider value>{t.page}</InTabs.Provider>
          </div>
        ))}
      </div>
    </div>
  )
}
