/* Labs for the intermediate topics, part 1: queues, rate limits, idempotency, isolation,
   the LSM tree and retries. The models live in models.js, and the topics that show these
   labs are in the topics-*.js files. */
(function () {
  const { h, s, ui, Ladder } = RT;
  const M = window.RTModels;
  const say = (en, bn) => (RT.settings.lang === 'bn' ? bn : en);
  const fmt = (ms) => (!isFinite(ms) ? say('never', 'কখনোই না') : ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms.toFixed(ms < 10 ? 1 : 0) + ' ms');
  const banner = () => h('div', { class: 'banner', role: 'status' });
  const tell = (el, cls, text) => { el.className = 'banner ' + cls; el.textContent = text; };
  RT.labRender = {};

  /* A small line chart. lines: [{ points: [[x, y]], color, dash, name }] */
  RT.lineChart = function (o) {
    const W = o.w || 760, H = o.h || 260, L = 52, R = 14, T = 12, B = 34;
    const px = (x) => L + ((x - o.x0) / (o.x1 - o.x0)) * (W - L - R), py = (y) => H - B - ((Math.min(y, o.y1) - o.y0) / (o.y1 - o.y0)) * (H - T - B);
    const svg = s('svg', { class: 'net', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.label });
    (o.xTicks || []).forEach(([x, t]) => svg.append(s('line', { class: 'lnk', x1: px(x), x2: px(x), y1: T, y2: H - B, style: 'opacity:.3' }), s('text', { class: 'dim', x: px(x), y: H - B + 14, 'text-anchor': 'middle' }, t)));
    (o.yTicks || []).forEach(([y, t]) => svg.append(s('line', { class: 'lnk', x1: L, x2: W - R, y1: py(y), y2: py(y), style: 'opacity:.3' }), s('text', { class: 'dim', x: L - 6, y: py(y) + 4, 'text-anchor': 'end' }, t)));
    svg.append(s('text', { class: 'dim', x: (L + W - R) / 2, y: H - 6, 'text-anchor': 'middle' }, o.xLabel || ''), s('text', { class: 'dim', x: L, y: 10 }, o.yLabel || ''));
    o.lines.forEach((l) => { if (l.points.length) svg.append(s('polyline', { fill: 'none', stroke: l.color, 'stroke-width': l.width || 2.4, 'stroke-dasharray': l.dash || null, points: l.points.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(' ') })); });
    (o.dots || []).forEach((d) => svg.append(s('circle', { cx: px(d[0]), cy: py(d[1]), r: 6, fill: d[2] || 'var(--ref)', stroke: 'var(--panel)', 'stroke-width': 2 })));
    return svg;
  };
  const legend = (items) => h('div', { class: 'key' }, items.map(([cls, t]) => [h('i', { class: cls }), t]));

  /* ---------- queueing ---------- */
  RT.labRender.queueing = (root, ctx) => {
    const rate = ui.slider({ id: 'qu-rate', label: say('Requests per second', 'প্রতি সেকেন্ডে অনুরোধ'), min: 10, max: 900, step: 10, value: 150, onInput: draw });
    const work = ui.slider({ id: 'qu-work', label: say('Work per request', 'প্রতি অনুরোধে কাজ'), min: 5, max: 100, step: 5, value: 20, fmt: (v) => v + ' ms', onInput: draw });
    const servers = ui.slider({ id: 'qu-srv', label: say('Workers', 'ওয়ার্কার'), min: 1, max: 16, value: 4, onInput: draw });
    const stats = ui.stats([['rho', say('Utilisation', 'ব্যবহারের হার')], ['wait', say('Time in queue', 'লাইনে সময়')], ['resp', say('Average response', 'গড় উত্তর')], ['p95', say('p95 response', 'p95 উত্তর')], ['l', say('Requests inside (L)', 'ভেতরে অনুরোধ (L)')]]);
    const say2 = banner(), chart = h('div', { class: 'stage' }), little = h('pre', { class: 'dig' });
    root.append(h('div', { class: 'controls' }, rate, work, servers), stats, say2, chart, ui.card(say('Little\'s Law, with your numbers', 'আপনার সংখ্যায় লিটলের সূত্র'), little));
    let hot = false;
    function draw() {
      const c = servers.value, sv = work.value, q = M.queue(rate.value, sv, c), cap = (1000 / sv) * c;
      stats.set('rho', Math.round(q.rho * 100) + '%', q.rho >= 1 ? 'bad' : q.rho > .85 ? 'warn' : 'good');
      stats.set('wait', fmt(q.wait)); stats.set('resp', fmt(q.response), q.rho >= 1 ? 'bad' : ''); stats.set('p95', fmt(q.p95)); stats.set('l', q.stable ? q.inSystem.toFixed(1) : '∞');
      const pts = [];
      for (let u = 2; u <= 98; u += 1) pts.push([u, M.queue((u / 100) * cap, sv, c).response / sv]);
      const here = Math.min(.98, q.rho) * 100;
      chart.textContent = '';
      chart.append(RT.lineChart({ label: say('Response time rises steeply as utilisation nears 100 percent', 'ব্যবহারের হার ১০০ শতাংশের কাছে গেলে উত্তরের সময় খাড়াভাবে বাড়ে'), x0: 0, x1: 100, y0: 0, y1: 20, xLabel: say('Utilisation', 'ব্যবহারের হার'), yLabel: say('Response time, as a multiple of the work', 'উত্তরের সময়, কাজের গুণ হিসেবে'), xTicks: [[0, '0%'], [50, '50%'], [70, '70%'], [85, '85%'], [100, '100%']], yTicks: [[1, '1×'], [5, '5×'], [10, '10×'], [20, '20×']], lines: [{ points: pts, color: 'var(--req)' }], dots: [[here, Math.min(20, M.queue((here / 100) * cap, sv, c).response / sv)]] }));
      little.textContent = q.stable
        ? `L = λ × W\n  = ${rate.value}/s × ${(q.response / 1000).toFixed(3)} s\n  = ${q.inSystem.toFixed(1)} ${say('requests inside the system', 'অনুরোধ সিস্টেমের ভেতরে')}\n${say('Capacity', 'ক্ষমতা')} = ${c} × (1000 ÷ ${sv} ms) = ${Math.round(cap)}/s`
        : `${say('Arrivals', 'আগমন')} ${rate.value}/s > ${say('capacity', 'ক্ষমতা')} ${Math.round(cap)}/s\n${say('The queue grows for ever.', 'লাইন চিরকাল বাড়তে থাকে।')}`;
      if (q.rho >= 1) { tell(say2, 'bad', say('More arrives than can leave. The queue grows until memory runs out or clients give up.', 'বের হওয়ার চেয়ে বেশি আসছে। মেমোরি ফুরানো বা ক্লায়েন্ট হাল ছাড়া পর্যন্ত লাইন বাড়ে।')); ctx.mission('over'); hot = true; }
      else if (q.rho > .85) { tell(say2, 'warn', say('Past the knee. A small rise in traffic now means a large rise in delay.', 'বাঁক পেরিয়ে গেছে। এখন সামান্য ট্রাফিক বাড়লেই দেরি অনেক বাড়ে।')); ctx.mission('knee'); hot = true; }
      else { tell(say2, 'ok', say('Spare capacity absorbs bursts, so requests rarely wait.', 'অতিরিক্ত ক্ষমতা হঠাৎ চাপ শুষে নেয়, তাই অনুরোধ কমই অপেক্ষা করে।')); if (hot && q.rho < .7) ctx.mission('fix'); }
    }
    draw();
  };

  /* ---------- rate limiting ---------- */
  RT.labRender.ratelimit = (root, ctx) => {
    const KINDS = [['fixed', say('Fixed window', 'ফিক্সড উইন্ডো')], ['sliding', say('Sliding log', 'স্লাইডিং লগ')], ['token', say('Token bucket', 'টোকেন বাকেট')], ['leaky', say('Leaky bucket', 'লিকি বাকেট')]];
    const WIN = 10, LIMIT = 10;
    let lim = M.limiter('fixed', LIMIT, WIN), now = 0, marks = [], plan = [], allowed = 0, denied = 0;
    const kind = ui.seg(say('Algorithm', 'অ্যালগরিদম'), KINDS, 'fixed', (v) => { lim = M.limiter(v, LIMIT, WIN); marks = []; plan = []; allowed = denied = 0; note(); });
    const auto = ui.slider({ id: 'rl-auto', label: say('Steady traffic', 'স্থির ট্রাফিক'), min: 0, max: 4, step: .5, value: 0, fmt: (v) => (v ? v + '/s' : say('off', 'বন্ধ')) });
    const stats = ui.stats([['ok', say('Allowed', 'অনুমোদিত')], ['no', say('Refused (429)', 'প্রত্যাখ্যাত (429)')], ['last', say('Allowed in last 10 s', 'শেষ ১০ সেকেন্ডে অনুমোদিত')], ['left', say('Room left', 'বাকি জায়গা')]]);
    const say2 = banner(), svg = s('svg', { class: 'net', viewBox: '0 0 760 120', role: 'img', 'aria-label': say('Requests over the last thirty seconds', 'শেষ ত্রিশ সেকেন্ডের অনুরোধ') }), g = s('g');
    svg.append(g);
    root.append(h('div', { class: 'controls' }, ui.field(say('Algorithm', 'অ্যালগরিদম'), kind), auto,
      ui.btn(say('One request', 'একটি অনুরোধ'), () => plan.push(now), { id: 'rl-one' }),
      ui.btn(say('Burst of 10', '১০টির ঝটকা'), () => { for (let i = 0; i < 10; i++) plan.push(now + i * .04); }, { kind: 'primary', id: 'rl-burst' }),
      ui.btn(say('Burst across the window edge', 'উইন্ডোর সীমা জুড়ে ঝটকা'), edge, { id: 'rl-edge' })),
    stats, say2, h('div', { class: 'stage' }, svg), legend([['c-res', say('allowed', 'অনুমোদিত')], ['c-bad', say('refused', 'প্রত্যাখ্যাত')]]));
    function note() { tell(say2, '', { fixed: say('Counts requests in fixed 10-second blocks. Simple, but look at what happens at the edge of a block.', 'নির্দিষ্ট ১০ সেকেন্ডের ব্লকে গোনে। সহজ, তবে ব্লকের সীমায় কী হয় দেখুন।'), sliding: say('Remembers each request\'s time, so the limit holds over any 10 seconds. Exact, and it uses more memory.', 'প্রতিটি অনুরোধের সময় মনে রাখে, তাই যেকোনো ১০ সেকেন্ডে সীমা টেকে। নির্ভুল, তবে মেমোরি বেশি লাগে।'), token: say('Tokens refill at a steady rate, and each request spends one. Saved-up tokens allow a burst.', 'টোকেন স্থির হারে ভরে, প্রতিটি অনুরোধে একটি খরচ হয়। জমানো টোকেনে ঝটকা চলে।'), leaky: say('Requests join a small queue that drains at a steady rate. Output stays smooth, and a full queue refuses.', 'অনুরোধ ছোট লাইনে দাঁড়ায়, লাইন স্থির হারে খালি হয়। বের হওয়া মসৃণ থাকে, লাইন ভরলে প্রত্যাখ্যান।') }[kind.value]); }
    function edge() {
      const next = (Math.floor(now / WIN) + 1) * WIN, at = next - now < 1 ? next + WIN : next;
      for (let i = 0; i < 10; i++) { plan.push(at - .6 + i * .05); plan.push(at + .1 + i * .05); }
      plan.sort((a, b) => a - b); edgeAt = at;
    }
    let edgeAt = null, carry = 0, drawT = 0;
    ctx.loop((dt) => {
      now += dt; carry += auto.value * dt;
      while (carry >= 1) { carry -= 1; plan.push(now); }
      while (plan.length && plan[0] <= now) {
        const t = plan.shift(), yes = lim.allow(t);
        marks.push({ t, yes });
        if (yes) allowed++; else { denied++; ctx.mission('refuse'); }
      }
      if (edgeAt != null && now > edgeAt + 1) {
        const n = marks.filter((m) => m.yes && m.t > edgeAt - 1 && m.t < edgeAt + 1).length;
        if (kind.value === 'fixed' && n > LIMIT) { tell(say2, 'bad', say(`${n} requests passed within two seconds, double the limit. Each window only counted its own.`, `দুই সেকেন্ডে ${n}টি অনুরোধ পার হলো, সীমার দ্বিগুণ। প্রতিটি উইন্ডো শুধু নিজেরটাই গুনেছে।`)); ctx.mission('edge'); }
        else if (kind.value !== 'fixed') { tell(say2, 'ok', say(`Only ${n} passed around the edge. This algorithm has no blind spot there.`, `সীমার আশপাশে মাত্র ${n}টি পার হলো। এই অ্যালগরিদমের সেখানে অন্ধ বিন্দু নেই।`)); ctx.mission('hold'); }
        edgeAt = null;
      }
      drawT += dt;
      if (drawT < .1) return;
      drawT = 0;
      marks = marks.filter((m) => m.t > now - 30);
      g.textContent = '';
      const x = (t) => 740 - (now - t) * 24;
      if (kind.value === 'fixed') for (let w = Math.floor((now - 30) / WIN) * WIN; w <= now; w += WIN) { if (x(w) > 10) g.append(s('line', { class: 'lnk', x1: x(w), x2: x(w), y1: 6, y2: 100, style: 'stroke-dasharray:4 4' })); }
      marks.forEach((m) => g.append(s('rect', { x: x(m.t) - 1.5, y: m.yes ? 20 : 62, width: 3, height: 32, fill: m.yes ? 'var(--res)' : 'var(--bad)' })));
      g.append(s('text', { class: 'dim', x: 12, y: 114 }, say('30 s ago', '৩০ সেকেন্ড আগে')), s('text', { class: 'dim', x: 700, y: 114 }, say('now', 'এখন')));
      stats.set('ok', allowed, 'good'); stats.set('no', denied, denied ? 'bad' : '');
      stats.set('last', marks.filter((m) => m.yes && m.t > now - 10).length); stats.set('left', Math.floor(lim.level(now)));
    });
    note();
  };

  /* ---------- idempotency ---------- */
  RT.labRender.idempotency = (root, ctx) => {
    let server = M.paymentServer(), busy = false, nextKey = 1, lastKey = null;
    const key = ui.toggle({ id: 'id-key', label: say('Send an idempotency key', 'আইডেমপোটেন্সি কী পাঠান'), checked: false });
    const lose = ui.toggle({ id: 'id-lose', label: say('The reply gets lost', 'উত্তর হারিয়ে যায়'), checked: true });
    const lad = Ladder(ctx, { actors: [{ name: say('Phone', 'ফোন'), sub: say('retries on timeout', 'টাইমআউটে আবার চেষ্টা') }, { name: say('Payment API', 'পেমেন্ট এপিআই'), sub: '' }, { name: say('Bank', 'ব্যাংক'), sub: '' }], label: say('Payment messages', 'পেমেন্টের বার্তা'), rowH: 36 });
    const stats = ui.stats([['paid', say('Times charged', 'কতবার কাটা হলো')], ['money', say('Customer paid', 'গ্রাহক দিলেন')], ['want', say('Customer meant to pay', 'গ্রাহক দিতে চেয়েছিলেন')]]);
    const say2 = banner(); let meant = 0;
    const paint = () => { const sum = server.ledger.reduce((a, r) => a + r.amount, 0); stats.set('paid', server.ledger.length, server.ledger.length > meant / 100 ? 'bad' : 'good'); stats.set('money', '$' + sum, sum > meant ? 'bad' : 'good'); stats.set('want', '$' + meant); };
    async function pay(sameKey, amount) {
      if (busy) return;
      busy = true;
      const k = key.checked ? (sameKey && lastKey ? lastKey : 'pay-' + nextKey++) : null, label = k ? ` key=${k}` : '';
      let refused = false;
      lastKey = k; if (!sameKey) meant += 100;
      lad.band(say(`Customer taps Pay $${amount}`, `গ্রাহক $${amount} পে চাপেন`), 'ref');
      for (let attempt = 1; attempt <= 2 && ctx.alive(); attempt++) {
        await lad.msg(0, 1, { label: `POST /pay${label}`.slice(0, 26), color: 'req', dur: 420 });
        const res = server.pay(k, amount);
        if (res.status === 422) { await lad.msg(1, 0, { label: '422 ' + say('key reused', 'কী আবার ব্যবহার'), color: 'bad', dur: 420 }); tell(say2, 'ok', say('The server refused: this key was used with a different amount. A key is tied to one exact request.', 'সার্ভার মানা করেছে: এই কী অন্য পরিমাণে ব্যবহার হয়েছে। একটি কী একটি নির্দিষ্ট অনুরোধের জন্য।')); ctx.mission('mismatch'); refused = true; break; }
        if (!res.replay) { await lad.msg(1, 2, { label: say('charge', 'চার্জ'), color: 'req', dur: 360 }); await lad.msg(2, 1, { label: say('done', 'সম্পন্ন'), color: 'res', dur: 360 }); }
        paint();
        const drop = lose.checked && attempt === 1;
        await lad.msg(1, 0, { label: res.replay ? say('200 saved reply', '200 রাখা উত্তর') : '200 OK', color: 'res', lost: drop, dur: 420 });
        if (!drop) break;
        lad.note(say('No reply arrived. The phone cannot tell what happened, so it tries again.', 'উত্তর আসেনি। ফোন জানে না কী হয়েছে, তাই আবার চেষ্টা করে।'));
      }
      paint();
      const extra = server.ledger.reduce((a, r) => a + r.amount, 0) - meant;
      if (refused) { /* the refusal message stays on screen */ }
      else if (extra > 0) { tell(say2, 'bad', say('Charged twice. The server treated the retry as a new payment.', 'দুবার কাটা হলো। সার্ভার রিট্রাইকে নতুন পেমেন্ট ধরেছে।')); ctx.mission('double'); }
      else if (key.checked && lose.checked) { tell(say2, 'ok', say('Charged once. The retry carried the same key, so the server replayed its saved reply.', 'একবারই কাটা হলো। রিট্রাইয়ে একই কী ছিল, তাই সার্ভার রাখা উত্তরটি আবার দিল।')); ctx.mission('safe'); }
      else tell(say2, '', say('Nothing went wrong this time, so nothing was tested.', 'এবার কিছু ভুল হয়নি, তাই কিছু পরীক্ষাও হয়নি।'));
      busy = false;
    }
    root.append(h('div', { class: 'controls' }, key, lose, ui.btn(say('Pay $100', '$১০০ পে করুন'), () => { say2.className = 'banner'; pay(false, 100); }, { kind: 'primary', id: 'id-pay' }),
      ui.btn(say('Reuse key with $900', '$৯০০ দিয়ে কী আবার ব্যবহার'), () => { if (!key.checked || !lastKey) { tell(say2, 'warn', say('Turn the key on and make a payment first.', 'আগে কী চালু করে একটি পেমেন্ট করুন।')); return; } pay(true, 900); }, { id: 'id-reuse' }),
      ui.btn(say('Start again', 'আবার শুরু'), () => { if (busy) return; server = M.paymentServer(); meant = 0; lastKey = null; lad.reset(); paint(); tell(say2, '', say('Press Pay to send a payment.', 'পেমেন্ট পাঠাতে পে চাপুন।')); }, { id: 'id-reset' })),
    stats, say2, h('div', { class: 'stage scroll', style: { maxHeight: '420px' } }, lad.svg));
    tell(say2, '', say('Press Pay to send a payment.', 'পেমেন্ট পাঠাতে পে চাপুন।')); paint();
  };

  /* ---------- isolation levels ---------- */
  RT.labRender.isolation = (root, ctx) => {
    const NAMES = { dirty: say('Dirty read', 'ডার্টি রিড'), nonrepeat: say('Non-repeatable read', 'নন-রিপিটেবল রিড'), phantom: say('Phantom row', 'ফ্যান্টম সারি'), lost: say('Lost update', 'হারানো আপডেট'), skew: say('Write skew', 'রাইট স্কিউ') };
    const STORY = {
      dirty: say('B changes a balance, then cancels. Did A see a value that never really existed?', 'B ব্যালান্স বদলে বাতিল করল। A কি এমন মান দেখল যা আসলে কখনও ছিল না?'),
      nonrepeat: say('A reads the same balance twice while B changes it in between.', 'B মাঝখানে বদলাচ্ছে, আর A একই ব্যালান্স দুবার পড়ছে।'),
      phantom: say('A counts orders twice while B adds one in between.', 'B মাঝখানে একটি যোগ করছে, আর A অর্ডার দুবার গুনছে।'),
      lost: say('A spends 30 and B spends 20 from 100. The correct end balance is 50.', '১০০ থেকে A ৩০ ও B ২০ খরচ করে। সঠিক শেষ ব্যালান্স ৫০।'),
      skew: say('Rule: at least one doctor stays on call. Ana and Ben each check, and each sees two, so each signs off.', 'নিয়ম: অন্তত একজন ডাক্তার ডিউটিতে থাকবেন। আনা ও বেন দেখেন দুজন আছেন, তাই দুজনই ছুটি নেন।'),
    };
    const LV = [['ru', say('Read uncommitted', 'রিড আনকমিটেড')], ['rc', say('Read committed', 'রিড কমিটেড')], ['rr', say('Repeatable read', 'রিপিটেবল রিড')], ['ser', say('Serializable', 'সিরিয়ালাইজেবল')]];
    let at = 0;
    const sc = ui.select({ id: 'is-sc', label: say('Situation', 'পরিস্থিতি'), value: 'dirty', options: Object.entries(NAMES), onChange() { at = 0; draw(); } });
    const lv = ui.seg(say('Isolation level', 'আইসোলেশন লেভেল'), LV, 'rc', () => { at = 0; draw(); });
    const body = h('div', { class: 'scroll' }), say2 = banner(), grid = h('div', { class: 'scroll' });
    root.append(h('div', { class: 'controls' }, sc, ui.field(say('Isolation level', 'আইসোলেশন লেভেল'), lv),
      ui.btn(say('Next step', 'পরের ধাপ'), () => { const r = M.isolation(sc.value, lv.value); if (at < r.steps) { at++; draw(); } }, { kind: 'primary', id: 'is-next' }),
      ui.btn(say('Run all', 'সব চালান'), () => { at = M.isolation(sc.value, lv.value).steps; draw(); }, { id: 'is-all' }),
      ui.btn(say('Start again', 'আবার শুরু'), () => { at = 0; draw(); }, { id: 'is-reset' })),
    say2, ui.card(say('Two transactions, side by side', 'পাশাপাশি দুটি ট্রানজ্যাকশন'), body), ui.card(say('What each level does here', 'এখানে প্রতিটি লেভেল কী করে'), grid));
    const text = (r) => {
      if (r.skipped) return '–';
      if (r.ok === false) return say('ABORTED: conflict', 'বাতিল: দ্বন্দ্ব');
      return { read: `read ${r.key} → ${r.value}`, count: `count ${r.key}* → ${r.value}`, write: `set ${r.key} = ${r.val}`, spend: `${r.key} = ${r.value} (−${r.val})`, off: `${r.key} = off`, commit: 'COMMIT', abort: 'ROLLBACK' }[r.op];
    };
    function draw() {
      const r = M.isolation(sc.value, lv.value, at);
      body.textContent = '';
      body.append(h('table', { class: 'table' }, h('tr', null, h('th', null, '#'), h('th', null, say('Transaction A', 'ট্রানজ্যাকশন A')), h('th', null, say('Transaction B', 'ট্রানজ্যাকশন B'))),
        r.log.map((row, i) => h('tr', null, h('td', null, i + 1), h('td', null, row.who === 'A' ? text(row) : ''), h('td', null, row.who === 'B' ? text(row) : '')))));
      if (at === 0) tell(say2, '', STORY[sc.value]);
      else if (r.anomaly === null) tell(say2, '', STORY[sc.value]);
      else if (r.anomaly) {
        tell(say2, 'bad', say(`${NAMES[sc.value]} happened at this level.`, `এই লেভেলে ${NAMES[sc.value]} ঘটেছে।`));
        ctx.mission('see'); if (sc.value === 'skew' && lv.value === 'rr') ctx.mission('skew');
      } else {
        const stopped = r.A === 'aborted' || r.B === 'aborted';
        tell(say2, 'ok', stopped ? say('Prevented. The database aborted one transaction, and the application must retry it.', 'ঠেকানো গেছে। ডেটাবেস একটি ট্রানজ্যাকশন বাতিল করেছে, অ্যাপ্লিকেশনকে আবার চেষ্টা করতে হবে।') : say('Prevented. A worked from a consistent view of the data.', 'ঠেকানো গেছে। A ডেটার একটি সামঞ্জস্যপূর্ণ ছবি থেকে কাজ করেছে।'));
        ctx.mission('stop'); if (sc.value === 'skew' && lv.value === 'ser') ctx.mission('ser');
      }
      grid.textContent = '';
      grid.append(h('table', { class: 'table' }, h('tr', null, h('th', null, say('Level', 'লেভেল')), Object.values(NAMES).map((n) => h('th', null, n))),
        LV.map(([id, name]) => h('tr', null, h('td', null, name), Object.keys(NAMES).map((k) => { const bad = M.isolation(k, id).anomaly; return h('td', { style: { color: bad ? 'var(--bad)' : 'var(--res)' } }, bad ? say('happens', 'ঘটে') : say('prevented', 'ঠেকে')); })))),
      h('p', { class: 'small muted', style: { marginTop: '6px' } }, say('Modelled on snapshot databases such as PostgreSQL. The SQL standard allows phantoms at repeatable read, and MySQL and SQL Server behave differently in places, so check your own database.', 'PostgreSQL-এর মতো স্ন্যাপশট ডেটাবেসের আদলে তৈরি। SQL মান রিপিটেবল রিডে ফ্যান্টম মেনে নেয়, আর MySQL ও SQL Server কিছু জায়গায় আলাদা, তাই নিজের ডেটাবেস যাচাই করুন।')));
    }
    draw();
  };

  /* ---------- LSM tree ---------- */
  RT.labRender.storage = (root, ctx) => {
    const KEYS = 'abcdefgh'.split('');
    let tree = M.lsm(4), n = 0;
    const key = ui.select({ id: 'ls-key', label: say('Key', 'কী'), value: 'a', options: KEYS.map((k) => [k, k]) });
    const stats = ui.stats([['uw', say('Your writes', 'আপনার রাইট')], ['dw', say('Writes to disk', 'ডিস্কে রাইট')], ['amp', say('Write amplification', 'রাইট অ্যামপ্লিফিকেশন')], ['fl', say('Sorted files', 'সাজানো ফাইল')], ['rd', say('File reads, last lookup', 'শেষ খোঁজে ফাইল রিড')]]);
    const say2 = banner(), mem = h('div', { class: 'hexbox' }), wal = h('div', { class: 'hexbox' }), files = h('div'), trace = h('ol', { class: 'small', style: { margin: 0, paddingLeft: '20px' } });
    const show = (v) => (v === null ? '🪦' : v);
    function paint() {
      mem.textContent = [...tree.mem.entries()].map(([k, v]) => `${k}=${show(v)}`).join('  ') || say('(empty)', '(খালি)');
      wal.textContent = tree.wal.map(([k, v]) => `${k}=${show(v)}`).join(' → ') || say('(empty)', '(খালি)');
      files.textContent = '';
      tree.files.forEach((f) => files.append(h('div', { class: 'hexbox', style: { marginBottom: '4px' } }, h('b', null, `F${f.id}  `), f.rows.map(([k, v]) => `${k}=${show(v)}`).join('  '))));
      if (!tree.files.length) files.append(h('p', { class: 'small muted' }, say('Nothing on disk yet.', 'ডিস্কে এখনও কিছু নেই।')));
      stats.set('uw', tree.userWrites); stats.set('dw', tree.diskWrites); stats.set('amp', tree.userWrites ? (tree.diskWrites / tree.userWrites).toFixed(1) + '×' : '–'); stats.set('fl', tree.files.length, tree.files.length > 3 ? 'warn' : '');
    }
    const write = (k, v) => {
      const flushed = tree.put(k, v);
      if (v === null) tell(say2, 'cache', say(`Deleting ${k} writes a tombstone. Old files are never edited, so the marker hides the old value.`, `${k} মুছলে একটি টম্বস্টোন লেখা হয়। পুরনো ফাইল বদলায় না, তাই চিহ্নটি পুরনো মান লুকায়।`));
      else tell(say2, flushed ? 'ok' : '', flushed ? say('The memtable filled up, so it was flushed to a new sorted file, and the log was cleared.', 'মেমটেবল ভরে গেছে, তাই নতুন সাজানো ফাইলে নামল, আর লগ খালি হলো।') : say(`${k} went to the log for safety, then to memory. No disk seek was needed.`, `${k} নিরাপত্তার জন্য লগে, তারপর মেমোরিতে গেল। ডিস্ক সিক লাগেনি।`));
      if (flushed) ctx.mission('flush');
      if (v === null) dead.add(k);
      paint();
    };
    const dead = new Set();
    const read = () => {
      const k = key.value, r = tree.get(k);
      trace.textContent = '';
      r.path.forEach((p) => trace.append(h('li', null, p.at === 'memtable' ? (p.hit ? say('Memtable: found', 'মেমটেবল: পাওয়া গেছে') : say('Memtable: not here', 'মেমটেবল: নেই')) : p.skipped ? say(`F${p.id}: Bloom filter says no, file skipped`, `F${p.id}: ব্লুম ফিল্টার বলে নেই, ফাইল বাদ`) : p.hit ? say(`F${p.id}: read, found`, `F${p.id}: পড়া হলো, পাওয়া গেছে`) : say(`F${p.id}: read, not here (false positive)`, `F${p.id}: পড়া হলো, নেই (ভুল পজিটিভ)`))));
      stats.set('rd', r.reads);
      const steps = r.path.filter((p) => p.at === 'file').length;
      if (steps >= 2) ctx.mission('layers');
      if (r.value === null) { tell(say2, 'cache', say('The search stopped at a tombstone, so older copies stay hidden.', 'খোঁজ টম্বস্টোনে থামল, তাই পুরনো কপি লুকানোই থাকল।')); ctx.mission('tomb'); }
      else tell(say2, r.found ? 'ok' : '', r.found ? say(`Found ${k} = ${r.value}. Newest data is checked first.`, `${k} = ${r.value} পাওয়া গেছে। নতুন ডেটা আগে দেখা হয়।`) : say(`${k} is not stored.`, `${k} রাখা নেই।`));
    };
    root.append(h('div', { class: 'controls' }, key,
      ui.btn(say('Write', 'লিখুন'), () => write(key.value, ++n), { kind: 'primary', id: 'ls-put' }), ui.btn(say('Delete', 'মুছুন'), () => write(key.value, null), { id: 'ls-del' }), ui.btn(say('Read', 'পড়ুন'), read, { id: 'ls-get' }),
      ui.btn(say('Write 4 random keys', '৪টি এলোমেলো কী লিখুন'), () => { for (let i = 0; i < 4; i++) write(KEYS[Math.floor(Math.random() * KEYS.length)], ++n); }, { id: 'ls-rand' }),
      ui.btn(say('Flush memtable', 'মেমটেবল ফ্লাশ'), () => { if (tree.flush()) { ctx.mission('flush'); tell(say2, 'ok', say('The memtable became a new sorted file.', 'মেমটেবল নতুন সাজানো ফাইল হলো।')); paint(); } }, { id: 'ls-flush' }),
      ui.btn(say('Compact files', 'ফাইল কম্প্যাক্ট'), () => { const had = tree.files.length; if (tree.compact()) { ctx.mission('compact'); tell(say2, 'ok', say(`Merged ${had} files into one. Old versions and tombstones are gone, so reads get cheaper, at the cost of more disk writes.`, `${had}টি ফাইল এক হলো। পুরনো সংস্করণ ও টম্বস্টোন গেল, রিড সস্তা হলো, বিনিময়ে ডিস্কে আরও রাইট।`)); paint(); } else tell(say2, 'warn', say('You need at least two files to compact.', 'কম্প্যাক্টে অন্তত দুটি ফাইল লাগে।')); }, { id: 'ls-compact' }),
      ui.btn(say('Start again', 'আবার শুরু'), () => { tree = M.lsm(4); n = 0; trace.textContent = ''; stats.set('rd', '–'); tell(say2, '', say('Write a few keys and watch where they go.', 'কয়েকটি কী লিখে দেখুন কোথায় যায়।')); paint(); }, { id: 'ls-reset' })),
    stats, say2, h('div', { class: 'twocol' }, ui.card(say('Memtable (fast, in memory)', 'মেমটেবল (দ্রুত, মেমোরিতে)'), mem), ui.card(say('Write-ahead log (on disk, for crashes)', 'রাইট-অ্যাহেড লগ (ডিস্কে, ক্র্যাশের জন্য)'), wal)), h('div', { class: 'twocol' }, ui.card(say('Sorted files, newest first', 'সাজানো ফাইল, নতুনটি আগে'), files), ui.card(say('Path of the last read', 'শেষ রিডের পথ'), trace)));
    tell(say2, '', say('Write a few keys and watch where they go.', 'কয়েকটি কী লিখে দেখুন কোথায় যায়।')); paint();
  };

  /* ---------- retries, backoff, breakers ---------- */
  RT.labRender.resilience = (root, ctx) => {
    const out = ui.seg(say('Outage', 'বিভ্রাট'), [['long', say('Long outage', 'দীর্ঘ বিভ্রাট')], ['blip', say('Short blip', 'ছোট ঝাঁকুনি')]], 'long', draw);
    const tries = ui.slider({ id: 're-n', label: say('Retries per request', 'প্রতি অনুরোধে রিট্রাই'), min: 0, max: 5, value: 3, onInput: draw });
    const back = ui.toggle({ id: 're-back', label: say('Exponential backoff', 'এক্সপোনেনশিয়াল ব্যাকঅফ'), onChange: draw }), jit = ui.toggle({ id: 're-jit', label: say('Jitter', 'জিটার'), onChange: draw });
    const brk = ui.toggle({ id: 're-brk', label: say('Circuit breaker', 'সার্কিট ব্রেকার'), onChange: draw }), bud = ui.toggle({ id: 're-bud', label: say('Retry budget (10%)', 'রিট্রাই বাজেট (১০%)'), onChange: draw });
    const stats = ui.stats([['peak', say('Peak load on the service', 'সার্ভিসে সর্বোচ্চ চাপ')], ['rec', say('Recovery after the fix', 'ঠিক হওয়ার পর সেরে ওঠা')], ['fail', say('Failed calls', 'ব্যর্থ কল')], ['shed', say('Failed fast', 'দ্রুত ব্যর্থ')]]);
    const say2 = banner(), chart = h('div', { class: 'stage' });
    root.append(h('div', { class: 'controls' }, ui.field(say('Outage', 'বিভ্রাট'), out), tries, back, jit, brk, bud), stats, say2, chart, legend([['c-req', say('load on the service', 'সার্ভিসে চাপ')], ['c-res', say('successful', 'সফল')], ['c-ref', say('capacity', 'ক্ষমতা')]]));
    function draw() {
      const blip = out.value === 'blip', o = { retries: tries.value, backoff: back.checked, jitter: jit.checked, breaker: brk.checked, budget: bud.checked, from: 20, to: blip ? 23 : 45 };
      const r = M.resilience(o), base = M.resilience({ ...o, retries: 0, breaker: false, budget: false });
      stats.set('peak', Math.round(r.peak) + '/s', r.peak > 180 ? 'bad' : 'good');
      stats.set('rec', r.recovery == null ? say('never', 'কখনোই না') : r.recovery + ' s', r.recovery == null ? 'bad' : r.recovery < 10 ? 'good' : 'warn');
      stats.set('fail', r.total.failed.toLocaleString()); stats.set('shed', r.total.shed.toLocaleString());
      chart.textContent = '';
      chart.append(RT.lineChart({ label: say('Load, successes and capacity over two minutes', 'দুই মিনিটে চাপ, সফলতা ও ক্ষমতা'), x0: 0, x1: 120, y0: 0, y1: 440, xLabel: say('Seconds', 'সেকেন্ড'), yLabel: say('Calls per second', 'প্রতি সেকেন্ডে কল'), xTicks: [[0, '0'], [20, '20'], [45, '45'], [80, '80'], [120, '120']], yTicks: [[100, '100'], [200, '200'], [400, '400']], lines: [{ points: r.series.map((p) => [p.t, p.capacity]), color: 'var(--ref)', dash: '5 4', width: 1.6 }, { points: r.series.map((p) => [p.t, p.offered]), color: 'var(--req)' }, { points: r.series.map((p) => [p.t, p.ok]), color: 'var(--res)' }] }));
      if (r.recovery == null && tries.value) {
        tell(say2, 'bad', say('The service is fixed, but it stays down. Failed calls retry, the retries overload it, and they fail again. The storm now feeds itself.', 'সার্ভিস ঠিক হয়েছে, তবু বন্ধ। ব্যর্থ কল রিট্রাই করে, রিট্রাই চাপ বাড়ায়, আবার ব্যর্থ হয়। ঝড় এখন নিজেকেই খাওয়াচ্ছে।'));
        if (!blip && !brk.checked && !bud.checked) ctx.mission('storm');
        if (back.checked && !blip) ctx.mission('notenough');
      } else if (tries.value && !blip && (brk.checked || bud.checked)) {
        tell(say2, 'ok', brk.checked ? say('The breaker opens, callers fail fast, and the service gets room to recover. A few trial calls then close it again.', 'ব্রেকার খোলে, কলাররা দ্রুত ব্যর্থ হয়, সার্ভিস সেরে ওঠার জায়গা পায়। কয়েকটি পরীক্ষামূলক কলের পর আবার বন্ধ হয়।') : say('The budget caps retries at a tenth of normal traffic, so they can never overwhelm the service.', 'বাজেট রিট্রাইকে স্বাভাবিক ট্রাফিকের এক-দশমাংশে বেঁধে রাখে, তাই সার্ভিস ডোবাতে পারে না।'));
        ctx.mission(brk.checked ? 'breaker' : 'budget');
      } else if (blip && tries.value && back.checked && jit.checked && r.peak < M.resilience({ ...o, backoff: false, jitter: false }).peak) {
        tell(say2, 'ok', say('Backoff and jitter spread the retries out, so a short blip passes with a much lower peak.', 'ব্যাকঅফ ও জিটার রিট্রাই ছড়িয়ে দেয়, তাই ছোট ঝাঁকুনি অনেক কম চাপে পার হয়।'));
        ctx.mission('spread');
      } else tell(say2, '', r.peak > base.peak * 1.5 ? say('Each failed call came back several times, so the load grew just when the service was weakest.', 'প্রতিটি ব্যর্থ কল কয়েকবার ফিরেছে, তাই সার্ভিস যখন সবচেয়ে দুর্বল তখনই চাপ বেড়েছে।') : say('With no retries the load stays flat, but every failure reaches the user.', 'রিট্রাই ছাড়া চাপ সমান থাকে, তবে প্রতিটি ব্যর্থতা ব্যবহারকারীর কাছে পৌঁছায়।'));
    }
    draw();
  };
})();
