/* Labs for the intermediate topics, part 2: network metrics, delivery, streaming, ids, pagination,
   clocks and error budgets. */
(function () {
  const { h, s, ui } = RT;
  const M = window.RTModels;
  const say = (en, bn) => (RT.settings.lang === 'bn' ? bn : en);
  const banner = () => h('div', { class: 'banner', role: 'status' });
  const tell = (el, cls, text) => { el.className = 'banner ' + cls; el.textContent = text; };

  /* ---------- network metrics ---------- */
  RT.labRender.netmetrics = (root, ctx) => {
    const ms = (v) => (!isFinite(v) ? say('never', 'কখনোই না') : v >= 1000 ? (v / 1000).toFixed(1) + ' s' : v.toFixed(v < 10 ? 1 : 0) + ' ms');
    const mbps = (v) => (v >= 1000 ? +(v / 1000).toFixed(1) + ' Gbps' : +v.toFixed(v < 10 ? 2 : 0) + ' Mbps');
    const size = (kb) => (kb >= 1000 ? +(kb / 1000).toFixed(1) + ' MB' : kb + ' KB');
    const count = (v) => (!isFinite(v) ? '∞' : v < 10 ? String(+v.toFixed(1)) : Math.round(v).toLocaleString('en-US'));
    const money = (v) => '$' + (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2));
    /* A slider that steps through a list, for numbers that span several powers of ten. */
    const stepped = (id, label, list, start, show) => {
      const el = ui.slider({ id, label, min: 0, max: list.length - 1, value: list.indexOf(start), fmt: (i) => show(list[i]), onInput: draw });
      const near = (v) => list.reduce((b, x, i) => (Math.abs(x - v) < Math.abs(list[b] - v) ? i : b), 0);
      return { el, get: () => list[el.value], put(v) { el.value = near(v); } };
    };
    const BW = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    const bandwidth = stepped('nm-bw', say('Bandwidth', 'ব্যান্ডউইথ'), BW, 100, mbps);
    const rtt = ui.slider({ id: 'nm-rtt', label: say('Latency (round trip)', 'ল্যাটেন্সি (আসা-যাওয়া)'), min: 1, max: 600, value: 40, fmt: (v) => v + ' ms', onInput: draw });
    const loss = stepped('nm-loss', say('Packet loss', 'প্যাকেট লস'), [0, .01, .02, .05, .1, .2, .5, 1, 2, 5], 0, (v) => v + '%');
    const jitter = ui.slider({ id: 'nm-jit', label: say('Jitter', 'জিটার'), min: 0, max: 100, value: 5, fmt: (v) => v + ' ms', onInput: draw });
    const sizeKB = stepped('nm-size', say('Response size', 'উত্তরের আকার'), [2, 10, 50, 200, 1000, 5000, 25000, 100000], 50, size);
    const rps = stepped('nm-rps', say('Requests per second', 'প্রতি সেকেন্ডে অনুরোধ'), [.1, .5, 1, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000], 100, count);
    const windowKB = ui.select({ id: 'nm-win', label: say('TCP window', 'TCP উইন্ডো'), value: '1024', options: [['64', '64 KB'], ['1024', '1 MB'], ['16384', '16 MB']], onChange: draw });
    const reuse = ui.toggle({ id: 'nm-reuse', label: say('Reuse connections', 'সংযোগ পুনর্ব্যবহার'), checked: true, onChange: draw });
    const LINKS = { server: [100, 40, 0, 5, 100], phone: [20, 120, .5, 30, 5], wifi: [50, 30, 2, 40, 5], far: [1000, 150, 0, 5, 100], sat: [50, 600, 0, 40, 5], dc: [10000, 1, 0, 0, 100] };
    const link = ui.select({ id: 'nm-link', label: say('Try a real link', 'আসল লিংক দেখুন'), value: 'server', options: [['server', say('Small server link', 'ছোট সার্ভারের লিংক')], ['phone', say('4G on the move', 'চলন্ত 4G')], ['wifi', say('Crowded Wi-Fi', 'ভিড়ের ওয়াই-ফাই')], ['far', say('Fibre to another continent', 'অন্য মহাদেশে ফাইবার')], ['sat', say('Geostationary satellite', 'জিওস্টেশনারি স্যাটেলাইট')], ['dc', say('Inside a data centre', 'ডেটা সেন্টারের ভেতরে')]], onChange(v) { const [b, r, l, j, t] = LINKS[v]; bandwidth.put(b); rtt.value = r; loss.put(l); jitter.value = j; rps.put(t); draw(); } });

    const stats = ui.stats([['speed', say('Throughput per connection', 'সংযোগ প্রতি থ্রুপুট')], ['resp', say('Average response', 'গড় উত্তর')], ['p95', say('p95 response', 'p95 উত্তর')], ['rho', say('Link utilisation', 'লিংকের ব্যবহার')], ['bdp', say('Bandwidth-delay product', 'ব্যান্ডউইথ-ডিলে গুণফল')]]);
    const system = ui.stats([['ok', say('Requests served per second', 'সেকেন্ডে সেবা পাওয়া অনুরোধ')], ['fail', say('Requests failing', 'ব্যর্থ অনুরোধ')], ['open', say('Open connections', 'খোলা সংযোগ')], ['work', say('Workers needed', 'দরকারি ওয়ার্কার')], ['cost', say('Data bill per month', 'মাসিক ডেটা বিল')], ['call', say('Video call quality', 'ভিডিও কলের মান')]]);
    const say2 = banner(), chart = h('div', { class: 'stage' }), table = h('div'), sums = h('div');
    const axis = ui.seg(say('Change', 'বদলান'), [['bandwidth', say('Bandwidth', 'ব্যান্ডউইথ')], ['rtt', say('Latency', 'ল্যাটেন্সি')], ['loss', say('Packet loss', 'প্যাকেট লস')], ['jitter', say('Jitter', 'জিটার')]], 'bandwidth', draw);
    const OUT = { response: say('Average response', 'গড় উত্তর'), p95: say('p95 response', 'p95 উত্তর'), speed: say('Throughput', 'থ্রুপুট'), rho: say('Link utilisation', 'লিংকের ব্যবহার'), workers: say('Workers', 'ওয়ার্কার'), costMonth: say('Data bill', 'ডেটা বিল') };
    const out = ui.seg(say('Effect on', 'প্রভাব'), Object.entries(OUT), 'response', draw);
    root.append(h('div', { class: 'controls' }, link, bandwidth.el, rtt, loss.el, jitter), h('div', { class: 'controls' }, sizeKB.el, rps.el, windowKB, reuse), stats, system, say2,
      ui.card(say('What if you change one number?', 'একটি সংখ্যা বদলালে কী হবে?'), ui.field(say('Effect on', 'প্রভাব'), out), table, h('p', { class: 'small muted' }, say('Each row doubles or halves one number and keeps the rest as you set them.', 'প্রতি সারিতে একটি সংখ্যা দ্বিগুণ বা অর্ধেক হয়, বাকিগুলো আপনার মতোই থাকে।'))),
      ui.card(say('One number across its whole range', 'একটি সংখ্যা পুরো পরিসরে'), ui.field(say('Change', 'বদলান'), axis), chart, h('div', { class: 'key' }, h('i', { class: 'c-req' }), say('Average response', 'গড় উত্তর'), h('i', { class: 'c-ref' }), say('p95 response', 'p95 উত্তর'), h('span', null, say('A missing line means the link is overloaded there.', 'রেখা না থাকলে সেখানে লিংক ওভারলোড।')))),
      ui.card(say('The sums, with your numbers', 'আপনার সংখ্যায় হিসাব'), sums));

    const ROWS = [['bandwidth', say('Bandwidth', 'ব্যান্ডউইথ')], ['rtt', say('Latency', 'ল্যাটেন্সি')], ['loss', say('Packet loss', 'প্যাকেট লস')], ['jitter', say('Jitter', 'জিটার')], ['sizeKB', say('Response size', 'উত্তরের আকার')], ['rps', say('Traffic', 'ট্রাফিক')]];
    const SWEEP = {
      bandwidth: { log: true, list: Array.from({ length: 41 }, (_, i) => 10 ** (i / 10)), unit: say('Bandwidth (Mbps)', 'ব্যান্ডউইথ (Mbps)'), ticks: [[0, '1'], [1, '10'], [2, '100'], [3, '1k'], [4, '10k']] },
      rtt: { list: Array.from({ length: 61 }, (_, i) => 1 + i * 10), unit: say('Latency (ms)', 'ল্যাটেন্সি (ms)'), ticks: [[1, '1'], [200, '200'], [400, '400'], [600, '600']] },
      loss: { list: Array.from({ length: 51 }, (_, i) => i / 10), unit: say('Packet loss (%)', 'প্যাকেট লস (%)'), ticks: [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']] },
      jitter: { list: Array.from({ length: 21 }, (_, i) => i * 5), unit: say('Jitter (ms)', 'জিটার (ms)'), ticks: [[0, '0'], [50, '50'], [100, '100']] },
    };
    const settings = () => ({ bandwidth: bandwidth.get(), rtt: rtt.value, loss: loss.get(), jitter: jitter.value, sizeKB: sizeKB.get(), rps: rps.get(), windowKB: +windowKB.value, reuse: reuse.checked });

    function cell(now, key, factor, o) {
      const was = now[out.value], then = M.network({ ...o, [key]: o[key] * factor })[out.value];
      if (o[key] === 0) return h('td', { class: 'muted' }, '–');
      if (!isFinite(was) || !isFinite(then)) return !isFinite(was) && !isFinite(then) ? h('td', { class: 'badtxt' }, say('Still overloaded', 'এখনও ওভারলোড')) : isFinite(then) ? h('td', { class: 'good' }, say('Recovers', 'সেরে ওঠে')) : h('td', { class: 'badtxt' }, say('Overloads', 'ওভারলোড'));
      const change = was ? (then - was) / was : 0, better = out.value === 'speed' ? change > 0 : change < 0, flat = Math.abs(change) < .005;
      return h('td', { class: flat ? 'muted' : better ? 'good' : 'badtxt' }, flat ? say('No change', 'বদল নেই') : (change > 0 ? '+' : '−') + Math.abs(change * 100).toFixed(0) + '%');
    }
    function drawChart(o) {
      const sw = SWEEP[axis.value], x = (v) => (sw.log ? Math.log10(v) : v), cur = M.network(o);
      const runs = sw.list.map((v) => [x(v), M.network({ ...o, [axis.value]: v })]), line = (k) => runs.filter(([, n]) => isFinite(n[k])).map(([p, n]) => [p, n[k]]);
      const top = Math.max(100, isFinite(cur.p95) ? cur.p95 * 2.5 : Math.min(...line('p95').map(([, y]) => y), 5000) * 2.5);
      chart.textContent = '';
      chart.append(RT.lineChart({ label: say('Response time as one network number changes', 'একটি নেটওয়ার্ক সংখ্যা বদলালে উত্তরের সময়'), x0: x(sw.list[0]), x1: x(sw.list[sw.list.length - 1]), y0: 0, y1: top, xTicks: sw.ticks, xLabel: sw.unit, yTicks: [[top / 2, ms(top / 2)], [top, ms(top)]], yLabel: say('Response time', 'উত্তরের সময়'), lines: [{ points: line('response'), color: 'var(--req)' }, { points: line('p95'), color: 'var(--ref)' }], dots: isFinite(cur.response) ? [[x(o[axis.value]), cur.response]] : [] }));
    }
    function draw() {
      const o = settings(), n = M.network(o), over = n.rho >= 1;
      stats.set('speed', mbps(n.speed), n.limit === 'bandwidth' ? 'good' : 'warn');
      stats.set('resp', ms(n.response), over ? 'bad' : ''); stats.set('p95', ms(n.p95), over ? 'bad' : '');
      stats.set('rho', Math.round(n.rho * 100) + '%', over ? 'bad' : n.rho > .7 ? 'warn' : 'good'); stats.set('bdp', size(Math.round(n.bdpKB)), n.bdpKB > o.windowKB ? 'warn' : '');
      system.set('ok', count(n.delivered), over ? 'bad' : 'good'); system.set('fail', Math.round(n.failed * 100) + '%', over ? 'bad' : 'good'); system.set('open', count(n.inFlight), over ? 'bad' : ''); system.set('work', count(n.workers), over ? 'bad' : ''); system.set('cost', money(n.costMonth));
      system.set('call', { good: say('Good', 'ভালো'), fair: say('Fair', 'মোটামুটি'), poor: say('Poor', 'খারাপ') }[n.call], { good: 'good', fair: 'warn', poor: 'bad' }[n.call]);

      table.textContent = '';
      table.append(h('table', { class: 'table', id: 'nm-what' }, h('tr', null, h('th', null, say('Number', 'সংখ্যা')), h('th', null, say('Double it', 'দ্বিগুণ করুন')), h('th', null, say('Halve it', 'অর্ধেক করুন'))), ROWS.map(([key, name]) => h('tr', null, h('td', null, name), cell(n, key, 2, o), cell(n, key, .5, o)))));
      drawChart(o);

      const p = n.parts;
      const rows = (list) => h('table', { class: 'table' }, list.map(([label, value]) => h('tr', null, h('td', null, label), h('td', null, value))));
      sums.textContent = '';
      sums.append(h('p', { class: 'small' }, say('Three limits on one connection, and the lowest wins', 'এক সংযোগে তিন সীমা, সবচেয়ে নিচেরটিই জেতে')),
        rows([[say('Bandwidth', 'ব্যান্ডউইথ'), mbps(o.bandwidth)], [say('Window ÷ RTT', 'উইন্ডো ÷ RTT'), mbps(n.byWindow)], [say('Loss limit', 'লস সীমা'), isFinite(n.byLoss) ? mbps(n.byLoss) : say('none', 'নেই')]]),
        h('p', { class: 'small' }, say('Average response', 'গড় উত্তর') + ': ' + ms(n.response)),
        rows([[say('Handshakes', 'হ্যান্ডশেক'), ms(p.handshake)], [say('Request and first reply', 'অনুরোধ ও প্রথম উত্তর'), ms(p.request)], [say('Server work', 'সার্ভারের কাজ'), ms(p.server)], [say('Slow start', 'স্লো স্টার্ট'), ms(p.rampUp)], [say('Sending the rest', 'বাকিটা পাঠানো'), ms(p.send)], [say('Queue on the link', 'লিংকের লাইন'), ms(p.queue)]]),
        h('p', { class: 'small' }, `L = λ × W = ${count(o.rps)}/s × ${isFinite(n.response) ? (n.response / 1000).toFixed(3) + ' s' : '∞'} = ${count(n.inFlight)} ${say('open connections', 'খোলা সংযোগ')}`));

      const gain = (key, factor) => { const b = M.network({ ...o, [key]: o[key] * factor }).response; return isFinite(n.response) ? 1 - b / n.response : 0; };
      const bw2 = gain('bandwidth', 2), rtt2 = gain('rtt', .5);
      if (n.limit === 'window') ctx.mission('window');
      if (n.limit === 'loss') ctx.mission('loss');
      if (bw2 > .2 && bw2 > rtt2) ctx.mission('bw');
      const capped = n.parts.send > n.response * .25;
      if (over) { tell(say2, 'bad', say(`Traffic is ${count(o.rps)} a second and the link can serve ${count(n.capacity)}, so ${Math.round(n.failed * 100)}% fail. More bandwidth, smaller responses or a CDN will fix this. Lower latency will not.`, `ট্রাফিক সেকেন্ডে ${count(o.rps)}, লিংক সামলাতে পারে ${count(n.capacity)}, তাই ${Math.round(n.failed * 100)}% ব্যর্থ। বেশি ব্যান্ডউইথ, ছোট উত্তর বা CDN এটি ঠিক করবে। কম ল্যাটেন্সি করবে না।`)); ctx.mission('over'); }
      else if (capped && n.limit === 'window') tell(say2, 'warn', say(`The TCP window is the limit. Filling this link needs ${size(Math.round(n.bdpKB))} in flight, but the window allows ${size(o.windowKB)}, so speed stops at ${mbps(n.speed)}.`, `TCP উইন্ডোই সীমা। এই লিংক ভরতে ${size(Math.round(n.bdpKB))} পথে থাকা দরকার, কিন্তু উইন্ডো দেয় ${size(o.windowKB)}, তাই গতি ${mbps(n.speed)}-এ থামে।`));
      else if (capped && n.limit === 'loss') tell(say2, 'warn', say(`Packet loss is the limit. TCP treats each loss as congestion and slows down, so this ${mbps(o.bandwidth)} link gives one connection only ${mbps(n.speed)}.`, `প্যাকেট লসই সীমা। TCP প্রতিটি লসকে জট ধরে ধীর হয়, তাই এই ${mbps(o.bandwidth)} লিংক এক সংযোগকে দেয় মাত্র ${mbps(n.speed)}।`));
      else if (n.parts.server > n.response * .5) tell(say2, 'ok', say('The network is barely involved here. Most of this response is server work, so faster code will help more than a better link.', 'এখানে নেটওয়ার্কের ভূমিকা সামান্য। এই উত্তরের বেশিরভাগই সার্ভারের কাজ, তাই ভালো লিংকের চেয়ে দ্রুত কোড বেশি সাহায্য করবে।'));
      else if (bw2 > rtt2) tell(say2, 'ok', say('Bandwidth is what this transfer waits on. Doubling it helps more than halving latency.', 'এই স্থানান্তর ব্যান্ডউইথের অপেক্ষায়। ল্যাটেন্সি অর্ধেকের চেয়ে ব্যান্ডউইথ দ্বিগুণ বেশি কাজে দেয়।'));
      else tell(say2, 'ok', say(`Round trips are what this response waits on. Halving latency saves ${Math.round(rtt2 * 100)}%. Doubling bandwidth saves ${Math.round(bw2 * 100)}%.`, `এই উত্তর আসা-যাওয়ার অপেক্ষায়। ল্যাটেন্সি অর্ধেক করলে ${Math.round(rtt2 * 100)}% বাঁচে। ব্যান্ডউইথ দ্বিগুণে বাঁচে ${Math.round(bw2 * 100)}%।`));
    }
    draw();
  };

  /* ---------- delivery guarantees ---------- */
  RT.labRender.delivery = (root, ctx) => {
    let seed = 11;
    const mode = ui.seg(say('Guarantee', 'নিশ্চয়তা'), [['atmost', say('At most once', 'সর্বোচ্চ একবার')], ['atleast', say('At least once', 'অন্তত একবার')], ['exactly', say('At least once + dedupe', 'অন্তত একবার + ডিডুপ')]], 'atmost', draw);
    const before = ui.slider({ id: 'dv-b', label: say('Crash before the work', 'কাজের আগে ক্র্যাশ'), min: 0, max: 50, step: 5, value: 20, fmt: (v) => v + '%', onInput: draw });
    const after = ui.slider({ id: 'dv-a', label: say('Crash after the work, before the ack', 'কাজের পরে, অ্যাকের আগে ক্র্যাশ'), min: 0, max: 50, step: 5, value: 20, fmt: (v) => v + '%', onInput: draw });
    const stats = ui.stats([['ok', say('Done exactly once', 'ঠিক একবার হয়েছে')], ['lost', say('Lost', 'হারিয়েছে')], ['dup', say('Done more than once', 'একাধিকবার হয়েছে')]]);
    const say2 = banner(), grid = h('div', { class: 'msg-grid' });
    root.append(h('div', { class: 'controls' }, ui.field(say('Guarantee', 'নিশ্চয়তা'), mode), before, after, ui.btn(say('Run again', 'আবার চালান'), () => { seed += 13; draw(); }, { kind: 'primary', id: 'dv-run' })), stats, say2, ui.card(say('Twelve messages', 'বারোটি বার্তা'), grid));
    function draw() {
      const r = M.delivery(mode.value, { crashBefore: before.value / 100, crashAfter: after.value / 100, seed });
      stats.set('ok', r.ok, 'good'); stats.set('lost', r.lost, r.lost ? 'bad' : 'good'); stats.set('dup', r.dupes, r.dupes ? 'warn' : 'good');
      grid.textContent = '';
      r.rows.forEach((m) => grid.append(h('div', { class: 'msg ' + (m.effects === 0 ? 'bad' : m.effects > 1 ? 'warn' : 'good') }, h('b', null, '#' + m.id), h('span', null, m.effects === 0 ? say('lost', 'হারিয়েছে') : `${m.effects}×`), h('small', null, say(`${m.attempts} tries`, `${m.attempts} চেষ্টা`)))));
      if (mode.value === 'atmost') { tell(say2, r.lost ? 'bad' : '', say('The consumer acknowledges first and works second. A crash in between loses the message, and nothing ever repeats.', 'কনজিউমার আগে স্বীকার করে, পরে কাজ করে। মাঝে ক্র্যাশ হলে বার্তা হারায়, কিছুই পুনরাবৃত্ত হয় না।')); if (r.lost) ctx.mission('lose'); }
      else if (mode.value === 'atleast') { tell(say2, r.dupes ? 'warn' : '', say('The consumer works first and acknowledges second. Nothing is lost, but a crash before the ack repeats the work.', 'কনজিউমার আগে কাজ করে, পরে স্বীকার করে। কিছু হারায় না, তবে অ্যাকের আগে ক্র্যাশ হলে কাজ পুনরাবৃত্ত হয়।')); if (r.dupes) ctx.mission('repeat'); }
      else { tell(say2, 'ok', say('Redelivery still happens, but the consumer records each message id, so a repeat has no effect. This is what "exactly once" means in practice.', 'পুনরায় পৌঁছানো ঘটেই, তবে কনজিউমার প্রতিটি বার্তার আইডি রাখে, তাই পুনরাবৃত্তির প্রভাব নেই। বাস্তবে "ঠিক একবার" বলতে এটাই বোঝায়।')); if (!r.dupes) ctx.mission('clean'); }
    }
    draw();
  };

  /* ---------- windows and watermarks ---------- */
  RT.labRender.streaming = (root, ctx) => {
    let seed = 5, events = M.streamEvents(160, seed, 10);
    const size = ui.seg(say('Window', 'উইন্ডো'), [['5', say('5 s', '৫ সে')], ['10', say('10 s', '১০ সে')], ['20', say('20 s', '২০ সে')]], '10', draw);
    const lag = ui.slider({ id: 'st-lag', label: say('Watermark waits for', 'ওয়াটারমার্ক অপেক্ষা করে'), min: 0, max: 14, value: 2, fmt: (v) => v + ' s', onInput: draw });
    const stats = ui.stats([['ev', say('Events', 'ইভেন্ট')], ['late', say('Too late, dropped', 'খুব দেরি, বাদ')], ['wait', say('Result delay', 'ফলের দেরি')]]);
    const say2 = banner(), box = h('div', { class: 'stage' }), table = h('div', { class: 'scroll' });
    root.append(h('div', { class: 'controls' }, ui.field(say('Window', 'উইন্ডো'), size), lag, ui.btn(say('New events', 'নতুন ইভেন্ট'), () => { seed += 7; events = M.streamEvents(160, seed, 10); draw(); }, { kind: 'primary', id: 'st-new' })), stats, say2, box, h('div', { class: 'key' }, h('i', { class: 'c-res' }), say('counted', 'গোনা হয়েছে'), h('i', { class: 'c-bad' }), say('arrived too late', 'খুব দেরিতে এসেছে')), ui.card(say('Results per window', 'উইন্ডো অনুযায়ী ফল'), table));
    function draw() {
      const list = events.map((e) => ({ ...e })), w = +size.value, r = M.windows(list, w, lag.value);
      stats.set('ev', list.length); stats.set('late', r.late, r.late ? 'bad' : 'good'); stats.set('wait', r.wait.toFixed(1) + ' s', r.wait > 6 ? 'warn' : 'good');
      const W = 760, H = 240, L = 40, B = 26, x = (t) => L + (t / 74) * (W - L - 10), y = (t) => H - B - (t / 62) * (H - B - 8);
      const svg = s('svg', { class: 'net', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': say('Each event plotted by when it happened and when it arrived', 'প্রতিটি ইভেন্ট, কখন ঘটেছে ও কখন এসেছে অনুযায়ী') });
      for (let t = 0; t <= 60; t += w) svg.append(s('line', { class: 'lnk', x1: L, x2: W - 10, y1: y(t), y2: y(t), style: 'opacity:.35' }), s('text', { class: 'dim', x: L - 5, y: y(t) + 3, 'text-anchor': 'end' }, t));
      svg.append(s('line', { x1: x(lag.value), y1: y(0), x2: x(60 + lag.value), y2: y(60), stroke: 'var(--ref)', 'stroke-width': 2, 'stroke-dasharray': '6 4' }), s('text', { class: 'dim', x: W / 2, y: H - 6, 'text-anchor': 'middle' }, say('When it reached us (seconds)', 'আমাদের কাছে কখন পৌঁছাল (সেকেন্ড)')), s('text', { class: 'dim', x: L, y: 8 }, say('When it happened', 'কখন ঘটেছিল')));
      list.forEach((e) => svg.append(s('circle', { cx: x(e.arrive), cy: y(e.event), r: e.late ? 4.5 : 3, fill: e.late ? 'var(--bad)' : 'var(--res)', opacity: e.late ? 1 : .75 })));
      box.textContent = ''; box.append(svg);
      table.textContent = '';
      table.append(h('table', { class: 'table' }, h('tr', null, h('th', null, say('Window', 'উইন্ডো')), h('th', null, say('Counted', 'গোনা')), h('th', null, say('Dropped', 'বাদ')), h('th', null, say('Published after', 'প্রকাশ হলো')))
        , r.list.slice(0, 12).map((v) => h('tr', null, h('td', null, `${v.start}–${v.end} s`), h('td', null, v.counted), h('td', { style: { color: v.late ? 'var(--bad)' : '' } }, v.late), h('td', null, `+${Math.max(0, v.closed - v.end).toFixed(1)} s`)))));
      if (r.late > 8) { tell(say2, 'bad', say(`Fast results, but ${r.late} events came too late and were dropped, so the totals are wrong.`, `ফল দ্রুত, তবে ${r.late}টি ইভেন্ট খুব দেরিতে এসে বাদ পড়েছে, তাই মোট ভুল।`)); ctx.mission('late'); }
      else if (!r.late) { tell(say2, 'warn', say('Every event is counted, but each result waits much longer. There is no free answer: choose between speed and completeness.', 'সব ইভেন্ট গোনা হয়েছে, তবে প্রতিটি ফল অনেক দেরিতে। বিনামূল্যে উত্তর নেই: গতি বা সম্পূর্ণতার একটি বাছুন।')); ctx.mission('wait'); }
      else { tell(say2, 'ok', say('A sensible middle: few events are lost, and results stay fresh. Real systems send the stragglers to a correction path.', 'ভালো মাঝামাঝি: অল্প ইভেন্ট হারায়, ফলও তাজা থাকে। আসল সিস্টেম দেরিতে আসাগুলো সংশোধনের পথে পাঠায়।')); ctx.mission('middle'); }
    }
    draw();
  };

  /* ---------- unique ids ---------- */
  RT.labRender.ids = (root, ctx) => {
    let last = -1, seq = 0;
    const worker = ui.slider({ id: 'id-w', label: say('Worker number', 'ওয়ার্কার নম্বর'), min: 0, max: 1023, value: 42, onInput: () => make(true) });
    const bar = h('div', { class: 'bitbar' }), parts = ui.stats([['id', 'Snowflake ID'], ['ms', say('Time part', 'সময়ের অংশ')], ['w', say('Worker part', 'ওয়ার্কারের অংশ')], ['s', say('Sequence part', 'সিকোয়েন্স অংশ')]]);
    const say2 = banner(), list = h('div', { class: 'scroll' });
    const rand = M.rng(Date.now() % 100000);
    function make(same) {
      const now = Date.now();
      if (!same) { if (now === last) seq++; else { last = now; seq = 0; } }
      const id = M.ids.snowflake(last < 0 ? now : last, worker.value, seq), d = M.ids.decode(id), bits = M.ids.bits(id);
      parts.set('id', id.toString()); parts.set('ms', new Date(d.ms).toISOString().slice(11, 23)); parts.set('w', d.worker); parts.set('s', d.seq);
      bar.textContent = '';
      [[1, 'sg', say('sign', 'চিহ্ন')], [41, 'ts', say('41 bits: milliseconds since our start date', '৪১ বিট: শুরুর তারিখ থেকে মিলিসেকেন্ড')], [10, 'wk', say('10: worker', '১০: ওয়ার্কার')], [12, 'sq', say('12: sequence', '১২: সিকোয়েন্স')]].reduce((at, [n, cls, label]) => { bar.append(h('div', { class: 'bits ' + cls, style: { flex: n > 1 ? `${n} 1 150px` : '0 0 auto' } }, h('code', null, bits.slice(at, at + n)), n > 1 ? h('span', null, label) : null)); return at + n; }, 0);
    }
    function burst() {
      const rows = []; const t = Date.now();
      for (let i = 0; i < 5; i++) rows.push({ sf: M.ids.snowflake(t + i, worker.value, 0).toString(), ul: M.ids.ulid(t + i, rand), uu: M.ids.uuid4(rand) });
      const sorted = (k) => rows.every((r, i) => !i || rows[i - 1][k] <= r[k]);
      list.textContent = '';
      list.append(h('table', { class: 'table' }, h('tr', null, h('th', null, 'Snowflake'), h('th', null, 'ULID'), h('th', null, 'UUID v4')), rows.map((r) => h('tr', null, h('td', null, r.sf), h('td', null, r.ul), h('td', null, r.uu)))),
        h('p', { class: 'small', style: { marginTop: '6px' } }, say(`In creation order, sorted by value? Snowflake: yes. ULID: yes. UUID v4: ${sorted('uu') ? 'by luck this time' : 'no'}.`, `তৈরির ক্রমে মান অনুযায়ী সাজানো? Snowflake: হ্যাঁ। ULID: হ্যাঁ। UUID v4: ${sorted('uu') ? 'এবার ভাগ্যক্রমে' : 'না'}।`)));
      tell(say2, 'ok', say('Ids that sort by time keep database inserts near the end of the index. Random ids land all over it, which splits pages and slows writes.', 'সময়ে সাজানো আইডি ডেটাবেসে ইনডেক্সের শেষের দিকে বসে। এলোমেলো আইডি সবখানে পড়ে, পেজ ভাঙে ও রাইট ধীর হয়।'));
      ctx.mission('compare');
    }
    root.append(h('div', { class: 'controls' }, worker, ui.btn(say('New ID', 'নতুন আইডি'), () => { make(false); ctx.mission('make'); tell(say2, '', say('Same worker, same millisecond: only the sequence changes. Press quickly and you might catch it.', 'একই ওয়ার্কার, একই মিলিসেকেন্ড: শুধু সিকোয়েন্স বদলায়। দ্রুত চাপলে ধরতে পারেন।')); }, { kind: 'primary', id: 'id-new' }), ui.btn(say('Compare id types', 'আইডির ধরন তুলনা'), burst, { id: 'id-cmp' })), parts, bar, say2, ui.card(say('Five ids of each kind', 'প্রতিটি ধরনের পাঁচটি আইডি'), list));
    make(false); tell(say2, '', say('A Snowflake id packs a time, a machine and a counter into 64 bits, so machines never need to talk to each other.', 'Snowflake আইডি ৬৪ বিটে সময়, মেশিন ও কাউন্টার রাখে, তাই মেশিনগুলোর কথা বলতে হয় না।'));
    list.append(h('p', { class: 'small muted' }, say('Press Compare id types.', 'আইডির ধরন তুলনা চাপুন।')));
  };

  /* ---------- pagination ---------- */
  RT.labRender.pagination = (root, ctx) => {
    let rows, next, off, after, shown, added;
    const reset = () => { rows = Array.from({ length: 40 }, (_, i) => ({ id: 40 - i })); next = 41; off = { page: 0, seen: new Set() }; after = { key: null, seen: new Set() }; shown = { off: [], key: [] }; added = 0; };
    reset();
    const LIMIT = 5;
    const depth = ui.slider({ id: 'pg-d', label: say('Jump to page', 'যে পাতায় যান'), min: 1, max: 200000, step: 1000, value: 1, fmt: (v) => v.toLocaleString(), onInput: cost });
    const say2 = banner(), left = h('div'), right = h('div'), bill = h('p', { class: 'small', role: 'status' });
    const list = (arr, seen) => h('div', { class: 'pg-list' }, arr.map((r) => h('span', { class: 'pg ' + (r.dup ? 'dup' : '') }, say('post ', 'পোস্ট ') + r.id)));
    function page() {
      const a = M.pages.offset(rows, off.page * LIMIT, LIMIT).rows, b = M.pages.keyset(rows, after.key, LIMIT).rows;
      off.page++; if (b.length) after.key = b[b.length - 1].id;
      let dups = 0;
      shown.off = a.map((r) => { const dup = off.seen.has(r.id); if (dup) dups++; off.seen.add(r.id); return { id: r.id, dup }; });
      shown.key = b.map((r) => { after.seen.add(r.id); return { id: r.id, dup: false }; });
      draw();
      if (dups) { tell(say2, 'bad', say(`Offset showed ${dups} post(s) again. New posts pushed every row down, so "skip ${(off.page - 1) * LIMIT}" lands on rows you already saw. Keyset carried on from the last post.`, `অফসেট ${dups}টি পোস্ট আবার দেখাল। নতুন পোস্ট সব সারি নিচে ঠেলেছে, তাই "${(off.page - 1) * LIMIT}টি বাদ" দেখা সারিতে পড়ে। কিসেট শেষ পোস্ট থেকেই চলল।`)); ctx.mission('dup'); }
      else tell(say2, '', say('Both agree while nothing changes. Try adding a post between pages.', 'কিছু না বদলালে দুটোই মেলে। পাতার মাঝে একটি পোস্ট যোগ করে দেখুন।'));
    }
    function draw() { left.textContent = ''; right.textContent = ''; left.append(h('code', { class: 'small' }, `OFFSET ${(off.page - 1 < 0 ? 0 : off.page - 1) * LIMIT} LIMIT ${LIMIT}`), list(shown.off)); right.append(h('code', { class: 'small' }, shown.key.length ? `WHERE id < ${shown.key[0].id + 1} LIMIT ${LIMIT}` : `LIMIT ${LIMIT}`), list(shown.key)); }
    function cost() {
      const p = depth.value, skip = (p - 1) * LIMIT;
      bill.textContent = say(`Page ${p.toLocaleString()}: offset reads and throws away ${skip.toLocaleString()} rows first. Keyset uses the index and reads ${LIMIT}.`, `পাতা ${p.toLocaleString()}: অফসেট আগে ${skip.toLocaleString()}টি সারি পড়ে ফেলে দেয়। কিসেট ইনডেক্স দিয়ে ${LIMIT}টি পড়ে।`);
      if (p > 50000) ctx.mission('deep');
    }
    root.append(h('div', { class: 'controls' }, ui.btn(say('Next page', 'পরের পাতা'), page, { kind: 'primary', id: 'pg-next' }), ui.btn(say('A new post arrives', 'নতুন পোস্ট এল'), () => { rows.unshift({ id: next++ }); added++; tell(say2, 'warn', say(`${added} new post(s) arrived at the top of the feed. Now press Next page.`, `ফিডের ওপরে ${added}টি নতুন পোস্ট এল। এবার পরের পাতা চাপুন।`)); }, { id: 'pg-add' }), ui.btn(say('Start again', 'আবার শুরু'), () => { reset(); draw(); tell(say2, '', say('Press Next page to read the feed both ways.', 'দুই পদ্ধতিতে ফিড পড়তে পরের পাতা চাপুন।')); }, { id: 'pg-reset' })), say2,
      h('div', { class: 'twocol' }, ui.card(say('Offset pagination', 'অফসেট পেজিনেশন'), left), ui.card(say('Keyset pagination', 'কিসেট পেজিনেশন'), right)), ui.card(say('The cost of going deep', 'গভীরে যাওয়ার খরচ'), h('div', { class: 'controls flat' }, depth), bill));
    tell(say2, '', say('Press Next page to read the feed both ways.', 'দুই পদ্ধতিতে ফিড পড়তে পরের পাতা চাপুন।')); draw(); cost();
  };

  /* ---------- logical clocks ---------- */
  RT.labRender.clocks = (root, ctx) => {
    const NAMES = ['A', 'B', 'C'];
    let c = M.clocks(3), picked = [];
    const svg = h('div', { class: 'stage' }), say2 = banner(), row = h('div', { class: 'chips' });
    function act(fn) { fn(); picked = []; draw(); }
    const msg = (a, b) => act(() => { const m = c.send(a); c.receive(b, m); });
    root.append(h('div', { class: 'controls' },
      NAMES.map((n, i) => ui.btn(say(`Event on ${n}`, `${n}-তে ঘটনা`), () => act(() => c.local(i)), { id: 'ck-e' + i })),
      ui.btn('A → B', () => msg(0, 1), { kind: 'primary', id: 'ck-ab' }), ui.btn('B → C', () => msg(1, 2), { id: 'ck-bc' }), ui.btn('C → A', () => msg(2, 0), { id: 'ck-ca' }),
      ui.btn(say('Start again', 'আবার শুরু'), () => { c = M.clocks(3); picked = []; draw(); }, { id: 'ck-reset' })), say2, svg, ui.card(say('Pick two events to compare', 'তুলনা করতে দুটি ঘটনা বাছুন'), row));
    function draw() {
      const ev = c.events, W = 760, H = 210, x0 = 44, step = Math.min(60, (W - x0 - 40) / Math.max(1, ev.length));
      const g = s('svg', { class: 'net', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': say('Three machines and their events over time', 'তিনটি মেশিন ও সময়ের সঙ্গে তাদের ঘটনা') });
      const ly = (p) => 36 + p * 66, ex = (e) => x0 + (e.id - .5) * step;
      NAMES.forEach((n, p) => g.append(s('text', { class: 'lab', x: 12, y: ly(p) + 4 }, n), s('line', { class: 'lnk', x1: x0, x2: W - 10, y1: ly(p), y2: ly(p) })));
      ev.filter((e) => e.from).forEach((e) => { const f = ev[e.from - 1]; g.append(s('line', { x1: ex(f), y1: ly(f.p), x2: ex(e), y2: ly(e.p), stroke: 'var(--req)', 'stroke-width': 1.6 })); });
      ev.forEach((e) => { const on = picked.includes(e.id); g.append(s('circle', { cx: ex(e), cy: ly(e.p), r: on ? 8 : 6, fill: on ? 'var(--ref)' : 'var(--accent)' }), s('text', { class: 'dim', x: ex(e), y: ly(e.p) - 11, 'text-anchor': 'middle' }, `${e.lam}`)); });
      svg.textContent = ''; svg.append(g);
      row.textContent = '';
      ev.forEach((e) => row.append(h('button', { class: 'chip', 'aria-pressed': String(picked.includes(e.id)), onclick() { picked = picked.includes(e.id) ? picked.filter((x) => x !== e.id) : [...picked.slice(-1), e.id]; draw(); } }, `${NAMES[e.p]} L${e.lam} [${e.vec.join(',')}]`)));
      if (!ev.length) row.append(h('p', { class: 'small muted' }, say('Create some events first.', 'আগে কিছু ঘটনা তৈরি করুন।')));
      if (picked.length === 2) {
        const [a, b] = picked.map((id) => ev[id - 1]), o = M.order(a.vec, b.vec);
        if (o === 'concurrent') { tell(say2, 'warn', say(`Concurrent. Neither event could have caused the other, even though their Lamport numbers (${a.lam}, ${b.lam}) look ordered. Only the vector clock shows this.`, `সমসাময়িক। কোনোটি অন্যটির কারণ হতে পারে না, যদিও ল্যামপোর্ট সংখ্যা (${a.lam}, ${b.lam}) ক্রমে আছে বলে মনে হয়। শুধু ভেক্টর ক্লক এটি দেখায়।`)); ctx.mission('concurrent'); }
        else { tell(say2, 'ok', say(`${o === 'before' ? 'The first' : 'The second'} event happened before the other, and could have caused it. Every position in one vector is at most the same position in the other.`, `${o === 'before' ? 'প্রথম' : 'দ্বিতীয়'} ঘটনাটি অন্যটির আগে ঘটেছে, এবং কারণ হতে পারে। এক ভেক্টরের প্রতিটি ঘর অন্যটির সেই ঘরের সমান বা কম।`)); ctx.mission('causal'); }
      } else tell(say2, '', say('Numbers above the dots are Lamport clocks. Make events, send messages, then pick two events below.', 'বিন্দুর ওপরের সংখ্যা ল্যামপোর্ট ক্লক। ঘটনা তৈরি করুন, বার্তা পাঠান, তারপর নিচে দুটি ঘটনা বাছুন।'));
    }
    draw();
  };

  /* ---------- error budgets ---------- */
  RT.labRender.slo = (root, ctx) => {
    const target = ui.select({ id: 'sl-t', label: say('Target (SLO)', 'লক্ষ্য (SLO)'), value: '.999', options: [['.99', '99%'], ['.995', '99.5%'], ['.999', '99.9%'], ['.9995', '99.95%'], ['.9999', '99.99%']], onChange: draw });
    const days = ui.seg(say('Window', 'সময়সীমা'), [['7', say('7 days', '৭ দিন')], ['30', say('30 days', '৩০ দিন')], ['90', say('90 days', '৯০ দিন')]], '30', draw);
    const traffic = ui.slider({ id: 'sl-r', label: say('Requests a day', 'দিনে অনুরোধ'), min: 1, max: 100, value: 10, fmt: (v) => v + 'M', onInput: draw });
    const fail = ui.slider({ id: 'sl-f', label: say('Failed so far', 'এ পর্যন্ত ব্যর্থ'), min: 0, max: 100, value: 20, fmt: (v) => v + 'k', onInput: draw });
    const rate = ui.slider({ id: 'sl-e', label: say('Error rate right now', 'এখনকার ত্রুটির হার'), min: 0, max: 5, step: .05, value: .3, fmt: (v) => v + '%', onInput: draw });
    const stats = ui.stats([['allow', say('Failures allowed', 'অনুমোদিত ব্যর্থতা')], ['time', say('Full downtime allowed', 'পুরো বন্ধের অনুমতি')], ['used', say('Budget used', 'বাজেট খরচ')], ['burn', say('Burn rate', 'বার্ন রেট')], ['out', say('Budget lasts', 'বাজেট টিকবে')]]);
    const meter = ui.bar(), say2 = banner();
    root.append(h('div', { class: 'controls' }, target, ui.field(say('Window', 'সময়সীমা'), days), traffic, fail, rate), stats, meter, say2);
    function draw() {
      const t = +target.value, d = +days.value, b = M.budget(t, d, traffic.value * 1e6, fail.value * 1e3), burn = M.burnRate(rate.value / 100, t);
      const used = Math.round(b.used * 100), hours = b.minutes >= 120 ? (b.minutes / 60).toFixed(1) + ' h' : b.minutes.toFixed(1) + ' min';
      stats.set('allow', Math.round(b.allowed).toLocaleString()); stats.set('time', hours); stats.set('used', used + '%', used >= 100 ? 'bad' : used > 70 ? 'warn' : 'good');
      stats.set('burn', burn.toFixed(1) + '×', burn > 2 ? 'bad' : burn > 1 ? 'warn' : 'good'); stats.set('out', burn ? (d / burn >= 1 ? (d / burn).toFixed(1) + say(' days', ' দিন') : ((d * 24) / burn).toFixed(1) + say(' h', ' ঘণ্টা')) : '∞');
      meter.set(used);
      if (used >= 100) { tell(say2, 'bad', say('The budget is gone. Stop feature releases and spend the time on reliability until the window recovers.', 'বাজেট শেষ। ফিচার রিলিজ থামান, উইন্ডো সেরে ওঠা পর্যন্ত নির্ভরযোগ্যতায় সময় দিন।')); ctx.mission('freeze'); }
      else if (burn > 2) { tell(say2, 'warn', say('Budget remains, but it is burning fast. Page someone now, because the budget will run out long before the window ends.', 'বাজেট আছে, তবে দ্রুত পুড়ছে। এখনই কাউকে ডাকুন, কারণ উইন্ডো শেষের অনেক আগেই ফুরাবে।')); ctx.mission('burn'); }
      else { tell(say2, 'ok', say('Budget remains and burns slowly. Ship features and take sensible risks: this is what the budget is for.', 'বাজেট আছে, ধীরে পুড়ছে। ফিচার ছাড়ুন, যুক্তিসঙ্গত ঝুঁকি নিন: বাজেট এজন্যই।')); ctx.mission('ship'); }
    }
    draw();
  };
})();
