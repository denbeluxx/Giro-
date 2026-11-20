// Genera index.ts (il file da incollare in Supabase → Edge Functions → notify) da main.ts e da src/lib.
import { buildSync } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (f) => fileURLToPath(new URL(f, import.meta.url))
export function buildNotify(write = true) {
  const r = buildSync({
    entryPoints: [here('./main.ts')], bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
    charset: 'utf8', external: ['npm:*'], legalComments: 'none', logLevel: 'silent',
    banner: { js: '// GENERATO da main.ts con «npm run build:notify»: non modificare a mano. Da incollare in Supabase → Edge Functions → notify → Code.' },
  })
  const code = r.outputFiles[0].text
  if (write) writeFileSync(here('./index.ts'), code)
  return code
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) { buildNotify(true); console.log('index.ts aggiornato', readFileSync(here('./index.ts'), 'utf8').length, 'caratteri') }
