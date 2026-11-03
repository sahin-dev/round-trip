const puppeteer = require('puppeteer-core');
const path = require('path');
const site = require('./env').site;
const shots = require('./env').shots;
require('fs').mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch(require('./env').launch);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + location() + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text() + (m.location().url || ''))) errors.push('CONSOLE ' + location() + ': ' + m.text()); });
  let cur = 'home';
  const location = () => cur;
  await page.goto(site, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { const S = RT.settings; S.openOn = 'lab'; S.seenTour = true; S.welcomed = true; RT.saveSettings(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(500);
  const ids = await page.evaluate(() => RT.labs.map((l) => l.id));
  console.log('labs', ids.length, ids.join(' '));
  await page.screenshot({ path: path.join(shots, 'home.png') });
  const overflow = [];
  for (const id of ids) {
    cur = id;
    await page.evaluate((i) => { location.hash = i; }, id);
    await sleep(350);
    // Click every button in the lab once, except navigation.
    const n = await page.evaluate(() => document.querySelectorAll('main .controls button, main .tabs button').length);
    for (let i = 0; i < n; i++) {
      await page.evaluate((k) => { const b = document.querySelectorAll('main .controls button, main .tabs button')[k]; if (b && !b.disabled) b.click(); }, i).catch((e) => errors.push('CLICK ' + id + ' ' + e.message));
      await sleep(60);
    }
    await sleep(900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (o > 0) overflow.push(id + ':' + o);
    await page.screenshot({ path: path.join(shots, id + '.png') });
    const junk = await page.evaluate(() => (document.querySelector('main').innerText.match(/\[object|undefined|NaN|Infinity/g) || []).join(','));
    if (junk) errors.push('JUNK TEXT ' + id + ': ' + junk);
  }
  cur = 'home';
  await page.evaluate(() => { location.hash = ''; });
  await sleep(500);
  const homeJunk = await page.evaluate(() => (document.querySelector('main').innerText.match(/\[object|undefined|NaN/g) || []).length);
  if (homeJunk) errors.push('JUNK TEXT home');
  console.log('home cards', await page.$$eval('.labcard', (c) => c.length), '|', await page.$$eval('.fact, .facts > *', (e) => e.length));
  await page.screenshot({ path: path.join(shots, 'home.png'), fullPage: true });
  console.log('overflow', overflow.join(' ') || 'none');
  console.log('errors', errors.length);
  [...new Set(errors)].slice(0, 40).forEach((e) => console.log(' ', e));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
