import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NOTIFY_DEFAULTS, NOTIFY_INFO, fillText, preview, textFor, unknownVars } from './notifyTexts'

describe('testi delle notifiche', () => {
  it('sostituisce le parole tra graffe e lascia le altre', () => {
    expect(fillText('{chi} ha chiamato Shotgun per {dove}!', { chi: 'Alessia', dove: 'Bolgia' })).toBe('Alessia ha chiamato Shotgun per Bolgia!')
    expect(fillText('Ciao {boh}', { chi: 'x' })).toBe('Ciao {boh}')
  })
  it('un testo vuoto o rovinato torna a quello predefinito', () => {
    expect(textFor({ low: { title: '  ', body: 'x' } }, 'low')).toEqual(NOTIFY_DEFAULTS.low)
    expect(textFor(undefined, 'shotgun')).toEqual(NOTIFY_DEFAULTS.shotgun)
    expect(textFor({ shotgun: { title: 'Davanti {chi}', body: '' } }, 'shotgun')).toEqual({ title: 'Davanti {chi}', body: '' })
  })
  it('i testi predefiniti usano solo parole valide e l\'anteprima non lascia graffe', () => {
    for (const k of Object.keys(NOTIFY_DEFAULTS) as (keyof typeof NOTIFY_DEFAULTS)[]) {
      expect(unknownVars(k, NOTIFY_DEFAULTS[k].title + NOTIFY_DEFAULTS[k].body)).toEqual([])
      const p = preview(k, NOTIFY_DEFAULTS[k])
      expect(p.title + p.body).not.toMatch(/[{}]/)
    }
    expect(unknownVars('low', '{dove} {km}')).toEqual(['dove'])
    expect(NOTIFY_INFO.new_trip.vars.map((v) => v.k)).toContain('guida')
  })
  it('il servizio notifiche ha gli stessi testi predefiniti dell\'app', () => {
    const src = readFileSync(new URL('../../supabase/functions/notify/index.ts', import.meta.url), 'utf8')
    for (const t of Object.values(NOTIFY_DEFAULTS)) {
      expect(src).toContain(JSON.stringify(t.title).slice(1, -1))
      expect(src).toContain(JSON.stringify(t.body).slice(1, -1))
    }
  })
})
