/* Plays Scale Quest in a real browser, with a real mouse for episode 1. */
const puppeteer = require('puppeteer-core');
const path = require('path');
const site = require('./env').site;
const shots = require('./env').shots;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
(async () => {
  const b = await puppeteer.launch(require('./env').launch);
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(site + '#game', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => { RT.settings.seenTour = true; RT.settings.welcomed = true; RT.settings.speed = 2; RT.setSpeed(2); RT.saveSettings(); });
  await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(500);
  ok((await p.$$('.ep')).length === 10, 'map shows ten episodes');
  ok(await p.$eval('#ep-2', (e) => e.disabled), 'episode 2 is locked at the start');
  await p.screenshot({ path: path.join(shots, 'game-map.png') });
  await p.click('#ep-1'); await sleep(300);
  // Failing with an empty canvas must block progress.
  await p.click('#gm-go');
  await p.waitForSelector('.card.lose', { timeout: 15000 });
  ok(true, 'an empty platform fails: ' + (await p.$eval('.card.lose p', (e) => e.textContent)));
  await p.click('#gm-fix'); await sleep(100);
  // Real mouse: build the platform.
  const drag = async (label, fx, fy) => {
    await p.evaluate(() => document.querySelector('.studio').scrollIntoView({ block: 'start', behavior: 'instant' })); await sleep(60);
    const btn = await p.evaluateHandle((l) => [...document.querySelectorAll('.pal')].find((x) => x.querySelector('b').textContent === l), label);
    const bx = await btn.boundingBox(), cv = await (await p.$('.studio-canvas')).boundingBox();
    await p.mouse.move(bx.x + 30, bx.y + 10); await p.mouse.down(); await p.mouse.move(cv.x + cv.width * fx, cv.y + cv.height * fy, { steps: 6 }); await p.mouse.up(); await sleep(120);
  };
  ok((await p.$$('.pal')).length === 2, 'episode 1 offers only the two allowed components');
  await drag('App servers', .4, .5); await drag('SQL database', .7, .5);
  const center = (sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const wire = async (from, to) => {
    const ids = await p.evaluate(() => [...document.querySelectorAll('.studio-canvas [data-id]')].map((g) => [g.dataset.id, g.querySelector('.t').textContent]));
    const a = ids.find((x) => x[1] === from)[0], c = ids.find((x) => x[1] === to)[0], s = await center(`[data-id="${a}"] .port`), t = await center(`[data-id="${c}"] rect.body`);
    await p.mouse.move(s.x, s.y); await p.mouse.down(); await p.mouse.move(t.x, t.y, { steps: 5 }); await p.mouse.up(); await sleep(120);
  };
  await wire('Users', 'App servers'); await wire('App servers', 'SQL database');
  // Configure hardware through the real inspector.
  const app = await p.evaluate(() => [...document.querySelectorAll('.studio-canvas [data-id]')].find((g) => g.querySelector('.t').textContent === 'App servers').dataset.id);
  const c = await center(`[data-id="${app}"] rect.body`); await p.mouse.click(c.x, c.y); await sleep(200);
  ok(!!(await p.$('#in-cpu')) && !!(await p.$('#in-ram')), 'inspector offers processor and RAM');
  await p.select('#in-cpu', '4'); await sleep(200);
  ok(/Limited by RAM/.test(await p.$eval('.inspector', (e) => e.textContent)), 'more CPU without RAM reports a memory limit');
  await p.select('#in-ram', '8'); await sleep(200);
  ok(/balanced/.test(await p.$eval('.inspector', (e) => e.textContent)), 'matching RAM reports a balanced machine: ' + (await p.$eval('.inspector', (e) => e.textContent.slice(70, 200))));
  await p.screenshot({ path: path.join(shots, 'game-ep1.png') });
  await p.click('#gm-go');
  await p.waitForSelector('.card.lose', { timeout: 15000 });
  ok(/costs more/.test(await p.$eval('.card.lose', (e) => e.textContent)), 'an oversized machine fails the budget');
  await p.click('#gm-fix'); await sleep(100);
  { const c2 = await center('[data-id="' + app + '"] rect.body'); await p.mouse.click(c2.x, c2.y); await sleep(150); await p.select('#in-cpu', '1'); await sleep(100); await p.select('#in-ram', '2'); await sleep(150); }
  await p.click('#gm-go');
  await p.waitForSelector('.card.win', { timeout: 20000 });
  ok(true, 'episode 1 passes with a hand-built platform');
  await p.screenshot({ path: path.join(shots, 'game-win.png') });
  // Remaining episodes with the reference solutions, in order.
  for (let i = 1; i < 10; i++) {
    await p.click('#gm-next'); await sleep(250);
    await p.evaluate((n) => { const G = RTGame, s = JSON.parse(localStorage.getItem('roundtrip.game')); s.designs[G.EPISODES[n].id] = G.solution(n); localStorage.setItem('roundtrip.game', JSON.stringify(s)); }, i);
    await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(300);
    await p.click('#ep-' + (i + 1)); await sleep(200);
    await p.click('#gm-go');
    const out = await p.waitForSelector('.card.win, .card.lose', { timeout: 40000 });
    const won = await out.evaluate((e) => e.classList.contains('win'));
    ok(won, `episode ${i + 1} passes in the browser` + (won ? '' : ': ' + (await out.evaluate((e) => e.textContent.slice(0, 160)))));
    if (i === 9) await p.screenshot({ path: path.join(shots, 'game-final.png') });
  }
  await p.click('#gm-next'); await sleep(300);
  await p.screenshot({ path: path.join(shots, 'game-map2.png') });
  console.log('hud:', await p.$eval('.hud', (e) => e.textContent));
  ok((await p.$$('.ep.won')).length === 10, 'all ten episodes show as won');
  console.log('page errors', errs.length, errs.slice(0, 5));
  console.log(fails.length ? fails.length + ' FAILED' : 'all gameplay checks passed');
  await b.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
