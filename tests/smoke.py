import sys
from playwright.sync_api import sync_playwright
out = '/home/claude/shots'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='it-IT', timezone_id='Europe/Rome')
    pg = c.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:4173/')
    pg.wait_for_selector('text=Organizza uscita')
    pg.wait_for_timeout(900)
    pg.screenshot(path=f'{out}/smoke-home.png')
    pg.click('text=Organizza uscita'); pg.wait_for_timeout(600)
    pg.screenshot(path=f'{out}/smoke-plan1.png')
    pg.click('text=Bolgia'); pg.wait_for_timeout(500)
    pg.click('button:has-text("Continua")'); pg.wait_for_timeout(900)
    pg.screenshot(path=f'{out}/smoke-plan2.png')
    pg.click('[role=radio]:has-text("Luca")'); pg.wait_for_timeout(300)
    pg.click('button:has-text("Continua")'); pg.wait_for_timeout(1800)
    pg.screenshot(path=f'{out}/smoke-plan3.png')
    print('errors:', errs)
    b.close()
