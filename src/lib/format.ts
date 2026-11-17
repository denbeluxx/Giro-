const nf1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '')

export const kmNum = (m: number) => nf1.format(Math.abs(m) / 1000)
export const fmtKm = (m: number) => `${nf1.format(m / 1000).replace('-', '−')} km`
export const fmtKmSigned = (m: number) => { const r = Math.round(m / 100) * 100; return `${sign(r)}${kmNum(r)} km` }
export const fmtEur = (c: number) => `${nf2.format(Math.abs(c) / 100)} €`
export const fmtEurSigned = (c: number) => `${sign(c)}${nf2.format(Math.abs(c) / 100)} €`
export const fmtDur = (s: number) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min` }
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
export const fmtDateLong = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
export const parseNum = (s: string) => { const v = parseFloat(s.replace(',', '.')); return isFinite(v) ? v : null }
export const localInput = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
