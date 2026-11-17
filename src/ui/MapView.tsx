import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { SIM } from '../lib/routing'
import type { Pt } from '../lib/types'
import { reducedMotion } from './kit'

export interface MapStop extends Pt { label: string; end?: boolean; title?: string }
interface Props { stops?: MapStop[]; geometry?: [number, number][] | null; dots?: Pt[]; padBottom?: number; padTop?: number; interactive?: boolean }

const isDark = () => getComputedStyle(document.documentElement).colorScheme.includes('dark')
const TILES = { light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' }

/** Mappa con percorso e tappe numerate. Si adatta al percorso lasciando libero lo spazio coperto dai pannelli. */
export function MapView({ stops = [], geometry, dots = [], padBottom = 24, padTop = 24, interactive = true }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const tiles = useRef<L.TileLayer | null>(null)

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: false, attributionControl: !SIM, dragging: interactive, scrollWheelZoom: interactive, touchZoom: interactive, doubleClickZoom: interactive, boxZoom: false, keyboard: interactive, zoomSnap: 0.25 })
    m.setView([45.69, 9.67], 11)
    map.current = m
    layer.current = L.layerGroup().addTo(m)
    const setTiles = () => {
      if (SIM) return
      tiles.current?.remove()
      tiles.current = L.tileLayer(isDark() ? TILES.dark : TILES.light, { maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap · © CARTO' }).addTo(m)
    }
    setTiles()
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', setTiles)
    window.addEventListener('giro-theme', setTiles)
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current!)
    return () => { ro.disconnect(); mq.removeEventListener('change', setTiles); window.removeEventListener('giro-theme', setTiles); m.remove() }
  }, [interactive])

  const sig = JSON.stringify([stops.map((s) => [s.lat, s.lng, s.label, s.end]), geometry?.length, geometry?.[0], dots])
  useEffect(() => {
    const m = map.current, g = layer.current
    if (!m || !g) return
    g.clearLayers()
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5856d6'
    const pts: L.LatLngExpression[] = []
    if (geometry?.length) {
      L.polyline(geometry, { color: '#fff', weight: 9, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g)
      L.polyline(geometry, { color: accent, weight: 5.5, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g)
      pts.push(...geometry)
    }
    for (const d of dots) { L.marker([d.lat, d.lng], { interactive: false, icon: L.divIcon({ className: '', html: '<div class="pin dot"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(g); pts.push([d.lat, d.lng]) }
    stops.forEach((s) => {
      L.marker([s.lat, s.lng], { interactive: false, keyboard: false, title: s.title, icon: L.divIcon({ className: '', html: `<div class="pin${s.end ? ' end' : ''}">${s.label}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(g)
      pts.push([s.lat, s.lng])
    })
    if (pts.length === 1) m.setView(pts[0], 14, { animate: false })
    else if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [36, padTop + 20], paddingBottomRight: [36, padBottom + 20], animate: !reducedMotion(), duration: 0.45, maxZoom: 15 })
  }, [sig, padBottom, padTop]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div className={`map${SIM ? ' sim' : ''}`} ref={el} role="img" aria-label={stops.length ? `Mappa del percorso: ${stops.map((s) => s.title).filter(Boolean).join(', ')}` : 'Mappa'} />
}
