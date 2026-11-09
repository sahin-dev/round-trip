const puppeteer = require('puppeteer-core');
const path = require('path');
const site = require('./env').site;
const shots = require('./env').shots;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
(async () => {
  const browser = await puppeteer.launch(require('./env').launch);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(site, { waitUntil: 'domcontentloaded' }); await sleep(500);
  const clickText = (sel, t) => page.evaluate((s, x) => { const b = [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === x); if (!b) throw new Error('no ' + x); b.click(); }, sel, t);

  // 1. Content completeness
  const missing = await page.evaluate(() => RT.labs.filter((l) => !['map', 'guide', 'glossary', 'game', 'about', 'roadmap', 'review', 'cheatsheet', 'playbook', 'walkthroughs'].includes(l.id) && !RTLearn.EXPLAIN[l.id]).map((l) => l.id));
  ok(missing.length === 0, 'every lab has a plain-English card ' + missing);
  const badLinks = await page.evaluate(() => { const bad = []; RTLearn.GLOSSARY.forEach((g) => { if (!RT.byId[g[2]]) bad.push(g[0] + '>' + g[2]); }); Object.values(RTLearn.PARTS).forEach((p) => { if (!RT.byId[p.lab]) bad.push(p.name); }); RTLearn.TECH.forEach((t) => { if (!RT.byId[t.lab]) bad.push(t.name); }); RTLearn.NEEDS.forEach(([n, l]) => l.forEach((x) => { if (!RTLearn.TECH.find((t) => t.name === x)) bad.push(n + ':' + x); })); RTLearn.PATHS.forEach((p) => (p.labs || []).forEach((i) => { if (!RT.byId[i]) bad.push(p.id + ':' + i); })); Object.values(RTLearn.FLOWS).forEach((f) => f.hops.forEach((h) => [h[0], h[1]].forEach((x) => { if (!RTLearn.PARTS[x]) bad.push('flow:' + x); }))); return bad; });
  ok(badLinks.length === 0, 'all content cross-references resolve ' + badLinks);

  // 2. Welcome flow
  ok(await page.$('#wl-go') !== null, 'first visit shows the welcome card');
  await page.select('#wl-path', 'starter'); await page.click('#wl-go'); await sleep(900);
  ok((await page.evaluate(() => location.hash)) === '#basics', 'welcome starts the beginner path at How systems work');
  await page.evaluate(() => { location.hash = 'map'; }); await sleep(500);

  await page.evaluate(() => { RT.settings.openOn = 'lab'; RT.saveSettings(); });
  // 3. System Map
  await page.click('#dk-next'); await sleep(1400);
  ok(/DNS/.test(await page.$eval('main .banner', (e) => e.textContent)), 'map narrates the first hop');
  ok((await page.$eval('.part', (e) => e.textContent)).includes('Real products'), 'map shows component detail');
  await page.screenshot({ path: path.join(shots, 'map.png'), fullPage: true });

  // 4. Lab explanation, glossary and first-run tour
  await page.evaluate(() => { location.hash = 'dns'; }); await sleep(1000);
  ok(await page.$eval('.explain', (e) => e.open), 'beginner sees the plain-English card open');
  ok(await page.$('.tour-box') !== null, 'first lab offers the guided tour');
  await page.screenshot({ path: path.join(shots, 'tour.png') });
  let n = 0; while (await page.$('#tour-next') && n < 8) { await page.click('#tour-next'); await sleep(120); n++; }
  ok(n >= 3 && !(await page.$('.tour-box')), `tour finishes (${n} steps)`);
  const gl = await page.$$eval('.gl', (g) => g.map((x) => x.textContent));
  ok(gl.length >= 5, 'terms are marked: ' + gl.slice(0, 10).join(', '));
  await page.hover('.notes .gl'); await sleep(150);
  ok(!(await page.$eval('.glpop', (e) => e.classList.contains('hide'))), 'hovering a term shows its meaning: ' + (await page.$eval('.glpop', (e) => e.textContent.slice(0, 70))));
  await page.mouse.move(5, 5); await sleep(120);
  ok(await page.$eval('.glpop', (e) => e.classList.contains('hide')), 'moving away hides the meaning');
  await page.screenshot({ path: path.join(shots, 'dns-explain.png'), fullPage: true });
  ok(await page.$$eval('.labnav a', (a) => a.length) === 2, 'lab has previous and next links on the path');
  // Live banners still work after word marking
  await page.click('#dns-go');
  await page.waitForFunction(() => !document.getElementById('dns-go').disabled, { timeout: 30000 }); await sleep(400);
  ok(/→|does not exist/.test(await page.$eval('main .banner', (e) => e.textContent)), 'DNS lab still runs with word marking on');

  // 5. Search
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await sleep(150);
  await page.type('#sr-q', 'kafka'); await sleep(150);
  const hits = await page.$$eval('.sr-list a', (a) => a.map((x) => x.textContent.slice(0, 34)));
  ok(hits.length >= 2, 'search finds Kafka: ' + hits.slice(0, 3).join(' | '));
  await page.keyboard.press('Enter'); await sleep(300);
  ok(await page.evaluate(() => !document.querySelector('dialog[open]')), 'search closes after choosing');

  // 6. Settings: theme, zoom, level, speed, assumptions
  await page.evaluate(() => { location.hash = 'studio'; }); await sleep(600);
  const budgetOf = () => page.$$eval('.req b', (b) => b.map((x) => x.textContent).find((t) => t.startsWith('$')));
  const b1 = await budgetOf();
  await page.click('#open-settings'); await sleep(200);
  await page.screenshot({ path: path.join(shots, 'settings.png') });
  await clickText('.dlg .seg button', 'Light'); await sleep(100);
  ok((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light', 'theme applies');
  await clickText('.dlg .seg button', 'Large'); await sleep(100);
  ok((await page.$eval('#main', (e) => e.style.zoom)) === '1.15', 'text size applies');
  await page.$eval('#as-price', (e) => { e.value = 2; e.dispatchEvent(new Event('input')); });
  await page.$eval('#as-app', (e) => { e.value = 2; e.dispatchEvent(new Event('input')); });
  await page.click('#set-close'); await sleep(400);
  const b2 = await budgetOf();
  ok(b1 !== b2, `assumptions change the budget (${b1} → ${b2})`);
  await page.screenshot({ path: path.join(shots, 'studio-light.png') });

  // 7. Drag on the Studio canvas still works at 1.15 zoom
  const lb = await (await page.evaluateHandle(() => [...document.querySelectorAll('.pal')].find((b) => b.querySelector('b').textContent === 'Cache'))).boundingBox();
  const cv = await (await page.$('.studio-canvas')).boundingBox();
  await page.evaluate(() => document.querySelector('.studio').scrollIntoView({ block: 'start', behavior: 'instant' })); await sleep(100);
  const lb2 = await (await page.evaluateHandle(() => [...document.querySelectorAll('.pal')].find((b) => b.querySelector('b').textContent === 'App servers'))).boundingBox();
  const cv2 = await (await page.$('.studio-canvas')).boundingBox();
  void lb; void cv;
  await page.mouse.move(lb2.x + 30, lb2.y + 10); await page.mouse.down(); await page.mouse.move(cv2.x + cv2.width * .6, cv2.y + cv2.height * .4, { steps: 6 }); await page.mouse.up(); await sleep(200);
  const pos = await page.evaluate(() => { const g = [...document.querySelectorAll('.studio-canvas [data-id]')].pop(), r = g.querySelector('rect.body').getBoundingClientRect(), c = document.querySelector('.studio-canvas').getBoundingClientRect(); return [(r.x + r.width / 2 - c.x) / c.width, (r.y + r.height / 2 - c.y) / c.height]; });
  ok(Math.abs(pos[0] - .6) < .05 && Math.abs(pos[1] - .4) < .08, 'drop lands under the pointer at large text size ' + pos.map((v) => v.toFixed(2)));
  await page.click('#st-clear'); await sleep(150);
  await page.click('#open-settings'); await sleep(150);
  await page.click('#as-reset'); await sleep(200);
  await clickText('.dlg .seg button', 'Normal'); await page.click('#set-close'); await sleep(300);
  ok((await budgetOf()) === b1, 'restoring defaults restores the budget');

  // 8. Guided mode: the coach alone can build a working design
  await page.select('#st-brief', 'feed'); await sleep(200);
  let steps = 0; while (await page.$('#st-coach') && steps < 20) { await page.click('#st-coach'); await sleep(60); steps++; }
  const tiles = await page.$$eval('main .stats .stat', (s) => s.map((x) => x.textContent).join(' | '));
  ok(steps >= 6, `coach built the feed design in ${steps} steps`);
  ok(!/No path/.test(tiles), 'coached design routes all traffic: ' + tiles.slice(0, 120));
  await page.screenshot({ path: path.join(shots, 'studio-coach.png') });
  ok(!(await page.$eval('.explain', (e) => e.open)), 'starting to build collapses the card so the canvas is in view');
  // 9. Interview mode hides feedback until submit
  await clickText('.seg button', 'Interview'); await sleep(200);
  ok(await page.$eval('main .stats', (e) => e.classList.contains('hide')), 'interview mode hides the score');
  ok(/Interview mode/.test(await page.$eval('.inspector', (e) => e.textContent)), 'interview mode hides hints');
  await page.click('#st-submit'); await sleep(200);
  ok(!(await page.$eval('main .stats', (e) => e.classList.contains('hide'))), 'submit reveals the score');

  // 10. Level changes the explanations
  await page.click('#open-settings'); await sleep(150);
  await clickText('.dlg .seg button', 'Experienced'); await sleep(200); await page.click('#set-close'); await sleep(300);
  await page.evaluate(() => { location.hash = 'lb'; }); await sleep(400);
  ok(!(await page.$eval('.explain', (e) => e.open)), 'experienced users get the card collapsed');
  ok((await page.$$('.gl')).length === 0, 'experienced users get no word marking');
  await page.click('#open-settings'); await sleep(150);
  await clickText('.dlg .seg button', 'My path only'); await sleep(150); await page.click('#set-close'); await sleep(200);
  const railN = await page.$$eval('.rail .port', (p) => p.length);
  ok(railN < 30, 'sidebar can show only my path: ' + railN);

  // 11. Technology Guide
  await page.evaluate(() => { location.hash = 'guide'; }); await sleep(300);
  await page.select('#tg-need', 'Make reads much faster'); await sleep(150);
  ok((await page.$$('.tech')).length === 2, 'guide filters by need');
  await page.select('#tg-b', 'Redis'); await sleep(100);
  ok((await page.$eval('.card table', (e) => e.textContent)).includes('Redis'), 'guide compares two technologies');
  await page.screenshot({ path: path.join(shots, 'guide.png'), fullPage: true });

  // Settings leave a running lab alone
  await page.evaluate(() => { location.hash = 'lb'; }); await sleep(4000);
  const served = () => page.$eval('main .stats .stat b', (e) => e.textContent);
  const before = +(await served());
  await page.click('#open-settings'); await sleep(120); await clickText('.dlg .seg button', 'Dark'); await page.click('#set-close'); await sleep(900);
  ok(+(await served()) >= before && before > 0, `closing settings keeps a running lab going (${before} → ${await served()})`);
  // Text size must never push the page sideways.
  await page.evaluate(() => { RT.settings.zoom = 1.3; RT.applySettings(); });
  const wide = [];
  for (const id of await page.evaluate(() => RT.labs.map((l) => l.id))) { await page.evaluate((i) => { location.hash = i; }, id); await sleep(130); const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) wide.push(id + ':' + o); }
  ok(!wide.length, 'no sideways scrolling at extra large text ' + wide);
  await page.evaluate(() => { RT.settings.zoom = 1; RT.applySettings(); location.hash = 'guide'; }); await sleep(200);
  // 12. Backup
  await page.click('#open-settings'); await sleep(150); await page.click('#set-export'); await sleep(100);
  ok((await page.$eval('#set-data', (e) => e.value)).includes('roundtrip.progress'), 'backup contains progress');
  await page.click('#set-close'); await sleep(200);
  console.log('page errors', errs.length, errs.slice(0, 4));
  await page.evaluate(() => { location.hash = ''; }); await sleep(400);
  await page.screenshot({ path: path.join(shots, 'home2.png') });
  console.log(fails.length ? fails.length + ' FAILED' : 'all learning-layer checks passed');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
