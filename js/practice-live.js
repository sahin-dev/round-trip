/* Live incident: the Studio's on-call simulator. It plays the design on the canvas through an evening,
   one simulated minute at a time, using js/practice-ops.js. The page's control dock drives it: Play,
   Next (one minute), Reset and speed. This panel only shows dashboards, the pager, the timeline,
   the runbook and, at the end, the postmortem. */
(function () {
  const { h, ui, fmtMs } = RT;
  const O = window.RTOps;
  const TICK = 450;
  const SEV = { page: ['PAGE', 'পেজ'], ticket: ['TICKET', 'টিকিট'], resolved: ['RESOLVED', 'সমাধান'] };
  const KIND = { event: 'k-req', page: 'k-bad', bad: 'k-bad', ticket: 'k-ref', resolved: 'k-res', ok: 'k-res', auto: 'k-cache', you: 'k-req' };

  /* host: design(), brief(), stage(), hidden(), redraw(), prefs, save(), mission(id) */
  RT.StudioLive = function (ctx, host) {
    const bn = () => RT.settings.lang === 'bn';
    const say = (en, b) => (bn() ? b : en);
    const L = (s) => O.pick(s, RT.settings.lang);
    const best = host.prefs.liveBest = host.prefs.liveBest || {};
    let scenario = O.SCENARIOS.some((x) => x.id === host.prefs.live) ? host.prefs.live : 'evening';
    let retry = host.prefs.liveRetry || '';
    let sim = null, auto = false, visible = false, snap = '', repaint = null, rep = null;

    const shape = (d) => JSON.stringify({ n: d.nodes.map(({ x, y, ...rest }) => { void x; void y; return rest; }), e: d.edges });
    const policy = () => retry || O.SCENARIOS.find((x) => x.id === scenario).retry || 'naive';
    const label = (sc) => `${L(sc.title)} · ${L(sc.level)}${best[sc.id] ? ' · ' + best[sc.id] : ''}`;
    const scSel = ui.select({ id: 'lv-scn', label: say('Incident', 'ঘটনা'), value: scenario, options: O.SCENARIOS.map((sc) => [sc.id, label(sc)]), onChange(v) { scenario = v; host.prefs.live = v; host.save(); restart(); } });
    const rtSel = ui.select({ id: 'lv-retry', label: say('When a request fails, clients', 'অনুরোধ ব্যর্থ হলে ক্লায়েন্ট'), value: policy(), options: O.POLICIES.map(([id, t]) => [id, L(t)]), onChange(v) { retry = v; host.prefs.liveRetry = v; host.save(); restart(); } });
    const finishB = ui.btn(say('Skip to the postmortem', 'সরাসরি পোস্টমর্টেমে যান'), () => { if (!sim) return; auto = false; sim.runAll(); finish(); }, { id: 'lv-finish', title: say('Work out the rest of the evening at once, with no more runbook actions', 'বাকি সন্ধ্যা একবারে হিসাব করুন, আর কোনো রানবুক পদক্ষেপ ছাড়া') });
    const story = h('div', { class: 'banner' }), watch = h('p', { class: 'small', style: { marginTop: '6px' } }), polNote = h('p', { class: 'small muted', style: { marginTop: '4px' } });
    const hint = h('p', { class: 'small muted', style: { marginTop: '6px' } });
    const tiles = h('div', { class: 'stats' }), charts = h('div', { class: 'twocol', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))' } });
    const runbook = h('div'), pager = h('div', { class: 'log', style: { maxHeight: '170px' } }), timeline = h('div', { class: 'log', style: { maxHeight: '260px' } });
    const reportBox = h('div'), off = h('p', { class: 'small muted hide' });
    const body = h('div', null,
      ui.card(say('Live incident', 'লাইভ ঘটনা'), h('div', { class: 'controls flat' }, scSel, rtSel, finishB), story, watch, polNote, hint),
      tiles, charts,
      h('div', { class: 'twocol' }, ui.card(say('Runbook', 'রানবুক'), runbook), h('div', null, ui.card(say('Pager', 'পেজার'), pager), ui.card(say('Timeline', 'সময়রেখা'), timeline))),
      reportBox);
    const el = h('div', null, off, body);

    function restart() {
      auto = false; rep = null;
      sim = O.create(host.design(), host.brief(), host.stage(), scenario, { retry: policy() });
      snap = shape(host.design());
      rtSel.value = policy();
      paint(); host.redraw(); if (repaint) repaint();
    }
    function advance() {
      if (!sim || sim.done) return;
      sim.step();
      if (sim.done) finish(); else { paint(); host.redraw(); }
      if (repaint) repaint();
    }
    ctx.every(TICK, () => { if (auto && visible && !ctx.clock.paused && sim && !sim.done) advance(); });

    const ORDER = ['S', 'A', 'B', 'C', 'D'];
    function finish() {
      auto = false; rep = sim.report();
      if (rep) {
        if (!best[scenario] || ORDER.indexOf(rep.grade) < ORDER.indexOf(best[scenario])) { best[scenario] = rep.grade; host.save(); }
        [...scSel.sel.options].forEach((o) => { o.textContent = label(O.SCENARIOS.find((x) => x.id === o.value)); });
        if (rep.pass) {
          host.mission('ops');
          if (rep.actions.length) host.mission('runbook');
          if (O.SCENARIOS.every((x) => best[x.id] && ORDER.indexOf(best[x.id]) <= 2)) host.mission('oncall');
        }
      }
      paint(); host.redraw(); if (repaint) repaint();
    }

    /* ---------- dashboards ---------- */
    const tile = (lbl, value, tone) => h('div', { class: 'stat ' + (tone || '') }, h('b', null, value), h('span', null, lbl));
    function drawTiles() {
      tiles.textContent = '';
      const sc = sim.sc, row = sim.row, b = host.brief(), slo = b.slo;
      tiles.append(tile(say('Time', 'সময়'), sim.clock(), sim.done ? '' : row && (row.err > sim.allowed || row.slow.length) ? 'bad' : 'good'));
      if (!row) { tiles.append(tile(say('Minutes in this shift', 'এই শিফটের মিনিট'), String(sc.len)), tile(say('Error budget for the month', 'মাসের এরর বাজেট'), Math.round(sim.budgetMin * 10) / 10 + say(' min', ' মিনিট'))); return; }
      tiles.append(tile(say('Requests/s', 'অনুরোধ/সে'), O.num(row.offered), row.amp > .3 ? 'warn' : ''),
        tile(say('Errors', 'ত্রুটি'), O.pct(row.err), row.err > sim.allowed ? 'bad' : 'good'));
      ['read', 'write', 'media', 'search', 'rt'].forEach((k) => { if (row.p95[k] === undefined) return; tiles.append(tile(`${L(O.CLS[k])} p95 (${say('target', 'লক্ষ্য')} ${slo[k]} ms)`, row.p95[k] >= D().TIMEOUT_MS ? say('Timing out', 'টাইমআউট') : fmtMs(row.p95[k]), row.p95[k] > slo[k] ? 'bad' : 'good')); });
      const apps = sim.base.nodes.filter((n) => n.type === 'app');
      if (apps.length) tiles.append(tile(say('App servers running', 'চলমান অ্যাপ সার্ভার'), String(apps.reduce((a, n) => a + row.fleet[n.id], 0))));
      if (row.hit !== null) tiles.append(tile(say('Cache hit rate', 'ক্যাশ হিট রেট'), O.pct(row.hit), row.hit < .5 ? 'bad' : row.hit < .8 ? 'warn' : ''));
      if (sim.base.nodes.some((n) => n.type === 'queue')) tiles.append(tile(say('Queue lag', 'কিউ পিছিয়ে'), row.lag ? Math.round(row.lag * 10) / 10 + say(' min', ' মিনিট') : say('None', 'নেই'), row.lag >= 5 ? 'bad' : row.lag > 0 ? 'warn' : 'good'));
      tiles.append(tile(say('Error budget used', 'এরর বাজেট খরচ'), O.pct(row.budget), row.budget > .05 ? 'bad' : row.budget > .02 ? 'warn' : 'good'),
        tile(say('Spending', 'খরচের হার'), O.money(row.cost / 720) + say('/h', '/ঘ')));
    }
    const D = () => window.RTDesign;
    function drawCharts() {
      charts.textContent = '';
      const S = sim.series, len = sim.len, sc = sim.sc, slo = host.brief().slo;
      const xt = []; for (let m = 0; m <= len; m += len > 120 ? 30 : 15) xt.push([m, O.hhmm(sc.start + m)]);
      const marks = sc.events.filter((e) => e.at !== undefined).map((e) => e.at);
      const chart = (title, y1, yTicks, lines, keys) => {
        const mk = marks.map((x) => ({ points: [[x, 0], [x, y1]], color: 'var(--muted)', dash: '3 4', width: 1.2 }));
        return ui.card(title, h('div', { class: 'stage' }, RT.lineChart({ label: title, h: 190, x0: 0, x1: len, y0: 0, y1, xTicks: xt, yTicks, lines: [...mk, ...lines] })), h('div', { class: 'key' }, keys.map(([c, t]) => [h('i', { class: c }), t])));
      };
      const pts = (f) => S.map((x) => [x.t, f(x)]);
      const peak = Math.max(1, ...S.map((x) => Math.max(x.offered, x.organic))) * 1.15;
      charts.append(chart(say('Traffic', 'ট্রাফিক'), peak, [[peak / 1.15, O.num(peak / 1.15) + '/s']], [{ points: pts((x) => x.organic), color: 'var(--muted)', dash: '5 4', width: 1.6 }, { points: pts((x) => x.offered), color: 'var(--req)' }, { points: pts((x) => x.served), color: 'var(--res)' }],
        [['c-mute', say('Real users', 'আসল ব্যবহারকারী')], ['c-req', say('Requests, with retries', 'রিট্রাইসহ অনুরোধ')], ['c-res', say('Served', 'সেবা পেয়েছে')]]));
      const eTop = Math.max(5, ...S.map((x) => x.err * 100)) * 1.1;
      charts.append(chart(say('Errors', 'ত্রুটি'), eTop, [[Math.round(eTop / 1.1), Math.round(eTop / 1.1) + '%']], [{ points: pts((x) => x.err * 100), color: 'var(--bad)' }], [['c-bad', say('Share of requests failing', 'ব্যর্থ অনুরোধের ভাগ')]]));
      const kinds = ['read', 'write'].filter((k) => S.some((x) => x.p95[k] !== undefined));
      const lTop = Math.max(...kinds.map((k) => slo[k] * 2.5), 100);
      const colors = { read: 'var(--req)', write: 'var(--ref)' };
      charts.append(chart(say('p95 response time', 'p95 উত্তরের সময়'), lTop, kinds.map((k) => [slo[k], fmtMs(slo[k])]),
        kinds.flatMap((k) => [{ points: [[0, slo[k]], [len, slo[k]]], color: colors[k], dash: '5 5', width: 1.1 }, { points: S.filter((x) => x.p95[k] !== undefined).map((x) => [x.t, Math.min(lTop, x.p95[k])]), color: colors[k] }]),
        [...kinds.map((k) => [k === 'read' ? 'c-req' : 'c-ref', L(O.CLS[k])]), ['c-mute', say('Dashed: targets', 'ড্যাশ: লক্ষ্য')]]));
      const ids = Object.keys((S[0] || { util: {} }).util).sort((a, b) => Math.max(...S.map((x) => x.util[b] || 0)) - Math.max(...S.map((x) => x.util[a] || 0))).slice(0, 3);
      const uTop = Math.min(3, Math.max(1.2, ...S.flatMap((x) => ids.map((id) => x.util[id] || 0))) * 1.1), tc = ['var(--req)', 'var(--ref)', 'var(--cache)'], kc = ['c-req', 'c-ref', 'c-cache'];
      charts.append(chart(say('Busiest tiers', 'সবচেয়ে ব্যস্ত টিয়ার'), uTop * 100, [[85, '85%'], [100, '100%']], [{ points: [[0, 100], [len, 100]], color: 'var(--bad)', dash: '5 5', width: 1.1 }, ...ids.map((id, i) => ({ points: pts((x) => Math.min(uTop, x.util[id] || 0) * 100), color: tc[i] }))],
        ids.map((id, i) => [kc[i], L(O.NAME[sim.byId[id].type])])));
    }
    function drawLogs() {
      const line = (x) => h('div', { class: KIND[x.kind] || '' }, `${O.hhmm(x.m)}  ${SEV[x.kind] ? SEV[x.kind][bn() ? 1 : 0] + ' · ' : ''}${L(x.text)}`);
      pager.textContent = ''; timeline.textContent = '';
      const alerts = sim.log.filter((x) => SEV[x.kind]);
      if (!alerts.length) pager.append(h('div', null, say('Quiet. Nobody has been paged.', 'শান্ত। কাউকে পেজ করা হয়নি।')));
      alerts.forEach((x) => pager.append(line(x)));
      if (!sim.log.length) timeline.append(h('div', null, say('Nothing has happened yet.', 'এখনও কিছু ঘটেনি।')));
      sim.log.forEach((x) => timeline.append(line(x)));
      pager.scrollTop = pager.scrollHeight; timeline.scrollTop = timeline.scrollHeight;
    }
    function drawRunbook() {
      runbook.textContent = '';
      runbook.append(h('p', { class: 'small muted', style: { marginBottom: '8px' } }, say('Fixes take time to work, as they do in production. Each one is logged in the timeline.', 'প্রোডাকশনের মতোই সমাধান কাজ করতে সময় নেয়। প্রতিটি সময়রেখায় লেখা থাকে।')));
      const tg = sim.targets();
      if (tg.length) {
        const sel = h('select', { id: 'lv-tier', 'aria-label': say('Tier to scale', 'যে টিয়ার স্কেল করবেন') }, tg.map((x) => h('option', { value: x.id }, L(x.label))));
        const what = h('p', { class: 'small muted' });
        const show = () => { const x = tg.find((y) => y.id === sel.value); what.textContent = x ? L(x.what) : ''; addB.disabled = !x || !x.ok; };
        sel.onchange = show;
        const addB = ui.btn(say('Add capacity', 'ক্ষমতা যোগ করুন'), () => { if (sim.act('scale', sel.value)) { paint(); if (repaint) repaint(); } }, { id: 'lv-scale' });
        runbook.append(h('div', { class: 'controls flat', style: { alignItems: 'center' } }, sel, addB), what);
        show();
      }
      sim.actions().forEach((a) => {
        const b = ui.btn(L(a.label), () => { if (sim.act(a.id)) { paint(); if (repaint) repaint(); } }, { id: 'lv-' + a.id, disabled: !a.ok });
        runbook.append(h('div', { style: { marginTop: '8px' } }, b, h('p', { class: 'small muted', style: { marginTop: '3px' } }, a.ok ? L(a.why) : L(a.no))));
      });
    }
    const actName = (a) => (a.id === 'scale' ? say('add ', 'যোগ: ') + L(O.NAME[sim.byId[a.arg].type]) : L((sim.actions().find((x) => x.id === a.id) || { label: a.id }).label));
    function drawReport() {
      reportBox.textContent = '';
      if (!rep) return;
      const sc = sim.sc, row = (k, v, tone) => h('tr', null, h('td', null, k), h('td', { class: tone || '' }, v));
      const t = (m) => O.hhmm(sc.start + m);
      const verdict = rep.pass ? say(`Grade ${rep.grade}. Customers barely noticed.`, `গ্রেড ${rep.grade}। গ্রাহকরা প্রায় টেরই পাননি।`) : say(`Grade ${rep.grade}. Customers felt this one.`, `গ্রেড ${rep.grade}। গ্রাহকরা এটি টের পেয়েছেন।`);
      const items = h('div', { class: 'findings' });
      if (!rep.items.length) items.append(h('p', { class: 'small good' }, say('The design review found nothing serious at the worst minute.', 'সবচেয়ে খারাপ মিনিটে ডিজাইন পর্যালোচনায় গুরুতর কিছু মেলেনি।')));
      rep.items.forEach((f) => items.append(h('div', { class: 'finding ' + f.sev }, h('span', { class: 'sev' }, f.sev), h('div', null, h('p', null, f.text), h('p', { class: 'muted' }, f.fix, ' ', f.lab && h('a', { href: '#' + f.lab }, say('Open the lab', 'ল্যাব খুলুন')))))));
      reportBox.append(ui.card(say('Postmortem: ', 'পোস্টমর্টেম: ') + L(sc.title),
        h('div', { class: 'banner ' + (rep.pass ? 'ok' : 'bad'), role: 'status', id: 'lv-verdict' }, verdict),
        h('div', { class: 'twocol', style: { marginTop: '8px' } },
          h('div', null, h('table', { class: 'table' },
            row(say('Error budget used', 'এরর বাজেট খরচ'), O.pct(rep.used) + say(' of the month', ' মাসের'), rep.used > .05 ? 'badtxt' : 'good'),
            row(say('Failed requests', 'ব্যর্থ অনুরোধ'), O.num(rep.failed)),
            row(say('Worst error rate', 'সর্বোচ্চ ত্রুটির হার'), O.pct(rep.worstErr)),
            row(say('Minutes outside the SLO', 'SLO-র বাইরে মিনিট'), String(rep.badMin)),
            row(say('First page', 'প্রথম পেজ'), rep.page ? say(`${t(rep.page.t)}, ${rep.ttd} min after it began`, `${t(rep.page.t)}, শুরুর ${rep.ttd} মিনিট পরে`) : say('Nobody was paged', 'কাউকে পেজ করা হয়নি')),
            row(say('Healthy again', 'আবার সুস্থ'), rep.recovered === null ? say('Not by the end of the shift', 'শিফট শেষেও নয়') : rep.badMin ? t(rep.recovered) : say('Never unhealthy', 'কখনও অসুস্থ হয়নি')),
            row(say('Your actions', 'আপনার পদক্ষেপ'), rep.actions.length ? rep.actions.map((a) => `${t(a.t)} ${actName(a)}`).join('; ') : say('None', 'কোনোটি নয়')),
            row(say('Spend for the shift', 'শিফটের খরচ'), O.money(rep.spend)))),
          h('div', null, h('h3', { class: 'small', style: { margin: '0 0 4px' } }, say('What happened', 'কী ঘটেছিল')), h('ul', { class: 'small', style: { margin: 0, paddingLeft: '17px' } }, rep.insights.map((x) => h('li', null, L(x)))))),
        h('h3', { class: 'small', style: { margin: '12px 0 4px' } }, say('Action items from the worst minute', 'সবচেয়ে খারাপ মিনিট থেকে করণীয়')), items,
        h('p', { class: 'small', style: { marginTop: '10px' } }, h('b', null, say('Lesson: ', 'শিক্ষা: ')), L(rep.lesson), ' ', h('a', { href: '#' + rep.lab }, say('Learn more', 'আরও জানুন'))),
        h('p', { class: 'small muted', style: { marginTop: '6px' } }, say('Grades: S spends under 0.5% of the monthly error budget with no bad minutes, A under 2%, B under 5%, C under 20%. A minute over a latency target counts as a quarter of a minute of errors.', 'গ্রেড: S মানে মাসিক এরর বাজেটের ০.৫%-এর কম, কোনো খারাপ মিনিট ছাড়া; A ২%-এর কম, B ৫%-এর কম, C ২০%-এর কম। ল্যাটেন্সি লক্ষ্যের ওপরে এক মিনিট মানে এক মিনিটের চার ভাগের এক ভাগ ত্রুটি।'))));
    }
    function paint() {
      const hide = host.hidden();
      off.classList.toggle('hide', !hide); body.classList.toggle('hide', hide);
      off.textContent = say('Live incidents open after you submit your design.', 'ডিজাইন জমা দেওয়ার পর লাইভ ঘটনা খোলে।');
      if (hide || !sim) return;
      const sc = sim.sc;
      story.textContent = L(sc.story);
      watch.textContent = ''; watch.append(h('b', null, say('Watch: ', 'লক্ষ্য রাখুন: ')), L(sc.watch));
      polNote.textContent = L(O.POLICIES.find((p) => p[0] === sim.retry)[2]);
      hint.textContent = sim.done ? say('The shift is over. Press Reset in the control bar to run it again, or change the design.', 'শিফট শেষ। আবার চালাতে কন্ট্রোল বারে রিসেট চাপুন, অথবা ডিজাইন বদলান।')
        : say('Press Play in the control bar at the top of the page. Next moves on one minute, and Speed sets how fast the evening passes. The canvas shows each minute as it happens. If you change the design, the incident starts again with it.', 'পাতার ওপরের কন্ট্রোল বারে প্লে চাপুন। পরেরটি এক মিনিট এগোয়, আর গতি ঠিক করে সন্ধ্যা কত দ্রুত কাটবে। ক্যানভাস প্রতিটি মিনিট ঘটার সঙ্গে সঙ্গে দেখায়। ডিজাইন বদলালে ঘটনাটি নতুন ডিজাইন নিয়ে আবার শুরু হয়।');
      finishB.disabled = sim.done;
      drawTiles(); drawCharts(); drawLogs(); drawRunbook(); drawReport();
    }

    /* What the control dock does while this panel is open. */
    const target = {
      name: say('Incident', 'ঘটনা'), ticks: true,
      playing: () => auto && !ctx.clock.paused,
      ended: () => !!(sim && sim.done),
      toggle() { if (!sim) return; if (sim.done) { restart(); auto = true; ctx.clock.play(); return; } if (!auto) { auto = true; ctx.clock.play(); } else ctx.clock.toggle(); },
      next() { if (!sim || sim.done) return; auto = false; ctx.clock.play(); advance(); },
      reset() { restart(); },
      canBack: () => false,
      backTitle: say('An incident only runs forward. Reset starts it again.', 'ঘটনা শুধু সামনে চলে। রিসেট আবার শুরু করে।'),
      canNext: () => !!(sim && !sim.done),
      nextTitle: () => say('Move on one minute (→)', 'এক মিনিট এগিয়ে যান (→)'),
      status: () => (!sim ? '' : sim.done ? say('Shift over · grade ', 'শিফট শেষ · গ্রেড ') + (rep ? rep.grade : '') : `${sim.clock()} · ${say('minute', 'মিনিট')} ${sim.t} / ${sim.len}${auto && !ctx.clock.paused ? '' : say(' · paused', ' · থেমে আছে')}`),
      suspend() { const was = auto && !ctx.clock.paused; auto = false; return was; },
      resume() { auto = true; ctx.clock.play(); },
      on(fn) { repaint = fn; const offC = ctx.clock.on(fn); return () => { repaint = null; offC(); }; },
    };

    return {
      el,
      show() { visible = true; if (!sim) restart(); else paint(); ctx.useDock(host.hidden() ? null : target); },
      hide() { visible = false; ctx.useDock(null); },
      /* The design changed: start the incident again with it, since the old run no longer describes it. */
      sync() {
        if (sim && shape(host.design()) !== snap) { const was = sim.t > 0; restart(); if (was && visible) RT.toast(say('The design changed, so the incident starts again with it.', 'ডিজাইন বদলেছে, তাই ঘটনাটি নতুন ডিজাইন নিয়ে আবার শুরু হচ্ছে।')); return; }
        if (visible) { paint(); ctx.useDock(host.hidden() ? null : target); }
      },
      /* While a run is under way, the canvas and score tiles show its current minute. */
      result: () => (visible && sim && sim.t > 0 && !host.hidden() ? sim.r : null),
      clock: () => (sim ? sim.clock() : ''),
      healthy: () => !!(sim && sim.row && sim.row.err <= sim.allowed && !sim.row.slow.length),
    };
  };
})();
