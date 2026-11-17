const nf1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '')

export const kmNum = (m: number) => nf1.format(Math.abs(m) / 1000)
const NB = '\u00a0' // spazio unificatore: cifra e unità restano sulla stessa riga
/** Arrotondamento al decimo di km simmetrico rispetto allo zero. */
export const roundKm = (m: number) => Math.sign(m) * Math.round(Math.abs(m) / 100) * 100
export const fmtKm = (m: number) => `${nf1.format(m / 1000).replace('-', '−')}${NB}km`
export const fmtKmSigned = (m: number) => { const r = roundKm(m); return `${sign(r)}${kmNum(r)}${NB}km` }
export const fmtEur = (c: number) => `${nf2.format(Math.abs(c) / 100)}${NB}€`
export const fmtEurSigned = (c: number) => `${sign(c)}${nf2.format(Math.abs(c) / 100)}${NB}€`
export const fmtDur = (s: number) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min` }
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
/** Data con ora, e l'anno quando non è quello in corso. */
export const fmtDateYear = (iso: string) => {
  const d = new Date(iso), y = d.getFullYear() !== new Date().getFullYear()
  return `${d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', ...(y ? { year: 'numeric' } : {}) })}, ${fmtTime(iso)}`
}
export const fmtDateLong = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
/**
 * Numero scritto da una persona: «12», «12,5», «12.5», «0.800» (= 0,8), «1.250,5» (= 1250,5). Niente segni, lettere o notazione esponenziale.
 * Restituisce null se il testo non è un numero valido o supera il massimo.
 */
export function parseNum(s: string, max = 1e6): number | null {
  const t = s.trim().replace(/\s/g, '')
  let v: number
  if (/^[1-9]\d{0,2}(\.\d{3})+,\d+$/.test(t) || /^[1-9]\d{0,2}(\.\d{3}){2,}$/.test(t)) v = parseFloat(t.replace(/\./g, '').replace(',', '.'))
  else if (/^\d+([.,]\d+)?$/.test(t)) v = parseFloat(t.replace(',', '.'))
  else return null
  return isFinite(v) && v <= max ? v : null
}
/** Valore da mettere in un campo: km con fino a 3 decimali, senza zeri inutili. */
export const kmField = (m: number) => String(Math.round(m) / 1000).replace('.', ',')
export const localInput = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
