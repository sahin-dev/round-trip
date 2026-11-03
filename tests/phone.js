const puppeteer = require('puppeteer-core');
const path = require('path');
const site = require('./env').site;
const shots = require('./env').shots;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch(require('./env').launch);
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await p.goto(site, { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => { const S = RT.settings; S.openOn = 'lab'; S.seenTour = true; S.welcomed = true; RT.saveSettings(); });
  await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(600);
  const over = [];
  for (const id of await p.evaluate(() => RT.labs.map((l) => l.id))) {
    await p.evaluate((i) => { location.hash = i; }, id); await sleep(220);
    const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (o > 0) over.push(id + ':' + o);
    if (id === 'workbench') for (const t of ['Cache size', 'Shard plan', 'Queue consumers', 'Autoscaler', 'Alerts']) { await p.evaluate((x) => [...document.querySelectorAll('.tabs button')].find((q) => q.textContent === x).click(), t); await sleep(120); const v = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (v > 0) over.push('workbench/' + t + ':' + v); }
  }
  console.log('phone overflow', over.join(' ') || 'none');
  await p.evaluate(() => { location.hash = 'studio'; }); await sleep(400);
  // Touch path: add from the palette, then connect with the side panel.
  await p.evaluate(() => [...document.querySelectorAll('.pal')].find((x) => x.querySelector('b').textContent === 'Load balancer').click()); await sleep(150);
  await p.evaluate(() => [...document.querySelectorAll('.pal')].find((x) => x.querySelector('b').textContent === 'App servers').click()); await sleep(150);
  const before = await p.$$eval('.studio-canvas path[marker-end]', (e) => e.length);
  await p.$eval('[data-id="users"]', (g) => g.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))); await sleep(150);
  await p.click('#st-connect'); await sleep(150);
  console.log('edges via side panel', before, '->', await p.$$eval('.studio-canvas path[marker-end]', (e) => e.length));
  await p.screenshot({ path: path.join(shots, 'phone-studio.png'), fullPage: false });
  console.log('errors', errs);
  await b.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
