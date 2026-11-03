/* Tests the built site as a host would serve it: headers on, CSP enforced, then offline. */
const { spawn } = require('child_process');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { launch, root } = require('./env');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = 'http://localhost:4173/';
(async () => {
  const server = spawn(process.execPath, [path.join(root, 'scripts', 'preview.mjs')], { stdio: 'ignore' });
  await sleep(700);
  const b = await puppeteer.launch(launch);
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
  try {
    const p = await b.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    const res = await p.goto(url, { waitUntil: 'networkidle2' });
    ok(/script-src 'self'/.test(res.headers()['content-security-policy'] || ''), 'CSP header sent');
    ok(await p.evaluate(() => !!document.querySelector('.rail') && !/Loading Round Trip/.test(document.body.innerText)), 'site starts');
    await p.evaluate(() => { const S = RT.settings; S.welcomed = true; S.seenTour = true; S.openOn = 'lab'; RT.saveSettings(); });
    for (const id of ['dns', 'game', 'studio', 'tls', 'about']) { await p.evaluate((i) => { location.hash = i; }, id); await sleep(450); }
    await p.evaluate(() => navigator.serviceWorker.ready);
    await sleep(500);
    ok(await p.evaluate(() => caches.keys().then((k) => k.length === 1)), 'service worker cached the site');
    const blocked = errs.filter((e) => /Content Security Policy/i.test(e));
    ok(!blocked.length, 'no CSP violations' + (blocked[0] ? ': ' + blocked[0].slice(0, 200) : ''));
    ok(!errs.filter((e) => !/Content Security Policy|Failed to load resource|net::ERR/.test(e)).length, 'no script errors');
    await p.setOfflineMode(true);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await sleep(900);
    ok(await p.evaluate(() => !!document.querySelector('.rail')), 'works offline');
    await p.evaluate(() => { location.hash = 'lb'; });
    await sleep(500);
    ok(await p.evaluate(() => document.querySelector('main').innerText.length > 200), 'a lab opens offline');
  } finally { await b.close(); server.kill(); }
  console.log(fails ? 'dist checks failed' : 'all dist checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
