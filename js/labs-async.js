/* Real-time transports, Kafka, architecture trade-offs. */
(function () {
  const { h, s, ui, Net, hash, utf8, fmtMs } = RT;

  RT.lab({
    id: 'realtime', title: 'Real-Time Transports', short: 'Polling to WebSockets', chapter: 'Long-Polling vs WebSockets vs SSE',
    lede: 'The server has news. How does it reach the browser? Four techniques run side by side on the same stream of events.',
    missions: [['event', 'Fire a server event and compare the delay across all four.'], ['quiet', 'Let it run through a quiet minute and see polling waste requests.'], ['send', 'Send a client message, and see SSE needing a separate request.']],
    notes: `<ul><li><b>Polling</b>: ask every few seconds. Simple and wasteful.</li><li><b>Long polling</b>: the server holds the request until there is news.</li><li><b>Server-Sent Events</b>: one long-lived HTTP stream, server to client only.</li><li><b>WebSocket</b>: an upgraded connection for full two-way messages.</li><li>Choose the simplest one that fits. Dashboards suit SSE, and chat and games suit WebSockets.</li></ul>`,
    check: { q: 'A live sports score page only needs updates from the server. Which is the simplest good fit?', options: ['WebSocket', 'Server-Sent Events', 'Polling every 100 ms', 'Email'], answer: 1, why: 'SSE gives one-way streaming over plain HTTP, with automatic reconnects built in.' },
    render(root, ctx) {
      const LANES = [['poll', 'Polling'], ['long', 'Long polling'], ['sse', 'SSE'], ['ws', 'WebSocket']];
      const W = 900, LH = 74, H = LANES.length * LH + 8, X0 = 118, X1 = 800;
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'net', role: 'img', 'aria-label': 'Four client-server lanes' });
      const gP = s('g');
      const lanes = {};
      LANES.forEach(([id, t], i) => {
        const y = 8 + i * LH + LH / 2 - 4;
        svg.append(s('text', { class: 'lab', x: 8, y: y + 4 }, t), s('rect', { x: X0 - 22, y: y - 18, width: 22, height: 36, rx: 3, fill: 'var(--req-soft)', stroke: 'var(--req)' }), s('rect', { x: X1, y: y - 18, width: 22, height: 36, rx: 3, fill: 'var(--ok-soft)', stroke: 'var(--res)' }));
        const line = s('line', { class: 'lnk', x1: X0, x2: X1, y1: y, y2: y, style: i >= 2 ? 'stroke:var(--accent);stroke-width:3;opacity:.45' : '' });
        svg.append(line);
        const delivered = s('text', { class: 'dim', x: 830, y: y + 4 }, '');
        svg.append(delivered);
        lanes[id] = { y, delivered, queue: 0, hold: false, reqs: 0, empty: 0, delaySum: 0, got: 0, born: [], pollT: 0 };
      });
      svg.append(gP);
      const stage = h('div', { class: 'stage' }, svg);
      const iv = ui.slider({ id: 'rt-iv', label: 'Polling interval', min: 1, max: 8, value: 3, fmt: (v) => v + ' s' });
      const rate = ui.slider({ id: 'rt-rate', label: 'Auto events', min: 0, max: 30, value: 8, fmt: (v) => (v ? v + '/min' : 'off') });
      const table = h('div', { class: 'scroll' });
      root.append(h('div', { class: 'controls' }, ui.btn('Server event now', fire, { kind: 'primary', id: 'rt-fire' }), ui.btn('Client sends a message', clientSend, { id: 'rt-send' }), iv, rate), stage, ui.card('Scoreboard', table));
      const pk = [];
      function move(lane, dir, color, label, done) {
        const tw = (label || '').length * 6.5 + 10;
        const g = s('g', { class: 'pkt c-' + color }, label ? [s('rect', { x: -tw / 2, y: -23, width: tw, height: 15, rx: 3 }), s('text', { y: -12 }, label)] : null, s('circle', { r: 5 }));
        gP.append(g); pk.push({ lane, dir, x: 0, g, done });
      }
      function deliver(id) {
        const l = lanes[id], now = performance.now();
        l.born.forEach((b) => { l.delaySum += now - b; l.got++; }); l.born = []; l.queue = 0;
      }
      function fire() {
        Object.keys(lanes).forEach((id) => { lanes[id].queue++; lanes[id].born.push(performance.now()); });
        ctx.mission('event');
        ['sse', 'ws'].forEach((id) => { const l = lanes[id]; move(l, -1, 'res', 'event', () => deliver(id)); l.reqs += 0; });
        const l = lanes.long;
        if (l.hold) { l.hold = false; move(l, -1, 'res', 'event', () => { deliver('long'); ask(); }); }
      }
      function ask() {
        const l = lanes.long; l.reqs++;
        move(l, 1, 'req', 'GET', () => { if (l.queue) move(l, -1, 'res', 'event', () => { deliver('long'); ask(); }); else l.hold = true; });
      }
      function clientSend() {
        move(lanes.ws, 1, 'req', 'msg', null);
        const p = lanes.sse; p.reqs++; move(p, 1, 'ref', 'POST', null); move(lanes.long, 1, 'ref', 'POST', null); lanes.long.reqs++; lanes.poll.reqs++; move(lanes.poll, 1, 'ref', 'POST', null);
        ctx.mission('send');
      }
      ask();
      lanes.ws.reqs = 1; lanes.sse.reqs = 1;
      let autoT = 0, drawT = 0;
      ctx.loop((dt) => {
        for (const p of pk.slice()) {
          p.x += dt / .55;
          const px = p.dir > 0 ? X0 + (X1 - X0) * p.x : X1 - (X1 - X0) * p.x;
          p.g.setAttribute('transform', `translate(${px},${p.lane.y})`);
          if (p.x >= 1) { p.g.remove(); pk.splice(pk.indexOf(p), 1); if (p.done) p.done(); }
        }
        const poll = lanes.poll;
        poll.pollT += dt;
        if (poll.pollT >= iv.value) {
          poll.pollT = 0; poll.reqs++;
          move(poll, 1, 'req', 'GET', () => { if (poll.queue) move(poll, -1, 'res', 'event', () => deliver('poll')); else { poll.empty++; move(poll, -1, 'bad', 'empty', null); } });
        }
        if (rate.value) { autoT += dt; if (autoT > 60 / rate.value) { autoT = 0; fire(); } }
        drawT += dt;
        if (drawT > .5) {
          drawT = 0;
          if (poll.empty >= 8) ctx.mission('quiet');
          const row = (id, t) => { const l = lanes[id]; return h('tr', null, h('td', null, t), h('td', null, l.reqs), h('td', { class: id === 'poll' && l.empty ? 'badtxt' : '' }, id === 'poll' ? l.empty : '0'), h('td', null, l.got ? fmtMs(l.delaySum / l.got) : '–'), h('td', null, id === 'ws' ? 'Both' : id === 'sse' ? 'Server → client' : 'Request based')); };
          table.textContent = '';
          table.append(h('table', { class: 'table' }, h('tr', null, ['Technique', 'HTTP requests', 'Empty replies', 'Average delay', 'Direction'].map((t) => h('th', null, t))), LANES.map(([id, t]) => row(id, t))));
        }
      });
    },
  });

  RT.lab({
    id: 'kafka', title: 'Kafka Log', short: 'Kafka & queues', chapter: 'Distributed Messaging System',
    lede: 'Messages are appended to a log and stay there. Consumers move their own bookmarks. Add consumers, crash them, and replay history.',
    missions: [['key', 'Send the same key repeatedly and see it stay on one partition.'], ['group', 'Add a consumer and watch partitions rebalance.'], ['idle', 'Add more consumers than partitions and see one sit idle.'], ['replay', 'Rewind a group and replay old messages.'], ['fan', 'Start a second group and see it read the same messages independently.']],
    notes: `<ul><li>A <b>topic</b> is split into <b>partitions</b>, each an append-only log.</li><li>Order is guaranteed within a partition, not across partitions.</li><li>The same key always lands on the same partition.</li><li>In a <b>consumer group</b>, each partition has one consumer, so partitions cap parallelism.</li><li>Reading doesn't delete messages, so many groups can read the same data. A classic <b>queue</b> removes messages once consumed.</li></ul>`,
    check: { q: 'A topic has 3 partitions and a group has 5 consumers. How many consumers do work?', options: ['5', '3', '1', '8'], answer: 1, why: 'Each partition goes to one consumer in a group, so 2 consumers sit idle.' },
    render(root, ctx) {
      const P = 3, W = 900, LANE = 60, H = P * LANE + 46;
      const parts = Array.from({ length: P }, () => []);
      let groups = [{ name: 'A', consumers: 2, off: [0, 0, 0] }], paused = false, n = 0;
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'net', role: 'img', 'aria-label': 'Three partitions as logs with consumer offsets' });
      const stage = h('div', { class: 'stage' }, svg);
      const key = h('input', { type: 'text', id: 'kf-key', value: 'user-7', 'aria-label': 'Message key' });
      const banner = h('div', { class: 'banner', role: 'status' }, 'Produce some messages, and watch the consumers follow.');
      const groupBox = h('div', { class: 'scroll' });
      const auto = ui.toggle({ id: 'kf-auto', label: 'Auto-produce', checked: true });
      root.append(h('div', { class: 'controls' }, ui.field('Key', key), ui.btn('Produce', () => produce(key.value), { kind: 'primary', id: 'kf-produce' }), auto, ui.btn('Consumer +', () => changeC(1), { id: 'kf-add' }), ui.btn('Consumer −', () => changeC(-1)), ui.btn('Rewind group A', rewind, { id: 'kf-rewind' }), ui.btn('Start group B', startB, { id: 'kf-b' })), banner, stage, ui.card('Consumer groups', groupBox));
      const assign = (g) => { const out = Array.from({ length: g.consumers }, () => []); for (let i = 0; i < P; i++) out[i % g.consumers].push(i); return out; };
      function draw() {
        svg.textContent = '';
        parts.forEach((p, i) => {
          const y = 8 + i * LANE;
          svg.append(s('text', { class: 'lab', x: 8, y: y + 26 }, 'Partition ' + i), s('line', { class: 'lnk', x1: 88, x2: W - 10, y1: y + 42, y2: y + 42 }));
          const show = p.slice(-30), base = p.length - show.length;
          show.forEach((m, j) => {
            const x = 90 + j * 26;
            const read = groups[0].off[i] > base + j;
            svg.append(s('rect', { x, y: y + 12, width: 23, height: 26, rx: 2, fill: read ? 'var(--ok-soft)' : 'var(--req-soft)', stroke: read ? 'var(--res)' : 'var(--req)' }), s('text', { class: 'dim', x: x + 11.5, y: y + 29, 'text-anchor': 'middle' }, (m % 100)));
          });
          groups.forEach((g, gi) => { const x = 90 + Math.max(0, g.off[i] - base) * 26 - 2; svg.append(s('path', { d: `M${x},${y + 48}l-5,8h10z`, fill: gi ? 'var(--cache)' : 'var(--ref)' }), s('text', { class: 'dim', x: x + 7, y: y + 56 }, g.name)); });
        });
        groupBox.textContent = '';
        groupBox.append(h('table', { class: 'table' }, h('tr', null, ['Group', 'Consumer', 'Partitions', 'Lag'].map((t) => h('th', null, t))),
          groups.flatMap((g) => assign(g).map((ps, i) => h('tr', null, h('td', null, g.name), h('td', null, 'c' + (i + 1)), h('td', { class: ps.length ? '' : 'badtxt' }, ps.length ? ps.join(', ') : 'idle'), h('td', null, ps.reduce((t, x) => t + parts[x].length - g.off[x], 0)))))));
      }
      const seenKey = {};
      function produce(k) {
        const v = k || ('k' + (n % 11)), p = hash(v) % P; n++; parts[p].push(n);
        seenKey[v] = seenKey[v] || new Set(); seenKey[v].add(p);
        if (k) { (seenKey[v].count = (seenKey[v].count || 0) + 1); banner.className = 'banner'; banner.textContent = `hash("${v}") mod 3 = ${p}. Same key, same partition, so its messages stay in order.`; if (seenKey[v].count >= 3 && seenKey[v].size === 1) ctx.mission('key'); }
        draw();
      }
      function changeC(d) {
        const g = groups[0]; g.consumers = Math.max(1, Math.min(6, g.consumers + d));
        banner.className = 'banner warn'; banner.textContent = `Rebalance: group A now has ${g.consumers} consumer(s). Partitions were reassigned, and nothing was lost, because the offsets are stored.`;
        ctx.mission('group'); if (g.consumers > P) { ctx.mission('idle'); banner.textContent = `${g.consumers} consumers, 3 partitions: ${g.consumers - P} sit idle. Partitions cap a group's parallelism.`; }
        draw();
      }
      function rewind() { groups[0].off = [0, 0, 0]; banner.className = 'banner ok'; banner.textContent = 'Group A rewound to offset 0. It re-reads everything, because the log still has it.'; ctx.mission('replay'); draw(); }
      function startB() { if (groups[1]) return; groups.push({ name: 'B', consumers: 1, off: [0, 0, 0] }); banner.className = 'banner ok'; banner.textContent = 'Group B reads the same log with its own offsets. Neither group affects the other. That is pub/sub built on one log.'; ctx.mission('fan'); draw(); }
      ctx.every(700, () => { if (auto.checked) produce(''); });
      ctx.every(320, () => { let ch = false; groups.forEach((g) => { const a = assign(g); a.forEach((ps) => { ps.forEach((x) => { if (g.off[x] < parts[x].length) { g.off[x]++; ch = true; } }); }); }); if (ch) draw(); });
      for (let i = 0; i < 9; i++) produce('');
      void paused;
    },
  });

  /* ----- Trade-offs ----- */
  function syncTab(root, ctx) {
    const net = Net(ctx, { w: 860, h: 220, label: 'Order service calling three downstream services' });
    net.node('o', { x: 110, y: 110, label: 'Order API', sub: '', w: 118 }).node('q', { x: 360, y: 110, label: 'Queue', sub: 'broker', w: 100, cls: 'alt' });
    const S = [['Payment', 300], ['Email', 900], ['Stock', 400]];
    S.forEach(([t], i) => { net.node('s' + i, { x: 720, y: 40 + i * 70, label: t, sub: S[i][1] + ' ms', w: 118, h: 46 }); net.link('q', 's' + i); });
    net.link('o', 'q');
    const mode = ui.seg('Mode', [['sync', 'Synchronous'], ['async', 'Asynchronous']], 'sync');
    const fail = ui.toggle({ id: 'ta-fail', label: 'Email service is down' });
    const say = h('div', { class: 'banner', role: 'status' }, 'One order needs three downstream steps.');
    const stats = ui.stats([['t', 'User waited', '–'], ['r', 'Result', '–']]);
    let busy = false;
    root.append(h('div', { class: 'controls' }, ui.field('Mode', mode), fail, ui.btn('Place order', go, { kind: 'primary', id: 'ta-go' })), say, h('div', { class: 'stage' }, net.svg), stats);
    async function go() {
      if (busy) return; busy = true; net.state('s1', fail.checked ? 'dead' : '');
      if (mode.value === 'sync') {
        let t = 0;
        for (let i = 0; i < 3; i++) {
          await net.send('o', 'q', { color: 'req', dur: 180 }); await net.send('q', 's' + i, { label: 'call', color: 'req', dur: 300 });
          if (i === 1 && fail.checked) { await net.send('s' + i, 'o', { label: 'timeout', color: 'bad', dur: 700 }); stats.set('t', fmtMs(t + 3000), 'bad'); stats.set('r', 'Order failed', 'bad'); say.className = 'banner bad'; say.textContent = 'Sync couples availability: a broken email service just failed a paying customer.'; ctx.mission('sync-fail'); busy = false; return; }
          t += S[i][1]; await net.send('s' + i, 'o', { label: 'ok', color: 'res', dur: 300 });
        }
        stats.set('t', fmtMs(t)); stats.set('r', 'Done', 'good'); say.className = 'banner'; say.textContent = 'The user waited for the sum of all three calls. The result is simple and immediate.';
      } else {
        await net.send('o', 'q', { label: '3 events', color: 'cache', dur: 400 });
        stats.set('t', '20 ms', 'good'); stats.set('r', 'Accepted', 'good');
        say.className = 'banner ok'; say.textContent = fail.checked ? 'The order succeeded at once. The email event waits in the queue until the service recovers.' : 'The user got an answer at once. The work continues in the background.';
        await Promise.all(S.map(async (x, i) => { await ctx.sleep(120 * i); if (i === 1 && fail.checked) { await ctx.sleep(600); net.sub('q', '1 waiting'); return; } await net.send('q', 's' + i, { label: 'event', color: 'cache', dur: 500 }); net.flash('s' + i, 'hit'); }));
        if (fail.checked) ctx.mission('async-survive');
      }
      busy = false;
    }
  }
  function stateTab(root, ctx) {
    const net = Net(ctx, { w: 860, h: 220, label: 'Two servers, a load balancer and a shared store' });
    net.node('u', { x: 90, y: 100, label: 'User', sub: 'cart: 3 items', w: 112 }).node('lb', { x: 300, y: 100, label: 'Load balancer', sub: '', w: 132 }).node('a', { x: 560, y: 46, label: 'Server A', sub: '', w: 122, h: 46, onClick: () => { downA = !downA; net.state('a', downA ? 'dead' : ''); } }).node('b', { x: 560, y: 154, label: 'Server B', sub: '', w: 122, h: 46 }).node('r', { x: 780, y: 100, label: 'Session store', sub: 'Redis', w: 130, cls: 'alt' });
    net.link('u', 'lb').link('lb', 'a').link('lb', 'b').link('a', 'r').link('b', 'r');
    let downA = false;
    const mode = ui.seg('Mode', [['stateful', 'Stateful (session in memory)'], ['stateless', 'Stateless (session in store)']], 'stateful');
    const say = h('div', { class: 'banner', role: 'status' }, 'Your cart lives on Server A. Click Server A to kill it, then send a request.');
    root.append(h('div', { class: 'controls' }, ui.field('Where is the session?', mode), ui.btn('Send request', go, { kind: 'primary', id: 'ts-go' })), say, h('div', { class: 'stage' }, net.svg));
    async function go() {
      const t = downA ? 'b' : 'a';
      await net.send('u', 'lb', { label: 'view cart', color: 'req', dur: 450 }); await net.send('lb', t, { color: 'req', dur: 450 });
      if (mode.value === 'stateless') {
        await net.send(t, 'r', { label: 'get', color: 'cache', dur: 360 }); await net.send('r', t, { label: 'cart', color: 'cache', dur: 360 });
        await net.send(t, 'lb', { color: 'res', dur: 360 }); await net.send('lb', 'u', { label: '3 items', color: 'res', dur: 400 });
        say.className = 'banner ok'; say.textContent = downA ? 'Server A died, and nobody noticed. Any server can answer, because the session lives elsewhere.' : 'Any server can handle this. That makes scaling out trivial.';
        if (downA) ctx.mission('stateless');
      } else if (downA) {
        await net.send(t, 'lb', { color: 'bad', dur: 360 }); await net.send('lb', 'u', { label: 'cart empty', color: 'bad', dur: 400 });
        say.className = 'banner bad'; say.textContent = 'Server B has never heard of you. The session died with Server A, so your cart is gone.'; ctx.mission('stateful');
      } else {
        await net.send(t, 'lb', { color: 'res', dur: 360 }); await net.send('lb', 'u', { label: '3 items', color: 'res', dur: 400 });
        say.className = 'banner'; say.textContent = 'It works, but only because you were routed to Server A, and that server must stay alive.';
      }
    }
  }
  function batchTab(root, ctx) {
    const mode = ui.seg('Mode', [['batch', 'Batch (run every 10 s)'], ['stream', 'Stream (process each event)']], 'stream');
    const box = h('div', { class: 'seq-grid', style: { minHeight: '30px' } });
    const stats = ui.stats([['lat', 'Average freshness', '–'], ['done', 'Events processed', 0], ['wait', 'Waiting', 0]]);
    const say = h('div', { class: 'banner', role: 'status' }, 'Events arrive continuously. When do they become useful?');
    root.append(h('div', { class: 'controls' }, ui.field('Mode', mode)), say, ui.card('Event buffer', box), stats);
    let pending = [], done = 0, sum = 0, t = 0, ev = 0, batchT = 0;
    ctx.loop((dt) => {
      t += dt; ev += dt; batchT += dt;
      if (ev > .35) { ev = 0; pending.push(t); if (mode.value === 'stream') { const b = pending.shift(); done++; sum += .05 + (t - b); } }
      if (mode.value === 'batch' && batchT >= 10) { batchT = 0; pending.forEach((b) => { sum += t - b; done++; }); pending = []; }
      box.textContent = ''; pending.slice(-40).forEach(() => box.append(h('span', { class: 'sq wait' })));
      stats.set('lat', done ? fmtMs((sum / done) * 1000) : '–', mode.value === 'stream' ? 'good' : 'warn'); stats.set('done', done); stats.set('wait', pending.length);
      say.textContent = mode.value === 'batch' ? `Next run in ${Math.ceil(10 - batchT)} s. Efficient for large volumes, but results are as old as the batch window. Think nightly reports.` : 'Each event is handled as it arrives. Fresh, but always-on infrastructure is harder to run. Think fraud alerts.';
      if (done > 12 && mode.value === 'batch') ctx.mission('batch');
    });
  }
  function formatTab(root, ctx) {
    const json = h('textarea', { id: 'tf-json', rows: 9, 'aria-label': 'JSON', spellcheck: 'false', oninput: conv });
    json.value = JSON.stringify({ user: { id: 42, name: 'Ana', tags: ['admin', 'beta'], active: true } }, null, 2);
    const xml = h('pre', { class: 'hexbox', style: { margin: 0, whiteSpace: 'pre-wrap' } });
    const stats = ui.stats([['j', 'JSON, minified', ''], ['x', 'XML, minified', ''], ['o', 'XML overhead', '']]);
    root.append(h('div', { class: 'twocol' }, ui.card('JSON (edit me)', json), ui.card('Same data as XML', xml)), stats);
    const toXml = (k, v, ind) => {
      const p = '  '.repeat(ind);
      if (Array.isArray(v)) return v.map((x) => toXml(k.replace(/s$/, ''), x, ind)).join('');
      if (v && typeof v === 'object') return `${p}<${k}>\n${Object.entries(v).map(([a, b]) => toXml(a, b, ind + 1)).join('')}${p}</${k}>\n`;
      return `${p}<${k}>${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</${k}>\n`;
    };
    function conv() {
      try {
        const o = JSON.parse(json.value), x = toXml('root', o, 0), jb = utf8(JSON.stringify(o)).length, xb = utf8(x.replace(/\n\s*/g, '')).length;
        xml.textContent = x; stats.set('j', jb + ' B'); stats.set('x', xb + ' B'); stats.set('o', '+' + Math.round(((xb - jb) / jb) * 100) + '%', 'warn'); ctx.mission('format');
      } catch (e) { xml.textContent = 'That is not valid JSON yet: ' + e.message; }
    }
    conv();
  }

  RT.lab({
    id: 'tradeoffs', title: 'Architecture Trade-offs', short: 'Trade-offs', chapter: 'Misc Concepts',
    lede: 'Common "X vs Y" choices, each turned into a small experiment, so you can feel the difference.',
    missions: [['sync-fail', 'Fail a synchronous order because of one broken dependency.'], ['async-survive', 'Survive the same failure asynchronously.'], ['stateful', 'Lose a session with a stateful server.'], ['stateless', 'Survive the same crash when stateless.'], ['batch', 'Run a batch window and compare freshness.'], ['format', 'Compare JSON and XML sizes.']],
    notes: `<ul><li><b>Sync vs async</b>: simplicity and immediacy against decoupling and resilience.</li><li><b>Stateful vs stateless</b>: keeping state out of servers makes scaling and failure easy.</li><li><b>Batch vs stream</b>: throughput and simplicity against freshness.</li><li><b>XML vs JSON</b>: schemas and verbosity against compact and easy.</li></ul>`,
    check: { q: 'What usually makes a web tier easy to scale horizontally?', options: ['Keeping sessions in server memory', 'Keeping sessions in a shared store or token', 'A bigger server', 'Sticky sessions'], answer: 1, why: 'When any server can handle any request, you can add or lose servers freely.' },
    render(root, ctx) {
      const items = [['sync', 'Sync vs async', syncTab], ['state', 'Stateful vs stateless', stateTab], ['batch', 'Batch vs stream', batchTab], ['format', 'JSON vs XML', formatTab]];
      const panes = {}, made = {};
      const tabs = ui.tabs(items.map(([a, b]) => [a, b]), (v) => {
        items.forEach(([id, , fn]) => { panes[id].classList.toggle('hide', id !== v); if (id === v && !made[id]) { made[id] = true; fn(panes[id], ctx); } });
      });
      root.append(tabs);
      items.forEach(([id]) => { panes[id] = h('div', { class: 'labmain hide' }); root.append(panes[id]); });
      tabs.set('sync');
    },
  });
})();
