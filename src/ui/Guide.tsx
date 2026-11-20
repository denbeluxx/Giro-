import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '../app'
import { enablePush, usePush } from '../lib/push'
import { Icon, reducedMotion } from './kit'

/** Guida al primo accesso: spiega l'app sulle schermate vere, passo per passo. Si può saltare e rivedere da Gruppo. */
export const GUIDE_KEY = 'shotgun-guide-done'
export const guideDone = () => { try { return localStorage.getItem(GUIDE_KEY) === '1' } catch { return true } }
const markDone = () => { try { localStorage.setItem(GUIDE_KEY, '1') } catch { /* */ } }

interface Step {
  title: string
  text: string
  /** elemento da illuminare (attributo data-guide) */
  target?: string
  /** sezione da mostrare: 0 Saldi, 1 Storico, 2 Pedaggi, 3 Luoghi, 4 Gruppo */
  tab: number
  notify?: boolean
  welcome?: boolean
}

export const GUIDE_STEPS: Step[] = [
  { welcome: true, tab: 0, title: 'Benvenuto su Shotgun', text: 'Chi guida stasera? L\'app tiene il conto dei km che ognuno guida per gli altri, divide i pedaggi e suggerisce a chi tocca il volante. Ti mostro tutto in un minuto.' },
  { target: 'saldo', tab: 0, title: 'Il tuo saldo', text: 'Verde: hai guidato più della tua quota. Rosso: hai usato più passaggi di quanti ne hai dati, e chi è più in rosso tra i presenti è il primo a dover guidare. Qui sotto vedi anche i pedaggi da dare o ricevere.' },
  { target: 'classifica', tab: 0, title: 'Chi tocca guidare', text: 'In cima c\'è chi è più in rosso: è il primo candidato al volante. Il saldo più alto è il Pilota, il più basso il Parassita.' },
  { target: 'organizza', tab: 0, title: 'Organizza un\'uscita', text: 'Scegli chi viene e dove andate: l\'app suggerisce chi deve guidare e calcola il giro più corto passando dalle case, con km e pedaggi A4. Poi mandi il piano su WhatsApp.' },
  { target: 'registra', tab: 0, title: 'Viaggio già fatto?', text: 'Registralo qui e conta subito. Le uscite organizzate invece si confermano dopo la serata con «Conferma viaggio»: solo allora km e pedaggi entrano nei saldi.' },
  { target: 'pedaggi', tab: 2, title: 'Pedaggi', text: 'Chi passa il casello anticipa per tutti. Qui vedi chi deve quanto a chi e registri i rimborsi con un tocco.' },
  { target: 'invita', tab: 4, title: 'Gruppo', text: 'Invita gli amici con il link, imposta la tua casa e attiva «Condividi casa con il gruppo» per il giro di raccolta, gestisci le notifiche. Da qui puoi anche rivedere questa guida.' },
  { tab: 0, title: 'Come si contano i km', text: 'Chi guida riceve i km percorsi; per ogni tratto, chi è in auto (conducente compreso) ne paga una quota uguale: chi sale dopo paga meno. Con «Non posso bere ostia» valgono doppio i primi 30 km dell\'uscita (triplo se l\'uscita è sotto i 5 km).' },
  { tab: 0, notify: true, title: 'Shotgun!', text: 'Quando esce una nuova uscita, il primo passeggero che strappa il biglietto «Shotgun!» si prende il posto davanti: il pezzo col sedile finisce accanto al suo nome. Con le notifiche attive lo sai per primo.' },
]

interface Box { x: number; y: number; w: number; h: number }

