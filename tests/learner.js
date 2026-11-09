/* Checks the learner features: depth switch, flow picture, prerequisites, understood mark,
   theory-only topics, About page and the welcome chooser, in both languages. */
const puppeteer = require('puppeteer-core');
const path = require('path');
const site = require('./env').site;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
(async () => {
  const b = await puppeteer.launch(require('./env').launch);
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(site, { waitUntil: 'domcontentloaded' });
  await sleep(400);
  const set = (o) => p.evaluate((x) => { Object.assign(RT.settings, x); RT.saveSettings(); }, o);
  await set({ welcomed: true, seenTour: true, openOn: 'theory', tab: {}, depth: '', level: 'some', lang: 'en' });
  await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(400);

  const ids = await p.evaluate(() => RT.labs.filter((l) => RT.hasTheory(l)).map((l) => l.id));
  /* Roadmap topics carry the full lesson; practice tools such as the Estimator keep a shorter one. */
  const roadmap = await p.evaluate(() => RT.STAGES.flatMap((s) => s.ids));
  console.log('topics with theory', ids.length);
  for (const lang of ['en', 'bn']) {
    await set({ lang, depth: 'deep' });
    await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(300);
    for (const id of ids) {
      await p.evaluate((i) => { location.hash = i; }, id); await sleep(90);
      const r = await p.evaluate(() => {
        const t = document.querySelector('main .theory');
        return t && { pic: t.querySelectorAll('.flow-box').length, boxes: t.querySelectorAll('.th-box').length, secs: t.querySelectorAll('.theory-body > section:not(.th-box):not(.scene)').length, scene: t.querySelectorAll('.scene .scn-list li').length, text: t.innerText, heads: [...t.querySelectorAll('.th-box h2')].map((x) => x.textContent) };
      });
      ok(r, id + ' ' + lang + ' no theory');
      if (!r) continue;
      ok(r.pic >= 2, id + ' ' + lang + ' picture');
      /* Deep shows the example, mistakes and deeper notes, plus use/avoid, gain/cost, interview notes and where it is used. */
      const topic = roadmap.includes(id);
      ok(r.boxes === (topic ? 9 : 3), id + ' ' + lang + ' boxes ' + r.boxes);
      if (topic) ok(r.scene >= 3, id + ' ' + lang + ' walkthrough');
      ok(r.secs >= 1, id + ' ' + lang + ' sections');
      ok(!/undefined|\[object|NaN/.test(r.text), id + ' ' + lang + ' junk');
      if (lang === 'bn') ok(!/A real example|Common mistakes|Going deeper|Remember|Reach for it|What you gain|Say this in|Where you will meet|Watch it work/.test(r.text), id + ' labels still English');
    }
  }
  await set({ lang: 'en', depth: 'simple' });
  await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(300);
  await p.evaluate(() => { location.hash = 'dns'; }); await sleep(250);
  const size = () => p.evaluate(() => document.querySelector('.theory-body').innerText.length);
  const simple = await size();
  await p.evaluate(() => [...document.querySelectorAll('.th-tools button')].find((x) => x.textContent === 'Deep').click()); await sleep(100);
  const deep = await size();
  await p.evaluate(() => [...document.querySelectorAll('.th-tools button')].find((x) => x.textContent === 'Standard').click()); await sleep(100);
  const std = await size();
  console.log('depth chars', simple, std, deep);
  ok(simple < std && std < deep, 'depth grows');
  await p.screenshot({ path: path.join(__dirname, 'shots', 'theory-standard.png'), fullPage: true });

  await p.click('#th-done'); await sleep(80);
  ok(await p.evaluate(() => RT.settings.read.dns === true), 'understood saved');
  await p.evaluate(() => { location.hash = 'about'; }); await sleep(200);
  ok(await p.evaluate(() => /your privacy/i.test(document.querySelector('main').innerText)), 'about page');
  await p.evaluate(() => { location.hash = 'basics'; }); await sleep(200);
  ok(await p.evaluate(() => !document.querySelector('main .tabs') || document.querySelector('main').innerText.includes('Try these next')), 'theory only topic');
  await p.screenshot({ path: path.join(__dirname, 'shots', 'basics.png'), fullPage: true });

  await set({ lang: 'bn', depth: 'standard' });
  await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(300);
  await p.evaluate(() => { location.hash = 'scalability'; }); await sleep(250);
  await p.screenshot({ path: path.join(__dirname, 'shots', 'scalability-bn.png'), fullPage: true });
  ok(await p.evaluate(() => /স্কেলেবিলিটি/.test(document.querySelector('main').innerText)), 'bn topic');

  /* A new visitor picks a style */
  await set({ lang: 'en', welcomed: false, read: {}, openOn: 'auto' });
  await p.evaluate(() => { location.hash = ''; }); await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(350);
  ok(await p.$('#wl-go'), 'welcome shown');
  if (await p.$('#wl-go')) {
    await p.evaluate(() => [...document.querySelectorAll('.welcome button')].find((x) => x.textContent === 'Play a game').click());
    await p.click('#wl-go'); await sleep(250);
    ok(await p.evaluate(() => location.hash === '#game'), 'play style opens the game');
  }
  console.log('fails', fails, 'page errors', errs.length, errs.slice(0, 4));
  await b.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
