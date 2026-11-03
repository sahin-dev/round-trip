/* The learning layer: settings, glossary popovers, search, guided tours, learning paths,
   the System Map, the Technology Guide and the glossary page. */
(function () {
  const { h, ui, Net } = RT;
  const L = window.RTLearn, D = window.RTDesign;
  if (window.RTTopicsReady) window.RTTopicsReady();
  const S = RT.settings;
  if (D.setAssumptions) D.setAssumptions(S.assume);

  /* ---------- glossary popovers ---------- */
  const entries = [];
  L.GLOSSARY.forEach(([term, def, lab, alts]) => { [term, ...(alts || [])].forEach((w) => entries.push({ w, term, def, lab })); });
  entries.sort((a, b) => b.w.length - a.w.length);
  const lookup = {};
  entries.forEach((e) => { lookup[e.w.toLowerCase()] = e; });
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const RX = new RegExp('(?<![\\w-])(' + entries.map((e) => esc(e.w)).join('|') + ')(?![\\w-])', 'gi');
  const CAPS = /^[A-Z0-9/-]{2,}$/;
  const SCOPE = '.lede, .notes, .banner, .quiz > p, .quiz > .small, .finding p, .mission span:last-child, .inspector p, .tech-text, .theory section > p, .theory li, .th-lead, .explain li';
  const marked = new WeakMap();

  function annotate(root) {
    if (!S.tips || S.level === 'pro' || S.lang === 'bn') return;
    root.querySelectorAll(SCOPE).forEach((el) => {
      const text = el.textContent;
      if (marked.get(el) === text && el.querySelector('.gl, *')) return;
      marked.set(el, text);
      const seen = new Set(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((n) => {
        if (n.parentElement.closest('a, button, .gl, code, summary')) return;
        const t = n.nodeValue; RX.lastIndex = 0;
        let m, last = 0; const frag = document.createDocumentFragment();
        while ((m = RX.exec(t))) {
          const e = lookup[m[1].toLowerCase()];
          if (!e || seen.has(e.term) || (CAPS.test(e.w) && m[1] !== e.w)) continue;
          seen.add(e.term);
          frag.append(t.slice(last, m.index), h('span', { class: 'gl', tabindex: 0, role: 'button', 'data-term': e.term, 'aria-label': `${m[1]}: show meaning` }, m[1]));
          last = m.index + m[1].length;
        }
        if (last) { frag.append(t.slice(last)); n.replaceWith(frag); }
      });
    });
  }
  const pop = h('div', { class: 'glpop hide', role: 'tooltip' });
  let popFor = null;
  function showPop(a) {
    const e = entries.find((x) => x.term === a.dataset.term); if (!e) return;
    popFor = a; pop.textContent = '';
    pop.append(h('b', null, e.term), h('p', null, e.def), RT.byId[e.lab] && location.hash.slice(1) !== e.lab && h('a', { href: '#' + e.lab, onclick: hidePop }, 'See it in action: ' + RT.byId[e.lab].title));
    pop.classList.remove('hide');
    const r = a.getBoundingClientRect(), w = Math.min(290, innerWidth - 24);
    pop.style.width = w + 'px'; pop.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left)) + 'px';
    const below = r.bottom + 6, ht = pop.offsetHeight;
    pop.style.top = (below + ht > innerHeight ? Math.max(8, r.top - ht - 6) : below) + 'px';
  }
  function hidePop() { pop.classList.add('hide'); popFor = null; }
  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest && e.target.closest('.gl');
    if (a) showPop(a); else if (popFor && !(e.target.closest && e.target.closest('.glpop'))) hidePop();
  });
  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('.gl'); if (a) { e.preventDefault(); showPop(a); } else if (popFor && !e.target.closest('.glpop')) hidePop(); });
  document.addEventListener('focusin', (e) => { if (e.target.classList && e.target.classList.contains('gl')) showPop(e.target); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePop(); });
  window.addEventListener('scroll', hidePop, true);

  /* ---------- paths and lab navigation ---------- */
  const allIds = () => RT.journey().filter((i) => RT.byId[i]);
  const pathOf = () => L.PATHS.find((p) => p.id === S.path) || L.PATHS[0];
  const pathIds = () => (pathOf().labs || allIds()).filter((i) => RT.byId[i]);
  const touched = (id) => (RT.progress[id] || []).length > 0;
  RT.pathLabs = () => pathIds();
  RT.pathName = () => pathOf().name;

  RT.beforeLab = (stage, def) => {
    const ex = RT.explainFor(def);
    if (!ex) return;
    S.ex = S.ex || {};
    const hasTheory = RT.hasTheory(def);
    const open = def.id in S.ex ? S.ex[def.id] : S.level !== 'pro' && !(S.level === 'some' && touched(def.id));
    stage.append(h('details', { class: 'explain', open: open || null, ontoggle(e) { S.ex[def.id] = e.target.open; RT.saveSettings(); } },
      h('summary', null, 'Try this first'),
      h('div', { class: 'explain-body' },
        !hasTheory && h('p', { class: 'ex-what' }, ex.what),
        !hasTheory && h('div', { class: 'ex-grid' }, h('div', null, h('b', null, 'Think of it like'), h('p', null, ex.like)), h('div', null, h('b', null, 'Why it matters'), h('p', null, ex.why))),
        h('ol', null, ex.start.map((v) => h('li', null, v))),
        h('div', { class: 'ex-actions' }, ui.btn('Show me around', () => tour(def), { id: 'ex-tour' }), h('span', { class: 'key' }, h('i', { class: 'c-req' }), 'request', h('i', { class: 'c-res' }), 'response', h('i', { class: 'c-ref' }), 'referral or warning', h('i', { class: 'c-cache' }), 'background or cached', h('i', { class: 'c-bad' }), 'failure')))));
  };
  RT.afterLab = (stage, def) => {
    const ids = pathIds(), i = ids.indexOf(def.id);
    if (i >= 0) {
      const prev = ids[i - 1], next = ids[i + 1];
      stage.append(h('nav', { class: 'labnav', 'aria-label': 'Path navigation' },
        prev ? h('a', { href: '#' + prev }, '← ' + RT.labText(RT.byId[prev], 'short')) : h('span'),
        h('span', { class: 'small muted' }, S.lang === 'bn' ? `${i + 1} / ${ids.length}` : `${pathOf().name}: ${i + 1} of ${ids.length}`),
        next ? h('a', { href: '#' + next, class: 'nextlab' }, RT.labText(RT.byId[next], 'short') + ' →') : h('a', { href: '#' }, 'Home →')));
    }
    if (!S.seenTour && L.EXPLAIN[def.id] && S.level === 'new' && !def.plain && !def.theoryOnly) { S.seenTour = true; RT.saveSettings(); setTimeout(() => { if (location.hash.slice(1) === def.id) tour(def); }, 500); }
    annotate(document.getElementById('main'));
  };
  RT.afterHome = () => annotate(document.getElementById('main'));

  /* Theory-only topics never reach afterLab, so every lesson carries its own links. */
  RT.theoryNav = (def) => {
    const ids = pathIds(), i = ids.indexOf(def.id);
    if (i < 0) return null;
    const prev = ids[i - 1], next = ids[i + 1];
    return h('nav', { class: 'th-nav', 'aria-label': 'Path navigation' },
      prev ? h('a', { href: '#' + prev }, '← ' + RT.labText(RT.byId[prev], 'short')) : h('span'),
      h('span', { class: 'small muted' }, `${i + 1} / ${ids.length}`),
      next ? h('a', { href: '#' + next, class: 'nextlab' }, RT.labText(RT.byId[next], 'short') + ' →') : h('a', { href: '#' }, S.lang === 'bn' ? 'হোম →' : 'Home →'));
  };

  /* ---------- guided tour ---------- */
  const STEPS = {
    studio: [['.controls', 'Choose what to build, how big it is, and how much help you want.'], ['.reqs', 'This is what your design must handle. Move your pointer over any unfamiliar word for its meaning.'], ['.palette', 'These are your building blocks. Drag one onto the canvas, or click it.'], ['.studio-canvas', 'Your system lives here. Drag from the dot on a box to connect it to another. The bar on each box shows how busy it is.'], ['.inspector', 'Select a box to set its size here. With nothing selected, this panel suggests your next step.'], ['main .stats', 'Your live results: green means the target is met, red means it isn\'t.']],
  };
  let tourOn = false;
  function tour(def) {
    if (tourOn) return;
    const list = (STEPS[def.id] || [['.controls', 'These are your controls. Everything on the page responds to them, so you can\'t break anything.'], ['.stage', 'This is the live diagram. Blue dots and labels are requests, green ones are responses, and red means failure.'], ['main .stats', 'These are the results. Watch them change as you adjust the controls.'], ['.banner', 'This line explains what just happened, in plain words.'], ['.side', 'Missions tick themselves off as you experiment. Key ideas and a quick quiz sit below them.']]).filter(([sel]) => { const e = document.querySelector(sel); return e && e.offsetParent !== null; });
    if (!list.length) return;
    tourOn = true;
    const ring = h('div', { class: 'tour-ring' }), box = h('div', { class: 'tour-box', role: 'dialog', 'aria-label': 'Guided tour' });
    document.body.append(ring, box);
    let i = 0;
    const end = () => { tourOn = false; ring.remove(); box.remove(); window.removeEventListener('resize', place); window.removeEventListener('hashchange', end); };
    function place() {
      const el = document.querySelector(list[i][0]), r = el.getBoundingClientRect();
      Object.assign(ring.style, { left: r.left - 5 + 'px', top: r.top - 5 + 'px', width: r.width + 10 + 'px', height: Math.min(r.height + 10, innerHeight - 20) + 'px' });
      const w = box.offsetWidth, ht = box.offsetHeight;
      const top = r.bottom + 12 + ht < innerHeight ? r.bottom + 12 : r.top - ht - 12 > 0 ? r.top - ht - 12 : innerHeight - ht - 16;
      box.style.top = top + 'px'; box.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left)) + 'px';
    }
    function step() {
      const [sel, text] = list[i];
      box.textContent = '';
      box.append(h('p', { class: 'small muted' }, `${i + 1} of ${list.length}`), h('p', null, text), h('div', { class: 'tour-btns' },
        ui.btn('Skip', end, { id: 'tour-skip' }), i > 0 && ui.btn('Back', () => { i--; step(); }, {}),
        ui.btn(i + 1 === list.length ? 'Done' : 'Next', () => { i++; if (i >= list.length) end(); else step(); }, { kind: 'primary', id: 'tour-next' })));
      document.querySelector(sel).scrollIntoView({ block: 'center', behavior: 'instant' });
      place();
    }
    window.addEventListener('resize', place); window.addEventListener('hashchange', end);
    step();
  }

  /* ---------- search ---------- */
  let dlgS = null;
  function openSearch() {
    if (!dlgS) {
      const input = h('input', { type: 'text', id: 'sr-q', placeholder: 'Search labs, terms and technologies', 'aria-label': 'Search', spellcheck: 'false' });
      const out = h('div', { class: 'sr-list' });
      input.addEventListener('input', () => run(input.value));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = out.querySelector('a'); if (a) a.click(); } });
      dlgS = h('dialog', { class: 'dlg', 'aria-label': 'Search' }, input, out);
      dlgS.input = input;
      dlgS.addEventListener('click', (e) => { if (e.target === dlgS) dlgS.close(); });
      document.body.append(dlgS);
      /* Lesson text, in both languages, so the box finds ideas as well as titles. */
      const lessons = RT.labs.map((l) => {
        const t = window.RTTheory[l.id] || {}, side = (x) => (x ? x.s.flatMap(([head, paras]) => [{ head, text: paras.join(' ').replace(/(^|\s)- /g, '$1') }]) : []);
        const bn = (window.RTLabsBn || {})[l.id] || {};
        return { l, names: [l.title, l.short, bn.title, bn.short].filter(Boolean).join(' ').toLowerCase(), ledes: [l.lede, bn.lede, l.notes].filter(Boolean).join(' ').toLowerCase(), secs: [...side(t.en), ...side(t.bn)] };
      });
      const clip = (text, at, len) => { const from = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - 40)) + 1); return (from ? '…' : '') + text.slice(from, at + len + 60).trim() + '…'; };
      function run(q0) {
        const q = q0.trim().toLowerCase(); out.textContent = '';
        if (!q) { out.append(h('p', { class: 'small muted' }, 'Try "cache", "p95" or "Kafka".')); return; }
        const rows = [], first = (v) => v.split(/(?<=[.?!।])\s/)[0];
        lessons.forEach(({ l, names, ledes, secs }) => {
          const title = RT.labText(l, 'title'), lede = first(RT.labText(l, 'lede'));
          if (names.includes(q)) { rows.push([5, 'Lab', title, lede, l.id]); return; }
          if (ledes.includes(q)) { rows.push([2, 'Lab', title, lede, l.id]); return; }
          const sec = secs.find((x) => x.head.toLowerCase().includes(q)) || secs.find((x) => x.text.toLowerCase().includes(q));
          if (!sec) return;
          const at = sec.text.toLowerCase().indexOf(q), inHead = sec.head.toLowerCase().includes(q);
          rows.push([inHead ? 3 : 1, 'Lab', title, sec.head + ': ' + (at >= 0 ? clip(sec.text, at, q.length) : first(sec.text)), l.id]);
        });
        L.GLOSSARY.forEach(([term, def, lab, alts]) => { const nm = [term, ...(alts || [])].join(' ').toLowerCase(); if (nm.includes(q)) rows.push([term.toLowerCase() === q ? 4 : 2, 'Term', term, def, lab]); });
        L.TECH.forEach((t) => { if ((t.name + ' ' + t.kind).toLowerCase().includes(q)) rows.push([3, 'Technology', t.name, t.say, 'guide']); });
(window.RTWalks || []).forEach((w) => { const x = w[S.lang === 'bn' ? 'bn' : 'en']; if ((w.en[0] + ' ' + w.bn[0] + ' ' + x[1]).toLowerCase().includes(q)) rows.push([3, 'Worked design', x[0], x[1], 'walkthroughs']); });
        rows.sort((a, b) => b[0] - a[0]).slice(0, 14).forEach(([, kind, name, say, id]) => out.append(h('a', { href: '#' + id, onclick() { dlgS.close(); } }, h('span', { class: 'sr-kind' }, kind), h('b', null, name), h('span', { class: 'small muted' }, say))));
                if (!rows.length) out.append(h('p', { class: 'small muted' }, 'Nothing matches that yet.'));
      }
      run('');
    }
    dlgS.showModal(); dlgS.input.select();
  }
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); } });

  /* ---------- settings ---------- */
  let dlg = null;
  function openSettings() {
    if (dlg) dlg.remove();
    const body = h('div', { class: 'set-body' });
    const row = (title, sub, ctl) => h('div', { class: 'set-row' }, h('div', null, h('b', null, title), sub && h('p', { class: 'small muted' }, sub)), ctl);
    let dirty = false;
    const set = (k, v) => { S[k] = v; RT.saveSettings(); RT.applySettings(); };
    const rerender = () => RT.reroute();
    const assume = S.assume;
    const asRow = (k, label, min, max, step, fmt) => {
      const sl = ui.slider({ id: 'as-' + k, label, min, max, step, value: assume[k], fmt, onInput(v) { assume[k] = v; dirty = true; RT.saveSettings(); D.setAssumptions(assume); } });
      return sl;
    };
    body.append(
      h('h3', null, 'Learning'),
      row('Experience', 'Sets how much explanation you see, and the Studio\'s default help.', ui.seg('Experience', [['new', 'New to this'], ['some', 'Know the basics'], ['pro', 'Experienced']], S.level, (v) => { set('level', v); rerender(); })),
      row('Learning path', pathOf().say, ui.select({ id: 'set-path', label: 'Path', value: S.path, options: L.PATHS.map((p) => [p.id, p.name]), onChange(v) { set('path', v); RT.rebuildRail(); openSettings(); rerender(); } })),
      row('Sidebar shows', null, ui.seg('Sidebar', [['all', 'All labs'], ['path', 'My path only']], S.rail, (v) => { set('rail', v); RT.rebuildRail(); })),
      row('Language', null, ui.seg('Language', [['en', 'English'], ['bn', 'বাংলা']], S.lang, (v) => RT.setLang(v))),
      row('Open topics on', 'Each topic has a Theory section and a Lab section.', ui.seg('Open topics on', [['auto', 'Automatic'], ['theory', 'Theory'], ['lab', 'Lab']], S.openOn, (v) => set('openOn', v))),
      row('Word explanations', 'Dotted words show their meaning when you hover or tap.', ui.toggle({ id: 'set-tips', label: 'On', checked: S.tips, onChange(v) { set('tips', v); rerender(); } })),
      h('h3', null, 'Display'),
      row('Theme', null, ui.seg('Theme', [['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']], S.theme, (v) => set('theme', v))),
      row('Text size', null, ui.seg('Text size', [['.9', 'Small'], ['1', 'Normal'], ['1.15', 'Large'], ['1.3', 'Extra large']], String(S.zoom), (v) => set('zoom', +v))),
      row('Animation speed', 'Slower gives you time to read each step.', ui.seg('Speed', [['.25', '¼×'], ['.5', '½×'], ['1', '1×'], ['2', '2×']], String(S.speed), (v) => RT.setSpeed(+v))),
      row('Reduce motion', 'Shortens animations.', ui.toggle({ id: 'set-motion', label: 'On', checked: S.motion, onChange(v) { set('motion', v); } })),
      h('h3', null, 'Simulation assumptions'),
      h('p', { class: 'small muted' }, 'These change the Design Studio\'s model. Try your own hardware numbers, or see how a design copes when servers are half as powerful. Budgets update to match.'),
      h('div', { class: 'controls flat' }, asRow('app', 'App server power', .25, 4, .25, (v) => v + '×'), asRow('db', 'Database power', .25, 4, .25, (v) => v + '×'), asRow('cache', 'Cache and queue power', .25, 4, .25, (v) => v + '×'), asRow('price', 'Prices', .25, 4, .25, (v) => v + '×'), asRow('floor', 'Failure test passes at', 90, 99.9, .1, (v) => v + '%')),
      ui.btn('Restore default assumptions', () => { Object.assign(assume, RT.defaultAssume()); RT.saveSettings(); D.setAssumptions(assume); RT.reroute(); openSettings(); }, { id: 'as-reset' }),
      h('h3', null, 'Your data'),
      h('p', { class: 'small muted' }, 'Progress, designs and notes stay in this browser. Copy them to move to another device.'));
    const box = h('textarea', { id: 'set-data', rows: 3, 'aria-label': 'Backup text', spellcheck: 'false', placeholder: 'Press "Create backup", or paste a backup here' });
    const msg = h('p', { class: 'small muted', role: 'status' });
    const keys = () => { const o = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('roundtrip.') && k !== 'roundtrip.settings') o.push(k); } } catch { /* storage is blocked */ } return o; };
    let armed = false;
    const wipe = ui.btn('Erase all progress', () => {
      if (!armed) { armed = true; wipe.textContent = 'Press again to erase everything'; return; }
      keys().forEach((k) => { try { localStorage.removeItem(k); } catch { /* nothing to do */ } });
      location.reload();
    }, { kind: 'danger', id: 'set-wipe' });
    body.append(box, h('div', { class: 'controls flat' },
      ui.btn('Create backup', () => { const o = {}; keys().forEach((k) => { o[k] = localStorage.getItem(k); }); box.value = JSON.stringify(o); box.select(); msg.textContent = 'Backup created. Copy this text somewhere safe.'; }, { id: 'set-export' }),
      ui.btn('Restore from backup', () => { try { const o = JSON.parse(box.value); if (!o || typeof o !== 'object' || Object.keys(o).some((k) => !k.startsWith('roundtrip.'))) throw new Error('shape'); Object.entries(o).forEach(([k, v]) => localStorage.setItem(k, v)); location.reload(); } catch { msg.textContent = 'That text is not a Round Trip backup, so nothing changed.'; } }, { id: 'set-import' }),
      wipe), msg);
    dlg = h('dialog', { class: 'dlg wide', 'aria-label': 'Settings' }, h('div', { class: 'set-head' }, h('h2', null, 'Settings'), ui.btn('Close', () => dlg.close(), { id: 'set-close' })), body);
    dlg.addEventListener('close', () => { if (dirty) RT.reroute(); });
    document.body.append(dlg); dlg.showModal();
  }
  RT.openSettings = openSettings; RT.openSearch = openSearch;

  /* ---------- home: welcome and path ---------- */
  RT.homeCard = () => {
    if (!S.welcomed) {
      const lv = ui.seg('Experience', [['new', 'I\'m new to this'], ['some', 'I know the basics'], ['pro', 'I\'m experienced']], S.level, (v) => { S.level = v; RT.saveSettings(); });
      const pt = ui.select({ id: 'wl-path', label: 'What\'s your goal?', value: 'starter', options: L.PATHS.filter((p) => p.labs).concat(L.PATHS[0]).map((p) => [p.id, p.name]) });
      const sty = ui.seg('How you like to learn', [['read', 'Read first'], ['do', 'Try things'], ['play', 'Play a game'], ['test', 'Test myself']], 'read');
      return h('section', { class: 'welcome' }, h('h2', null, 'Welcome. Let\'s set this up for you.'), h('p', { class: 'small muted' }, 'Three quick choices. You can change them any time in Settings.'), h('div', { class: 'controls flat' }, ui.field('How much do you know?', lv), ui.field('How do you like to learn?', sty), pt, ui.btn('Start learning', () => {
        S.path = pt.value; S.welcomed = true; S.style = sty.value; S.openOn = sty.value === 'read' ? 'theory' : sty.value === 'do' ? 'lab' : 'auto';
        RT.saveSettings(); RT.rebuildRail();
        location.hash = sty.value === 'play' ? 'game' : sty.value === 'test' ? 'trainer' : pathIds()[0];
      }, { kind: 'primary', id: 'wl-go' }), ui.btn('Skip for now', () => { S.welcomed = true; RT.saveSettings(); RT.reroute(); }, { id: 'wl-skip' })));
    }
    const isDone = (i) => touched(i) || S.read[i], canFinish = (i) => RT.levelOf(i) > 0 || (RT.byId[i].missions || []).length > 0;
    const ids = pathIds().filter(canFinish), done = ids.filter(isDone).length, nx = ids.find((i) => !isDone(i)) || ids[0], bar = ui.bar('res');
    bar.set((done / ids.length) * 100);
    return h('section', { class: 'welcome' }, h('div', { class: 'path-head' }, h('div', null, h('h2', null, pathOf().name), h('p', { class: 'small muted' }, `${done} of ${ids.length} started. ${pathOf().say}`)), h('a', { class: 'btn primary', href: '#' + nx, id: 'path-next' }, (S.lang === 'bn' ? 'চালিয়ে যান: ' : 'Continue: ') + RT.labText(RT.byId[nx], 'short'))), bar,
      pathOf().labs && h('ol', { class: 'path-steps' }, ids.slice(0, 40).map((i) => h('li', null, h('a', { href: '#' + i, class: isDone(i) ? 'done' : '' }, RT.labText(RT.byId[i], 'short'))))));
  };

  /* ---------- System Map ---------- */
  const LAYOUT = { users: [80, 230], dns: [80, 70], cdn: [260, 60], lb: [260, 230], gateway: [430, 230], app: [600, 230], cache: [800, 90], db: [800, 230], replica: [800, 350], queue: [600, 400], worker: [430, 400], blob: [430, 60], search: [260, 400] };
  const LINKS = [['users', 'dns'], ['users', 'cdn'], ['users', 'lb'], ['cdn', 'blob'], ['lb', 'gateway'], ['gateway', 'app'], ['app', 'cache'], ['app', 'db'], ['db', 'replica'], ['app', 'queue'], ['queue', 'worker'], ['worker', 'search'], ['worker', 'cache'], ['app', 'users']];
  RT.lab({
    id: 'map', title: 'System Map', short: 'System Map', chapter: 'Start here',
    lede: 'Every part of a modern web system on one page. Click a box to see what it does, or follow a request through the whole thing.',
    render(root, ctx) {
      const net = Net(ctx, { w: 900, h: 460, label: 'Components of a large web system' });
      const detail = h('div', { class: 'card part' });
      Object.entries(LAYOUT).forEach(([id, [x, y]]) => net.node(id, { x, y, label: L.PARTS[id].name, sub: '', w: 124, h: 44, onClick: () => showPart(id) }));
      LINKS.forEach(([a, b]) => { if (a !== 'app' || b !== 'users') net.link(a, b); });
      const flow = ui.seg('Journey', Object.entries(L.FLOWS).map(([k, f]) => [k, f.name]), 'page', () => { playId++; stepI = 0; paint(); say.textContent = 'Press Play, or step through it one hop at a time.'; });
      const say = h('div', { class: 'banner', role: 'status' }, 'Press Play to follow a request, or click any box.');
      const count = h('span', { class: 'small muted' });
      const play = ui.btn('Play', playAll, { kind: 'primary', id: 'map-play' }), nextB = ui.btn('Next hop', stepOne, { id: 'map-next' });
      let stepI = 0, running = false, cur = null, playId = 0;
      root.append(h('div', { class: 'controls' }, ui.field('Follow a journey', flow), play, nextB, count), say, h('div', { class: 'stage' }, net.svg), detail);
      function paint() { Object.keys(LAYOUT).forEach((id) => net.state(id, id === cur ? 'on' : '')); count.textContent = `Hop ${stepI} of ${L.FLOWS[flow.value].hops.length}`; }
      function showPart(id) {
        cur = id; const p = L.PARTS[id]; detail.textContent = ''; paint();
        detail.append(h('h2', null, p.name), h('p', { class: 'tech-text' }, p.what), h('div', { class: 'ex-grid', style: { marginTop: '8px' } },
          h('div', null, h('b', null, 'Think of it like'), h('p', null, p.like)), h('div', null, h('b', null, 'You need it'), h('p', { class: 'tech-text' }, p.need)), h('div', null, h('b', null, 'Real products'), h('p', null, p.tech)), h('div', null, h('b', null, 'Try it'), h('p', null, h('a', { href: '#' + p.lab }, 'Open ' + RT.byId[p.lab].title)))));
        annotateNow();
      }
      const annotateNow = () => annotate(root);
      async function stepOne() {
        if (running) return;
        const f = L.FLOWS[flow.value]; if (stepI >= f.hops.length) stepI = 0;
        running = true;
        const [a, b, text] = f.hops[stepI]; stepI++;
        say.textContent = text; say.className = 'banner';
        if (a !== b) await net.send(a, b, { color: flow.value === 'fail' ? 'bad' : b === 'users' ? 'res' : 'req', dur: 900 }); else await ctx.sleep(700);
        net.flash(b, 'hit', 500); showPart(b); running = false; paint();
      }
      async function playAll() {
        if (running) return;
        const me = ++playId, f = L.FLOWS[flow.value]; stepI = 0;
        for (let i = 0; i < f.hops.length; i++) { await stepOne(); await ctx.sleep(1100); if (me !== playId) return; }
      }
      detail.append(h('p', { class: 'small muted' }, 'Click a box on the map to read about it.'));
      paint();
    },
  });

  /* ---------- Technology Guide ---------- */
  RT.lab({
    id: 'guide', title: 'Technology Guide', short: 'Technology Guide', chapter: 'Start here',
    lede: 'The real products behind the concepts: what each is for, when to avoid it, and which lab shows the idea at work.',
    render(root) {
      const cats = ['All', ...new Set(L.TECH.map((t) => t.cat))];
      const cat = ui.seg('Category', cats.map((c) => [c, c]), 'All', draw);
      const need = ui.select({ id: 'tg-need', label: 'I need to…', value: '', options: [['', 'Show everything'], ...L.NEEDS.map(([n]) => [n, n])], onChange: draw });
      const list = h('div', { class: 'tech-grid' });
      const names = L.TECH.map((t) => [t.name, t.name]);
      const a = ui.select({ id: 'tg-a', label: 'Compare', value: 'PostgreSQL', options: names, onChange: compare }), b = ui.select({ id: 'tg-b', label: 'with', value: 'Cassandra', options: names, onChange: compare });
      const cmp = h('div', { class: 'scroll' });
      root.append(h('div', { class: 'controls' }, need, ui.field('Category', cat)), list, ui.card('Compare two technologies', h('div', { class: 'controls flat', style: { marginBottom: '8px' } }, a, b), cmp));
      function draw() {
        const wanted = L.NEEDS.find(([n]) => n === need.value);
        list.textContent = '';
        L.TECH.filter((t) => (cat.value === 'All' || t.cat === cat.value) && (!wanted || wanted[1].includes(t.name))).forEach((t) => {
          list.append(h('details', { class: 'tech', open: wanted ? true : null }, h('summary', null, h('b', null, t.name), h('span', { class: 'small muted' }, t.kind)),
            h('div', { class: 'tech-in' }, h('p', { class: 'tech-text' }, t.say), h('p', null, h('b', null, 'Good for: '), t.good), h('p', null, h('b', null, 'Avoid for: '), t.bad), h('p', { class: 'muted' }, 'Alternatives: ' + t.alt), RT.byId[t.lab] && h('a', { href: '#' + t.lab }, 'See the idea in ' + RT.byId[t.lab].title))));
        });
        annotate(root);
      }
      function compare() {
        const A = L.TECH.find((t) => t.name === a.value), B = L.TECH.find((t) => t.name === b.value);
        const rows = [['Type', 'kind'], ['Best for', 'good'], ['Avoid for', 'bad'], ['How it scales', 'scale'], ['Consistency', 'consistency'], ['Learning curve', 'learn']];
        cmp.textContent = '';
        cmp.append(h('table', { class: 'table' }, h('tr', null, h('th', null, 'Measure'), h('th', null, A.name), h('th', null, B.name)), rows.map(([n, k]) => h('tr', null, h('td', null, n), h('td', { style: { fontFamily: 'var(--body)' } }, A[k]), h('td', { style: { fontFamily: 'var(--body)' } }, B[k])))));
      }
      draw(); compare();
    },
  });

  /* ---------- Glossary page ---------- */
  RT.lab({
    id: 'glossary', title: 'Glossary', short: 'Glossary', chapter: 'Start here',
    lede: 'Every term used on this site, in plain words.',
    render(root) {
      const q = h('input', { type: 'text', id: 'gl-q', placeholder: 'Filter terms', 'aria-label': 'Filter terms', oninput: draw });
      const list = h('div', { class: 'gloss' });
      root.append(h('div', { class: 'controls' }, ui.field('Find a term', q, 'grow')), list);
      function draw() {
        const t = q.value.trim().toLowerCase(); list.textContent = '';
        L.GLOSSARY.slice().sort((a, b) => a[0].localeCompare(b[0])).filter(([n, d]) => !t || (n + ' ' + d).toLowerCase().includes(t)).forEach(([n, d, lab]) => list.append(h('div', null, h('b', null, n), h('p', null, d), RT.byId[lab] && h('a', { class: 'small', href: '#' + lab }, RT.byId[lab].title))));
        if (!list.children.length) list.append(h('p', { class: 'small muted' }, 'No terms match that.'));
      }
      draw();
    },
  });

  /* Dynamic text, such as banners, gets word explanations as it appears */
  let pending = false;
  RT.afterStart = () => {
    const main = document.getElementById('main');
    new MutationObserver(() => {
      if (pending) return; pending = true;
      setTimeout(() => { pending = false; annotate(main); }, 180);
    }).observe(main, { childList: true, subtree: true });
    document.body.append(pop);
    if (S.lang === 'bn') RT.i18nWatch();
  };
})();
