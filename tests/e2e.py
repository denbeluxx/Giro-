"""Collaudo end-to-end della build dimostrativa (percorsi simulati) + caso di guasto del routing sulla build reale.
Uso: python3 tests/e2e.py  (richiede i server su :4173 = dist-sim e :4174 = dist)."""
import re, sys, json
from playwright.sync_api import sync_playwright

OUT = '/home/claude/shots'
SIM, REAL = 'http://localhost:4173/', 'http://localhost:4174/'
passed = []
def ok(cond, msg):
    if not cond:
        print('✗', msg); sys.exit(1)
    passed.append(msg); print('✓', msg)

def norm(t): return t.replace('\u00a0', ' ')

def num(s):
    m = re.search(r'([+−-]?)\s*(\d+(?:,\d+)?)', s)
    v = float(m.group(2).replace(',', '.'))
    return -v if m.group(1) in ('−', '-') else v

def hero(pg):
    pg.wait_for_selector('.hero .big'); pg.wait_for_timeout(900)
    return num(pg.inner_text('.hero .big'))

def shot(pg, name): pg.screenshot(path=f'{OUT}/{name}.png')
def tap(pg, sel, wait=450): pg.click(sel); pg.wait_for_timeout(wait)
def db(pg): return json.loads(pg.evaluate("localStorage.getItem('giro-demo-v5')"))['groups']['demo-group']

def new_ctx(b, **kw):
    return b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='it-IT', timezone_id='Europe/Rome', **kw)

def leave_flow(pg):
    pg.go_back(); pg.wait_for_timeout(400); pg.go_back(); pg.wait_for_timeout(400)
    pg.click('.nav .nav-btn'); pg.wait_for_timeout(400)
    # uscendo la bozza resta in home: la eliminiamo per ripartire puliti
    if pg.locator('[aria-label="Elimina la bozza"]').count(): tap(pg, '[aria-label="Elimina la bozza"]', 500)

