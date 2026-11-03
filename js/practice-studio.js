/* Design Studio: a canvas for building a system against a brief, with live simulation,
   failure injection, a scored review, and an interview mode. */
(function () {
  const { h, ui, fmtMs } = RT;
  const D = window.RTDesign, { TYPES, DEFAULTS, CLASSES } = D, summary = RT.Designer.summary, money = RT.Designer.money;
  const num = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1000) + 'k' : n >= 100 ? Math.round(n).toLocaleString() : n >= 1 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2));
  const pctA = (a) => (a * 100).toFixed(a >= .9999 ? 3 : 2) + '%';
  const load = (k, dflt) => { try { return JSON.parse(localStorage.getItem(k)) || dflt; } catch { return dflt; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* designs simply stop persisting */ } };
  const blank = () => ({ nodes: [{ id: 'users', type: 'users', x: 11, y: 242, regions: 1 }], edges: [] });

  RT.lab({
    id: 'studio', title: 'Design Studio', short: 'Design Studio', chapter: 'Practice', wide: true,
    lede: 'Pick a brief, then drag components onto the canvas and wire them together. Your design runs against real traffic numbers as you build, and failures and a scored review follow.',
    missions: [
      ['first', 'Pass any brief at Launch.'], ['growth', 'Pass any brief at Growth, with 10× or more traffic.'], ['hyper', 'Pass any brief at Hyper-scale.'],
      ['chaos', 'Pass every failure test in one design.'], ['grade', 'Earn an S grade on any stage.'], ['three', 'Pass three different briefs.'], ['all', 'Pass all eight briefs.'], ['iv', 'Finish an interview session against the clock.'],
      ['load', 'Run a load test at ten times the traffic, and keep the design within its targets.'],
    ],
    notes: `<ul>
      <li>Start from the numbers. Reads, writes, storage and SLOs decide everything else.</li>
      <li>Find the bottleneck, fix that, and repeat. Adding capacity elsewhere only adds cost.</li>
      <li>Caches and replicas help reads. Only shards or a queue help writes.</li>
      <li>Keep utilisation well under 100%. A zone outage can halve your capacity overnight.</li>
      <li>In an interview, explain each trade-off you make. The diagram alone earns little.</li>
    </ul>`,
    check: { q: 'Your database is at 140% and the review says writes are the limit. Which change helps?', options: ['Add read replicas', 'Add a cache', 'Add shards, or buffer writes through a queue', 'Add app servers'], answer: 2, why: 'Every replica applies every write, so replicas cannot raise write capacity. Sharding splits writes, and a queue smooths them.' },

    render(root, ctx) {
      const safe = (v) => {
        const c = D.sanitize(v);
        if (!c.nodes.some((n) => n.type === 'users')) c.nodes.unshift(blank().nodes[0]);
        return { nodes: c.nodes.map((n) => ({ ...DEFAULTS[n.type], x: 187, y: 33, ...n })), edges: c.edges };
      };
      const allBriefs = () => { const c = load('roundtrip.custom', null); return c ? [...D.BRIEFS, c] : D.BRIEFS; };
      const prefs = load('roundtrip.studio', { brief: 'url', stage: 0, best: {}, notes: {} });
      let wanted = null;
      try { wanted = sessionStorage.getItem('rt-open-brief'); sessionStorage.removeItem('rt-open-brief'); } catch { /* the saved brief is used instead */ }
      let brief = allBriefs().find((b) => b.id === (wanted || prefs.brief)) || D.BRIEFS[0];
      let mode = RT.settings.level === 'new' ? 'guided' : 'standard', revealed = false;
      let stage = prefs.stage || 0, design, grade = null, fault = null, mine = null;
      const test = { on: false, set: {}, r: null, limit: null };
      const say = (en, bn) => (RT.settings.lang === 'bn' ? bn : en);
      const slotKey = () => 'roundtrip.design.' + brief.id + '.' + stage;

      const briefSel = ui.select({ id: 'st-brief', label: 'Brief', value: brief.id, options: allBriefs().map((b) => [b.id, `${b.title} · ${b.level || 'Custom'}`]), onChange(v) { persist(); brief = allBriefs().find((b) => b.id === v); fault = null; openSlot(); } });
      const stageSeg = ui.seg('Stage', [['0', 'Launch'], ['1', 'Growth'], ['2', 'Hyper-scale']], String(stage), (v) => { persist(); stage = +v; fault = null; openSlot(); });
      const modeSeg = ui.seg('Help level', [['guided', 'Guided'], ['standard', 'Standard'], ['blind', 'Interview']], mode, (v) => { mode = v; revealed = false; refresh(); });
      const submitB = ui.btn('Submit for review', () => { revealed = true; refresh(); }, { kind: 'primary', id: 'st-submit' });
      const undoB = ui.btn('Undo', () => dz.undo(), { id: 'st-undo' });
      const clearB = ui.btn('Clear canvas', () => { dz.change(() => { design = blank(); }); }, { kind: 'danger', id: 'st-clear' });
      const carry = ui.btn('Copy previous stage', () => {
        if (!stage) { RT.toast('Launch is the first stage'); return; }
        const prev = load('roundtrip.design.' + brief.id + '.' + (stage - 1), null);
        if (!prev) { RT.toast('Nothing is saved for the previous stage yet'); return; }
        dz.change(() => { design = safe(prev); });
      }, { id: 'st-carry', title: 'Start from your design for the previous stage, then scale it' });

      const pitch = h('p', { class: 'small' }), reqs = h('div', { class: 'reqs' });
      const score = h('div', { class: 'stats' }), incident = h('div', { class: 'banner bad hide', role: 'status' });
      const panes = { review: h('div'), chaos: h('div'), traffic: h('div', { class: 'scroll' }), interview: h('div'), reference: h('div'), share: h('div'), model: h('div') };
      const tabs = ui.tabs([['review', 'Review'], ['chaos', 'Failure tests'], ['traffic', 'Traffic by tier'], ['interview', 'Interview mode'], ['reference', 'Reference design'], ['share', 'Save & share'], ['model', say('How the numbers work', 'সংখ্যাগুলো কীভাবে আসে')]], (v) => {
        Object.entries(panes).forEach(([k, p]) => p.classList.toggle('hide', k !== v));
      });
      const hidden = () => mode === 'blind' && !revealed;
      const shown = () => (test.on && test.r ? test.r : fault ? fault.r : grade.r);
      function persist() { save(slotKey(), design); prefs.brief = brief.id; prefs.stage = stage; save('roundtrip.studio', prefs); }
      function openSlot() { design = safe(load(slotKey(), null) || blank()); dz.reset(); mine = null; buildInterview(); buildTest(); refresh(); }
      function idle(inspector) {
          if (hidden()) { inspector.append(h('h2', null, 'Interview mode'), h('p', { class: 'small' }, 'No hints or scores until you submit. Select a component to configure it.')); return; }
          inspector.append(h('h2', null, 'Next step'));
          if (mode === 'guided') {
            const c = D.coach(design, brief, stage);
            if (!c.finished) {
              const bar = ui.bar('res'); bar.set((c.done / c.total) * 100);
              inspector.append(h('p', { class: 'small muted' }, `Step ${c.done + 1} of ${c.total}`), bar, h('p', { class: 'small', style: { fontWeight: 600 } }, c.text), h('p', { class: 'small muted' }, c.why), ui.btn('Add it for me', () => { dz.change(() => c.apply(design)); dz.collapseCard(); }, { kind: 'primary', id: 'st-coach' }), h('a', { class: 'small', href: '#' + c.lab }, 'Learn about this'));
              return;
            }
          }
          const top = grade.findings[0];
          inspector.append(h('p', { class: 'small' }, design.nodes.length < 2 ? 'Add a load balancer and connect Users to it. Then work towards a database.' : top ? top.text : 'No open problems. Try the failure tests, or raise the stage.'));
          if (top && top.fix && design.nodes.length >= 2) inspector.append(h('p', { class: 'small muted', style: { marginTop: '4px' } }, top.fix));
          inspector.append(h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Select a component to configure it.'));
      }
      const testOn = ui.toggle({ id: 'lt-on', label: say('Test this design under live load', 'লাইভ চাপে এই ডিজাইন পরীক্ষা করুন'), checked: false, onChange(v) { test.on = v; if (v) fault = null; refresh(); } });
      const testReset = ui.btn(say('Back to the brief\'s numbers', 'ব্রিফের সংখ্যায় ফিরুন'), () => { buildTest(); refresh(); }, { id: 'lt-reset' });
      const testFit = ui.btn(say('Size this design for this load', 'এই চাপের জন্য ডিজাইনের মাপ ঠিক করুন'), () => {
        if (!test.on) return;
        const was = grade.r.cost;
        dz.change(() => { design = D.fit(JSON.parse(JSON.stringify(design)), brief, stage, [{ ...testFaults(), load: testLoad() }], .7, false, .7); });
        RT.toast(D.holds(test.r) ? say(`Sized for this load. Monthly cost at the brief's traffic went from ${money(was)} to ${money(grade.r.cost)}. Undo restores your design.`, `এই চাপের জন্য মাপ ঠিক হয়েছে। ব্রিফের ট্রাফিকে মাসিক খরচ ${money(was)} থেকে ${money(grade.r.cost)} হয়েছে। পূর্বাবস্থা আপনার ডিজাইন ফেরায়।`) : say('More capacity alone cannot meet this load. Read the verdict below for what is limiting it.', 'শুধু ক্ষমতা বাড়িয়ে এই চাপ সামলানো যায় না। কী আটকাচ্ছে তা নিচের ফলাফলে দেখুন।'));
      }, { id: 'lt-fit' });
      const testControls = h('div', { class: 'controls flat' }), testOut = h('div'), testNote = h('p', { class: 'small muted' });
      const testCard = ui.card(say('Load test', 'লোড টেস্ট'), h('div', { class: 'controls flat' }, testOn, testReset, testFit), testNote, testControls, testOut);
      const dz = RT.Designer(ctx, { get: () => design, set: (v) => { design = v; }, result: () => (hidden() ? null : grade ? shown() : null), last: () => (grade ? grade.r : null), refresh, persist, idle });
      root.append(
        h('div', { class: 'controls' }, briefSel, ui.field('Stage', stageSeg), ui.field('Help level', modeSeg), submitB, carry, undoB, clearB),
        ui.card(null, pitch, reqs), score, incident,
        dz.el,
        h('p', { class: 'small muted' }, 'Drag a component onto the canvas, or click it to add one. Drag from the dot on a box\'s right edge to connect it. Press Delete to remove the selected item. On a touch screen, use "Connect to" in the side panel. Capacities and prices are illustrative.'),
        testCard, tabs, ...Object.values(panes));
      tabs.set('review');

      /* ---------- scoring ---------- */
      function drawHeader() {
        const d = D.demand(brief, stage), limit = D.budget(brief, stage);
        pitch.textContent = ''; pitch.append(brief.pitch, ' ', `${d.name}: ${num(d.dau)} daily active users.`);
        const chip = (k, v) => h('span', { class: 'req' }, h('b', null, v), k);
        reqs.textContent = '';
        reqs.append(chip('reads/s, peak', num(d.read)), chip('writes/s, peak', num(d.write)));
        if (d.media) reqs.append(chip('media/s', num(d.media)));
        if (d.search) reqs.append(chip('searches/s', num(d.search)));
        if (d.rt) reqs.append(chip('realtime msgs/s', num(d.rt)));
        reqs.append(chip('of data', d.storageTB >= 1000 ? (d.storageTB / 1000).toFixed(1) + ' PB' : d.storageTB >= 1 ? Math.ceil(d.storageTB) + ' TB' : Math.ceil(d.storageTB * 1000) + ' GB'), chip('hot data', num(d.hotGB) + ' GB'), chip('availability', pctA(d.slo.avail)), chip('monthly budget', money(limit)));
        if (d.strong) reqs.append(chip('consistency', 'Strong'));
        if (d.global) reqs.append(chip('audience', 'Global'));
        if (d.fanout > 1) reqs.append(chip('fan-out per write', '×' + d.fanout));
      }
      function drawScore() {
        const g = grade, r = shown();
        score.textContent = '';
        score.classList.toggle('hide', hidden());
        const tile = (label, value, tone) => h('div', { class: 'stat ' + (tone || '') }, h('b', null, value), h('span', null, label));
        score.append(test.on ? tile(say('Load test', 'লোড টেস্ট'), D.holds(r) ? say('Holding', 'টিকে আছে') : say('Failing', 'ব্যর্থ হচ্ছে'), D.holds(r) ? 'good' : 'bad') : tile('Grade', g.letter + ' · ' + g.score, g.passed ? 'good' : 'warn'));
        Object.entries(r.classes).forEach(([k, c]) => {
          const lim = r.d.slo[k];
          score.append(tile(`${CLASSES[k]} p95 (target ${lim} ms)`, !c.routed ? 'No path' : c.timedOut ? say('Timing out', 'টাইমআউট হচ্ছে') : fmtMs(c.p95), !c.routed || c.p95 > lim ? 'bad' : 'good'));
        });
        score.append(tile(`Availability (target ${pctA(r.d.slo.avail)})`, r.checks.routes ? pctA(r.avail) : '–', r.checks.avail ? 'good' : 'bad'),
          tile('Requests succeeding', (r.succ * 100).toFixed(r.succ > .999 ? 2 : 1) + '%', r.succ >= .999 ? 'good' : 'bad'),
          tile(`Monthly cost (budget ${money(g.limit)})`, money(r.cost), r.cost <= g.limit ? 'good' : 'bad'));
      }
      function drawReview() {
        const g = grade; panes.review.textContent = '';
        if (hidden()) { panes.review.append(h('p', { class: 'small muted' }, 'Interview mode hides the review. Press Submit for review when you are ready to be graded.')); return; }
        const rubric = h('div', { class: 'rubric' }, g.parts.map(([name, w, v]) => { const b = ui.bar(v >= 1 ? 'res' : v > 0 ? '' : 'bad'); b.set(v * 100); return h('div', { class: 'small' }, h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, name, h('span', { class: 'mono' }, `${Math.round(w * v)}/${w}`)), b); }));
        const list = h('div', { class: 'findings' });
        if (!g.findings.length) list.append(h('p', { class: 'small good' }, 'No findings. This is a clean design.'));
        g.findings.slice(0, 14).forEach((f) => list.append(h('div', { class: 'finding ' + f.sev }, h('span', { class: 'sev' }, f.sev), h('div', null, h('p', null, f.text), h('p', { class: 'muted' }, f.fix, ' ', f.lab && h('a', { href: '#' + f.lab }, 'Open the lab'))))));
        const verdict = g.passed ? `This design passes ${D.demand(brief, stage).name}.` : 'Not passing yet.';
        panes.review.append(h('div', { class: 'twocol' }, ui.card('Score', h('p', { class: 'small', style: { marginBottom: '6px' } }, verdict), rubric), ui.card(`Design review (${g.findings.length})`, list)));
      }
      function drawChaos() {
        const g = grade; panes.chaos.textContent = '';
        if (hidden()) { panes.chaos.append(h('p', { class: 'small muted' }, 'Failure tests run after you submit.')); return; }
        panes.chaos.append(h('p', { class: 'small muted', style: { marginBottom: '8px' } }, 'A test passes when at least 98% of requests still succeed during the incident. Press Run to replay one on the canvas.'));
        panes.chaos.append(h('div', { class: 'threecol' }, g.tests.map((t) => ui.card(t.name, h('p', { class: 'small' }, t.say), h('p', { class: 'small ' + (t.pass ? 'good' : 'badtxt'), style: { margin: '6px 0' } }, `${t.pass ? 'Survived' : 'Failed'}: ${(t.succ * 100).toFixed(1)}% succeed`),
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, ui.btn(fault && fault.id === t.id ? 'Stop' : 'Run on canvas', () => { fault = fault && fault.id === t.id ? null : { id: t.id, r: t.result, name: t.name }; if (fault) { test.on = false; testOn.checked = false; } refresh(); }, { id: 'st-run-' + t.id, kind: 'danger' }), h('a', { class: 'small', href: '#' + t.lab, style: { alignSelf: 'center' } }, 'Learn more'))))));
      }
      function drawTraffic() {
        const r = shown(); panes.traffic.textContent = '';
        if (hidden()) { panes.traffic.append(h('p', { class: 'small muted' }, 'Traffic results appear after you submit.')); return; }
        const rows = design.nodes.filter((n) => n.type !== 'users').map((n) => {
          const x = r.nodes[n.id], by = Object.entries(x.load.by).map(([k, v]) => `${CLASSES[k]} ${num(v)}/s`).join(', ') || 'no traffic';
          const cap = x.cap.all === Infinity ? 'unlimited' : x.cap.all ? num(x.cap.all) + '/s' : `${num(x.cap.r)} reads, ${num(x.cap.w)} writes`;
          return h('tr', null, h('td', null, TYPES[n.type].label), h('td', null, summary(n)), h('td', null, by), h('td', null, cap), h('td', { class: x.util > 1 ? 'badtxt' : x.util > .75 ? '' : 'good' }, x.down ? 'DOWN' : Number.isFinite(x.util) ? Math.round(x.util * 100) + '%' : '–'), h('td', null, money(x.cost)));
        });
        panes.traffic.append(h('table', { class: 'table' }, h('tr', null, ['Tier', 'Setup', 'Traffic', 'Capacity', 'Load', 'Cost/mo'].map((t) => h('th', null, t))), rows));
        if (!rows.length) panes.traffic.append(h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'Add components to see traffic.'));
        if (r.transfer) panes.traffic.append(h('p', { class: 'small', style: { marginTop: '6px' } }, say('Data sent to users: ', 'ব্যবহারকারীদের পাঠানো ডেটা: '), money(r.transfer), say(' a month, included in the monthly cost.', ' প্রতি মাসে, মাসিক খরচের মধ্যেই।')));
        const timed = Object.entries(r.classes).filter(([, c]) => c.routed && !c.timedOut);
        if (timed.length) panes.traffic.append(h('h3', { class: 'small', style: { margin: '12px 0 4px' } }, say('Where the time goes (p95)', 'সময় কোথায় যায় (p95)')), h('table', { class: 'table' }, timed.map(([k, c]) => {
          const parts = [[say('Network', 'নেটওয়ার্ক'), c.net, 'net'], ...c.path.map(([id, ms]) => [TYPES[(design.nodes.find((n) => n.id === id) || { type: 'users' }).type].label, ms, ''])].filter(([, ms]) => ms >= .05);
          return h('tr', null, h('td', null, CLASSES[k]), h('td', null, fmtMs(c.p95)), h('td', null, h('div', { class: 'timebar', role: 'img', 'aria-label': parts.map(([n, ms]) => n + ' ' + fmtMs(ms)).join(', ') }, parts.map(([n, ms, cls]) => h('span', { class: cls, style: { flexGrow: ms }, title: n + ' ' + fmtMs(ms) }, ms / c.p95 > .14 ? n : '')))));
        })));
      }
      function drawReference() {
        panes.reference.textContent = '';
        const ref = D.solve(brief, stage), rr = D.grade(ref, brief, stage);
        const load2 = ui.btn('Show the reference design on the canvas', () => { mine = JSON.stringify(design); dz.change(() => { design = JSON.parse(JSON.stringify(ref)); }); }, { id: 'st-ref' });
        const back = mine && ui.btn('Back to my design', () => { const m = mine; mine = null; dz.change(() => { design = JSON.parse(m); }); }, { id: 'st-back' });
        const typesMine = new Set(design.nodes.map((n) => n.type)), typesRef = [...new Set(ref.nodes.map((n) => n.type))];
        const missing = typesRef.filter((t) => !typesMine.has(t) && t !== 'users');
        const yours = grade.r;
        panes.reference.append(h('div', { class: 'twocol' },
          ui.card('Compare', h('table', { class: 'table' }, h('tr', null, h('th', null, 'Measure'), h('th', null, 'Yours'), h('th', null, 'Reference')), h('tr', null, h('td', null, 'Monthly cost'), h('td', null, money(yours.cost)), h('td', null, money(rr.r.cost))), h('tr', null, h('td', null, 'Availability'), h('td', null, pctA(yours.avail)), h('td', null, pctA(rr.r.avail))), h('tr', null, h('td', null, 'Grade'), h('td', null, grade.letter), h('td', null, rr.letter))),
            h('p', { class: 'small muted', style: { marginTop: '6px' } }, missing.length ? `The reference also uses: ${missing.map((t) => TYPES[t].label).join(', ')}. Try working out why before you look.` : 'You use every kind of component the reference does.')),
          ui.card('Try it yourself first', h('p', { class: 'small', style: { marginBottom: '8px' } }, 'The reference is one valid answer, sized by stress testing. Yours can be better. Your own design is kept, so you can return to it.'), h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, load2, back))));
      }
      /* Interview timer lives outside the refresh cycle */
      let ivLeft = 45 * 60, ivOn = false;
      const ivClock = h('b', { class: 'ivclock', role: 'timer' }, '45:00');
      const ivBtn = ui.btn('Start 45-minute session', () => { ivOn = !ivOn; ivBtn.textContent = ivOn ? 'Pause' : 'Resume'; }, { id: 'iv-start', kind: 'primary' });
      ctx.every(1000, () => {
        if (!ivOn || ivLeft <= 0) return;
        ivLeft--; ivClock.textContent = `${String(Math.floor(ivLeft / 60)).padStart(2, '0')}:${String(ivLeft % 60).padStart(2, '0')}`;
        if (!ivLeft) { ivOn = false; ivBtn.textContent = 'Time is up'; RT.toast('Time is up. How far did you get?'); }
      });
      function buildInterview() {
        panes.interview.textContent = '';
        if (!brief.guide) { panes.interview.append(h('p', { class: 'small muted' }, 'Custom briefs have no interview guide. Use a built-in brief for this mode.')); return; }
        const G = brief.guide, nk = brief.id;
        const notes = prefs.notes[nk] = prefs.notes[nk] || {};
        const sections = [['ask', '1. Clarify requirements', '5 min', 'Which questions would you ask before drawing anything?', G.ask], ['est', '2. Estimate scale', '5 min', 'Work out reads, writes and storage. Then compare with the numbers above.', null], ['api', '3. Define the API', '5 min', 'Which endpoints does the system need?', G.api], ['data', '4. Model the data', '5 min', 'Which entities, keys and stores?', G.data], ['hld', '5. Draw the high-level design', '15 min', 'Build it on the canvas, and aim for a passing score.', null], ['deep', '6. Deep dives', '10 min', 'Pick the hardest parts and defend your trade-offs.', G.deep]];
        panes.interview.append(h('div', { class: 'controls flat', style: { marginBottom: '10px', alignItems: 'center' } }, ivClock, ivBtn, ui.btn('Reset timer', () => { ivLeft = 45 * 60; ivOn = false; ivClock.textContent = '45:00'; ivBtn.textContent = 'Start 45-minute session'; }), ui.btn('Finish session', () => { if (ivLeft < 45 * 60) { ctx.mission('iv'); RT.toast(`Session finished in ${Math.ceil((45 * 60 - ivLeft) / 60)} min, grade ${grade.letter}`); ivOn = false; } else RT.toast('Start the timer first'); }, { id: 'iv-finish' })));
        panes.interview.append(h('div', { class: 'twocol' }, sections.map(([k, title, mins, prompt, answer]) => {
          const reveal = answer && h('ul', { class: 'small hide', style: { margin: '6px 0 0', paddingLeft: '17px' } }, answer.map((t) => h('li', null, t)));
          const ta = h('textarea', { id: 'iv-' + nk + '-' + k, rows: 3, 'aria-label': title + ' notes', placeholder: 'Your notes', oninput() { notes[k] = ta.value; save('roundtrip.studio', prefs); } });
          ta.value = notes[k] || '';
          return ui.card(`${title} · ${mins}`, h('p', { class: 'small', style: { marginBottom: '6px' } }, prompt), k === 'hld' ? null : ta, reveal && h('div', { style: { marginTop: '6px' } }, ui.btn('Reveal model answer', () => reveal.classList.toggle('hide'), {})), reveal);
        })));
      }
      function drawShare() {
        panes.share.textContent = '';
        const box = h('textarea', { id: 'st-json', rows: 6, 'aria-label': 'Design as JSON', spellcheck: 'false' });
        box.value = JSON.stringify({ brief: brief.id, stage, design });
        const msg = h('p', { class: 'small muted', role: 'status' }, 'Designs save automatically in this browser, per brief and stage. Copy this text to back one up or share it.');
        panes.share.append(ui.card('Design as text', box, h('div', { class: 'controls flat', style: { marginTop: '8px' } },
          ui.btn('Copy', () => { navigator.clipboard.writeText(box.value).then(() => { msg.textContent = 'Copied.'; }, () => { box.select(); msg.textContent = 'Select the text and copy it by hand.'; }); }, { id: 'st-copy' }),
          ui.btn('Load from text', () => {
            try {
              const o = JSON.parse(box.value), raw = o.design || o;
              if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error('shape');
              const dsg = safe(raw), gone = raw.nodes.length + raw.edges.length - (dsg.nodes.length - (raw.nodes.some((n) => n && n.type === 'users') ? 0 : 1)) - dsg.edges.length;
              dz.change(() => { design = dsg; });
              RT.toast(gone ? say(`Loaded. ${gone} impossible part${gone > 1 ? 's were' : ' was'} removed.`, `লোড হয়েছে। ${gone}টি অসম্ভব অংশ বাদ গেছে।`) : say('Loaded onto the canvas.', 'ক্যানভাসে লোড হয়েছে।'));
            } catch { msg.textContent = 'That text is not a saved design, so nothing changed.'; }
          }, { id: 'st-load' })), msg));
      }
      function buildModel() {
        const rows = [
          [say('Throughput', 'থ্রুপুট'), say('The tightest tier sets it. Tiers behind a bottleneck only see what gets through, so fixing one can reveal the next.', 'সবচেয়ে সংকীর্ণ টিয়ার এটি ঠিক করে। বাধার পেছনের টিয়ার শুধু যা পার হয় তাই দেখে, তাই একটি ঠিক করলে পরেরটি দেখা দিতে পারে।')],
          [say('Latency', 'ল্যাটেন্সি'), say('p95 adds each tier on the slowest path that more than 5% of requests take, plus the network. Queueing depends on pool size, so one busy server queues long before a hundred do.', 'p95 যোগ করে ৫%-এর বেশি অনুরোধ যে ধীর পথ নেয় তার প্রতিটি টিয়ার, সঙ্গে নেটওয়ার্ক। লাইন পুলের আকারের ওপর নির্ভর করে, তাই একশোটির অনেক আগেই একটি ব্যস্ত সার্ভারে লাইন হয়।')],
          [say('Overload', 'অতিরিক্ত চাপ'), say(`When over 5% of a kind of request fails, its p95 is the ${D.TIMEOUT_MS / 1000}-second client timeout.`, `কোনো ধরনের ৫%-এর বেশি অনুরোধ ব্যর্থ হলে তার p95 হয় ${D.TIMEOUT_MS / 1000} সেকেন্ডের ক্লায়েন্ট টাইমআউট।`)],
          [say('Regions', 'রিজিয়ন'), say('Each region is a full paid stack. It adds capacity for stateless work and reads, but every copy applies every write. Writes to a single SQL primary travel to its region.', 'প্রতিটি রিজিয়ন একটি পুরো স্ট্যাক। এটি স্টেটলেস কাজ ও রিডে ক্ষমতা বাড়ায়, কিন্তু প্রতিটি কপি সব রাইট প্রয়োগ করে। একক SQL প্রাইমারিতে রাইট তার রিজিয়নেই যায়।')],
          [say('Replicas', 'রেপ্লিকা'), say('They add read capacity, minus the work of replaying writes. They never add write capacity. Losing the primary costs one replica.', 'এরা রিড ক্ষমতা বাড়ায়, রাইট পুনরায় চালানোর কাজ বাদে। রাইট ক্ষমতা কখনও বাড়ায় না। প্রাইমারি হারালে একটি রেপ্লিকা কমে।')],
          [say('Auto-scaling', 'অটো-স্কেলিং'), say('New servers take minutes, so a sudden spike can only double a tier. Sustained load can grow it up to 10×, and you pay for what runs.', 'নতুন সার্ভারে মিনিট লাগে, তাই হঠাৎ স্পাইকে টিয়ার কেবল দ্বিগুণ হয়। টানা চাপে ১০ গুণ পর্যন্ত বাড়ে, আর যা চলে তার দাম দিতে হয়।')],
          [say('Connections', 'সংযোগ'), say('Calling a store from a browser is not possible, so those links do not exist. WebSocket servers hand messages to what follows them, and workers keep caches and indexes updated. The sender does not wait for that work.', 'ব্রাউজার থেকে স্টোরে কল করা যায় না, তাই সেই সংযোগ নেই। ওয়েবসকেট সার্ভার বার্তা পরের কম্পোনেন্টে পাঠায়, আর ওয়ার্কার ক্যাশ ও ইনডেক্স হালনাগাদ রাখে। প্রেরক সেই কাজের অপেক্ষা করে না।')],
          [say('Cost', 'খরচ'), say('Instances, storage, CDN and data sent to users, at round list prices. Data coming in is free.', 'ইনস্ট্যান্স, স্টোরেজ, CDN ও ব্যবহারকারীদের পাঠানো ডেটা, গোল তালিকা-দামে। ভেতরে আসা ডেটা বিনামূল্যে।')],
        ];
        panes.model.textContent = '';
        panes.model.append(ui.card(say('How the numbers work', 'সংখ্যাগুলো কীভাবে আসে'), h('p', { class: 'small', style: { marginBottom: '6px' } }, say('This is a capacity model. It solves a steady state, so it does not replay individual requests. Use it to compare designs and find limits. Capacities and prices are round teaching figures, not measurements, so load test real systems before you trust a number.', 'এটি একটি ক্ষমতা মডেল। এটি স্থির অবস্থা হিসাব করে, প্রতিটি অনুরোধ আলাদা করে চালায় না। ডিজাইন তুলনা ও সীমা খুঁজতে ব্যবহার করুন। ক্ষমতা ও দাম শেখার জন্য গোল সংখ্যা, পরিমাপ নয়, তাই কোনো সংখ্যায় ভরসার আগে আসল সিস্টেমে লোড টেস্ট করুন।')), h('table', { class: 'table cheat' }, rows.map(([a, b]) => h('tr', null, h('td', null, h('b', null, a)), h('td', null, b))))));
      }
      /* ---------- load test: change the brief's numbers and watch the design respond ---------- */
      const TIMES = [.1, .25, .5, 1, 2, 3, 5, 10, 20, 50, 100], SIZES = [.1, .5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
      const HITS = [0, .3, .5, .7, .8, .9, .95, .98], FANS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
      const kb = (v) => (v >= 1000 ? +(v / 1000).toFixed(1) + ' MB' : v + ' KB');
      const testLoad = () => { const { fail, ...load } = test.set; void fail; return load; };
      const testFaults = () => (test.set.fail ? { [test.set.fail]: true } : {});
      function runTest() {
        test.r = D.evaluate(design, brief, stage, { ...testFaults(), load: testLoad() });
        test.limit = D.breakPoint(design, brief, stage, testLoad(), testFaults());
      }
      function applyTest() { runTest(); dz.draw(); drawScore(); drawTraffic(); drawTest(); }
      function buildTest() {
        const b = D.demand(brief, stage), s = test.set = { scale: 1, readX: 1, writeX: 1, respKB: b.recordKB, writeKB: b.recordKB, where: b.global ? 'world' : 'country', maxHit: b.maxHit, fanout: b.fanout, fail: '' };
        const rates = [];
        const step = (id, key, label, list, show) => {
          const all = [...new Set([...list, s[key]])].sort((x, y) => x - y);
          return ui.slider({ id, label, min: 0, max: all.length - 1, value: all.indexOf(s[key]), fmt: (i) => show(all[i]), onInput(i) { s[key] = all[i]; rates.forEach((el) => { el.value = +el.input.value; }); applyTest(); } });
        };
        const all = step('lt-scale', 'scale', say('All traffic', 'সব ট্রাফিক'), TIMES, (x) => `×${x} · ${num((b.read + b.write + b.media + b.search + b.rt) * x)}/s`);
        const reads = step('lt-read', 'readX', say('Reads', 'রিড'), TIMES, (x) => `×${x} · ${num(b.read * s.scale * x)}/s`);
        const writes = step('lt-write', 'writeX', say('Writes', 'রাইট'), TIMES, (x) => `×${x} · ${num(b.write * s.scale * x)}/s`);
        rates.push(reads, writes);
        const where = ui.select({ id: 'lt-where', label: say('Where users are', 'ব্যবহারকারীরা কোথায়'), value: s.where, options: [['near', say('Close to the servers', 'সার্ভারের কাছে')], ['country', say('Same country', 'একই দেশে')], ['world', say('Around the world', 'সারা বিশ্বে')], ['far', say('Far from the servers', 'সার্ভার থেকে দূরে')]], onChange(v) { s.where = v; applyTest(); } });
        const fail = ui.select({ id: 'lt-fail', label: say('Also break', 'সঙ্গে ভাঙুন'), value: '', options: [['', say('Nothing', 'কিছুই না')], ...D.CHAOS.map(([id, name]) => [id, name])], onChange(v) { s.fail = v; applyTest(); } });
        testControls.textContent = '';
        testControls.append(all, reads, writes, step('lt-resp', 'respKB', say('Response size', 'উত্তরের আকার'), SIZES, kb), step('lt-wsize', 'writeKB', say('Write size', 'রাইটের আকার'), SIZES, kb), where,
          step('lt-hit', 'maxHit', say('Cacheable reads', 'ক্যাশযোগ্য রিড'), HITS, (v) => Math.round(v * 100) + '%'), step('lt-fan', 'fanout', say('Fan-out per write', 'প্রতি রাইটে ফ্যান-আউট'), FANS, (v) => '×' + v), fail);
      }
      function drawTestChart(r) {
        const x = Math.log10, runs = TIMES.map((t) => [x(t), D.evaluate(design, brief, stage, { ...testFaults(), load: { ...testLoad(), scale: t } })]);
        const line = (c) => runs.filter(([, n]) => n.classes[c] && n.classes[c].routed).map(([p, n]) => [p, n.classes[c].p95]);
        const goal = r.d.slo.read || 100, top = Math.max(goal * 2.5, ...['read', 'write'].flatMap((c) => (r.classes[c] && r.classes[c].routed ? [r.classes[c].p95 * 1.4] : [])));
        return RT.lineChart({ label: say('Response time as all traffic grows', 'সব ট্রাফিক বাড়লে উত্তরের সময়'), h: 220, x0: x(TIMES[0]), x1: x(100), y0: 0, y1: top, xLabel: say('All traffic, as a multiple of the brief', 'সব ট্রাফিক, ব্রিফের গুণ হিসেবে'), yLabel: say('p95 response', 'p95 উত্তর'),
          xTicks: [[-1, '×0.1'], [0, '×1'], [1, '×10'], [2, '×100']], yTicks: [[goal, fmtMs(goal)], [top, fmtMs(top)]],
          lines: [{ points: [[x(TIMES[0]), goal], [x(100), goal]], color: 'var(--muted)', dash: '5 5', width: 1.4 }, { points: line('read'), color: 'var(--req)' }, { points: line('write'), color: 'var(--ref)' }],
          dots: r.classes.read && r.classes.read.routed ? [[x(test.set.scale), Math.min(top, r.classes.read.p95)]] : [] });
      }
      function drawTest() {
        const off = hidden();
        testOn.input.disabled = off; testReset.classList.toggle('hide', !test.on || off); testFit.classList.toggle('hide', !test.on || off);
        testControls.classList.toggle('hide', !test.on || off);
        testNote.textContent = off ? say('Load tests open after you submit.', 'জমা দেওয়ার পর লোড টেস্ট খোলে।') : test.on ? say('The canvas, scores and Traffic by tier now show this load. Change your design while it runs. Auto-scaling tiers grow up to 10×, and cost more while they do. Regions are set on the Users box.', 'ক্যানভাস, স্কোর ও টিয়ার অনুযায়ী ট্রাফিক এখন এই চাপ দেখায়। চলার সময়ই ডিজাইন বদলান। অটো-স্কেলিং টিয়ার ১০ গুণ পর্যন্ত বাড়ে, তখন খরচও বাড়ে। রিজিয়ন ঠিক হয় Users বাক্সে।') : say('Change the traffic, reads, writes, sizes and user location, and watch this design respond. It does not affect your grade.', 'ট্রাফিক, রিড, রাইট, আকার ও ব্যবহারকারীর অবস্থান বদলান, দেখুন এই ডিজাইন কীভাবে সাড়া দেয়। এতে আপনার গ্রেড বদলায় না।');
        testOut.textContent = '';
        if (!test.on || off) return;
        const r = test.r, lim = test.limit, ok = D.holds(r), total = Object.values(r.classes).reduce((t, c) => t + c.rate, 0);
        const busy = Object.entries(r.nodes).filter(([id]) => id !== 'users').sort((x, y) => y[1].util - x[1].util)[0];
        const typeOf = (id) => TYPES[design.nodes.find((n) => n.id === id).type].label;
        const stats = ui.stats([['total', say('Requests/s', 'অনুরোধ/সে')], ['read', say('Reads/s', 'রিড/সে')], ['write', say('Writes/s', 'রাইট/সে')], ['succ', say('Requests succeeding', 'সফল অনুরোধ')], ['cost', say('Monthly cost', 'মাসিক খরচ')], ['limit', say('Breaks at', 'ভাঙে')]]);
        stats.set('total', num(total)); stats.set('read', num(r.d.read)); stats.set('write', num(r.d.write));
        stats.set('succ', (r.succ * 100).toFixed(r.succ > .999 ? 2 : 1) + '%', r.succ >= .999 ? 'good' : 'bad');
        stats.set('cost', money(r.cost), r.cost <= grade.limit ? 'good' : 'warn');
        const times = (v) => '×' + (v >= 10 ? Math.round(v) : v.toFixed(1));
        stats.set('limit', lim.scale === Infinity ? '∞' : lim.scale ? `${times(lim.scale)} · ${num(lim.total)}/s` : say('Not holding', 'টিকছে না'), lim.scale >= test.set.scale ? 'good' : 'bad');
        /* What stops the design, read from where the time really goes, so the advice fits the cause. */
        const cause = (why) => {
          if (why.kind === 'route') return [say('Connect Users through to something that can serve each kind of request.', 'প্রতিটি ধরনের অনুরোধ সেবা দিতে পারে এমন কিছুর সঙ্গে Users যুক্ত করুন।')];
          if (why.kind === 'backlog') return [say('The workers cannot keep up, so the queue grows without limit. Add workers.', 'ওয়ার্কার তাল রাখতে পারে না, তাই কিউ অসীমে বাড়ে। ওয়ার্কার যোগ করুন।')];
          if (why.kind === 'tier') return [h('b', null, typeOf(why.id)), say(`: ${Math.round(why.util * 100)}% of capacity. Add capacity there, or take load off that tier.`, `: ক্ষমতার ${Math.round(why.util * 100)}%। সেখানে ক্ষমতা বাড়ান, বা সেই টিয়ারের চাপ কমান।`)];
          const away = why.net > why.p95 * .5, over = why.p95 > why.limit * 1.02;
          return [h('b', null, D.CLASSES[why.cls]), away
            ? say(`${over ? ` take ${fmtMs(why.p95)} against a ${fmtMs(why.limit)} target` : ` reach their ${fmtMs(why.limit)} target`}, and ${fmtMs(why.net)} of that is the network. More servers will not help. Add a region on the Users box, or send less data.`, `${over ? ` ${fmtMs(why.p95)} নেয়, লক্ষ্য ${fmtMs(why.limit)}` : ` ${fmtMs(why.limit)} লক্ষ্যে পৌঁছায়`}, আর এর ${fmtMs(why.net)} নেটওয়ার্কে যায়। বেশি সার্ভারে লাভ হবে না। Users বাক্সে রিজিয়ন যোগ করুন, বা কম ডেটা পাঠান।`)
            : say(`${over ? ` take ${fmtMs(why.p95)} against a ${fmtMs(why.limit)} target` : ` reach their ${fmtMs(why.limit)} target`}, because requests spend too long inside the system. Busiest tier: `, `${over ? ` ${fmtMs(why.p95)} নেয়, লক্ষ্য ${fmtMs(why.limit)}` : ` ${fmtMs(why.limit)} লক্ষ্যে পৌঁছায়`}, কারণ অনুরোধ সিস্টেমের ভেতরে বেশি সময় নেয়। সবচেয়ে ব্যস্ত টিয়ার: `), !away && h('b', null, typeOf(why.id)), !away && ` ${Math.round(why.util * 100)}%.`];
        };
        const verdict = h('div', { class: 'banner ' + (ok ? 'ok' : 'bad'), role: 'status' });
        if (!ok) verdict.append(say('Failing at this load. ', 'এই চাপে ব্যর্থ হচ্ছে। '), ...cause(D.stopper(r)).filter(Boolean));
        else if (lim.why) verdict.append(say(`Holding. The next limit comes at ${times(lim.scale)} of the brief's traffic: `, `টিকে আছে। পরের সীমা ব্রিফের ট্রাফিকের ${times(lim.scale)}-এ: `), ...cause(lim.why).filter(Boolean));
        else verdict.append(say('Holding, with no limit found within 10,000× the brief.', 'টিকে আছে, ব্রিফের ১০,০০০ গুণের মধ্যে কোনো সীমা মেলেনি।'));
        const tiers = busy && h('p', { class: 'small', style: { margin: '6px 0' } }, say('Busiest tier now: ', 'এখন সবচেয়ে ব্যস্ত টিয়ার: '), h('b', null, typeOf(busy[0])), ` ${Number.isFinite(busy[1].util) ? Math.round(busy[1].util * 100) : 0}%`, r.transfer ? say(` · Extra data transfer: ${money(r.transfer)} a month`, ` · বাড়তি ডেটা ট্রান্সফার: মাসে ${money(r.transfer)}`) : '');
        const list = h('div', { class: 'findings' });
        D.review(design, brief, stage, r).filter((f) => f.sev !== 'info').slice(0, 4).forEach((f) => list.append(h('div', { class: 'finding ' + f.sev }, h('span', { class: 'sev' }, f.sev), h('div', null, h('p', null, f.text), h('p', { class: 'muted' }, f.fix)))));
        testOut.append(stats, verdict, tiers || '', h('div', { class: 'twocol' }, h('div', null, h('div', { class: 'stage' }, drawTestChart(r)), h('div', { class: 'key' }, h('i', { class: 'c-req' }), say('Reads', 'রিড'), h('i', { class: 'c-ref' }), say('Writes', 'রাইট'), h('span', null, say('Dashed: read target', 'ড্যাশ: রিডের লক্ষ্য')))), list));
        if (ok && test.set.scale >= 10) ctx.mission('load');
      }
      function awards() {
        const g = grade, key = brief.id + ':' + stage;
        if (g.score > (prefs.best[key] || 0)) { prefs.best[key] = g.score; save('roundtrip.studio', prefs); }
        if (!g.passed && g.score < 95) return;
        if (g.passed) {
          (prefs.passed = prefs.passed || {})[brief.id] = true; save('roundtrip.studio', prefs);
          ctx.mission('first'); if (stage >= 1) ctx.mission('growth'); if (stage >= 2) ctx.mission('hyper');
          const n = D.BRIEFS.filter((b) => prefs.passed[b.id]).length;
          if (n >= 3) ctx.mission('three'); if (n >= 8) ctx.mission('all');
        }
        if (g.score >= 95) ctx.mission('grade');
      }
      function refresh() {
        submitB.classList.toggle('hide', mode !== 'blind');
        grade = D.grade(design, brief, stage);
        if (fault) { const t = grade.tests.find((x) => x.id === fault.id); fault = t ? { id: t.id, r: t.result, name: t.name } : null; }
        incident.classList.toggle('hide', !fault);
        if (fault) incident.textContent = `Incident: ${fault.name}. The numbers and canvas show the system during this failure.`;
        if (test.on) runTest();
        drawHeader(); dz.draw(); drawScore(); drawReview(); drawChaos(); drawTraffic(); drawReference(); drawShare(); drawTest();
        if (hidden()) return;
        awards();
        if (grade.tests.length && grade.tests.every((t) => t.pass) && grade.r.checks.routes && grade.r.checks.capacity) ctx.mission('chaos');
      }
      buildModel();
      openSlot();
    },
  });
})();
