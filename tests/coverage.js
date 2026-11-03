/* Measures Bengali coverage: visits every page in Bengali, exercises it, and counts what is
   still English on screen. Technical names kept in English on purpose are not counted. */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const site = require('./env').site;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEEP = /^(HTTP|HTTPS|TCP|UDP|TLS|DNS|SQL|NoSQL|JSON|XML|JWT|OAuth|CPU|RAM|SSD|HDD|API|URL|URI|URN|CDN|QUIC|LRU|LFU|FIFO|ACID|BASE|CAP|PACELC|Redis|Kafka|RabbitMQ|AWS|S3|SHA-256|CRC32|GET|POST|OK|ms|GB|TB|MB|KB|Gbps|vCPU|TTL|RTT|NS|MX|TXT|AAAA|CNAME|Random|Host)$/;
const techy = (s) => !/[a-z]{3}/.test(s) || /^[\w.-]+\.(com|org|net|io|uk|js|css|jpg|svg|woff2|json|html|bd)$/.test(s) || /^[\w./:-]+$/.test(s) && !/\s/.test(s) && /[.:/_]/.test(s) || KEEP.test(s);
(async () => {
  const b = await puppeteer.launch(require('./env').launch);
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(site, { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => { const S = RT.settings; S.welcomed = true; S.seenTour = true; S.lang = 'bn'; S.openOn = 'lab'; S.level = 'some'; S.speed = 2; RT.saveSettings(); });
  await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(500);
  const ids = await p.evaluate(() => RT.labs.map((l) => l.id));
  let en = new Set(), bnNodes = 0;
  const scan = () => p.evaluate(() => {
    const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let bn = 0;
    while (w.nextNode()) {
      const n = w.currentNode, t = n.nodeValue.trim(), pe = n.parentElement;
      if (!t || !pe || pe.closest('script,style,code,pre,textarea,.hexbox,.gloss b,.tech summary b,.sr-list b')) continue;
      if (/[\u0980-\u09FF]/.test(t)) { bn++; if (!/[A-Za-z]{4,}\s+[A-Za-z]{4,}/.test(t)) continue; }
      if (/[A-Za-z]{3}/.test(t)) out.push(t);
    }
    return { out, bn };
  });
  const perLab = {};
  for (const id of [...ids, '']) {
    await p.evaluate((i) => { location.hash = i; }, id); await sleep(350);
    const n = await p.evaluate(() => document.querySelectorAll('main .controls button, main .tabs button').length);
    for (let i = 0; i < n; i++) { await p.evaluate((k) => { const x = document.querySelectorAll('main .controls button, main .tabs button')[k]; if (x && !x.disabled) x.click(); }, i).catch(() => {}); await sleep(50); }
    await sleep(1200);
    const r = await scan();
    bnNodes += r.bn;
    const miss = r.out.filter((s) => !techy(s));
    miss.forEach((s) => en.add(s));
    perLab[id || 'home'] = { en: miss.length, bn: r.bn };
  }
  // Open Settings and the search box in Bengali as well.
  await p.click('#open-settings'); await sleep(250);
  const r2 = await scan(); r2.out.filter((s) => !techy(s)).forEach((s) => en.add(s));
  await p.click('#set-close'); await sleep(200);
  const misses = await p.evaluate(() => RT.i18nMisses());
  misses.filter((s) => !techy(s)).forEach((s) => en.add(s));
  const list = [...en].sort((x, y) => x.length - y.length);
  fs.writeFileSync(require('path').join(__dirname, 'missing.txt'), list.join('\n'));
  const tot = Object.values(perLab).reduce((t, v) => ({ en: t.en + v.en, bn: t.bn + v.bn }), { en: 0, bn: 0 });
  console.log('on-screen text blocks: Bengali', tot.bn, 'English left', tot.en, 'coverage', ((tot.bn / (tot.bn + tot.en)) * 100).toFixed(1) + '%');
  console.log('worst pages:', Object.entries(perLab).sort((a, c) => c[1].en - a[1].en).slice(0, 8).map(([k, v]) => k + ':' + v.en).join(' '));
  console.log('distinct missing strings', list.length, 'errors', errs.length, errs.slice(0, 3));
  await b.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