export function Guide({ onClose, showTab }: { onClose: (viaBack?: boolean) => void; showTab: (i: number) => void }) {
  const { onBack, forward } = useApp()
  const [i, setI] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [view, setView] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const [cardH, setCardH] = useState(240)
  const [push$, setPush] = usePush()
  const [pushBusy, setPushBusy] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const next$ = useRef<HTMLButtonElement>(null)
  const step = GUIDE_STEPS[i]
  const last = i === GUIDE_STEPS.length - 1
  const iRef = useRef(i)
  iRef.current = i

  const close = useCallback((viaBack?: boolean) => { markDone(); onClose(viaBack) }, [onClose])
  const go = useCallback((n: number) => setI(Math.max(0, Math.min(GUIDE_STEPS.length - 1, n))), [])
  const next = useCallback(() => (last ? close() : go(i + 1)), [last, close, go, i])

  // tasto Indietro del telefono: passo precedente (e si rimette il livello di cronologia), al primo passo chiude
  useEffect(() => onBack(() => {
    if (iRef.current > 0) { go(iRef.current - 1); forward(); return true }
    close(true); return true
  }), [onBack, forward, go, close])

  // sezione giusta, elemento in vista, poi il riquadro luminoso lo segue (scorrimenti, rotazione, dati aggiornati)
  useLayoutEffect(() => {
    showTab(step.tab)
    if (!step.target) { setBox(null); return }
    let raf = 0, scrolled = false, t0 = performance.now()
    const measure = () => {
      const vw = window.innerWidth, vh = window.innerHeight
      setView((v) => (v.w === vw && v.h === vh ? v : { w: vw, h: vh }))
      const el = document.querySelector<HTMLElement>(`[data-guide="${step.target}"]`)
      if (el) {
        const sc = el.closest('.scroll') as HTMLElement | null
        let r = el.getBoundingClientRect()
        const inView = r.left > -4 && r.right < vw + 4
        if (inView && !scrolled) {
          scrolled = true
          // un elemento più alto dello spazio si mostra dall'inizio, non dal mezzo
          const room = sc ? sc.clientHeight : vh
          el.scrollIntoView({ block: r.height > room * 0.5 ? 'start' : 'center', inline: 'nearest' })
          r = el.getBoundingClientRect()
        }
        const pad = 6
        const top = Math.max(4, (sc ? sc.getBoundingClientRect().top : 0) + 2)
        const y = Math.max(top, r.top - pad)
        const bottom = Math.min(r.bottom + pad, y + vh * 0.42, vh - 4)
        setBox({ x: Math.max(4, r.left - pad), y, w: Math.min(vw - 8, r.width + pad * 2), h: Math.max(24, bottom - y) })
      }
      if (performance.now() - t0 < 1100) raf = requestAnimationFrame(measure)
    }
    measure()
    const restart = () => { cancelAnimationFrame(raf); t0 = performance.now(); measure() }
    window.addEventListener('resize', restart)
    const every = window.setInterval(() => { if (performance.now() - t0 >= 1100) measure() }, 500)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', restart); clearInterval(every) }
  }, [i]) // eslint-disable-line react-hooks/exhaustive-deps

  // altezza vera del riquadro di testo, per scegliere dove metterlo
  useLayoutEffect(() => { if (card.current) setCardH(card.current.offsetHeight) })
  useEffect(() => { next$.current?.focus({ preventScroll: true }) }, [i])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') go(i - 1)
      else if (e.key === 'Tab' && card.current) {
        // il fuoco resta nel riquadro della guida
        const f = [...card.current.querySelectorAll<HTMLElement>('button:not([disabled])')]
        if (!f.length) return
        const a = f[0], z = f[f.length - 1]
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
        else if (!card.current.contains(document.activeElement)) { e.preventDefault(); a.focus() }
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [close, next, go, i])

  // si scorre anche il riquadro della guida: a sinistra avanti, a destra indietro
  const sw = useRef<{ x: number; y: number } | null>(null)
  const onDown = (e: React.PointerEvent) => { sw.current = { x: e.clientX, y: e.clientY } }
  const onUp = (e: React.PointerEvent) => {
    const s = sw.current; sw.current = null
    if (!s) return
    const dx = e.clientX - s.x, dy = e.clientY - s.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? next() : go(i - 1))
  }

  const { w: vw, h: vh } = view
  const hole = box ? `M0 0H${vw}V${vh}H0Z M${box.x} ${box.y}h${box.w}v${box.h}h${-box.w}Z` : null
  // il riquadro va dal lato con più spazio; se non ci sta, resta comunque tutto nello schermo
  const M = 10
  let cardPos: React.CSSProperties = { top: '50%', transform: 'translateY(-50%)' }
  if (box) {
    const below = vh - (box.y + box.h) - 14 - M, above = box.y - 14 - M
    const top = cardH <= below ? box.y + box.h + 14 : cardH <= above ? box.y - 14 - cardH : below >= above ? vh - M - cardH : M
    cardPos = { top: Math.max(M, Math.min(vh - M - cardH, top)) }
  }
  const turnOn = async () => {
    if (pushBusy) return
    setPushBusy(true)
    try { setPush(await enablePush()) } catch { setPush('off') } finally { setPushBusy(false) }
  }

  return (
    <div className={`guide${reducedMotion() ? ' still' : ''}`} role="dialog" aria-modal="true" aria-labelledby="guide-t">
      <div className="guide-dim" style={hole ? { clipPath: `path(evenodd, '${hole}')` } : undefined} />
      {box && <div className="guide-ring" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      {box && <div className="guide-block" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      <div ref={card} className={`guide-card${step.welcome ? ' welcome' : ''}`} style={cardPos} key={i} onPointerDown={onDown} onPointerUp={onUp}>
        <div className="guide-top">
          <div className="guide-dots" aria-label={`Passo ${i + 1} di ${GUIDE_STEPS.length}`}>{GUIDE_STEPS.map((_, k) => <i key={k} className={k === i ? 'on' : k < i ? 'past' : ''} />)}</div>
          {!last && <button className="link guide-skip" onClick={() => close()}>Salta</button>}
        </div>
        {step.welcome && <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={64} height={64} className="guide-icon" />}
        <h2 id="guide-t">{step.title}</h2>
        <p>{step.text}</p>
        {step.notify && (push$ === 'off' ? <button className="btn tinted small guide-notify" disabled={pushBusy} onClick={turnOn}><span className="btn-l"><Icon n="bell" size={18} />Attiva le notifiche</span></button>
          : push$ === 'on' ? <p className="guide-ok"><Icon n="check" size={18} />Notifiche attive su questo telefono</p>
          : push$ === 'needs-home' ? <p className="guide-note">Su iPhone arrivano solo all'app aggiunta alla schermata Home: Condividi → «Aggiungi alla schermata Home».</p>
          : push$ === 'denied' ? <p className="guide-note">Notifiche bloccate: riattivale dalle impostazioni del telefono.</p> : null)}
        <div className="guide-btns">
          {i > 0 && <button className="btn gray small" onClick={() => go(i - 1)}>Indietro</button>}
          <button ref={next$} className="btn primary small" onClick={next}><span className="btn-l">{step.welcome ? 'Iniziamo' : last ? 'Inizia a usare Shotgun' : 'Avanti'}</span></button>
        </div>
      </div>
    </div>
  )
}
