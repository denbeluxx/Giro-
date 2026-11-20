import { createRoot } from 'react-dom/client'
import { App } from './app'
import '@fontsource/space-grotesk/latin-400.css'
import '@fontsource/space-grotesk/latin-500.css'
import '@fontsource/space-grotesk/latin-600.css'
import '@fontsource/space-grotesk/latin-700.css'
import './styles.css'

// L'app si chiamava «Giro»: i dati salvati sul dispositivo passano ai nomi nuovi una volta sola.
try {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('giro-')) continue
    const n = `shotgun-${k.slice(5)}`
    if (localStorage.getItem(n) == null) localStorage.setItem(n, localStorage.getItem(k) ?? '')
    localStorage.removeItem(k)
  }
} catch { /* archivio non disponibile */ }

// Tastiera su iPhone: Safari non ridimensiona la pagina, quindi alziamo fogli e pulsante principale.
const vv = window.visualViewport
if (vv) {
  const sync = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`)
  vv.addEventListener('resize', sync)
  vv.addEventListener('scroll', sync)
}

createRoot(document.getElementById('root')!).render(<App />)
