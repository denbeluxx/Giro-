/**
 * Vibrazioni brevi per lo strappo del biglietto.
 * Android: Vibration API. iPhone: Safari non ha una API per vibrare; l'unico modo è cliccare
 * un interruttore nascosto (<input type=checkbox switch>, Safari 17.4+), che dà un colpetto del
 * Taptic Engine. Safari lo concede solo a ridosso di un tocco dell'utente, quindi su iPhone
 * i colpetti più lontani dal tocco possono non arrivare. Dove non c'è niente, non succede nulla.
 */

const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
let ios: HTMLLabelElement | null = null

function iosTick() {
  if (typeof document === 'undefined') return
  if (!ios) {
    const label = document.createElement('label')
    label.setAttribute('aria-hidden', 'true')
    label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.setAttribute('switch', '')
    input.tabIndex = -1
    label.appendChild(input)
    document.body.appendChild(label)
    ios = label
  }
  ios.click()
}

/** Un colpetto: `ms` vale solo su Android, su iPhone il colpo è sempre lo stesso. */
export function tick(ms = 9) {
  try {
    if (canVibrate) navigator.vibrate(ms)
    else iosTick()
  } catch { /* nessuna vibrazione disponibile */ }
}
