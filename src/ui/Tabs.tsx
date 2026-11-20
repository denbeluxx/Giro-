import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { reducedMotion } from './kit'

/** Vero dentro una sezione affiancata (niente tasto Indietro: si scorre o si tocca la barra). */
export const InTabs = createContext(false)
export const useInTabs = () => useContext(InTabs)

export interface TabDef { key: string; label: string; page: ReactNode }

/** Sezioni principali affiancate: si passa dall'una all'altra scorrendo col dito o toccando la barra in alto. */
export function Tabs({ tabs, index, onIndex, color }: { tabs: TabDef[]; index: number; onIndex: (i: number) => void; color?: string }) {
  const pager = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const led = useRef<HTMLSpanElement>(null)
  const settled = useRef(index)
  const timer = useRef<number>()
  const frame = useRef<number>()
  const onIndexRef = useRef(onIndex)
  onIndexRef.current = onIndex

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
    const r = Math.round(p)
    b.forEach((el, i) => el.classList.toggle('on', i === r))
    const bb = bar.current!, t = b[Math.max(0, Math.min(b.length - 1, r))]
    if (t.offsetLeft < bb.scrollLeft + 8) bb.scrollLeft = t.offsetLeft - 16
    else if (t.offsetLeft + t.offsetWidth > bb.scrollLeft + bb.clientWidth - 8) bb.scrollLeft = t.offsetLeft + t.offsetWidth - bb.clientWidth + 16
  }
  /** Solo la sezione ferma sullo schermo si può toccare e leggere con VoiceOver. */
  const lock = (i: number) => {
    const pages = pager.current?.children
    if (!pages) return
    for (let k = 0; k < pages.length; k++) {
      if (k === i) { pages[k].removeAttribute('inert'); pages[k].removeAttribute('aria-hidden') }
      else { pages[k].setAttribute('inert', ''); pages[k].setAttribute('aria-hidden', 'true') }
    }
  }

  useLayoutEffect(() => {
    const el = pager.current
    if (!el) return
    el.scrollLeft = index * el.clientWidth
    paint(index); lock(index)
    const ro = new ResizeObserver(() => { el.scrollLeft = settled.current * el.clientWidth; paint(settled.current) })
    ro.observe(el)
    return () => { ro.disconnect(); clearTimeout(timer.current); cancelAnimationFrame(frame.current!) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // sezione scelta da fuori (un tocco su «Pedaggi» in home, il tasto Indietro)
  useEffect(() => {
    const el = pager.current
    if (!el || index === settled.current) return
    el.scrollTo({ left: index * el.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [index])

  const onScroll = () => {
    const el = pager.current!
    cancelAnimationFrame(frame.current!)
    frame.current = requestAnimationFrame(() => paint(el.scrollLeft / el.clientWidth))
    clearTimeout(timer.current)
    // fermo: la sezione su cui si è fermato il dito diventa quella attiva
    timer.current = window.setTimeout(() => {
      const i = Math.round(el.scrollLeft / el.clientWidth)
      if (Math.abs(el.scrollLeft - i * el.clientWidth) > 2) return
      settled.current = i
      lock(i)
      onIndexRef.current(i)
    }, 110)
  }
  const go = (i: number) => {
    const el = pager.current!
    if (i === settled.current && Math.abs(el.scrollLeft - i * el.clientWidth) < 2) {
      // tocco sulla sezione già aperta: torna in cima
      el.children[i]?.querySelector('.scroll')?.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
      return
    }
    el.scrollTo({ left: i * el.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  return (
    <div className="screen tabs-root" style={color ? ({ '--tab-led': color } as React.CSSProperties) : undefined}>
      <div className="tabbar" ref={bar} role="tablist" aria-label="Sezioni">
        {tabs.map((t, i) => (
          <button key={t.key} role="tab" id={`tab-${t.key}`} aria-controls={`page-${t.key}`} aria-selected={i === index} className={i === index ? 'on' : ''} onClick={() => go(i)}>{t.label}</button>
        ))}
        <span className="tab-led" ref={led} aria-hidden />
      </div>
      <div className="pager" ref={pager} onScroll={onScroll}>
        {tabs.map((t) => (
          <div key={t.key} className="page" role="tabpanel" id={`page-${t.key}`} aria-labelledby={`tab-${t.key}`}>
            <InTabs.Provider value>{t.page}</InTabs.Provider>
          </div>
        ))}
      </div>
    </div>
  )
}