def plan_to(pg, place, driver=None, search=None, mode='Organizza uscita', only=None):
    tap(pg, f'text={mode}', 600)
    if only is not None:
        for name in ['Daniele', 'Matteo', 'Filippo', 'Alessia', 'Andrea']:
            if name not in only: tap(pg, f'.chip:has-text("{name}")', 120)
    if search:
        pg.fill('.search input', search); pg.wait_for_selector(f'.list .row:has-text("{place}")')
    tap(pg, f'.row:has-text("{place}")', 500)
    tap(pg, 'button:has-text("Continua")', 900)
    if driver: tap(pg, f'[role=radio]:has-text("{driver}")', 300)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    c = new_ctx(b, record_video_dir=f'{OUT}/video', record_video_size={'width': 390, 'height': 844})
    pg = c.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(SIM)
    h0 = hero(pg)
    shot(pg, '01-home')

    # --- Organizza uscita: suggerimento visibile, nessuno selezionato ---
    plan_to(pg, 'Bolgia')
    ok(pg.locator('.pill:has-text("Suggerito")').count() == 1, 'il suggerito è visibile')
    ok(pg.locator('[role=radio][aria-checked=true]').count() == 0, 'inizialmente nessun conducente è selezionato')
    ok(pg.locator('.cta .btn').is_disabled(), 'non si prosegue senza una scelta esplicita')
    shot(pg, '03-chi-guida')
    tap(pg, '[role=radio]:has-text("Alessia")', 350)
    ok(pg.locator('[role=radio][aria-checked=true]').count() == 1 and pg.locator('.cta .btn').is_enabled(), 'un altro conducente si sceglie con un solo tocco, senza conferme')
    ok('giro' in pg.inner_text('[role=radio]:has-text("Daniele")') and 'giro' in pg.inner_text('[role=radio]:has-text("Alessia")') and pg.locator('.notice').count() == 0, 'km del giro per ognuno, senza riquadri ripetuti')
    shot(pg, '04-chi-guida-scelto')
    tap(pg, 'button:has-text("Continua")', 1600)
    pg.wait_for_selector('.stats b')
    shot(pg, '05-percorso')
    # pannello espanso e riordino tappe
    tap(pg, '.grab', 600); shot(pg, '06-percorso-pannello')
    names0 = pg.locator('.stop .t').all_inner_texts()
    hbox = pg.locator('.stop .handle').nth(1).bounding_box()
    pg.mouse.move(hbox['x'] + 20, hbox['y'] + 20); pg.mouse.down(); pg.mouse.move(hbox['x'] + 20, hbox['y'] + 85, steps=8); pg.wait_for_timeout(200)
    shot(pg, '07-riordino-tappe'); pg.mouse.up(); pg.wait_for_timeout(1300)
    names1 = pg.locator('.stop .t').all_inner_texts()
    ok(names0 != names1 and sorted(names0) == sorted(names1), 'le tappe si riordinano trascinando e il percorso si ricalcola')
    tap(pg, '.stop .main >> nth=1', 500); shot(pg, '08-tappa-sale-scende')
    ok(pg.locator('.sheet button:has-text("Sposta prima")').count() == 1, 'riordino disponibile anche con controlli accessibili')
    tap(pg, '.sheet-h .nav-btn', 400)
    tap(pg, '.seg button:has-text("Ritorno")', 500)
    ok(pg.locator('.stop').count() == len(names1), 'ritorno proposto con le tappe in ordine inverso')
    tap(pg, 'button:has-text("Salva uscita")', 1200)
    pg.wait_for_selector('.sheet:has-text("Condividi il piano")')
    txt = pg.inner_text('.sheet .list')
    ok('Bolgia' in txt and 'Guida: Alessia' in txt and 'Casa di' in txt and '?t=' in txt and 'Ritorno' in txt, 'riepilogo WhatsApp con destinazione, conducente, tappe per nome, ritorno e link')
    ok(pg.locator('.sheet a[href^="https://wa.me/?text="]').count() == 1, 'la condivisione parte da un tocco dell\'utente')
    shot(pg, '09-condividi')
    tap(pg, '.sheet-h .nav-btn', 400)
    shot(pg, '10-uscita-pianificata')
    tap(pg, '.nav-btn:has-text("Indietro")', 700)
    ok(hero(pg) == h0, 'la pianificazione lascia invariati i saldi')

    # --- Conducente da decidere ---
    plan_to(pg, 'Setai')
    tap(pg, '[role=radio]:has-text("Da decidere")', 300)
    tap(pg, 'button:has-text("Continua")', 900)
    tap(pg, 'button:has-text("Salva uscita")', 1200)
    tap(pg, '.sheet-h .nav-btn', 400)
    ok('Da decidere' in pg.inner_text('.scroll'), 'l\'uscita si salva con «Conducente da decidere»')
    tap(pg, '.nav-btn:has-text("Indietro")', 700)
    ok(hero(pg) == h0, 'saldi ancora invariati')

    # --- Conferma con un tocco (e doppio tocco) ---
    tap(pg, '.banner.hot', 800)
    shot(pg, '11-conferma')
    pg.locator('.cta .btn:has-text("Conferma viaggio")').dblclick(); pg.wait_for_selector('.done')
    pg.wait_for_timeout(1100); shot(pg, '12-viaggio-registrato')
    delta = num(pg.inner_text('.done .card .num'))
    t4 = [t for t in db(pg)['trips'] if t['id'] == 't-4'][0]
    ok(t4['status'] == 'confirmed' and t4['version'] == 2, 'doppio tocco su «Conferma viaggio»: registrato una sola volta')
    tap(pg, '.done .btn', 900)
    h1 = hero(pg)
    ok(abs(h1 - (h0 + delta)) < 0.11, f'conferma: saldo aggiornato una volta sola ({h0} {delta:+} → {h1})')
    shot(pg, '13-home-dopo-conferma')

    # --- A4 coperta: pedaggio compilato da solo ---
    plan_to(pg, 'Navigli', driver='Matteo', only=['Daniele', 'Matteo'])
    tap(pg, 'button:has-text("Continua")', 1600); pg.wait_for_selector('.stats b')
    ok('Pedaggio 4,30 €' in norm(pg.inner_text('.stats')), 'tratta A4 Seriate–Milano Est: tariffa ufficiale compilata senza digitare nulla')
    shot(pg, '14-pedaggio-a4')
    tap(pg, '.grab', 500)
    tap(pg, 'button:has-text("Pedaggio e pagante")', 500); shot(pg, '15-pedaggio-dettaglio')
    ok(pg.locator('.sheet select').first.input_value() == 'seriate', 'caselli riconosciuti e correggibili')
    ok('Ricorda' not in pg.inner_text('.sheet') and 'verificare' not in pg.inner_text('.sheet'), 'pedaggio A4 certo: nessuna conferma richiesta')
    tap(pg, '.sheet-h .nav-btn', 400)
    ok(pg.locator('button:has-text("Guida al ritorno")').count() == 0 and pg.locator('[role=switch][aria-label="Non posso bere ostia"]').count() == 1, 'un solo conducente per andata e ritorno; opzione «Non posso bere ostia» unica')
    tap(pg, '[role=switch][aria-label="Non posso bere ostia"]', 300)
    d = pg.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('giro-draft-'))) || '{}')")
    ok(len(d.get('legs', [])) == 2 and all(l['designated'] for l in d['legs']) and len({l['driverId'] for l in d['legs']}) == 1, 'opzione e conducente valgono per andata e ritorno')
    tap(pg, '[role=switch][aria-label="Non posso bere ostia"]', 300)
    tap(pg, 'button:has-text("Pedaggio e pagante")', 400)
    tap(pg, '.sheet-h .nav-btn', 400)
    leave_flow(pg)

    # --- A35: fuori copertura ---
    plan_to(pg, 'Treviglio', driver='Filippo', search='trevi')
    tap(pg, 'button:has-text("Continua")', 1600); pg.wait_for_selector('.stats b')
    ok('fuori copertura' in pg.inner_text('.stats').lower() and 'A35' in pg.inner_text('.panel-body'), 'A35 indicata come fuori copertura')
    shot(pg, '16-a35-fuori-copertura')
    leave_flow(pg)

    # --- Registrazione diretta con flag: 2 + 2 km => ×3 ---
    plan_to(pg, 'Setai', driver='Daniele', mode='Registra un viaggio già fatto', only=['Daniele', 'Andrea'])
    tap(pg, 'button:has-text("Continua")', 1600); pg.wait_for_selector('.stats b')
    tap(pg, '.grab', 500)
    tap(pg, 'button:has-text("Correggi i chilometri")', 500)
    for i in (0, 1): pg.fill(f'#km-{i}', '2')
    ok(pg.locator('.sheet [role=switch]').count() == 1, 'un solo interruttore «Non posso bere ostia» per tutta l\'uscita')
    tap(pg, '.sheet [role=switch]', 200)
    foot = ' '.join(pg.locator('.sheet .foot').all_inner_texts())
    foot = norm(foot); ok(foot.count('×3') == 2 and foot.count('6,0 km') == 2, '2 + 2 km con flag: ×3, 12 km validi')
    pg.fill('#km-0', '4,9'); pg.fill('#km-1', '0')
    ok('14,7 km' in norm(pg.locator('.sheet .foot').first.inner_text()), '4,9 km con flag: 14,7 km validi')
    pg.fill('#km-0', '2,5'); pg.fill('#km-1', '2,5')
    foot = ' '.join(pg.locator('.sheet .foot').all_inner_texts())
    foot = norm(foot); ok(foot.count('×2') == 2 and foot.count('5,0 km') == 2, '5 km esatti con flag: ×2, 10 km validi')
    pg.fill('#km-0', '2'); pg.fill('#km-1', '2')
    shot(pg, '17-chilometri-flag')
    tap(pg, '.sheet .btn:has-text("Fatto")', 500)
    tap(pg, 'button:has-text("Registra viaggio")', 900); pg.wait_for_selector('.done'); pg.wait_for_timeout(900)
    d2 = num(pg.inner_text('.done .card .num'))
    rec = [t for t in db(pg)['trips'] if t['status'] == 'confirmed' and t['dest']['name'].startswith('Setai') and len(t['presentIds']) == 2][-1]
    def share(t, km_leg, mult):  # quota attesa: Andrea è a bordo solo tra casa sua e il locale
        tot = 0
        for leg in t['legs']:
            ms = [x['meters'] for x in leg['segs']]; w = ms[1] if leg['kind'] == 'andata' else ms[0]
            tot += km_leg * mult * (w / sum(ms)) / 2
        return tot
    exp = share(rec, 2, 3)
    ok(abs(d2 - exp) < 0.06 and 0 < d2 < 6, f'passeggera raccolta lungo il percorso: paga solo i suoi tratti (conducente +{d2}, atteso {exp:.2f})')
    tap(pg, '.done .btn', 900)
    h2 = hero(pg)
    ok(abs(h2 - (h1 + d2)) < 0.11, 'registrazione diretta: saldo aggiornato')

    # --- Storico, modifica, annullamento ---
    tap(pg, '.tile:has-text("Storico")', 700); shot(pg, '18-storico')
    tap(pg, '.row:has-text("Setai"):has-text("Confermato") >> nth=0', 800); shot(pg, '19-dettaglio-viaggio')
    ok('Ultima modifica: Daniele' in pg.inner_text('.scroll'), 'il dettaglio mostra chi ha fatto l\'ultima modifica')
    tap(pg, '.row:has-text("Km effettivi")', 500)
    pg.fill('#km-0', '3'); pg.fill('#km-1', '3'); tap(pg, '.sheet .btn:has-text("Fatto")', 900)
    tap(pg, '.nav-btn:has-text("Indietro")', 600); tap(pg, '.nav-btn:has-text("Indietro")', 700)
    h3 = hero(pg)
    ok(abs(h3 - h1 - d2) < 0.11, f'modifica a 3 + 3 km (×2 = 12 validi come 2 + 2 ×3): saldo ricalcolato e coerente ({h3})')
    tap(pg, '.tile:has-text("Storico")', 700); tap(pg, '.row:has-text("Setai"):has-text("Confermato") >> nth=0', 800)
    tap(pg, '.row:has-text("Annulla viaggio")', 500); tap(pg, '.sheet .btn:has-text("Annulla viaggio")', 1000)
    tap(pg, '.nav-btn:has-text("Indietro")', 600); tap(pg, '.nav-btn:has-text("Indietro")', 700)
    ok(abs(hero(pg) - h1) < 0.11, 'annullamento: il viaggio esce dai saldi')
    g = db(pg)
    ok(sum(1 for t in g['trips'] if t['status'] == 'cancelled') == 1, 'il viaggio annullato resta nello storico')

    # --- Pedaggi e rimborso ---
    tap(pg, '.hchip:has-text("Pedaggi")', 700); shot(pg, '20-pedaggi')
    before = pg.locator('.list').first.inner_text()
    if pg.locator('.row:has-text("Tocca per registrare")').count():
        tap(pg, '.row:has-text("Tocca per registrare") >> nth=0', 500); shot(pg, '21-rimborso')
        tap(pg, '.sheet .btn:has-text("Registra rimborso")', 1000)
        ok(pg.locator('.list').first.inner_text() != before and 'rimborsi registrati' in pg.inner_text('.scroll').lower(), 'rimborso registrato: saldi in euro aggiornati')
    tap(pg, '.nav-btn:has-text("Indietro")', 700)

    # --- Seconda sessione: stessi dati ---
    pg2 = c.new_page(); pg2.goto(SIM); pg2.wait_for_selector('.hero .big')
    tap(pg2, '.nav .nav-btn', 700); pg2.locator('.chip:has-text("Matteo")').last.scroll_into_view_if_needed(); tap(pg2, '.section:has-text("Modalità dimostrativa") .chip:has-text("Matteo")', 700)
    tap(pg2, '.nav-btn:has-text("Indietro")', 700)
    rows1 = pg.locator('.section .list').first.inner_text(); rows2 = pg2.locator('.section .list').first.inner_text()
    ok(rows1.replace(' · tu', '') == rows2.replace(' · tu', ''), 'due sessioni (Daniele e Matteo) vedono gli stessi saldi')
    tap(pg2, '.row:has-text("Registra un viaggio")', 500); tap(pg2, '.row:has-text("Setai")', 400); tap(pg2, 'button:has-text("Continua")', 800)
    tap(pg2, '[role=radio]:has-text("Matteo")', 300); tap(pg2, 'button:has-text("Continua")', 1600); tap(pg2, 'button:has-text("Registra viaggio")', 1400)
    pg.wait_for_timeout(900)
    ok(pg.locator('.section .list').first.inner_text() != rows1, 'un viaggio registrato in una sessione compare subito nell\'altra')
    pg2.close()

    # --- Membri, luoghi ---
    tap(pg, '.nav .nav-btn', 700); shot(pg, '22-membri')
    tap(pg, '.nav-btn:has-text("Indietro")', 600); tap(pg, '.tile:has-text("Luoghi")', 700); shot(pg, '23-luoghi')
    ok(not errs, f'nessun errore in console ({errs[:2]})')
    c.close()

    # --- Tema scuro e movimento ridotto ---
    c2 = new_ctx(b, color_scheme='dark', reduced_motion='reduce'); pg = c2.new_page(); pg.goto(SIM)
    hero(pg); shot(pg, '24-home-scuro')
    plan_to(pg, 'Bolgia', driver='Filippo'); shot(pg, '25-chi-guida-scuro')
    tap(pg, 'button:has-text("Continua")', 1400); pg.wait_for_selector('.stats b'); shot(pg, '26-percorso-scuro')
    tap(pg, 'button:has-text("Salva uscita")', 900)
    ok(pg.locator('.sheet:has-text("Condividi il piano")').count() == 1, 'tema scuro e «Riduci movimento»: il flusso completo funziona')
    dur = pg.evaluate("getComputedStyle(document.querySelector('.sheet')).animationDuration")
    ok(dur in ('1e-05s', '0.00001s'), f'con «Riduci movimento» le animazioni sono disattivate ({dur})')
    tap(pg, '.sheet-h .nav-btn', 200); tap(pg, '.nav-btn:has-text("Indietro")', 300); tap(pg, '.nav .nav-btn', 300)
    ok(pg.evaluate("getComputedStyle(document.body).backgroundColor") == 'rgb(22, 23, 26)', 'tema antracite applicato anche su dispositivo scuro')
    c2.close()

    # --- Tastiera: viewport ridotto come con tastiera aperta ---
    c3 = b.new_context(viewport={'width': 390, 'height': 480}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='it-IT'); pg = c3.new_page(); pg.goto(SIM)
    hero(pg); tap(pg, 'text=Organizza uscita', 500); pg.locator('.search input').scroll_into_view_if_needed(); pg.fill('.search input', 'navi'); pg.wait_for_selector('.list .row:has-text("Navigli")')
    box = pg.locator('.cta .btn').bounding_box()
    ok(box['y'] + box['height'] <= 480, 'con la tastiera aperta ricerca e pulsante principale restano raggiungibili')
    shot(pg, '27-tastiera'); c3.close()

    # --- Nome del gruppo modificabile ---
    c4 = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='it-IT'); pg = c4.new_page(); pg.goto(SIM)
    hero(pg); tap(pg, 'button:has(h1.title)', 600); tap(pg, '.row:has-text("Nome del gruppo")', 400)
    pg.fill('.sheet input', 'Compagnia del giro'); tap(pg, '.sheet .btn:has-text("Salva nome")', 700)
    pg.go_back(); pg.wait_for_selector('.hero .big')
    ok(pg.inner_text('h1.title') == 'Compagnia del giro' and db(pg)['group']['name'] == 'Compagnia del giro', 'il nome del gruppo si può cambiare')
    c4.close()

    # --- Build reale senza rete: il routing fallisce, i dati restano ---
    c4 = new_ctx(b); pg = c4.new_page(); pg.goto(REAL); hero(pg)
    tap(pg, 'text=Organizza uscita', 600)
    pg.fill('.search input', 'via roma'); pg.wait_for_selector('.notice:has-text("La ricerca non risponde")', timeout=20000)
    ok(True, 'ricerca non raggiungibile: errore chiaro con «Riprova»')
    shot(pg, '28-errore-ricerca')
    pg.fill('.search input', ''); tap(pg, '.row:has-text("Bolgia")', 400); tap(pg, 'button:has-text("Continua")', 900)
    tap(pg, '[role=radio]:has-text("Matteo")', 300); tap(pg, 'button:has-text("Continua")', 600)
    pg.wait_for_selector('.notice:has-text("Il servizio dei percorsi non risponde")', timeout=20000)
    ok(pg.locator('.stop').count() >= 2, 'routing non raggiungibile: tappe e scelte conservate, con «Riprova» e inserimento manuale')
    tap(pg, '.grab', 500); shot(pg, '29-errore-percorso')
    tap(pg, 'button:has-text("Inserisci i km a mano")', 500)
    ok('linea d\'aria' in pg.inner_text('.panel-body'), 'la stima è dichiarata come tale, mai come percorso reale')
    shot(pg, '30-km-manuali')
    c4.close(); b.close()

print(f'\n{len(passed)} verifiche superate')
