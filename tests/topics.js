/* Checks the roadmap, new topics and labs, review, search and navigation, in both languages. */
const puppeteer = require('puppeteer-core');
const site = require('./env').site;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
(async () => {
  const b = await puppeteer.launch(require('./env').launch);
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(site, { waitUntil: 'domcontentloaded' }); await sleep(400);
  const set = (o) => p.evaluate((x) => { Object.assign(RT.settings, x); RT.saveSettings(); }, o);
  const go = async (id) => { await p.evaluate((i) => { location.hash = i; }, id); await sleep(160); };
  const click = (sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
  await set({ welcomed: true, seenTour: true, openOn: 'lab', tab: {}, level: 'some', lang: 'en', depth: 'deep' });
  await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(400);

  // Every id named anywhere must exist, so no link can dead-end.
  const bad = await p.evaluate(() => {
    const out = [];
    RT.TRACKS.forEach(([g, ids]) => ids.forEach((i) => { if (!RT.byId[i]) out.push('track ' + g + ':' + i); }));
    Object.entries(RT.PRE).forEach(([i, list]) => { if (!RT.byId[i]) out.push('pre key ' + i); list.forEach((x) => { if (!RT.byId[x]) out.push('pre ' + i + ':' + x); }); });
    RT.STAGES.forEach((s) => s.ids.forEach((i) => { if (!RT.byId[i]) out.push('stage ' + i); }));
    (window.RTWalks || []).forEach((w) => w.topics.forEach((i) => { if (!RT.byId[i]) out.push('walk ' + i); }));
    RT.labs.forEach((l) => { const t = window.RTTopicMeta[l.id]; if (t && t.try) t.try.forEach((i) => { if (!RT.byId[i]) out.push('try ' + l.id + ':' + i); }); });
    return out;
  });
  ok(!bad.length, 'all ids resolve: ' + bad);

  // Each topic appears in exactly one roadmap stage, and every topic is on the roadmap.
  const road = await p.evaluate(() => {
    const seen = RT.STAGES.flatMap((s) => s.ids), dup = seen.filter((x, i) => seen.indexOf(x) !== i);
    const missing = RT.labs.filter((l) => RT.levelOf(l.id) && !seen.includes(l.id)).map((l) => l.id);
    return { dup, missing };
  });
  ok(!road.dup.length, 'no topic sits in two stages: ' + road.dup);
  ok(!road.missing.length, 'every topic is on the roadmap: ' + road.missing);

  // Prerequisites must not run in a circle.
  const cycle = await p.evaluate(() => {
    const state = {}, bad = [];
    const walk = (i, path) => { if (state[i] === 2) return; if (state[i] === 1) { bad.push(path.concat(i).join('>')); return; } state[i] = 1; (RT.PRE[i] || []).forEach((x) => walk(x, path.concat(i))); state[i] = 2; };
    Object.keys(RT.PRE).forEach((i) => walk(i, []));
    return bad;
  });
  ok(!cycle.length, 'prerequisites have no cycles: ' + cycle);

  // The course runs in one order: nothing before its prerequisites, and difficulty only rises.
  const order = await p.evaluate(() => {
    const late = (seq) => seq.flatMap((id, i) => (RT.PRE[id] || []).filter((x) => seq.indexOf(x) > i).map((x) => id + ' before ' + x));
    const full = RT.journey(), lv = RT.STAGES.flatMap((s) => s.ids).map(RT.levelOf);
    return {
      late: [full, ...RTLearn.PATHS.filter((x) => x.labs).map((x) => x.labs)].flatMap(late),
      dup: full.filter((x, i) => full.indexOf(x) !== i),
      missing: RT.labs.filter((l) => !full.includes(l.id)).map((l) => l.id),
      drops: lv.filter((v, i) => i && v < lv[i - 1]).length,
    };
  });
  ok(!order.late.length, 'no topic comes before its prerequisites: ' + order.late);
  ok(!order.dup.length && !order.missing.length, 'the journey holds every page once: ' + order.dup + ' ' + order.missing);
  ok(!order.drops, 'difficulty never drops along the roadmap: ' + order.drops);

  // Each language must be complete in every newer topic: nothing falls back to English.
  const gaps = await p.evaluate(() => {
    const out = [], hasBn = (v) => /[ঀ-৿]/.test(v);
    Object.entries(window.RTTopicMeta).forEach(([id, t]) => {
      if (!t.bn || !t.bn.pic) return;
      ['title', 'lede', 'what', 'like', 'why', 'example'].forEach((k) => { if (!hasBn(t.bn[k])) out.push(id + '.' + k); });
      if (t.en.s.length !== t.bn.s.length) out.push(id + ' section count');
      t.en.s.forEach((sec, i) => { const a = sec[1].length, c = t.bn.s[i] ? t.bn.s[i][1].length : -1; if (a !== c) out.push(id + ' section ' + i + ' paragraphs ' + a + '/' + c); });
      if (t.en.take.length !== t.bn.take.length) out.push(id + ' take');
      if (t.en.mistakes.length !== t.bn.mistakes.length) out.push(id + ' mistakes');
      if (t.en.deep.length !== t.bn.deep.length) out.push(id + ' deep');
      if (t.en.check.options.length !== t.bn.check.options.length) out.push(id + ' options');
      if ((t.en.start || []).length !== (t.bn.start || []).length) out.push(id + ' start');
      if (t.render && !(t.en.start || []).length) out.push(id + ' lab has no first steps');
      (t.missions || []).forEach(([m]) => { if (!t.bn.missions || !t.bn.missions[m]) out.push(id + ' mission ' + m); });
    });
    return out;
  });
  ok(!gaps.length, 'languages match: ' + gaps.slice(0, 12));

  // Every roadmap topic is complete: a walkthrough that plays, and the rounding-off sections in both languages.
  const unfinished = await p.evaluate(() => {
    const out = [], bnText = (v) => /[ঀ-৿]/.test(v || '');
    RT.STAGES.flatMap((s) => s.ids).forEach((id) => {
      const sc = RT.SCENES[id], m = RT.MORE[id];
      if (!sc) out.push(id + ' has no walkthrough'); else RT.checkScene(sc).forEach((e) => out.push(id + ' ' + e));
      if (!m || !m.bn) { out.push(id + ' has no extra sections'); return; }
      ['use', 'avoid', 'gain', 'cost', 'say'].forEach((k) => {
        const a = m.en[k] || [], b = m.bn[k] || [];
        if (a.length < 2 || a.length !== b.length || !b.every(bnText)) out.push(id + '.' + k);
      });
      if (!m.en.real || !bnText(m.bn.real)) out.push(id + '.real');
      const q = m.en.q, qb = m.bn.q;
      if (!q || !qb || q.options.length !== qb.options.length || !(q.answer >= 0 && q.answer < q.options.length) || !bnText(qb.q + qb.why)) out.push(id + '.q');
    });
    return out;
  });
  ok(!unfinished.length, 'every topic is complete: ' + unfinished.slice(0, 12));

  // One control dock per page, and no other animation controls anywhere: not in the sidebar, the
  // settings, the lab or the walkthrough.
  const surfaces = () => p.evaluate(() => ({
    docks: document.querySelectorAll('main .dock').length,
    others: document.querySelectorAll('.rail .speed, .playbar, .scene button, main [id$="-next"]:not(#dk-next):not(#rv-next):not(#path-next)').length,
    own: /Step by step|Next step/.test(document.querySelector('main').innerText),
  }));
  for (const id of ['tls', 'dns', 'tcp', 'auth', 'lb']) {
    await go(id); await sleep(150);
    const s = await surfaces();
    ok(s.docks === 1 && !s.others && !s.own, id + ' has one control dock and nothing else: ' + JSON.stringify(s));
  }
  await p.click('#open-settings'); await sleep(150);
  ok(!(await p.evaluate(() => /Animation speed/.test(document.querySelector('dialog[open]').innerText))), 'settings no longer hold a speed control');
  await p.click('#set-close'); await sleep(150);

  // Labs can be paused, nudged forward and reset from the dock, and a paused lab stands still.
  await go('lb'); await sleep(700);
  ok(await p.$eval('.dk-name', (e) => e.textContent) === 'Lab', 'on the Lab tab the dock drives the lab');
  await click('#dk-play'); await sleep(60);
  const t0 = await p.evaluate(() => (RT.clock.paused ? RT.now() : -1));
  await sleep(400);
  ok(t0 >= 0 && (await p.evaluate(() => RT.now())) === t0, 'pause stops simulated time');
  ok(await p.$eval('#dk-play', (e) => /Play/.test(e.textContent)), 'the button offers Play while paused');
  await click('#dk-next'); await sleep(700);
  ok(await p.evaluate((t) => RT.clock.paused && RT.now() > t, t0), 'Next moves time forward a moment, then stops');
  ok(await p.$eval('#dk-back', (e) => e.disabled), 'a lab cannot step back');
  await p.keyboard.press('k'); await sleep(60);
  ok(!(await p.evaluate(() => RT.clock.paused)), 'the K key plays again');
  await p.evaluate(() => document.querySelector('main .node.click').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await sleep(60);
  await click('#dk-reset'); await sleep(150);
  ok(await p.$$eval('main .dock', (b) => b.length) === 1 && !(await p.$('main .node.dead')), 'reset rebuilds the lab from the start');
  await click('#dk-play'); await sleep(40);
  await go('dns'); await sleep(80);
  ok(!(await p.evaluate(() => RT.clock.paused)), 'leaving a paused lab starts the next one running');

  // A lab that can stop between messages does it from the dock's switch, and Next shows each message.
  await go('tls'); await sleep(150);
  ok(await p.$eval('.dk-mode', (e) => !e.hidden), 'the dock offers "one step at a time" for a lab that has it');
  await p.evaluate(() => { if (!document.querySelector('#dk-mode').checked) document.querySelector('#dk-mode').click(); });
  await click('#tls-go'); await sleep(1500);
  const rows1 = await p.$$eval('.lad .row', (r) => r.length);
  ok(/press Next/.test(await p.$eval('.dk-status', (e) => e.textContent)) && rows1 >= 1, 'the lab waits for Next');
  await click('#dk-next'); await sleep(1500);
  ok(await p.$$eval('.lad .row', (r) => r.length) > rows1, 'Next shows the next message');
  await p.evaluate(() => document.querySelector('#dk-mode').click()); await sleep(60);
  await go('lb'); await sleep(80);
  ok(await p.$eval('.dk-mode', (e) => e.hidden), 'the switch is hidden where a lab has no steps');

  // Lessons have next and previous links.
  await set({ openOn: 'theory' });
  await go('servers');
  ok(await p.$('.th-nav') !== null, 'a theory-only lesson has path links');
  ok(await p.$eval('main', (e) => /unlocks/.test(e.textContent)), 'a lesson says what it unlocks');

  // The dock drives the walkthrough: forward and back, jump to any step, and reset.
  await go('outbox');
  const cap = () => p.$eval('.scene .scn-num', (e) => e.textContent);
  ok(await p.$eval('.dk-name', (e) => e.textContent) === 'Walkthrough', 'on a lesson the dock drives the walkthrough');
  ok(await p.$$eval('.dock .dk-dot', (d) => d.length) === 5 && (await p.$$eval('.scene .scn-list li', (l) => l.length)) === 5, 'the dock shows a dot per step, and the lesson a written line per step');
  await click('#dk-next'); await sleep(80);
  ok(await cap() === '1/5', 'Next starts at step 1');
  await p.evaluate(() => document.querySelectorAll('.dock .dk-dot')[3].click()); await sleep(80);
  ok(await cap() === '4/5', 'a dot jumps to its step');
  await click('#dk-back'); await sleep(80);
  ok(await cap() === '3/5', 'Back goes one step back');
  await p.keyboard.press('ArrowRight'); await sleep(80);
  ok(await cap() === '4/5', 'the right arrow key steps forward');
  await click('#dk-reset'); await sleep(80);
  ok(await cap() === '▶', 'Reset returns to the start');

  // On a topic with both tabs, the dock follows the tab, pausing what you leave.
  await go('dns'); await sleep(150);
  await p.evaluate(() => [...document.querySelectorAll('main .tabs button')].find((x) => x.textContent === 'Theory').click()); await sleep(80);
  ok(await p.$eval('.dk-name', (e) => e.textContent) === 'Walkthrough', 'the Theory tab hands the dock to the walkthrough');
  await p.evaluate(() => [...document.querySelectorAll('main .tabs button')].find((x) => x.textContent === 'Lab').click()); await sleep(80);
  ok(await p.$eval('.dk-name', (e) => e.textContent) === 'Lab', 'the Lab tab hands it back to the lab');
  ok((await p.$$('.theory .th-duo')).length === 2 && (await p.$('.theory .th-box.talk')) && (await p.$('.quiz-more')), 'a lesson has when-to-use, trade-offs, interview notes and a second question');
  await set({ openOn: 'lab' });

  // Sidebar groups collapse, and the current page's group opens by itself.
  const closed = await p.$$eval('.rail details.track:not([open])', (d) => d.length);
  ok(closed > 5, 'sidebar groups start collapsed: ' + closed);
  await go('cs-dynamo');
  ok(await p.evaluate(() => document.querySelector('.port[aria-current="page"]').closest('details').open), 'the current group opens');

  // Search reaches inside lessons, in both languages.
  await p.keyboard.down('Control'); await p.keyboard.press('k'); await p.keyboard.up('Control'); await sleep(120);
  await p.type('#sr-q', 'tombstone'); await sleep(150);
  ok((await p.$$eval('.sr-list a', (a) => a.map((x) => x.textContent).join('|'))).includes('Storage'), 'search finds text inside a lesson');
  await p.$eval('#sr-q', (e) => { e.value = ''; }); await p.type('#sr-q', 'uber'); await sleep(120);
  ok((await p.$$('.sr-list a')).length >= 1, 'search covers lesson bodies');
  await p.keyboard.press('Escape'); await sleep(100);

  // The labs do what their topics claim.
  await go('isolation');
  await p.select('#is-sc', 'skew'); await sleep(60);
  await p.evaluate(() => [...document.querySelectorAll('main .seg button')].find((x) => x.textContent === 'Repeatable read').click()); await sleep(60);
  await click('#is-all'); await sleep(100);
  ok(/happened/.test(await p.$eval('main .banner', (e) => e.textContent)), 'write skew passes repeatable read');
  await p.evaluate(() => [...document.querySelectorAll('main .seg button')].find((x) => x.textContent === 'Serializable').click()); await sleep(60);
  await click('#is-all'); await sleep(100);
  ok(/Prevented/.test(await p.$eval('main .banner', (e) => e.textContent)), 'serializable stops it');

  await go('idempotency');
  await click('#id-pay');
  await p.waitForFunction(() => /Charged twice/.test(document.querySelector('main .banner').textContent), { timeout: 12000 }).catch(() => ok(false, 'no key charges twice'));
  await click('#id-reset'); await sleep(100);
  await click('#id-key'); await sleep(50);
  await click('#id-pay');
  await p.waitForFunction(() => /Charged once/.test(document.querySelector('main .banner').textContent), { timeout: 12000 }).catch(() => ok(false, 'a key charges once'));

  await go('storage');
  for (let i = 0; i < 4; i++) await click('#ls-put');
  await click('#ls-compact'); await sleep(40);
  ok((await p.$eval('main .stat', (e) => e.textContent)).length > 0, 'storage lab shows numbers');

  await go('netmetrics');
  const slide = (id, v) => p.$eval(id, (e, x) => { e.value = x === 'max' ? e.max : x; e.dispatchEvent(new Event('input')); }, v);
  const netBanner = async () => { await sleep(60); return p.$eval('main .banner', (e) => e.textContent); };
  ok(/Round trips/.test(await netBanner()), 'a small response waits on round trips');
  ok((await p.$$eval('#nm-what tr', (r) => r.length)) === 7, 'the what-if table has a row per number');
  await slide('#nm-size', 'max'); await slide('#nm-rps', 0);
  ok(/Bandwidth is what/.test(await netBanner()), 'a large transfer waits on bandwidth');
  await slide('#nm-size', 2); await slide('#nm-rps', 'max');
  ok(/fail/.test(await netBanner()), 'too much traffic overloads the link');
  ok(await p.$$eval('main .table td', (c) => !c.some((x) => /NaN|undefined|Infinity/.test(x.textContent))), 'an overloaded table has no junk');

  await go('resilience');
  ok(/stays down/.test(await p.$eval('main .banner', (e) => e.textContent)), 'the default run shows a retry storm');
  await click('#re-brk'); await sleep(80);
  ok(/breaker/.test(await p.$eval('main .banner', (e) => e.textContent)), 'a breaker ends the storm');

  await go('ratelimit');
  await click('#rl-burst'); await sleep(250); await click('#rl-burst'); await sleep(900);
  ok(+(await p.evaluate(() => document.querySelectorAll('main .stat b')[1].textContent)) > 0, 'a second burst is refused');

  // Review: an answer is stored, and comes back later.
  await p.evaluate(() => { localStorage.removeItem('roundtrip.review'); });
  await go('review');
  await p.evaluate(() => [...document.querySelectorAll('main .seg button')].find((x) => x.textContent === 'Every topic').click()); await sleep(120);
  await p.evaluate(() => document.querySelector('main .quiz button').click()); await sleep(80);
  ok(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('roundtrip.review'))).length === 1), 'an answer is remembered');
  ok(await p.$('#rv-next') !== null, 'review offers the next question');
  await click('#rv-next'); await sleep(80);
  ok(await p.$('main .quiz') !== null, 'review moves on');

  // Worked designs reveal one step at a time.
  await go('walkthroughs');
  ok((await p.$$('.walk')).length === 11, 'eleven worked designs');
  ok(await p.$$eval('.walk', (w) => w.every((x) => x.querySelectorAll('.walk-step').length === 6)), 'each has six steps');

  // Reference pages cannot be finished, so they must not hold up the Continue button.
  await p.evaluate(() => { RT.settings.path = 'full'; RT.saveSettings(); }); await go('');
  ok(!/Roadmap|Glossary/.test(await p.$eval('#path-next', (e) => e.textContent)), 'Continue skips reference pages');

  // Filtering the home page by level.
  await go('');
  await p.evaluate(() => [...document.querySelectorAll('main .controls .seg button')].find((x) => x.textContent === 'Advanced').click()); await sleep(100);
  const vis = await p.$$eval('.labcard', (c) => c.filter((x) => x.offsetParent).map((x) => x.dataset.lv));
  ok(vis.length > 5 && vis.every((v) => v === '3'), 'level filter leaves advanced topics: ' + vis.length);
  await p.evaluate(() => [...document.querySelectorAll('main .controls .seg button')].find((x) => x.textContent === 'All levels').click()); await sleep(60);

  // Bengali: pages are written in Bengali, not leftovers.
  await set({ lang: 'bn' });
  await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(400);
  for (const id of ['roadmap', 'cheatsheet', 'playbook', 'walkthroughs', 'review', 'queueing', 'isolation', 'cs-dynamo']) {
    await go(id); await sleep(120);
    const t = await p.$eval('main', (e) => e.innerText);
    const bn = (t.match(/[ঀ-৿]/g) || []).length, en = (t.match(/[A-Za-z]/g) || []).length;
    ok(bn > en, id + ' reads as Bengali ' + bn + '/' + en);
  }
  await set({ lang: 'en' });
  console.log('page errors', errs.length, errs.slice(0, 3));
  ok(!errs.length, 'no page errors');
  console.log(fails ? fails + ' FAILED' : 'all topic checks passed');
  await b.close();
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
