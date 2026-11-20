import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { tick } from '../lib/haptics'
import { SeatMark } from './kit'

/** Larghezza della matrice del biglietto: deve restare uguale a .ticket-stub in brand.css. */
export const STUB_W = 78
const HOLES = 9 // fori della perforazione: ognuno che si rompe è un colpetto

// numeri pseudo-casuali ripetibili: lo strappo ha sempre la stessa forma
function seeded(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

// bordo strappato lungo una verticale, con i dentini verso `dir`
function torn(x: number, y0: number, y1: number, dir: 1 | -1, r: () => number) {
  const n = Math.max(8, Math.round(Math.abs(y1 - y0) / 3))
  let d = ''
  for (let i = 0; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / n
    const dx = (i % 2 ? 1.9 : 0.2) * (0.55 + r() * 0.9) * dir
    d += ` L${(x + dx).toFixed(2)} ${y.toFixed(2)}`
  }
  return d
}

const maskUrl = (w: number, h: number, d: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><path d='${d}' fill='black'/></svg>`)}")`

/** Forma della matrice: angoli tondi a sinistra, tacche e bordo strappato a destra. */
function stubPath(S: number, H: number) {
  const R = 18, n = 10, r = seeded(7)
  return `M${R} 0 L${S - n} 0 A${n} ${n} 0 0 0 ${S} ${n}${torn(S, n, H - n, -1, r)} L${S} ${H - n} A${n} ${n} 0 0 0 ${S - n} ${H} L${R} ${H} A${R} ${R} 0 0 1 0 ${H - R} L0 ${R} A${R} ${R} 0 0 1 ${R} 0 Z`
}
/** Forma del biglietto senza matrice: tacche e bordo strappato a sinistra, angoli tondi a destra. */
function bodyPath(B: number, H: number) {
  const R = 18, n = 10, r = seeded(13)
  return `M${n} 0 L${B - R} 0 A${R} ${R} 0 0 1 ${B} ${R} L${B} ${H - R} A${R} ${R} 0 0 1 ${B - R} ${H} L${n} ${H} A${n} ${n} 0 0 0 0 ${H - n}${torn(0, H - n, n, 1, r)} L0 ${n} A${n} ${n} 0 0 0 ${n} 0 Z`
}
const masked = (url: string): CSSProperties => ({ WebkitMask: `${url} 0 0 / 100% 100% no-repeat`, mask: `${url} 0 0 / 100% 100% no-repeat` })

type Props = {
  /** Dove si trova il tasto «Shotgun!» quando viene toccato. */
  from: DOMRect
  /** Risponde true se il posto davanti è davvero nostro. */
  claim: Promise<boolean>
  name: string
  place: string
  /** Selettore del posto accanto al nome, dove la matrice va ad attaccarsi. */
  slot: string
  onDone: (won: boolean) => void
}

/**
 * Il rito dello strappo: il biglietto si solleva, si piega lungo la perforazione, si strappa
 * dall'alto in basso un foro alla volta (un colpetto per foro), la matrice si stacca, si gira
 * mostrando il nome e vola accanto al nome nella lista «In auto». Un tocco salta alla fine.
 */
export function TearRitual({ from, claim, name, place, slot, onDone }: Props) {
  const W = from.width, H = from.height, S = STUB_W, B = W - S
  const masks = useMemo(() => ({ stub: maskUrl(S, H, stubPath(S, H)), body: maskUrl(B, H, bodyPath(B, H)) }), [S, B, H])
  const holes = useMemo(() => Array.from({ length: HOLES }, (_, i) => (H * (i + 1)) / (HOLES + 1)), [H])
  const vw = window.innerWidth, vh = window.innerHeight
  const k = Math.min(1.12, (vw - 40) / W)
  const dim$ = useRef<HTMLDivElement>(null), box$ = useRef<HTMLDivElement>(null), stub$ = useRef<HTMLSpanElement>(null)
  const body$ = useRef<HTMLSpanElement>(null), over$ = useRef<SVGSVGElement>(null), fly$ = useRef<HTMLDivElement>(null)
  const ctl = useRef({ dead: false, canSkip: false, won: false, anims: [] as Animation[] })
  const done$ = useRef(onDone)
  done$.current = onDone

  const finish = (won: boolean) => {
    const c = ctl.current
    if (c.dead) return
    c.dead = true
    c.anims.forEach((a) => a.cancel())
    done$.current(won)
  }

  useLayoutEffect(() => {
    const c = ctl.current
    const [dim, box, stub, body, over, fly] = [dim$.current, box$.current, stub$.current, body$.current, over$.current, fly$.current]
    if (!dim || !box || !stub || !body || !over || !fly || !box.animate) { claim.then((w) => finish(w)); return }
    const play = (el: Element, kf: Keyframe[], o: KeyframeAnimationOptions) => {
      const a = el.animate(kf, { fill: 'forwards', ...o })
      c.anims.push(a)
      return a.finished.then(() => true, () => false)
    }
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const cx = vw / 2, cy = vh * 0.42
    const tx = cx - (from.left + W / 2), ty = cy - (from.top + H / 2)
    const lifted = `translate(${tx}px, ${ty}px) scale(${k})`

    // pezzettini di carta che cadono dai fori
    const NS = 'http://www.w3.org/2000/svg'
    const bits: { el: SVGRectElement; x: number; y: number; vx: number; vy: number; a: number; va: number; t: number }[] = []
    let bitsOn = false
    const bitsLoop = (prev: number) => (now: number) => {
      if (c.dead) return
      const dt = Math.min(0.05, (now - prev) / 1000)
      for (let i = bits.length - 1; i >= 0; i--) {
        const p = bits[i]
        p.t += dt; p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt
        p.el.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.a.toFixed(0)})`)
        p.el.setAttribute('opacity', String(Math.max(0, 1 - p.t / 0.75)))
        if (p.t > 0.75) { p.el.remove(); bits.splice(i, 1) }
      }
      if (bits.length) requestAnimationFrame(bitsLoop(now)); else bitsOn = false
    }
    const spray = (y: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const el = document.createElementNS(NS, 'rect')
        const w = 2.4 + Math.random() * 2.8
        el.setAttribute('x', String(-w / 2)); el.setAttribute('y', '-1'); el.setAttribute('width', w.toFixed(1)); el.setAttribute('height', (1.8 + Math.random() * 2).toFixed(1))
        el.setAttribute('fill', Math.random() < 0.5 ? '#cdb9ff' : '#ffffff')
        over.appendChild(el)
        bits.push({ el, x: S + (Math.random() - 0.5) * 3, y, vx: -40 + Math.random() * 70, vy: -70 + Math.random() * 50, a: Math.random() * 180, va: -500 + Math.random() * 1000, t: 0 })
      }
      if (!bitsOn) { bitsOn = true; requestAnimationFrame(bitsLoop(performance.now())) }
    }
    const fibers = Array.from(over.querySelectorAll<SVGLineElement>('.rt-fiber'))
    const holeEls = Array.from(over.querySelectorAll<SVGCircleElement>('.rt-hole'))

    const run = async () => {
      // 1. il biglietto si solleva al centro, il resto si abbassa
      play(dim, [{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: 'ease-out' })
      await play(box, [{ transform: 'translate(0, 0) scale(1)' }, { transform: lifted }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' })
      if (c.dead) return
      // 2. si piega lungo la perforazione, in attesa della conferma
      stub.style.transformOrigin = `${S}px ${H / 2}px`
      const fold = play(stub, [{ transform: 'scaleX(1)', filter: 'brightness(1)' }, { transform: 'scaleX(.9)', filter: 'brightness(.88)' }], { duration: 280, easing: 'ease-in-out' })
      tick(10)
      const [won] = await Promise.all([claim, fold, wait(300)])
      if (c.dead) return
      c.won = won
      if (!won) {
        // qualcuno è arrivato prima: il biglietto non si strappa e torna al suo posto
        play(stub, [{ transform: 'scaleX(.9)' }, { transform: 'scaleX(1)' }], { duration: 200 })
        await play(box, [{ transform: lifted }, { transform: `${lifted} translateX(-9px)` }, { transform: `${lifted} translateX(8px)` }, { transform: `${lifted} translateX(-5px)` }, { transform: lifted }], { duration: 380 })
        tick(30)
        play(dim, [{ opacity: 1 }, { opacity: 0 }], { duration: 300 })
        await play(box, [{ transform: lifted }, { transform: 'translate(0, 0) scale(1)' }], { duration: 360, easing: 'cubic-bezier(.4,0,.2,1)' })
        finish(false)
        return
      }
      c.canSkip = true
      // 3. lo strappo: dall'alto in basso, un foro alla volta
      stub.getAnimations().forEach((a) => a.cancel())
      const T = 1250
      let next = 0
      await new Promise<void>((res) => {
        const t0 = performance.now()
        const frame = (now: number) => {
          if (c.dead) return res()
          const t = Math.min(1, (now - t0) / T)
          // la carta resiste all'inizio, cede a metà, fa fatica sull'ultimo pezzo
          const p = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
          const yt = p * H
          const th = -(1.5 + 13 * p)
          const sx = 0.9 + 0.1 * Math.min(1, t * 3)
          stub.style.transformOrigin = `${S}px ${yt}px`
          stub.style.transform = `scaleX(${sx}) rotate(${th}deg)`
          stub.style.filter = `brightness(${0.88 + 0.12 * Math.min(1, t * 3)})`
          while (next < holes.length && yt >= holes[next]) {
            holeEls[next]?.setAttribute('opacity', '0')
            spray(holes[next], next === holes.length - 1 ? 8 : 4)
            tick(next === holes.length - 1 ? 24 : 9)
            next++
          }
          const s = Math.sin((-th * Math.PI) / 180)
          fibers.forEach((f, j) => {
            const y = yt - (2 + j * 4.5)
            const gap = (yt - y) * s
            const show = t < 1 && y > 0 && gap > 0.5
            f.setAttribute('opacity', show ? String(0.75 - j * 0.18) : '0')
            if (show) { f.setAttribute('x1', (S - gap).toFixed(2)); f.setAttribute('y1', y.toFixed(2)); f.setAttribute('x2', String(S + 0.6)); f.setAttribute('y2', (y + 0.6).toFixed(2)) }
          })
          if (t < 1) requestAnimationFrame(frame); else res()
        }
        requestAnimationFrame(frame)
      })
      if (c.dead) return
      // 4. la matrice si stacca
      stub.style.zIndex = '3'
      play(body, [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(7px) rotate(1deg)', opacity: 0.85, offset: 0.3 }, { transform: 'translateX(4px) rotate(.5deg)', opacity: 0 }], { duration: 900, easing: 'ease-out' })
      await play(stub, [{ transform: stub.style.transform }, { transform: 'translate(6px, -26px) rotate(-19deg)' }], { duration: 240, easing: 'cubic-bezier(.2,.9,.3,1.2)' })
      if (c.dead) return
      // 5. si gira e mostra a chi va il posto davanti
      const r0 = stub.getBoundingClientRect()
      const fw = S * k, fh = H * k
      Object.assign(fly.style, { left: `${r0.left + r0.width / 2 - fw / 2}px`, top: `${r0.top + r0.height / 2 - fh / 2}px`, width: `${fw}px`, height: `${fh}px`, visibility: 'visible' })
      stub.style.visibility = 'hidden'
      const target = document.querySelector(slot) as HTMLElement | null
      const tr0 = target?.getBoundingClientRect()
      if (target && tr0 && (tr0.top < 70 || tr0.bottom > vh - 140)) target.scrollIntoView({ block: 'center' })
      const fx0 = r0.left + r0.width / 2, fy0 = r0.top + r0.height / 2
      const sx = vw / 2 - fx0, sy = vh * 0.3 - fy0
      const show = `perspective(800px) translate(${sx}px, ${sy}px) rotate(0deg) scale(1.5) rotateY(180deg)`
      setTimeout(() => tick(12), 430)
      await play(fly, [
        { transform: 'perspective(800px) translate(0, 0) rotate(-19deg) scale(1) rotateY(0deg)' },
        { transform: `perspective(800px) translate(${sx}px, ${sy}px) rotate(-4deg) scale(1.5) rotateY(0deg)`, offset: 0.5 },
        { transform: show },
      ], { duration: 820, easing: 'cubic-bezier(.3,.7,.3,1)' })
      if (c.dead) return
      await wait(520)
      if (c.dead) return
      // 6. vola accanto al nome nella lista «In auto»
      const tr = (document.querySelector(slot) as HTMLElement | null)?.getBoundingClientRect()
      if (!tr) { finish(true); return }
      const dx = tr.left + tr.width / 2 - fx0, dy = tr.top + tr.height / 2 - fy0
      const st = tr.width / fw
      play(dim, [{ opacity: 1 }, { opacity: 0 }], { duration: 520, delay: 260, easing: 'ease-in' })
      await play(fly, [
        { transform: show },
        { transform: `perspective(800px) translate(${(sx + dx) / 2}px, ${Math.min(sy, dy) - 30}px) rotate(-16deg) scale(${(1.5 + st) / 2}) rotateY(270deg)`, offset: 0.45 },
        { transform: `perspective(800px) translate(${dx}px, ${dy}px) rotate(-6deg) scale(${st}) rotateY(360deg)` },
      ], { duration: 780, easing: 'cubic-bezier(.5,0,.25,1)' })
      finish(true)
    }
    run()
    return () => { c.dead = true; c.anims.forEach((a) => a.cancel()) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const skip = () => { if (ctl.current.canSkip) finish(true) }
  const fs = { '--k': k } as CSSProperties
  return createPortal(
    <div className="ritual" onClick={skip} aria-hidden="true">
      <div className="ritual-dim" ref={dim$} />
      <div className="shotgun-btn rt-ticket" ref={box$} style={{ left: from.left, top: from.top, width: W, height: H }}>
        <span className="ticket-stub rt-stub" ref={stub$} style={masked(masks.stub)}><SeatMark size={36} /></span>
        <span className="ticket-body rt-body" ref={body$} style={masked(masks.body)}><b>Shotgun!</b><span>Il posto davanti va al primo che lo chiama</span></span>
        <svg className="rt-over" ref={over$} width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          {holes.map((y, i) => <circle key={i} className="rt-hole" cx={S} cy={y} r={2.3} />)}
          {[0, 1, 2].map((j) => <line key={j} className="rt-fiber" opacity={0} />)}
        </svg>
      </div>
      <div className="rt-fly" ref={fly$} style={fs}>
        <span className="rt-face front" style={masked(masks.stub)}><SeatMark size={Math.round(36 * k)} /></span>
        <span className="rt-face back" style={masked(masks.stub)}><small>Posto davanti</small><b>{name}</b><small>{place}</small></span>
      </div>
    </div>,
    document.body,
  )
}
