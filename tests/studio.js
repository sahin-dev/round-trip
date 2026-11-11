const puppeteer = require('puppeteer-core');
const path = require('path');
const site = require('./env').site;
const shots = require('./env').shots;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch(require('./env').launch);
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1050 });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(site + '#studio', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { RT.settings.level = 'some'; RT.settings.seenTour = true; RT.settings.openOn = 'lab'; RT.settings.tab = {}; RT.settings.ex = { studio: false }; RT.saveSettings(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(500);
  await page.evaluate(() => document.querySelector('.studio').scrollIntoView({ block: 'start', behavior: 'instant' }));
  await sleep(150);
  const grade = () => page.$eval('main .stats .stat b', (e) => e.textContent);
  const nodesCount = () => page.$$eval('.studio-canvas [data-id]', (n) => n.length);
  const center = async (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });

  // Real mouse: drag components from the palette onto the canvas.
  const dragIn = async (label, tx, ty) => {
    await page.evaluate(() => document.querySelector('.studio').scrollIntoView({ block: 'start', behavior: 'instant' })); await sleep(60);
    const btn = await page.evaluateHandle((l) => [...document.querySelectorAll('.pal')].find((b) => b.querySelector('b').textContent === l), label);
    const box = await btn.boundingBox();
    const cv = await (await page.$('.studio-canvas')).boundingBox();
    await page.mouse.move(box.x + 40, box.y + 12); await page.mouse.down();
    await page.mouse.move(cv.x + tx * cv.width, cv.y + ty * cv.height, { steps: 8 }); await page.mouse.up(); await sleep(120);
  };
  await dragIn('Load balancer', .3, .5);
  await dragIn('App servers', .52, .5);
  await dragIn('NoSQL store', .8, .7);
  await dragIn('Cache', .8, .25);
  console.log('nodes after drag', await nodesCount());
  // Real mouse: wire from a port to a node.
  const wire = async (fromType, toType) => {
    const ids = await page.evaluate(() => [...document.querySelectorAll('.studio-canvas [data-id]')].map((g) => [g.dataset.id, g.querySelector('.t').textContent]));
    const a = ids.find((x) => x[1] === fromType)[0], b = ids.find((x) => x[1] === toType)[0];
    const p = await center(`[data-id="${a}"] .port`), q = await center(`[data-id="${b}"] rect.body`);
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 6 }); await page.mouse.up(); await sleep(120);
  };
  await wire('Users', 'Load balancer'); await wire('Load balancer', 'App servers'); await wire('App servers', 'NoSQL store'); await wire('App servers', 'Cache');
  console.log('edges', await page.$$eval('.studio-canvas path[marker-end]', (p) => p.length), 'grade', await grade());
  await wire('Cache', 'App servers'); // not allowed
  console.log('toast:', await page.$eval('.toast', (t) => t.textContent).catch(() => 'none'));
  // Configure via the inspector.
  { const id = await page.evaluate(() => [...document.querySelectorAll('.studio-canvas [data-id]')].find((g) => g.querySelector('.t').textContent === 'Load balancer').dataset.id); const c = await center('[data-id="' + id + '"] rect.body'); await page.mouse.click(c.x, c.y); await sleep(150); }
  console.log('inspector:', await page.$eval('.inspector', (e) => e.textContent.slice(0, 100)));
  await page.screenshot({ path: path.join(shots, 'studio-1.png'), fullPage: true });
  console.log('findings:', await page.$$eval('.finding', (f) => f.slice(0, 5).map((x) => x.textContent.slice(0, 90))));
  console.log('score tiles:', await page.$$eval('main .stats .stat', (s) => s.map((x) => x.textContent).join(' | ')));

  // Load the reference, confirm it passes, and run an incident.
  await page.evaluate(() => [...document.querySelectorAll('.tabs button')].find((b) => /Reference/.test(b.textContent)).click());
  await page.click('#st-ref'); await sleep(250);
  console.log('reference grade', await grade(), 'nodes', await nodesCount());
  await page.evaluate(() => [...document.querySelectorAll('.tabs button')].find((b) => /Failure/.test(b.textContent)).click());
  await page.click('#st-run-zone'); await sleep(250);
  console.log('incident:', await page.$eval('main .banner.bad', (e) => e.textContent));
  await page.screenshot({ path: path.join(shots, 'studio-2.png'), fullPage: true });
  await page.click('#st-run-zone'); await sleep(100);
  // Load test: the panel drives the canvas and scores, and an empty test matches the design.
  await page.click('#lt-on'); await sleep(200);
  const firstTile = () => page.$eval('main .stats .stat b', (e) => e.textContent);
  const setTest = (id, v) => page.$eval(id, (e, x) => { e.value = x === 'max' ? e.max : x; e.dispatchEvent(new Event('input')); }, v);
  const fail = (m) => console.log('FAIL', m);
  if (await firstTile() !== 'Holding') fail('a reference design holds at its own numbers: ' + await firstTile());
  await setTest('#lt-scale', 'max'); await setTest('#lt-read', 'max'); await sleep(200);
  if (await firstTile() !== 'Failing') fail('a hundred times the traffic breaks it: ' + await firstTile());
  if (!(await page.$('.studio-canvas .node.err'))) fail('the overloaded tier turns red on the canvas');
  console.log('load test:', await page.$$eval('.card .banner', (b) => b.map((x) => x.textContent).join(' | ')));
  await page.click('#lt-reset'); await sleep(200);
  if (await firstTile() !== 'Holding') fail('reset returns to the brief');
  await page.select('#lt-fail', 'zone'); await sleep(200);
  await page.select('#lt-fail', ''); await page.click('#lt-reset'); await sleep(150);
  await setTest('#lt-scale', 'max'); await setTest('#lt-read', 'max'); await sleep(200);
  if (await firstTile() !== 'Failing') fail('ten thousand times the reads breaks a design sized for its brief');
  await page.click('#lt-fit'); await sleep(600);
  if (await firstTile() !== 'Holding') fail('sizing a design for the load makes it hold: ' + await firstTile());
  await page.click('#st-undo'); await sleep(250);
  if (await firstTile() !== 'Failing') fail('undo restores the design after sizing');
  await page.click('#lt-reset'); await sleep(150);
  await page.click('#lt-on'); await sleep(200);
  if (!/·/.test(await firstTile())) fail('turning the test off brings the grade back: ' + await firstTile());
  // Live incident: the dock drives it, the canvas follows it, the runbook acts, and a postmortem follows.
  {
    const dk = () => page.$eval('.dk-status', (e) => e.textContent);
    if (!(await page.$eval('main .dock', (d) => d.hidden))) fail('the Studio shows no dock until something can be played');
    await page.evaluate(() => [...document.querySelectorAll('.tabs button')].find((b) => /Live incident/.test(b.textContent)).click()); await sleep(200);
    if (await page.$eval('.dk-name', (e) => e.textContent) !== 'Incident') fail('the Live incident tab hands the dock to the incident');
    await page.select('#lv-scn', 'deploy'); await sleep(150);
    for (let i = 0; i < 14; i++) { await page.click('#dk-next'); await sleep(40); }
    if (!(await dk()).includes('minute 14 /')) fail('Next moves the incident on one minute: ' + await dk());
    if (await firstTile() !== '19:54') fail('the score tiles follow the live minute: ' + await firstTile());
    await page.click('#dk-play'); await sleep(1500); await page.click('#dk-play'); await sleep(100);
    const held = await dk(); await sleep(900);
    if (held !== await dk() || held.includes('minute 14 /')) fail('Play runs the incident and Pause holds it: ' + held);
    if (await page.$eval('#lv-rollback', (e) => e.disabled)) fail('a rollback is offered once the release is out');
    await page.click('#lv-rollback'); await sleep(100);
    if (!(await page.$$eval('main .log', (l) => l.some((x) => /Roll back/.test(x.textContent))))) fail('runbook actions appear in the timeline');
    await page.click('#lv-finish'); await sleep(300);
    console.log('live verdict:', await page.$eval('#lv-verdict', (e) => e.textContent), '|', await dk());
    if (!(await page.$('#lv-verdict'))) fail('a postmortem follows the shift');
    await page.screenshot({ path: path.join(shots, 'studio-live.png'), fullPage: true });
    await page.click('#dk-reset'); await sleep(150);
    if (!(await dk()).includes('minute 0 /')) fail('Reset starts the incident again');
    await page.evaluate(() => [...document.querySelectorAll('.topic-tabs button')].find((b) => b.textContent === 'Theory').click()); await sleep(150);
    await page.evaluate(() => [...document.querySelectorAll('.topic-tabs button')].find((b) => b.textContent === 'Lab').click()); await sleep(150);
    if (await page.$eval('.dk-name', (e) => e.textContent) !== 'Incident') fail('coming back to the Lab tab gives the dock back to the incident');
    await page.evaluate(() => [...document.querySelectorAll('.tabs button')].find((b) => /^Review$/.test(b.textContent)).click()); await sleep(150);
    if (!(await page.$eval('main .dock', (d) => d.hidden))) fail('leaving the Live incident tab puts the dock away');
  }
  // Selecting a connection and then clearing the canvas must not crash.
  await page.$eval('.studio-canvas path[stroke="transparent"]', (e) => e.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await sleep(120);
  await page.evaluate(() => document.querySelector('#st-clear').click()); await sleep(200);
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await sleep(200);
  // Pasted text: impossible parts go, the design stays, and damaged text changes nothing.
  const paste = (v) => page.evaluate((x) => { document.querySelector('#st-json').value = x; document.querySelector('#st-load').click(); }, v);
  await paste(JSON.stringify({ nodes: [{ id: 'u', type: 'users', x: 11, y: 242 }, { id: 'd', type: 'nosql', x: 500, y: 200 }, { id: 'r', type: 'robot' }], edges: [['u', 'd']] })); await sleep(250);
  if (await nodesCount() !== 2) fail('an unknown part is dropped from pasted text: ' + await nodesCount());
  if ((await page.$$eval('.studio-canvas path[marker-end]', (p) => p.length)) !== 0) fail('a browser cannot be wired to a database, even from pasted text');
  await paste('not json'); await sleep(150);
  if (await nodesCount() !== 2) fail('damaged text changes nothing');
  await page.evaluate(() => document.querySelector('#st-clear').click()); await sleep(150);
  await page.evaluate(() => document.querySelector('#st-ref').click()); await sleep(250);
  // Every brief and stage via the UI.
  const briefs = await page.$$eval('#st-brief option', (o) => o.map((x) => x.value));
  for (const b of briefs) {
    await page.select('#st-brief', b); await sleep(120);
    for (const st of ['Launch', 'Hyper-scale']) {
      await page.evaluate((s) => [...document.querySelectorAll('.seg button')].find((x) => x.textContent === s).click(), st); await sleep(80);
      await page.evaluate(() => [...document.querySelectorAll('.tabs button')].find((t) => /Reference/.test(t.textContent)).click());
      await page.click('#st-ref'); await sleep(80);
    }
    console.log(b, await grade());
  }
  // Persistence: reload keeps the design.
  await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(500);
  console.log('after reload nodes', await nodesCount(), 'brief', await page.$eval('#st-brief', (e) => e.value));
  console.log('missions', JSON.stringify(await page.evaluate(() => RT.progress.studio)));
  // Interview tab
  await page.evaluate(() => [...document.querySelectorAll('.tabs button')].find((b) => /Interview/.test(b.textContent)).click()); await sleep(150);
  await page.screenshot({ path: path.join(shots, 'studio-3.png'), fullPage: true });
  // Workbench goals: confirm every goal is reachable.
  await page.goto(site + '#workbench', { waitUntil: 'domcontentloaded' }); await sleep(300);
  const setR = (id, v) => page.$eval('#' + id, (e, val) => { e.value = val; e.dispatchEvent(new Event('input')); }, v);
  const tab = (t) => page.evaluate((x) => [...document.querySelectorAll('.tabs button')].find((b) => b.textContent === x).click(), t);
  const banner = () => page.$eval('main .labmain .labmain:not(.hide) .banner', (e) => e.textContent);
  const segClick = (t) => page.evaluate((x) => [...document.querySelectorAll('.labmain .labmain:not(.hide) .seg button')].find((b) => b.textContent === x).click(), t);
  await segClick('Sliding window'); console.log('limiter sliding:', await banner());
  await segClick('Token bucket'); await setR('wb-burst', 60); console.log('limiter token:', await banner());
  await tab('Cache size'); await sleep(300); console.log('cache:', await banner()); await setR('wb-mem', 8); await sleep(200); console.log('cache8:', await banner());
  await tab('Shard plan'); await sleep(100); await segClick('user_id (hashed)'); await setR('wb-n', 12); console.log('shard:', await banner());
  await setR('wb-n', 20); console.log('shard20:', await banner());
  await tab('Queue consumers'); await sleep(100); console.log('queue:', await banner()); await setR('wb-c', 12); await setR('wb-pt', 12); console.log('queue12:', await banner()); await setR('wb-c', 18); await setR('wb-pt', 18); console.log('queue18:', await banner());
  await tab('Autoscaler'); await sleep(100); console.log('scale:', await banner()); await setR('wb-abt', 2); console.log('scale tuned:', await banner());
  await tab('Alerts'); await sleep(100); console.log('alert:', await banner()); await setR('wb-t', 300); await setR('wb-win', 3); console.log('alert tuned:', await banner());
  await page.screenshot({ path: path.join(shots, 'workbench.png'), fullPage: true });
  console.log('wb missions', JSON.stringify(await page.evaluate(() => RT.progress.workbench)));
  // Estimator
  await page.goto(site + '#estimate', { waitUntil: 'domcontentloaded' }); await sleep(300);
  await page.screenshot({ path: path.join(shots, 'estimate.png'), fullPage: true });
  await page.click('#es-studio'); await sleep(500);
  console.log('custom brief open:', await page.$eval('#st-brief', (e) => e.value), await page.$eval('main .card p', (e) => e.textContent));
  // Trainer
  await page.goto(site + '#trainer', { waitUntil: 'domcontentloaded' }); await sleep(300);
  for (let i = 0; i < 6; i++) { await page.evaluate(() => { const b = document.querySelector('main .quiz button:not(:disabled)'); if (b) b.click(); }); await sleep(30); await page.click('#tr-next'); await sleep(30); }
  await page.screenshot({ path: path.join(shots, 'trainer.png'), fullPage: true });
  console.log('trainer:', await page.$$eval('main .stats .stat', (s) => s.map((x) => x.textContent).join(' | ')));
  console.log('errors', errs);
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
