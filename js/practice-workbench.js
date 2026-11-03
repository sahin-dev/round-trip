/* Component Workbench: size one component at a time against a concrete goal. */
(function () {
  const { h, s, ui, seeded, hash } = RT;
  const svgChart = (label, minW) => { const el = s('svg', { viewBox: '0 0 760 210', role: 'img', 'aria-label': label }); el.style.cssText = `width:100%;min-width:${minW || 520}px;display:block`; return el; };
  const goalBox = () => { const el = h('div', { class: 'banner', role: 'status' }); el.set = (ok, text) => { el.className = 'banner ' + (ok ? 'ok' : 'warn'); el.textContent = text; }; return el; };
  function axes(svg, H, x0, topLabel) {
    svg.append(s('line', { class: 'lnk', x1: x0, x2: 752, y1: H, y2: H }), s('line', { class: 'lnk', x1: x0, x2: x0, y1: 10, y2: H }), s('text', { class: 'dim', x: 2, y: 18 }, topLabel), s('text', { class: 'dim', x: x0 - 12, y: H + 3 }, '0'));
  }
  const line = (pts, color, w) => s('polyline', { fill: 'none', stroke: color, 'stroke-width': w || 2, points: pts.join(' ') });

  /* ----- Rate limiter ----- */
  function limiterTab(root, ctx) {
    const algo = ui.seg('Algorithm', [['fixed', 'Fixed window'], ['sliding', 'Sliding window'], ['token', 'Token bucket']], 'fixed', run);
    const limit = ui.slider({ id: 'wb-lim', label: 'Limit per 10 s', min: 10, max: 200, step: 5, value: 100, onInput: run });
    const burst = ui.slider({ id: 'wb-burst', label: 'Bucket size', min: 5, max: 200, step: 5, value: 50, onInput: run });
    const pattern = ui.seg('Traffic', [['edge', 'Attack at window edge'], ['burst', 'Short human burst'], ['steady', 'Steady overuse']], 'edge', run);
    const svg = svgChart('Requests allowed and blocked per second');
    const stats = ui.stats([['peak', 'Worst 10 s let through', ''], ['ok', 'Legitimate burst allowed', ''], ['mem', 'Memory per client', '']]);
    const goal = goalBox();
    root.append(h('p', { class: 'small' }, 'Goal: allow no more than 110% of the limit in any 10 seconds, and still let a short human burst through.'), h('div', { class: 'controls' }, ui.field('Algorithm', algo), ui.field('Traffic', pattern), limit, burst), goal, h('div', { class: 'stage' }, svg), stats);
    function traffic(kind) {
      const a = new Array(40).fill(0);
      if (kind === 'edge') { for (let t = 7; t < 10; t++) a[t] = 45; for (let t = 10; t < 13; t++) a[t] = 45; }
      else if (kind === 'burst') { a[4] = 30; a[5] = 25; a[20] = 25; for (let t = 0; t < 40; t++) a[t] += 2; }
      else a.fill(25);
      return a;
    }
    function apply(name, reqs, lim, cap) {
      const pass = new Array(reqs.length).fill(0); let tokens = cap;
      const rate = lim / 10;
      reqs.forEach((n, t) => {
        if (name === 'token') { tokens = Math.min(cap, tokens + rate); pass[t] = Math.min(n, Math.floor(tokens)); tokens -= pass[t]; }
        else if (name === 'fixed') { const w = Math.floor(t / 10), used = pass.slice(w * 10, t).reduce((a, b) => a + b, 0); pass[t] = Math.min(n, Math.max(0, lim - used)); }
        else { const used = pass.slice(Math.max(0, t - 9), t).reduce((a, b) => a + b, 0); pass[t] = Math.min(n, Math.max(0, lim - used)); }
      });
      return pass;
    }
    const worst = (p) => { let m = 0; for (let t = 0; t + 10 <= p.length; t++) m = Math.max(m, p.slice(t, t + 10).reduce((a, b) => a + b, 0)); return m; };
    function run() {
      const lim = limit.value, cap = burst.value, reqs = traffic(pattern.value), pass = apply(algo.value, reqs, lim, cap);
      const H = 182, x0 = 34, bw = (752 - x0) / reqs.length, top = Math.max(...reqs, 10) * 1.15, y = (v) => H - (v / top) * (H - 14);
      svg.textContent = ''; axes(svg, H, x0, Math.round(top) + '/s');
      reqs.forEach((v, t) => { svg.append(s('rect', { x: x0 + t * bw + 1, y: y(v), width: bw - 2, height: H - y(v), fill: 'var(--bad-soft)' }), s('rect', { x: x0 + t * bw + 1, y: y(pass[t]), width: bw - 2, height: H - y(pass[t]), fill: 'var(--accent)' })); if (t % 10 === 0) svg.append(s('text', { class: 'dim', x: x0 + t * bw, y: H + 14 }, t + ' s')); });
      const w = worst(pass), legit = traffic('burst'), lp = apply(algo.value, legit, lim, cap), burstOk = lp.slice(4, 6).reduce((a, b) => a + b, 0) / 55;
      stats.set('peak', w + ' req', w > lim * 1.1 ? 'bad' : 'good'); stats.set('ok', Math.round(burstOk * 100) + '%', burstOk >= .9 ? 'good' : 'warn');
      stats.set('mem', { fixed: '1 counter', sliding: 'a log of timestamps', token: '2 numbers' }[algo.value]);
      const edgeW = worst(apply(algo.value, traffic('edge'), lim, cap)), good = edgeW <= lim * 1.1 && burstOk >= .9;
      goal.set(good, good ? `Goal met with ${algo.value === 'token' ? 'a token bucket' : 'a sliding window'}. Bursts pass, and the edge attack does not.` : edgeW > lim * 1.1 ? `An attacker gets ${edgeW} requests through in 10 seconds by straddling a window edge. That is ${Math.round(edgeW / lim * 100)}% of the limit.` : 'Attacks are stopped, but real users are being throttled. Allow a larger burst.');
      if (good) ctx.mission('limiter');
    }
    run();
  }

  /* ----- Cache sizing with a real LRU simulation ----- */
  function cacheTab(root, ctx) {
    const skew = ui.slider({ id: 'wb-sk', label: 'Traffic skew (Zipf)', min: .4, max: 1.4, step: .1, value: 1, onInput: run });
    const mem = ui.slider({ id: 'wb-mem', label: 'Cache memory', min: 1, max: 64, value: 2, fmt: (v) => v + ' GB', onInput: run });
    const obj = ui.slider({ id: 'wb-obj', label: 'Object size', min: 1, max: 50, value: 10, fmt: (v) => v + ' KB', onInput: run });
    const reqs = ui.slider({ id: 'wb-req', label: 'Traffic', min: 5, max: 100, step: 5, value: 40, fmt: (v) => v + 'k reads/s', onInput: run });
    const svg = svgChart('Hit rate as cache size grows');
    const stats = ui.stats([['hit', 'Hit rate (simulated)', ''], ['db', 'Reads reaching the database', ''], ['cost', 'Memory cost', '']]);
    const goal = goalBox();
    const DB_LIMIT = 3000;
    root.append(h('p', { class: 'small' }, `Goal: keep database reads below ${DB_LIMIT.toLocaleString()}/s with the least memory. This replays 100,000 requests through a real LRU cache, over a scaled-down catalogue of 10,000 objects.`), h('div', { class: 'controls' }, reqs, skew, mem, obj), goal, h('div', { class: 'stage' }, svg), stats);
    function sampler(alpha) {
      const N = 10000, cdf = new Float64Array(N); let t = 0;
      for (let i = 0; i < N; i++) { t += 1 / Math.pow(i + 1, alpha); cdf[i] = t; }
      return (r) => { let x = r * t, lo = 0, hi = N - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < x) lo = m + 1; else hi = m; } return lo; };
    }
    function lruHit(sample, items) {
      const rnd = seeded(9), m = new Map(); let hits = 0;
      const n = 100000, warm = 40000;
      for (let i = 0; i < n; i++) {
        const k = sample(rnd());
        if (m.has(k)) { m.delete(k); if (i >= warm) hits++; }
        m.set(k, 1);
        if (m.size > items) m.delete(m.keys().next().value);
      }
      return hits / (n - warm);
    }
    function run() {
      const sample = sampler(skew.value), itemsPerGB = 10000 / obj.value, sizes = [1, 2, 4, 8, 16, 32, 64];
      const scale = (gb) => Math.max(1, Math.round(gb * itemsPerGB));
      const curve = sizes.map((g) => lruHit(sample, scale(g))), hit = lruHit(sample, scale(mem.value));
      const H = 182, x0 = 34, X = (g) => x0 + (Math.log2(g) / 6) * (752 - x0), Y = (v) => H - v * (H - 14);
      svg.textContent = ''; axes(svg, H, x0, '100%');
      svg.append(line(sizes.map((g, i) => `${X(g)},${Y(curve[i])}`), 'var(--accent)'), s('circle', { cx: X(mem.value), cy: Y(hit), r: 6, fill: 'var(--ref)' }));
      sizes.forEach((g) => svg.append(s('text', { class: 'dim', x: X(g) - 10, y: H + 14 }, g + ' GB')));
      const dbR = reqs.value * 1000 * (1 - hit);
      stats.set('hit', (hit * 100).toFixed(1) + '%'); stats.set('db', Math.round(dbR).toLocaleString() + '/s', dbR <= DB_LIMIT ? 'good' : 'bad'); stats.set('cost', '$' + mem.value * 9 + '/mo');
      const need = sizes.find((g, i) => reqs.value * 1000 * (1 - curve[i]) <= DB_LIMIT);
      const good = dbR <= DB_LIMIT;
      goal.set(good, good ? `Goal met. ${need && need < mem.value ? `${need} GB would also do, for less money.` : 'This is close to the smallest size that works.'} Doubling memory gains less each time, so the curve flattens.` : `The database still gets ${Math.round(dbR).toLocaleString()} reads/s. ${need ? `About ${need} GB would do it.` : 'Memory alone cannot reach this at this skew, so scale the database or reduce traffic.'}`);
      if (good && (!need || mem.value <= need * 1.5)) ctx.mission('cache');
    }
    run();
  }

  /* ----- Shard planner ----- */
  function shardTab(root, ctx) {
    const writes = ui.slider({ id: 'wb-w', label: 'Peak writes', min: 1, max: 100, value: 20, fmt: (v) => v + 'k/s', onInput: run });
    const size = ui.slider({ id: 'wb-s', label: 'Data today', min: 1, max: 100, value: 12, fmt: (v) => v + ' TB', onInput: run });
    const grow = ui.slider({ id: 'wb-g', label: 'Growth per year', min: 10, max: 200, step: 10, value: 80, fmt: (v) => v + '%', onInput: run });
    const shards = ui.slider({ id: 'wb-n', label: 'Shards', min: 1, max: 64, value: 4, onInput: run });
    const key = ui.seg('Shard key', [['user', 'user_id (hashed)'], ['date', 'created_at'], ['country', 'country']], 'date', run);
    const bars = h('div', { style: { display: 'grid', gap: '4px' } });
    const stats = ui.stats([['w', 'Busiest shard writes', ''], ['s', 'Biggest shard in 3 years', ''], ['cost', 'Cost per month', '']]);
    const goal = goalBox();
    const CAPW = 4000, CAPTB = 4;
    root.append(h('p', { class: 'small' }, `Goal: every shard stays under ${CAPW.toLocaleString()} writes/s and ${CAPTB} TB three years from now, at the lowest cost.`), h('div', { class: 'controls' }, writes, size, grow, shards, ui.field('Shard key', key)), goal, ui.card('Write load by shard', bars), stats);
    function shareOf(k, n) {
      if (k === 'user') { const c = new Array(n).fill(0); for (let i = 0; i < 4000; i++) c[hash('u' + i) % n]++; return c.map((v) => v / 4000); }
      if (k === 'date') { const a = new Array(n).fill(.02 / Math.max(1, n - 1)); a[n - 1] = n > 1 ? .98 : 1; return a; }
      const w = [.34, .22, .14, .1, .07, .05, .04, .04]; const a = new Array(n).fill(0); w.forEach((v, i) => { a[i % n] += v; }); return a;
    }
    function run() {
      const n = shards.value, k = key.value, sh = shareOf(k, n), w = writes.value * 1000, data = size.value * Math.pow(1 + grow.value / 100, 3);
      const busiest = Math.max(...sh) * w, spread = k === 'date' ? 1 / n : Math.max(...sh), biggest = data * spread;
      bars.textContent = '';
      sh.slice(0, 16).forEach((v, i) => { const u = (v * w) / CAPW, b = ui.bar(u > 1 ? 'bad' : 'res'); b.set(u * 100); bars.append(h('div', { class: 'small mono' }, `shard ${i + 1}: ${Math.round(v * w).toLocaleString()}/s`, b)); });
      if (n > 16) bars.append(h('p', { class: 'small muted' }, `and ${n - 16} more`));
      stats.set('w', Math.round(busiest).toLocaleString() + '/s', busiest > CAPW ? 'bad' : 'good'); stats.set('s', biggest.toFixed(1) + ' TB', biggest > CAPTB ? 'bad' : 'good'); stats.set('cost', '$' + (n * 700).toLocaleString());
      const min = Math.max(Math.ceil(w / CAPW / .92), Math.ceil(data / CAPTB)), good = busiest <= CAPW && biggest <= CAPTB;
      goal.set(good, good ? `Goal met${n <= min + 1 ? ', close to the minimum.' : `. About ${min} shards would do, so you can save money.`}` : k === 'date' ? 'Date keys send every new write to the newest shard. That shard is hot, whatever the shard count.' : k === 'country' ? 'One country dominates, so its shard stays hot. Country keys cannot be split further.' : `Not enough yet. The numbers need about ${min} shards.`);
      if (good && k === 'user') ctx.mission('shard');
    }
    run();
  }

  /* ----- Queue and consumers ----- */
  function queueTab(root, ctx) {
    const prod = ui.slider({ id: 'wb-p', label: 'Producer peak', min: 1, max: 30, value: 12, fmt: (v) => v + 'k msg/s', onInput: run });
    const cons = ui.slider({ id: 'wb-c', label: 'Consumers', min: 1, max: 40, value: 8, onInput: run });
    const rate = ui.slider({ id: 'wb-r', label: 'Each consumer', min: 100, max: 2000, step: 100, value: 800, fmt: (v) => v + ' msg/s', onInput: run });
    const part = ui.slider({ id: 'wb-pt', label: 'Partitions', min: 1, max: 40, value: 6, onInput: run });
    const svg = svgChart('Queue backlog over one hour');
    const stats = ui.stats([['max', 'Peak backlog', ''], ['drain', 'Drained after peak in', ''], ['eff', 'Consumers doing work', ''], ['cost', 'Consumers cost', '']]);
    const goal = goalBox();
    root.append(h('p', { class: 'small' }, 'Goal: a 20-minute traffic peak must drain within 5 minutes of ending, without paying for many more consumers than that takes.'), h('div', { class: 'controls' }, prod, cons, rate, part), goal, h('div', { class: 'stage' }, svg), stats);
    function run() {
      const active = Math.min(cons.value, part.value), out = active * rate.value, pk = prod.value * 1000, base = pk * .25, M = 60;
      const sim = (o) => {
        const ser = []; let q = 0, top = 0, done = null;
        for (let m = 0; m < M; m++) {
          const inRate = m >= 15 && m < 35 ? pk : base;
          q = Math.max(0, q + (inRate - o) * 60); ser.push(q); top = Math.max(top, q);
          if (m >= 35 && q === 0 && done == null) done = m - 34;
        }
        return { ser, top, done };
      };
      const { ser: series, top: maxQ, done: drained } = sim(out);
      const H = 182, x0 = 34, top = Math.max(maxQ, 1) * 1.1, X = (m) => x0 + (m / (M - 1)) * (752 - x0), Y = (v) => H - (v / top) * (H - 14);
      svg.textContent = ''; axes(svg, H, x0, (top / 1e6).toFixed(1) + 'M msgs');
      svg.append(s('rect', { x: X(15), y: 10, width: X(35) - X(15), height: H - 10, fill: 'var(--ref-soft)' }), s('text', { class: 'dim', x: X(15) + 6, y: 24 }, 'peak'), line(series.map((v, m) => `${X(m)},${Y(v)}`), 'var(--accent)'));
      stats.set('max', maxQ >= 1e6 ? (maxQ / 1e6).toFixed(1) + 'M' : Math.round(maxQ).toLocaleString(), maxQ ? 'warn' : 'good');
      stats.set('drain', drained == null ? 'Never' : drained <= 1 ? 'Instantly' : drained + ' min', drained != null && drained <= 5 ? 'good' : 'bad');
      stats.set('eff', `${active} of ${cons.value}`, cons.value > part.value ? 'warn' : ''); stats.set('cost', '$' + cons.value * 100 + '/mo');
      let need = 1; while (need < 400) { const t = sim(need * rate.value).done; if (t != null && t <= 5) break; need++; }
      const good = drained != null && drained <= 5 && cons.value <= part.value;
      goal.set(good, good ? 'Goal met. The queue absorbs the peak, and consumers catch up soon after.' : cons.value > part.value ? `${cons.value - part.value} consumers sit idle, because a partition goes to one consumer in a group. Add partitions.` : drained == null ? `Consumers handle ${out.toLocaleString()} msg/s, which never clears the backlog. It takes ${need} consumers to meet the goal.` : `The backlog takes ${drained} minutes to clear. It takes ${need} consumers to meet the goal.`);
      if (good) ctx.mission('queue');
    }
    run();
  }

  /* ----- Autoscaler ----- */
  function scaleTab(root, ctx) {
    const min = ui.slider({ id: 'wb-amin', label: 'Minimum servers', min: 1, max: 30, value: 4, onInput: run });
    const th = ui.slider({ id: 'wb-ath', label: 'Scale out above', min: 40, max: 95, step: 5, value: 90, fmt: (v) => v + '% CPU', onInput: run });
    const boot = ui.slider({ id: 'wb-abt', label: 'Server boot time', min: 1, max: 15, value: 6, fmt: (v) => v + ' min', onInput: run });
    const fixed = ui.toggle({ id: 'wb-afix', label: 'Compare: fixed fleet at peak size', onChange: run });
    const svg = svgChart('Capacity against demand over a day');
    const stats = ui.stats([['viol', 'Minutes over capacity', ''], ['cost', 'Server-hours per day', ''], ['peak', 'Largest fleet', '']]);
    const goal = goalBox();
    const CAP = 100;
    root.append(h('p', { class: 'small' }, 'Goal: fewer than 3 overloaded minutes across a day with a sudden evening spike, using at most 60% of a fixed fleet\'s server-hours.'), h('div', { class: 'controls' }, min, th, boot, fixed), goal, h('div', { class: 'stage' }, svg), stats);
    function run() {
      const load = []; for (let m = 0; m < 1440; m++) { const d = 800 + 700 * Math.sin(((m - 480) / 1440) * 2 * Math.PI); load.push(d + (m > 1140 && m < 1200 ? 1500 : 0)); }
      const peak = Math.max(...load), fleetMax = Math.ceil(peak / CAP);
      let n = min.value, pending = [], viol = 0, hours = 0, top = n; const caps = [];
      load.forEach((v, m) => {
        if (fixed.checked) n = fleetMax;
        else {
          pending = pending.filter((p) => { if (p <= m) { n++; return false; } return true; });
          const u = (v / (n * CAP)) * 100, want = Math.ceil(v / (CAP * (th.value / 100)));
          if (u > th.value && n + pending.length < want) { const add = want - n - pending.length; for (let i = 0; i < add; i++) pending.push(m + boot.value); }
          if (u < th.value * .5 && n > min.value && !pending.length && m % 5 === 0) n--;
        }
        if (v > n * CAP) viol++;
        hours += n / 60; top = Math.max(top, n); caps.push(n * CAP);
      });
      const H = 182, x0 = 34, tp = Math.max(peak, ...caps) * 1.1, X = (m) => x0 + (m / 1439) * (752 - x0), Y = (v) => H - (v / tp) * (H - 14), pick = (a) => a.filter((_, i) => i % 8 === 0).map((v, i) => `${X(i * 8)},${Y(v)}`);
      svg.textContent = ''; axes(svg, H, x0, Math.round(tp) + ' rps');
      svg.append(line(pick(load), 'var(--bad)'), line(pick(caps), 'var(--accent)', 2.4), s('text', { class: 'dim', x: 44, y: 22 }, 'red: demand   blue: capacity'));
      [0, 6, 12, 18].forEach((hh) => svg.append(s('text', { class: 'dim', x: X(hh * 60), y: H + 14 }, hh + ':00')));
      const fixedHours = fleetMax * 24, ratio = hours / fixedHours;
      stats.set('viol', viol + ' min', viol < 3 ? 'good' : 'bad'); stats.set('cost', Math.round(hours) + ' h (' + Math.round(ratio * 100) + '%)', ratio <= .6 ? 'good' : 'warn'); stats.set('peak', top + ' servers');
      const good = !fixed.checked && viol < 3 && ratio <= .6;
      goal.set(good, fixed.checked ? `A fixed fleet never overloads, but it pays for ${fleetMax} servers all day.` : good ? 'Goal met. The fleet reacts before users feel the spike, and it shrinks afterwards.' : viol >= 3 ? 'New servers arrive too late for the spike. Reducing boot time is usually the cheapest fix, for example with pre-built images or warm pools.' : 'It is safe, but too expensive. Raise the threshold or lower the minimum.');
      if (good) ctx.mission('scale');
    }
    run();
  }

  /* ----- Alert tuner ----- */
  function alertTab(root, ctx) {
    const thr = ui.slider({ id: 'wb-t', label: 'Alert at p95 above', min: 150, max: 700, step: 10, value: 260, fmt: (v) => v + ' ms', onInput: run });
    const win = ui.slider({ id: 'wb-win', label: 'For at least', min: 1, max: 15, value: 1, fmt: (v) => v + ' min', onInput: run });
    const svg = svgChart('Latency metric with alerts');
    const stats = ui.stats([['fa', 'False alarms', ''], ['caught', 'Incidents caught', ''], ['delay', 'Average time to detect', '']]);
    const goal = goalBox();
    const rnd = seeded(21), M = 480, series = [], INC = [[120, 150, 620], [300, 322, 420], [410, 430, 900]];
    for (let m = 0; m < M; m++) {
      let v = 170 + rnd() * 45; if (rnd() < .03) v += 120 + rnd() * 160;
      INC.forEach(([a, b, peak]) => { if (m >= a && m < b) v = peak * (.82 + rnd() * .3); });
      series.push(v);
    }
    root.append(h('p', { class: 'small' }, 'Goal: catch all three real incidents within 5 minutes, with no more than 2 false alarms. Shaded areas are incidents.'), h('div', { class: 'controls' }, thr, win), goal, h('div', { class: 'stage' }, svg), stats);
    function run() {
      const H = 182, x0 = 34, top = 1050, X = (m) => x0 + (m / (M - 1)) * (752 - x0), Y = (v) => H - (v / top) * (H - 14);
      svg.textContent = ''; axes(svg, H, x0, '1 s');
      INC.forEach(([a, b]) => svg.append(s('rect', { x: X(a), y: 10, width: X(b) - X(a), height: H - 10, fill: 'var(--ref-soft)' })));
      svg.append(line(series.map((v, m) => `${X(m)},${Y(v)}`), 'var(--accent)', 1.2), s('line', { x1: x0, x2: 752, y1: Y(thr.value), y2: Y(thr.value), stroke: 'var(--bad)', 'stroke-dasharray': '5 4', 'stroke-width': 1.4 }));
      let run_ = 0, fired = false, fa = 0; const det = INC.map(() => null);
      series.forEach((v, m) => {
        if (v > thr.value) run_++; else { run_ = 0; fired = false; }
        if (run_ >= win.value && !fired) {
          fired = true;
          const hit = INC.findIndex(([a, b]) => m >= a && m < b + 2);
          svg.append(s('circle', { cx: X(m), cy: Y(Math.min(v, 1000)), r: 4, fill: hit >= 0 ? 'var(--res)' : 'var(--bad)' }));
          if (hit >= 0) { if (det[hit] == null) det[hit] = m - INC[hit][0]; } else fa++;
        }
      });
      const caught = det.filter((d) => d != null), mean = caught.length ? caught.reduce((a, b) => a + b, 0) / caught.length : null, slow = caught.some((d) => d > 5);
      stats.set('fa', fa, fa <= 2 ? 'good' : 'bad'); stats.set('caught', `${caught.length} of 3`, caught.length === 3 ? 'good' : 'bad'); stats.set('delay', mean == null ? '–' : mean.toFixed(1) + ' min', mean != null && mean <= 5 ? 'good' : 'warn');
      const good = fa <= 2 && caught.length === 3 && !slow;
      goal.set(good, good ? 'Goal met. Requiring a sustained breach filters out spikes, and the threshold still sees real incidents.' : fa > 2 ? `${fa} false alarms in eight hours. That is how on-call engineers learn to ignore alerts. Require a longer breach.` : caught.length < 3 ? 'A real incident went unnoticed. Lower the threshold or the duration.' : 'Incidents are caught, but too slowly. Shorten the duration.');
      if (good) ctx.mission('alert');
    }
    run();
  }

  RT.lab({
    id: 'workbench', title: 'Component Workbench', short: 'Component Workbench', chapter: 'Practice',
    lede: 'Design one component at a time. Each bench gives you a real target, so you find the setting that meets it for the least money.',
    missions: [['limiter', 'Build a rate limiter that stops edge attacks and allows human bursts.'], ['cache', 'Size a cache to protect the database, without overspending.'], ['shard', 'Choose a shard key and count that last three years.'], ['queue', 'Size consumers so a traffic peak drains in 5 minutes.'], ['scale', 'Tune an autoscaler through a sudden spike.'], ['alert', 'Tune an alert that catches incidents and stays quiet otherwise.']],
    notes: `<ul><li>Sizing starts with the workload, not the tool.</li><li>Look for the knee of the curve: past it, spending more buys little.</li><li>Averages hide problems. Look at the busiest shard, the worst window and the peak.</li><li>A good alert needs both a threshold and a duration.</li></ul>`,
    check: { q: 'Doubling your cache from 8 GB to 16 GB raised the hit rate only from 91% to 93%. What does that suggest?', options: ['The cache is broken', 'You are past the knee of the curve, so the next problem is elsewhere', 'Use a bigger server', 'LRU is the wrong policy'], answer: 1, why: 'Skewed traffic means the hottest items fit early. After that, each extra gigabyte serves rarer and rarer keys.' },
    render(root, ctx) {
      const items = [['limiter', 'Rate limiter', limiterTab], ['cache', 'Cache size', cacheTab], ['shard', 'Shard plan', shardTab], ['queue', 'Queue consumers', queueTab], ['scale', 'Autoscaler', scaleTab], ['alert', 'Alerts', alertTab]];
      const panes = {}, made = {};
      const tabs = ui.tabs(items.map(([a, b]) => [a, b]), (v) => { items.forEach(([id, , fn]) => { panes[id].classList.toggle('hide', id !== v); if (id === v && !made[id]) { made[id] = true; fn(panes[id], ctx); } }); });
      root.append(tabs);
      items.forEach(([id]) => { panes[id] = h('div', { class: 'labmain hide' }); root.append(panes[id]); });
      tabs.set('limiter');
    },
  });
})();
