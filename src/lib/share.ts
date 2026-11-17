import { fmtDateLong, fmtTime } from './format'
import type { Leg, Member, Trip } from './types'

export function tripLink(tripId: string): string {
  const u = new URL(window.location.href)
  return `${u.origin}${u.pathname}?t=${tripId}`
}
export function inviteLink(code: string): string {
  const u = new URL(window.location.href)
  return `${u.origin}${u.pathname}?invito=${code}`
}

function legLines(leg: Leg, name: (id: string) => string): string[] {
  return leg.stops.map((s, i) => {
    const bits: string[] = []
    if (i === 0 && leg.driverId) bits.push(`parte ${name(leg.driverId)}`)
    if (s.on.length) bits.push(`sale ${s.on.map(name).join(', ')}`)
    if (s.off.length && i < leg.stops.length - 1) bits.push(`scende ${s.off.map(name).join(', ')}`)
    return `${i + 1}. ${s.name}${bits.length ? ` (${bits.join(' · ')})` : ''}`
  })
}

/** Riepilogo dell'uscita da incollare su WhatsApp. Usa i nomi delle tappe, mai le coordinate. */
export function shareText(trip: Trip, members: Member[]): string {
  const name = (id: string) => members.find((m) => m.id === id)?.name.split(' ')[0] ?? '?'
  const [go, back] = [trip.legs.find((l) => l.kind === 'andata'), trip.legs.find((l) => l.kind === 'ritorno')]
  const date = fmtDateLong(trip.startsAt).replace(/^./, (c) => c.toUpperCase())
  const out: string[] = [`🚗 *${trip.dest.name}*`, `${date}, partenza alle ${fmtTime(trip.startsAt)}`]
  out.push(`Guida: ${go?.driverId ? name(go.driverId) : 'da decidere'}`)
  if (go && go.stops.length > 1) out.push('', '*Andata*', ...legLines(go, name))
  if (back) {
    const who = back.driverId ? (back.driverId === go?.driverId ? '' : ` · guida ${name(back.driverId)}`) : ' · conducente da decidere'
    const at = back.time ? ` alle ${back.time}` : ''
    const mirrored = go && go.stops.length > 1 && back.stops.length === go.stops.length && back.stops.every((s, i) => s.name === go.stops[go.stops.length - 1 - i].name)
    if (back.stops.length < 2) out.push('', `*Ritorno*${at}${who}: tappe da definire`)
    else if (mirrored) out.push('', `*Ritorno*${at}: stesse tappe al contrario${who}`)
    else out.push('', `*Ritorno*${at}${who}`, ...legLines(back, name))
  } else out.push('', 'Ritorno: non previsto in questa uscita')
  out.push('', `Dettagli: ${tripLink(trip.id)}`)
  return out.join('\n')
}

export function whatsappUrl(text: string) { return `https://wa.me/?text=${encodeURIComponent(text)}` }
