/** Testi delle notifiche: li sceglie chi ha creato il gruppo. Le parole tra graffe vengono sostituite al momento dell'invio.
 *  ATTENZIONE: gli stessi testi predefiniti sono copiati nel servizio notifiche (supabase/functions/notify/index.ts). */
export type NotifyKind = 'new_trip' | 'shotgun' | 'confirm' | 'low'
export interface NotifyText { title: string; body: string }
export type NotifyTexts = Partial<Record<NotifyKind, NotifyText>>

export const NOTIFY_KINDS: NotifyKind[] = ['new_trip', 'shotgun', 'confirm', 'low']
export const TITLE_MAX = 80
export const BODY_MAX = 200

export const NOTIFY_DEFAULTS: Record<NotifyKind, NotifyText> = {
  new_trip: { title: 'Nuova uscita: {dove}', body: '{quando} · guida {guida}. Il posto davanti va a chi chiama Shotgun per primo.' },
  shotgun: { title: '{chi} ha chiamato Shotgun!', body: 'Il posto davanti per {dove} è suo.' },
  confirm: { title: 'Conferma il viaggio: {dove}', body: 'Era {quando}. Controllate km e pedaggi e confermate.' },
  low: { title: 'Saldo {km} km', body: 'Sei sotto i −70 km: alla prossima uscita il volante è tuo.' },
}

/** Cosa si può inserire in ogni testo, con un esempio per l'anteprima. */
export const NOTIFY_INFO: Record<NotifyKind, { label: string; when: string; vars: { k: string; hint: string; ex: string }[] }> = {
  new_trip: { label: 'Nuova uscita', when: 'A tutto il gruppo, quando qualcuno organizza un\'uscita. Chi viene come passeggero ha anche il tasto «Shotgun!».', vars: [
    { k: 'dove', hint: 'destinazione', ex: 'Bolgia' }, { k: 'quando', hint: 'giorno e ora', ex: 'sab 22 nov, 21:30' },
    { k: 'guida', hint: 'chi guida', ex: 'Matteo' }, { k: 'chi', hint: 'chi l\'ha organizzata', ex: 'Daniele' }] },
  shotgun: { label: 'Shotgun preso', when: 'Agli altri in auto, quando qualcuno prende il posto davanti.', vars: [
    { k: 'chi', hint: 'chi ha chiamato Shotgun', ex: 'Alessia' }, { k: 'dove', hint: 'destinazione', ex: 'Bolgia' }, { k: 'quando', hint: 'giorno e ora', ex: 'sab 22 nov, 21:30' }] },
  confirm: { label: 'Viaggio da confermare', when: 'La mattina dopo l\'uscita, a chi c\'era, se il viaggio non è ancora confermato.', vars: [
    { k: 'dove', hint: 'destinazione', ex: 'Bolgia' }, { k: 'quando', hint: 'giorno e ora', ex: 'sab 22 nov, 21:30' }, { k: 'guida', hint: 'chi guidava', ex: 'Matteo' }] },
  low: { label: 'Saldo sotto −70 km', when: 'A chi scende sotto i −70 km, al massimo una volta al giorno.', vars: [
    { k: 'chi', hint: 'nome', ex: 'Andrea' }, { k: 'km', hint: 'saldo', ex: '−72,4' }] },
}

/** Sostituisce {dove}, {chi}… con i valori; le parole sconosciute restano come sono. */
export function fillText(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
}

export const textFor = (texts: NotifyTexts | undefined, kind: NotifyKind): NotifyText => {
  const t = texts?.[kind]
  return t && typeof t.title === 'string' && t.title.trim() && typeof t.body === 'string' ? t : NOTIFY_DEFAULTS[kind]
}

/** Esempio di come arriverà la notifica, con valori inventati. */
export const preview = (kind: NotifyKind, t: NotifyText): NotifyText => {
  const vars = Object.fromEntries(NOTIFY_INFO[kind].vars.map((v) => [v.k, v.ex]))
  return { title: fillText(t.title, vars), body: fillText(t.body, vars) }
}

/** Parole tra graffe che il testo usa ma che per questa notifica non esistono. */
export const unknownVars = (kind: NotifyKind, s: string): string[] => {
  const ok = new Set(NOTIFY_INFO[kind].vars.map((v) => v.k))
  return [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !ok.has(k)))]
}
