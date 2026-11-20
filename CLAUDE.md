# Shotgun — regole di lavoro

- **Guida dell'app** (`src/ui/Guide.tsx`, `GUIDE_STEPS`): ogni modifica che cambia cosa vede o fa chi usa l'app (nuove sezioni, nuove funzioni, regole di calcolo, testi o nomi di pulsanti spiegati nella guida) va riportata anche nella guida. Se un passo indica un elemento con `data-guide`, l'attributo deve restare sull'elemento giusto. Dopo la modifica: collaudo `tests/e2e.py` (sezione «Guida al primo accesso»).
- **Testi delle notifiche**: i testi predefiniti stanno sia in `src/lib/notifyTexts.ts` sia in `supabase/functions/notify/index.ts`; un test controlla che coincidano. Dopo una modifica al servizio va ripubblicata la funzione `notify` su Supabase (Edge Functions → notify → Code).
- **Database**: `supabase/schema.sql` si può rieseguire per intero (idempotente). Controlli: `node tests/schema.check.mjs`.
- **Prima di pubblicare**: `npx tsc --noEmit`, `npx vitest run`, `node tests/schema.check.mjs`, `npm run build:sim && npm run build`, poi `python3 tests/e2e.py` con le anteprime su :4173 (dist-sim) e :4174 (dist).
- Testi dell'interfaccia in italiano, semplici e senza termini tecnici.
