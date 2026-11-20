import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp, type Route } from '../app'
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
  /** sezione da mostrare: home, history, money, places, members */
  tab?: Route['s']
  /** l'elemento illuminato si può toccare; toccando un'altra sezione si va avanti */
  tryIt?: boolean
  notify?: boolean
  welcome?: boolean
}

export const GUIDE_STEPS: Step[] = [
  { welcome: true, tab: 'home', title: 'Benvenuto su Shotgun', text: 'Chi guida stasera? L\'app tiene il conto dei km che ognuno guida per gli altri, divide i pedaggi e suggerisce a chi tocca il volante. Ti mostro tutto in un minuto.' },
  { target: 'saldo', tab: 'home', title: 'Il tuo saldo', text: 'Verde: hai guidato più di quanto ti hanno portato. Rosso: sei in debito di km e la prossima tocca a te. Qui sotto vedi anche i pedaggi da dare o ricevere.' },
  { target: 'classifica', tab: 'home', title: 'I saldi del gruppo', text: 'Chi è più in rosso è il primo candidato a guidare. Il più avanti è il Pilota, il più indietro il Parassita.' },
  { target: 'organizza', tab: 'home', title: 'Organizza un\'uscita', text: 'Scegli chi viene e dove andate: l\'app suggerisce chi deve guidare e calcola il giro più corto passando dalle case, con km e pedaggi A4. Poi mandi il piano su WhatsApp.' },
  { target: 'registra', tab: 'home', title: 'Viaggio già fatto?', text: 'Registralo qui e conta subito. Le uscite organizzate invece si confermano dopo la serata con «Conferma viaggio»: solo allora km e pedaggi entrano nei saldi.' },
  { target: 'sezioni', tab: 'home', tryIt: true, title: 'Cinque sezioni', text: 'Saldi, Storico, Pedaggi, Luoghi e Gruppo stanno una accanto all\'altra: scorri col dito o tocca un nome. Prova: tocca «Storico».' },
  { target: 'storico', tab: 'history', title: 'Storico', text: 'Tutte le uscite. Aprine una per confermarla, correggere km e pedaggi o annullarla. Verde confermato, rosso annullato, arancio da confermare.' },
  { target: 'pedaggi', tab: 'money', title: 'Pedaggi', text: 'Chi passa il casello anticipa per tutti. Qui vedi chi deve quanto a chi e registri i rimborsi con un tocco.' },
  { target: 'invita', tab: 'members', title: 'Gruppo', text: 'Invita gli amici con il link, imposta la tua casa per il giro di raccolta e gestisci le notifiche. Da qui puoi anche rivedere questa guida.' },
  { tab: 'home', title: 'Come si contano i km', text: 'Chi guida riceve i km del tragitto; ognuno in auto, conducente compreso, ne paga una quota uguale. Se chi guida attiva «Non posso bere ostia», i primi 30 km valgono doppio.' },
  { tab: 'home', notify: true, title: 'Shotgun!', text: 'Quando esce una nuova uscita, il primo passeggero che chiama Shotgun si prende il posto davanti. Con le notifiche attive lo sai per primo.' },
]

interface Box { x: number; y: number; w: number; h: number }

export function Guide({ onClose }: { onClose: () => void }) {
  const { push, tab } = useApp()
  const [i, setI] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [push$, setPush] = usePush()
  const [pushBusy, setPushBusy] = useState(false)
  const next$ = useRef<HTMLButtonElement>(null)
  const startTab = useRef(tab)
  const step = GUIDE_STEPS[i]
  const last = i === GUIDE_STEPS.length - 1

  const close = useCallback(() => { markDone(); push({ s: 'home' }); onClose() }, [push, onClose])
  const go = useCallback((n: number) => setI(Math.max(0, Math.min(GUIDE_STEPS.length - 1, n))), [])
  const next = useCallback(() => (last ? close() : go(i + 1)), [last, close, go, i])

  // passo «prova tu»: toccando o scorrendo verso un'altra sezione si va avanti da soli
  useEffect(() => { if (step.tryIt) startTab.current = tab }, [i]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (step.tryIt && tab !== startTab.current) go(i + 1) }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // sezione giusta, elemento in vista, poi il riquadro luminoso lo segue mentre la pagina si sposta
  useLayoutEffect(() => {
    if (step.tab) push({ s: step.tab } as Route)
    if (!step.target) { setBox(null); return }
    let raf = 0, scrolled = false
    const t0 = performance.now()
    const vw = window.innerWidth, vh = window.innerHeight
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-guide="${step.target}"]`)
      if (el) {
        let r = el.getBoundingClientRect()
        const inView = r.left > -4 && r.right < vw + 4
        if (inView && !scrolled) { scrolled = true; el.scrollIntoView({ block: 'center', inline: 'nearest' }); r = el.getBoundingClientRect() }
        const pad = 6
        const y = Math.max(4, r.top - pad)
        setBox({ x: Math.max(4, r.left - pad), y, w: Math.min(vw - 8, r.width + pad * 2), h: Math.min(vh * 0.42, r.bottom + pad - y) })
      }
      if (performance.now() - t0 < 1100) raf = requestAnimationFrame(measure)
    }
    measure()
    const onResize = () => { scrolled = true; cancelAnimationFrame(raf); measure() }
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize) }
  }, [i]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { next$.current?.focus({ preventScroll: true }) }, [i])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') go(i - 1)
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

  const vw = typeof window !== 'undefined' ? window.innerWidth : 390
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const hole = box ? `M0 0H${vw}V${vh}H0Z M${box.x} ${box.y}h${box.w}v${box.h}h${-box.w}Z` : null
  const below = box ? box.y + box.h / 2 < vh / 2 : false
  const cardPos: React.CSSProperties = !box ? { top: '50%', transform: 'translateY(-50%)' } : below ? { top: Math.min(vh - 260, box.y + box.h + 14) } : { bottom: Math.min(vh - 260, vh - box.y + 14) }
  const turnOn = async () => {
    if (pushBusy) return
    setPushBusy(true)
    try { setPush(await enablePush()) } catch { setPush('off') } finally { setPushBusy(false) }
  }

  return (
    <div className={`guide${reducedMotion() ? ' still' : ''}`} role="dialog" aria-modal="true" aria-labelledby="guide-t">
      <div className="guide-dim" style={hole ? { clipPath: `path(evenodd, '${hole}')` } : undefined} />
      {box && <div className="guide-ring" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      {box && !step.tryIt && <div className="guide-block" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      {step.tryIt && box && <span className="guide-tap" style={{ left: Math.min(vw - 60, box.x + 100), top: box.y + box.h - 6 }} aria-hidden><Icon n="up" size={22} /></span>}
      <div className={`guide-card${step.welcome ? ' welcome' : ''}`} style={cardPos} key={i} onPointerDown={onDown} onPointerUp={onUp}>
        <div className="guide-top">
          <div className="guide-dots" aria-label={`Passo ${i + 1} di ${GUIDE_STEPS.length}`}>{GUIDE_STEPS.map((_, k) => <i key={k} className={k === i ? 'on' : k < i ? 'past' : ''} />)}</div>
          {!last && <button className="link guide-skip" onClick={close}>Salta</button>}
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
