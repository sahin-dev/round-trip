/* Accessibility audit with axe-core across every page, in both themes and both languages. */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const site = process.argv[2] || require('./env').site;
const axe = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch(require('./env').launch);
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  await p.goto(site, { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => { const S = RT.settings; S.welcomed = true; S.seenTour = true; S.openOn = 'lab'; RT.saveSettings(); });
  const totals = {};
  for (const [theme, lang] of [['light', 'en'], ['dark', 'en'], ['light', 'bn']]) {
    await p.evaluate((t, l) => { const S = RT.settings; S.theme = t; S.lang = l; S.tab = {}; RT.saveSettings(); }, theme, lang);
    await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(400);
    const ids = await p.evaluate(() => ['', ...RT.labs.map((l) => l.id)]);
    for (const id of ids) {
      await p.evaluate((i) => { location.hash = i; }, id); await sleep(260);
      await p.evaluate(axe);
      const r = await p.evaluate(async () => { const x = await axe.run(document, { resultTypes: ['violations'], runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }); return x.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes[0].target.join(' ').slice(0, 70) })); });
      r.forEach((v) => { const k = v.id; const t = totals[k] = totals[k] || { impact: v.impact, nodes: 0, pages: new Set(), ex: v.ex, modes: new Set() }; t.nodes += v.n; t.pages.add(id || 'home'); t.modes.add(theme + '/' + lang); });
    }
  }
  const rows = Object.entries(totals).sort((a, c) => ['critical', 'serious', 'moderate', 'minor'].indexOf(a[1].impact) - ['critical', 'serious', 'moderate', 'minor'].indexOf(c[1].impact));
  rows.forEach(([k, t]) => console.log(`${(t.impact || '').padEnd(9)} ${k.padEnd(34)} nodes ${String(t.nodes).padStart(5)}  pages ${String(t.pages.size).padStart(3)}  ${[...t.modes].join(',')}  e.g. ${t.ex}`));
  console.log(rows.length ? rows.length + ' rule(s) violated' : 'axe: no violations');
  await b.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
