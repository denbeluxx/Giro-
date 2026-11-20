# Shotgun — regole di lavoro

- **Guida dell'app** (`src/ui/Guide.tsx`, `GUIDE_STEPS`): ogni modifica che cambia cosa vede o fa chi usa l'app (nuove sezioni, nuove funzioni, regole di calcolo, testi o nomi di pulsanti spiegati nella guida) va riportata anche nella guida. Se un passo indica un elemento con `data-guide`, l'attributo deve restare sull'elemento giusto. Dopo la modifica: collaudo `tests/e2e.py` (sezione «Guida al primo accesso»).
- **Servizio notifiche**: il sorgente è `supabase/functions/notify/main.ts` e usa il codice di `src/lib` (calcoli, testi predefiniti). `index.ts` si genera con `npm run build:notify` (un test controlla che sia aggiornato) e va incollato in Supabase → Edge Functions → notify → Code dopo ogni modifica a main.ts o ai file di `src/lib` che usa.
- **Database**: `supabase/schema.sql` si può rieseguire per intero (idempotente). Controlli: `node tests/schema.check.mjs`.
- **Prima di pubblicare**: `npx tsc --noEmit`, `npx vitest run`, `node tests/schema.check.mjs`, `npm run build:sim && npm run build`, poi `python3 tests/e2e.py` con le anteprime su :4173 (dist-sim) e :4174 (dist).
- **Identità visiva**: stile in `src/brand.css` (sopra `styles.css`), simbolo del sedile in `SeatMark` (`src/ui/kit.tsx`), icone in `public/`. Nuove grafiche (logo, icone, simboli) si adottano solo dopo la valutazione del board simulato: 10 designer e 100 utenti tipo.
- Testi dell'interfaccia in italiano, semplici e senza termini tecnici.
