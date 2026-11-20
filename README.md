# Giro

Chilometri, turni di guida e pedaggi tra amici. L'app mostra quanto ha contribuito ciascuno, suggerisce chi guida e lascia sempre la scelta al gruppo.

Web app installabile (PWA) · React + TypeScript + Vite · database condiviso Supabase · mappe OpenStreetMap.

## Avvio in locale

```bash
npm install
npm run dev          # http://localhost:5173
```

Senza configurazione l'app parte in **modalità dimostrativa**: dati di esempio salvati solo sul dispositivo, segnalati in alto da «Dati dimostrativi». Serve per provare; non è condivisa tra telefoni.

## Mettere online l'app vera (circa 20 minuti, tutto gratuito)

### 1. Supabase — database e accessi
1. Crea un progetto su [supabase.com](https://supabase.com) (regione: Frankfurt).
2. **SQL Editor → New query**: incolla tutto `supabase/schema.sql` ed esegui.
3. **Authentication → Emails → Magic Link**: nel corpo dell'email aggiungi il codice, per esempio
   `Il tuo codice di accesso: {{ .Token }}`.
   È importante: su iPhone l'app installata sulla Home non riceve i link aperti da Mail, mentre il codice a 6 cifre funziona sempre.
4. **Authentication → URL Configuration**: imposta *Site URL* con l'indirizzo pubblico dell'app (punto 2) e aggiungilo anche tra le *Redirect URLs*.
5. **Project Settings → API**: copia *Project URL* e chiave *anon public*.

**Necessario per gli amici:** l'invio email incluso in Supabase spedisce solo ai membri del team del progetto e al massimo 2 email l'ora. Per far accedere gli amici collega un servizio SMTP gratuito (es. Brevo o Resend) da *Authentication → SMTP Settings*: il limite sale a 30 email l'ora, modificabile.

Da sapere: sul piano gratuito un progetto senza attività per 7 giorni viene messo in pausa. I dati restano; si riattiva dal pannello di Supabase.

### 2. GitHub Pages — pubblicazione
1. Nel repository: **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables**: aggiungi `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Ogni modifica su `main` viene testata e pubblicata in automatico (`.github/workflows/pages.yml`). L'indirizzo, del tipo `https://<utente>.github.io/<repository>/`, va nel *Site URL* di Supabase (punto 1.4).

In alternativa funziona anche Vercel o Netlify, con le stesse due variabili.

La chiave *anon* è pubblica per progetto: la protezione dei dati è nelle regole del database (RLS), per cui ogni gruppo è leggibile e scrivibile solo dai suoi membri.

### 3. Installazione sul telefono
- iPhone (Safari): Condividi → **Aggiungi a Home**.
- Android (Chrome): menu → **Installa app**.

## Configurazioni

| Variabile | Obbligatoria | A cosa serve |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | sì, per l'app condivisa | database e accesso |
| `VITE_OSRM_URL` | no | server dei percorsi (predefinito: `router.project-osrm.org`) |
| `VITE_PHOTON_URL` | no | ricerca luoghi (predefinito: `photon.komoot.io`) |

## Integrazioni: cosa è verificato e cosa no

| Parte | Stato |
|---|---|
| Regole dei km, quote, pedaggi, rimborsi, suggerimento, giro delle case | **Verificate** con 40 test automatici (`npm test`) |
| Schema del database, accessi, inviti, concorrenza, protezioni contro manomissioni | **Verificati** su Postgres con 37 controlli (`node tests/schema.check.mjs`) |
| Interfaccia e flussi | **Verificati** in Chrome con viewport iPhone, 38 controlli (`python3 tests/e2e.py`), tema chiaro/scuro e «Riduci movimento» |
| Percorsi stradali (OSRM) e ricerca (Photon) | Codice completo, lettura della risposta testata su dati di esempio. **Non provati dal vivo**: l'ambiente di sviluppo non poteva raggiungere quei server. Da provare al primo avvio. |
| Supabase reale (email, tempo reale tra telefoni) | Schema provato su Postgres; **collegamento a un progetto Supabase vero non ancora provato**. |
| Safari iOS e Android reali | **Non provati su dispositivi fisici**. |

Servizi usati, tutti gratuiti e senza chiavi: tessere mappa CARTO su dati OpenStreetMap, OSRM (server dimostrativo pubblico), Photon di Komoot. I server pubblici hanno limiti d'uso adatti a un gruppo di amici, non a un uso intensivo.

## Pedaggi A4 Milano Est ⇄ Brescia Ovest

**Come funziona.** Dal percorso OSRM l'app legge i tratti a pagamento e l'autostrada. Sull'A4 individua casello di entrata e di uscita, cerca l'importo e lo attribuisce al conducente, diviso tra gli occupanti del tratto. Andata e ritorno sono calcolati separatamente.

**Caselli coperti** (16, classe A): Milano Est, Agrate, Cavenago-Cambiago, Trezzo, Capriate, Dalmine, Bergamo, Seriate, Grumello-Telgate, Ponte Oglio, Palazzolo, Rovato, Ospitaletto, Brescia Ovest, Brescia Centro, Brescia Est.

**Tariffe ufficiali, calcolo automatico.**
- In tabella (`src/lib/tolls.ts`) ci sono tutte le 120 coppie di caselli, lette il 20/11/2026 dal calcolatore ufficiale <https://www.infoviaggiando.it/pedaggi> (classe A). L'importo è compilato da solo e risulta certo: non c'è nulla da confermare.
- Riconoscimento: l'app legge dal percorso i tratti con sigla A4 e prende come caselli il punto in cui si entra e quello in cui si esce (posizioni delle rampe da OpenStreetMap). A ovest di Agrate vale la barriera di Milano Est. Il router pubblico non segnala i tratti a pagamento, quindi conta la sigla della strada.
- Le tariffe autostradali cambiano di solito a gennaio: quando succede va riletta la tabella (data in `TARIFF_DATE`). Nel frattempo un importo scritto a mano su un viaggio vale per quel viaggio.
- Tangenziali di Milano (A50, A51, A52) considerate senza pedaggio nei collegamenti con l'A4.

**Stati mostrati:** «Nessun pedaggio», importo compilato, «Da verificare», «Fuori copertura». A35 BreBeMi e ogni altra autostrada a pagamento risultano fuori copertura: l'importo si inserisce a mano.

## Regole implementate

- Chi guida all'andata guida anche al ritorno. Senza opzione ×1; con «Non posso bere ostia» (vale per tutta l'uscita) ×2; ×3 se l'uscita è sotto i 5 km in totale (a 5 km esatti ×2).
- Per ogni tratto tra due tappe: al conducente i km ponderati, a ogni occupante (conducente compreso) una quota uguale. Chi sale o scende lungo il percorso paga solo i suoi tratti.
- I saldi non sono salvati: sono ricalcolati ogni volta dai viaggi confermati e dai rimborsi. Modifiche e annullamenti restano quindi coerenti e la somma del gruppo è sempre zero (arrotondamento al metro e al centesimo con resto distribuito).
- Un viaggio conta una sola volta: identificativo generato dal dispositivo (un reinvio non duplica) e numero di versione controllato dal database (una seconda conferma o una modifica superata viene rifiutata e l'app ricarica).

## Collaudo

Oltre ai test automatici, la versione è stata usata a fondo da 8 agenti di collaudo, in due giri (collaudo e verifica delle correzioni) (flusso, conducente, km, pedaggi, mappa, conferma e storico, grafica e accessibilità, sicurezza). I problemi trovati sono stati corretti in quattro blocchi: saldi, sicurezza, flusso, grafica.

Protezioni principali:
- un membro può modificare solo nome, colore e casa propri; «creato da» e «ultima modifica di» li scrive il database;
- i viaggi con dati malformati vengono rifiutati dal database e ignorati dall'app;
- rimborsi solo tra membri dello stesso gruppo; il link di invito si può rigenerare;
- km e pedaggi fuori scala (oltre 2.000 km o 500 € per tratta) rifiutati dal database;
- le tariffe del gruppo si salvano una alla volta, così due telefoni non si sovrascrivono;
- la casa non condivisa non entra mai nei percorsi.

## Struttura

```
src/lib/calc.ts       regole km, pedaggi, saldi, suggerimento   (+ calc.test.ts)
src/lib/tolls.ts      caselli A4, tariffe, lettura percorso OSRM
src/lib/routing.ts    OSRM, Photon, stima di riserva
src/lib/plan.ts       giro delle case, ritorno inverso
src/lib/store/        Supabase e modalità dimostrativa
src/screens/          home, organizzazione, viaggio, storico, luoghi, pedaggi, membri
supabase/schema.sql   tabelle, regole di accesso, inviti
tests/                collaudo database ed end-to-end
```

## Limiti noti

- Un membro del gruppo, usando direttamente il database, può ancora scrivere km o pedaggi falsi ma realistici: ogni modifica riporta però il suo nome.
- Senza rete l'app mostra il caricamento per qualche secondo prima dell'errore (tentativi automatici della libreria Supabase); offline non c'è una copia dei saldi in sola lettura.
- Da provare dal vivo: Safari su iPhone (app sulla Home), aggiornamento in tempo reale tra telefoni con Supabase.

## Rimandato alla versione successiva

Easter egg e gamification; notifiche; più auto nella stessa uscita; scelta tra percorsi alternativi con più di due tappe (oggi si corregge con i km).
