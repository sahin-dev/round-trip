/* Capacity Estimator and Decision Trainer. */
(function () {
  const { h, ui } = RT;
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* works without storage */ } };
  const fmtBytes = (kb) => (kb >= 1e12 ? (kb / 1e12).toFixed(1) + ' PB' : kb >= 1e9 ? (kb / 1e9).toFixed(1) + ' TB' : kb >= 1e6 ? (kb / 1e6).toFixed(1) + ' GB' : kb >= 1e3 ? (kb / 1e3).toFixed(1) + ' MB' : kb.toFixed(0) + ' KB');
  const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : n >= 10 ? Math.round(n).toString() : n.toFixed(1));

  function calcTab(root, ctx) {
    const f = { dau: 10, reads: 30, writes: 3, kb: 2, years: 3, peak: 3 };
    const dau = ui.slider({ id: 'es-dau', label: 'Daily active users', min: .1, max: 500, step: .1, value: 10, fmt: (v) => v + 'M', onInput: run });
    const reads = ui.slider({ id: 'es-r', label: 'Reads per user per day', min: 1, max: 200, value: 30, onInput: run });
    const writes = ui.slider({ id: 'es-w', label: 'Writes per user per day', min: .1, max: 50, step: .1, value: 3, onInput: run });
    const kb = ui.slider({ id: 'es-kb', label: 'Record size', min: .1, max: 100, step: .1, value: 2, fmt: (v) => v + ' KB', onInput: run });
    const years = ui.slider({ id: 'es-y', label: 'Keep data for', min: 1, max: 10, value: 3, fmt: (v) => v + ' years', onInput: run });
    const peak = ui.slider({ id: 'es-p', label: 'Peak vs average', min: 1.5, max: 10, step: .5, value: 3, fmt: (v) => v + '×', onInput: run });
    const sloR = ui.slider({ id: 'es-lat', label: 'Target read time', min: 50, max: 800, step: 10, value: 200, fmt: (v) => v + ' ms' });
    const avail = ui.select({ id: 'es-av', label: 'Availability target', value: '.999', options: [['.99', '99%'], ['.999', '99.9%'], ['.9995', '99.95%'], ['.9999', '99.99%']] });
    const media = ui.slider({ id: 'es-m', label: 'Media views per user', min: 0, max: 200, step: 5, value: 0 });
    const strong = ui.toggle({ id: 'es-strong', label: 'Must be strongly consistent' });
    const global = ui.toggle({ id: 'es-global', label: 'Users worldwide' });
    const out = ui.stats([['rq', 'Peak reads/s'], ['wq', 'Peak writes/s'], ['ratio', 'Read:write ratio'], ['store', 'Storage'], ['cache', 'Cache (20% of daily reads)'], ['bw', 'Peak read bandwidth'], ['srv', 'App servers at 900 rps']]);
    const steps = h('pre', { class: 'dig' });
    const toStudio = ui.btn('Design this in the Studio', () => {
      const b = { id: 'custom', custom: true, title: 'My system', level: 'Custom', pitch: `Your own workload: ${dau.value}M daily users.`, stages: [{ name: 'Launch', dau: dau.value * 1e5 }, { name: 'Growth', dau: dau.value * 1e6 }, { name: 'Hyper-scale', dau: dau.value * 1e7 }],
        reads: reads.value, writes: writes.value, media: media.value, mediaKB: 300, recordKB: kb.value, years: years.value, peak: peak.value, maxHit: .92, strong: strong.checked, global: global.checked, slo: { read: sloR.value, write: sloR.value * 1.5, media: 250, avail: +avail.value }, shape: { store: strong.checked ? 'sql' : 'nosql', cache: 1, cdn: media.value > 0 ? 1 : 0, regions: global.checked ? 2 : 0, queue: reads.value / writes.value < 3 ? 1 : 0 } };
      save('roundtrip.custom', b);
      try { sessionStorage.setItem('rt-open-brief', 'custom'); } catch { /* the brief list still offers it */ }
      location.hash = 'studio';
    }, { kind: 'primary', id: 'es-studio' });
    root.append(h('div', { class: 'controls' }, dau, reads, writes, kb, years, peak), ui.card('Targets for your own brief', h('div', { class: 'controls flat' }, sloR, avail, media, strong, global)), out, ui.card('Show the working', steps), h('div', { class: 'controls flat' }, toStudio, h('span', { class: 'small muted' }, 'Launch is 1/10 of these users, Growth is this size, and Hyper-scale is 10×.')));
    function run() {
      const U = dau.value * 1e6, avgR = (U * reads.value) / 86400, avgW = (U * writes.value) / 86400, pR = avgR * peak.value, pW = avgW * peak.value;
      const storeKB = U * writes.value * 365 * years.value * kb.value, cacheKB = U * reads.value * kb.value * .2;
      out.set('rq', fmtN(pR)); out.set('wq', fmtN(pW)); out.set('ratio', Math.round(reads.value / writes.value) + ':1'); out.set('store', fmtBytes(storeKB)); out.set('cache', fmtBytes(cacheKB));
      out.set('bw', (((pR * kb.value * 8) / 1e6)).toFixed(1) + ' Gbps'); out.set('srv', Math.ceil(((pR + pW) / 900) / .5));
      steps.textContent = `Average reads   = ${fmtN(U)} users × ${reads.value} ÷ 86,400 s = ${fmtN(avgR)}/s\nPeak reads      = ${fmtN(avgR)} × ${peak.value} = ${fmtN(pR)}/s\nAverage writes  = ${fmtN(U)} users × ${writes.value} ÷ 86,400 s = ${fmtN(avgW)}/s\nPeak writes     = ${fmtN(avgW)} × ${peak.value} = ${fmtN(pW)}/s\nStorage         = ${fmtN(U)} × ${writes.value}/day × 365 × ${years.value} y × ${kb.value} KB = ${fmtBytes(storeKB)}\nCache           = 20% of ${fmtBytes(U * reads.value * kb.value)} read per day = ${fmtBytes(cacheKB)}\nServers         = ${fmtN(pR + pW)} rps ÷ 900 rps ÷ 50% target load = ${Math.ceil(((pR + pW) / 900) / .5)}`;
    }
    void f; run();
  }

  const PROMPTS = [
    ['a photo-sharing app', 'photos', 2, 40, 800], ['a messaging app', 'messages', 40, 40, 1], ['a micro-blogging site', 'posts', 2, 100, 1], ['a ride-hailing app', 'trip updates', 12, 12, .5],
    ['a food delivery app', 'orders', .3, 15, 2], ['a news site', 'comments', .1, 30, 1], ['an online code judge', 'submissions', 3, 10, 20], ['a music streaming app', 'plays', 20, 20, .2],
  ];
  function drillTab(root, ctx) {
    const stats = load('roundtrip.estimate', { done: 0, good: 0 });
    let q = null, seen = 0;
    const box = h('div', { class: 'labmain' }), tally = h('p', { class: 'small muted' });
    root.append(box, tally);
    function next() {
      const p = PROMPTS[Math.floor(Math.random() * PROMPTS.length)], dau = [1, 2, 5, 10, 20, 50, 100, 200][Math.floor(Math.random() * 8)];
      const [name, thing, wr, rd, kb] = p;
      q = { name, thing, dau, wr, rd, kb, ans: { w: (dau * 1e6 * wr) / 86400, r: (dau * 1e6 * rd) / 86400, s: (dau * 1e6 * wr * 365 * kb) / 1e9 } };
      seen++; draw();
    }
    function draw() {
      box.textContent = '';
      const i = (id, label, unit) => { const el = h('input', { type: 'number', id, 'aria-label': label, step: 'any', min: 0 }); return { el, field: ui.field(`${label} (${unit})`, el) }; };
      const w = i('dr-w', 'Average writes', 'per second'), r = i('dr-r', 'Average reads', 'per second'), st = i('dr-s', 'Storage for one year', 'TB');
      const result = h('div');
      box.append(ui.card('Estimate this, on paper first', h('p', null, `You are designing ${q.name} with ${q.dau} million daily users. Each user creates ${q.wr} ${q.thing} a day and reads ${q.rd} a day. Each is about ${q.kb} KB.`), h('p', { class: 'small muted', style: { marginTop: '4px' } }, 'Use 100,000 seconds in a day to keep the maths simple. Within 3× counts as right, since interviews reward the right order of magnitude.')),
        h('div', { class: 'controls' }, w.field, r.field, st.field, ui.btn('Check', check, { kind: 'primary', id: 'dr-check' }), ui.btn('Next problem', next, { id: 'dr-next' })), result);
      function check() {
        const rows = [['Writes/s', +w.el.value, q.ans.w, `${q.dau}M × ${q.wr} ÷ 86,400`], ['Reads/s', +r.el.value, q.ans.r, `${q.dau}M × ${q.rd} ÷ 86,400`], ['Storage TB/year', +st.el.value, q.ans.s, `${q.dau}M × ${q.wr} × 365 × ${q.kb} KB`]];
        const good = (a, b) => a > 0 && a / b <= 3 && b / a <= 3, all = rows.every(([, a, b]) => good(a, b));
        result.textContent = '';
        result.append(h('div', { class: 'banner ' + (all ? 'ok' : 'warn'), role: 'status' }, all ? 'All three are in the right range.' : 'Not quite. Check the working below.'), h('div', { class: 'scroll' }, h('table', { class: 'table', style: { marginTop: '6px' } }, h('tr', null, ['Measure', 'You', 'Answer', 'Off by', 'Working'].map((t) => h('th', null, t))), rows.map(([n, a, b, wk]) => h('tr', null, h('td', null, n), h('td', null, a || '–'), h('td', null, fmtN(b)), h('td', { class: good(a, b) ? 'good' : 'badtxt' }, a > 0 ? (Math.max(a / b, b / a)).toFixed(1) + '×' : '–'), h('td', null, wk))))));
        stats.done++; if (all) stats.good++; save('roundtrip.estimate', stats); tallyDraw();
        if (all) ctx.mission('drill1'); if (stats.good >= 5) ctx.mission('drill5');
      }
    }
    const tallyDraw = () => { tally.textContent = stats.done ? `Solved ${stats.good} of ${stats.done} attempts.` : ''; };
    next(); tallyDraw(); void seen;
  }

  function factsTab(root) {
    const table = (title, heads, rows) => ui.card(title, h('div', { class: 'scroll' }, h('table', { class: 'table' }, h('tr', null, heads.map((t) => h('th', null, t))), rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))))));
    root.append(h('div', { class: 'twocol' },
      table('Latency to know (rough orders of magnitude)', ['Operation', 'Time'], [['Memory read', '100 ns'], ['Read 1 MB from memory', '250 µs'], ['Same-zone round trip', '0.5 ms'], ['SSD random read', '100 µs'], ['Read 1 MB from SSD', '1 ms'], ['Disk seek', '10 ms'], ['Across a continent', '40 ms'], ['Across an ocean', '150 ms']]),
      table('Sizes and time', ['Item', 'Value'], [['2^10', '1 thousand (KB)'], ['2^20', '1 million (MB)'], ['2^30', '1 billion (GB)'], ['2^40', '1 trillion (TB)'], ['Seconds in a day', '86,400 (say 100k)'], ['Seconds in a month', '2.6 million'], ['1 million/day', 'about 12/s'], ['1 billion/day', 'about 12,000/s']]),
      table('Availability budget', ['Target', 'Down per year', 'Down per month'], [['99%', '3.65 days', '7.3 h'], ['99.9%', '8.8 h', '44 min'], ['99.95%', '4.4 h', '22 min'], ['99.99%', '53 min', '4.4 min'], ['99.999%', '5.3 min', '26 s']]),
      table('Rough capacities (assumed in this site)', ['Component', 'Per instance'], [['App server', '400–1,800 requests/s'], ['SQL primary', '4k writes/s, 12k reads/s, 4 TB'], ['NoSQL node', '12k writes/s, 10k reads/s, 6 TB'], ['Cache node', '100k operations/s'], ['Queue broker', '50k messages/s'], ['WebSocket server', '12k messages/s']])));
  }

  RT.lab({
    id: 'estimate', title: 'Capacity Estimator', short: 'Capacity Estimator', chapter: 'Practice',
    lede: 'Good designs start with numbers. Work out traffic and storage, drill it until it\'s quick, and send your own workload to the Studio.',
    missions: [['drill1', 'Solve an estimation problem within 3×.'], ['drill5', 'Solve five.']],
    notes: `<ul><li>Round hard. A day is about 100,000 seconds.</li><li>Say your assumptions out loud, because interviewers score the method.</li><li>Convert everything to per-second and per-year.</li><li>Then ask: which number changes the design?</li></ul>`,
    check: { q: '100 million users each write once a day. Roughly how many writes per second is that on average?', options: ['100', '1,000', '10,000', '100,000'], answer: 1, why: '100M ÷ 100k seconds is about 1,000/s, so peaks may reach a few thousand.' },
    render(root, ctx) {
      const a = h('div', { class: 'labmain' }), b = h('div', { class: 'labmain hide' }), c = h('div', { class: 'labmain hide' }); const made = {};
      const tabs = ui.tabs([['c', 'Calculator'], ['d', 'Practice drill'], ['f', 'Numbers to know']], (v) => { [[a, 'c'], [b, 'd'], [c, 'f']].forEach(([p, k]) => p.classList.toggle('hide', k !== v)); if (!made[v]) { made[v] = 1; if (v === 'd') drillTab(b, ctx); if (v === 'f') factsTab(c); } });
      root.append(tabs, a, b, c); calcTab(a, ctx); made.c = 1; tabs.set('c');
    },
  });

  /* ----- Decision Trainer ----- */
  const CARDS = [
    ['Caching', 'Product pages are read 1,000 times for each update, and being a minute stale is fine.', ['Cache-aside with a short TTL', 'Write-back cache', 'Read from the primary every time'], 0, 'Reads dominate and staleness is tolerable, so a simple cache with a TTL wins.', 'cacheflow'],
    ['Caching', 'A popular key expires, and thousands of requests stampede to the database.', ['Raise the database\'s timeout', 'Coalesce requests behind a lock', 'Lower the TTL'], 1, 'One request rebuilds, and the rest wait for its result.', 'stampede'],
    ['Caching', 'Attackers request random IDs that do not exist, bypassing your cache.', ['Bigger cache', 'Bloom filter or negative caching', 'More replicas'], 1, 'This is cache penetration. Filter or remember the misses.', 'bloom'],
    ['Databases', 'A bank needs money transfers that can never half-complete.', ['Eventually consistent key-value store', 'SQL with transactions', 'Cache with write-back'], 1, 'Atomic transactions are exactly what this needs.', 'acid'],
    ['Databases', 'Reads are saturating a healthy primary, and writes are fine.', ['Add read replicas or a cache', 'Add shards', 'Add a message queue'], 0, 'Read load scales with replicas and caches. Shards are the costlier fix.', 'replication'],
    ['Databases', 'Writes are saturating the primary, and the data set keeps growing.', ['Add read replicas', 'Shard the data', 'Bigger cache'], 1, 'Replicas repeat every write, so only splitting data raises write capacity.', 'sharding'],
    ['Databases', 'Queries by email are slow on a 50 million row table.', ['Add an index on email', 'Add a replica', 'Move to a cache'], 0, 'A full scan is the problem, and an index fixes it directly.', 'index'],
    ['Databases', 'Order history must show the customer\'s address at the time of ordering.', ['Normalize it into the customer table', 'Copy it onto the order', 'Keep it in a cache'], 1, 'Denormalizing here records a historical fact, so the copy is correct.', 'acid'],
    ['Sharding', 'You must pick a shard key for a table of tweets.', ['created_at', 'Hashed user_id', 'Country'], 1, 'Time keys create one hot shard, and country keys are skewed. A hashed key spreads evenly.', 'sharding'],
    ['Sharding', 'Your cache cluster often adds and removes nodes.', ['hash(key) mod N', 'Consistent hashing', 'Range partitioning'], 1, 'With mod N, a resize moves nearly every key. Consistent hashing moves about 1/N.', 'sharding'],
    ['Consistency', 'During a network partition, a shopping cart should still accept items.', ['Choose CP', 'Choose AP and merge later', 'Stop the whole site'], 1, 'A cart conflict can be merged, but a lost sale cannot.', 'cap'],
    ['Consistency', 'A flash sale has 100 units left and must never oversell.', ['AP store with eventual consistency', 'Strongly consistent check on the stock row', 'Client-side counter'], 1, 'Stock is the one number that must be correct, so this data gets strong consistency.', 'cap'],
    ['Consistency', 'N=5. You need reads to always see the latest write.', ['W=2, R=2', 'W=3, R=3', 'W=1, R=1'], 1, 'R + W must exceed N for the sets to overlap.', 'quorum'],
    ['Traffic', 'Requests vary from 10 ms to 10 s across identical servers.', ['Round robin', 'Least connections', 'Random'], 1, 'Counting open connections reflects real load, and turn-taking does not.', 'lb'],
    ['Traffic', 'You need routing by URL path, auth and rate limits at the front door.', ['Layer 4 load balancer', 'API gateway', 'DNS round robin'], 1, 'Those are Layer 7, API-level concerns.', 'gateway'],
    ['Traffic', 'Users in Tokyo wait a long time for images hosted in Virginia.', ['Bigger servers in Virginia', 'A CDN', 'A faster database'], 1, 'Distance is the problem, so move the content closer.', 'cdn'],
    ['Traffic', 'A public API should allow short bursts but cap sustained use.', ['Fixed window counter', 'Token bucket', 'No limit, autoscale instead'], 1, 'Tokens accumulate during quiet time, which allows bursts within a steady rate.', 'workbench'],
    ['Messaging', 'One order must trigger email, invoicing and analytics.', ['Call all three synchronously', 'Publish an event for each to consume', 'One big transaction'], 1, 'Pub/sub decouples them, so a slow email service cannot fail the order.', 'tradeoffs'],
    ['Messaging', 'Traffic bursts overwhelm a database that averages well below capacity.', ['Queue the writes and consume steadily', 'Drop the requests', 'Raise the timeout'], 0, 'A queue turns a spike into a steady flow.', 'kafka'],
    ['Messaging', 'You need to replay last week\'s events into a new service.', ['Classic work queue', 'Kafka-style log', 'HTTP webhooks'], 1, 'A log keeps messages after they are read, so a new consumer can start from the past.', 'kafka'],
    ['Messaging', 'A message keeps failing and is blocking the partition.', ['Retry forever', 'Send it to a dead-letter queue', 'Restart the broker'], 1, 'Move it aside after a few retries, and investigate separately.', 'kafka'],
    ['Realtime', 'A live scoreboard only pushes updates to viewers.', ['WebSockets', 'Server-Sent Events', 'Poll each second'], 1, 'One-way push over plain HTTP is the simplest fit.', 'realtime'],
    ['Realtime', 'A multiplayer game needs low-latency messages both ways.', ['WebSockets', 'Long polling', 'SSE'], 0, 'Full duplex over one connection fits two-way traffic.', 'realtime'],
    ['Reliability', 'A recovering service is immediately knocked over again by retries.', ['Retry immediately', 'Exponential backoff with jitter', 'Remove the timeout'], 1, 'Jitter breaks up the herd of synchronized clients.', 'availability'],
    ['Reliability', 'Your one load balancer failed and took the site down.', ['Add more app servers', 'Run an active-passive pair', 'Add a cache'], 1, 'The balancer was the single point of failure.', 'lb'],
    ['Reliability', 'Someone runs a bad DELETE, and replicas apply it within a second.', ['Promote a replica', 'Restore from a backup', 'Add sync replication'], 1, 'Replication copies mistakes, so you need a point in the past.', 'replication'],
    ['Security', 'Services need to verify a user without calling a session store.', ['Signed JWT', 'Server-side sessions', 'Basic auth to each service'], 0, 'A signed token can be verified statelessly. The trade-off is harder revocation.', 'auth'],
    ['Security', 'A third-party app wants a user\'s calendar without their password.', ['Ask for the password', 'OAuth delegation', 'Share an API key by email'], 1, 'That is exactly the delegation OAuth was made for.', 'auth'],
    ['Security', 'A 300 Gbps flood saturates your 10 Gbps uplink.', ['Rate limit in your app', 'Scrubbing service upstream', 'More app servers'], 1, 'Traffic has to be stopped before it reaches your link.', 'ddos'],
    ['Storage', 'You must store 50 PB of video files.', ['SQL BLOB columns', 'Object storage', 'Redis'], 1, 'Object storage is built for large, durable, cheap files.', 'dfs'],
    ['Storage', 'Users need typo-tolerant full-text search.', ['SQL LIKE queries', 'Search index', 'Bloom filter'], 1, 'An inverted index is purpose-built for this.', 'index'],
    ['Architecture', 'Your web tier must scale by adding servers freely.', ['Keep sessions in server memory', 'Keep sessions in a shared store', 'Pin users with sticky sessions'], 1, 'Stateless servers can be added and lost without users noticing.', 'tradeoffs'],
  ];
  RT.lab({
    id: 'trainer', title: 'Decision Trainer', short: 'Decision Trainer', chapter: 'Practice',
    lede: 'System design is a chain of trade-offs. Make the call on 32 real situations. Cards you get wrong come back until they stick.',
    missions: [['ten', 'Answer 10 cards correctly.'], ['streak', 'Get 8 right in a row.'], ['all', 'Clear every card at least once.']],
    notes: `<ul><li>Name the constraint first, then choose the tool.</li><li>A wrong answer is useful: follow its link to the matching lab.</li><li>Each card has one best answer for that situation. Change the situation, and the answer can change.</li></ul>`,
    render(root, ctx) {
      const st = load('roundtrip.trainer', { right: {}, wrong: {} });
      let streak = 0, order = [], topic = 'All', cur = null;
      const topics = ['All', ...new Set(CARDS.map((c) => c[0]))];
      const seg = ui.seg('Topic', topics.map((t) => [t, t]), 'All', (v) => { topic = v; build(); });
      const board = h('div', { class: 'stats' }), area = h('div'), weak = h('div');
      root.append(h('div', { class: 'controls' }, ui.field('Topic', seg), ui.btn('Reset progress', () => { st.right = {}; st.wrong = {}; save('roundtrip.trainer', st); build(); }, { kind: 'danger' })), board, area, ui.card('Topic strength', weak));
      function build() {
        const pool = CARDS.map((c, i) => i).filter((i) => topic === 'All' || CARDS[i][0] === topic);
        const score = (i) => (st.right[i] || 0) * 2 - (st.wrong[i] || 0) * 3 + Math.random();
        order = pool.sort((a, b) => score(a) - score(b)); next();
      }
      function board_() {
        const seen = Object.keys(st.right).length, tot = Object.values(st.right).reduce((a, b) => a + b, 0);
        board.textContent = '';
        [['Cards cleared', `${seen}/${CARDS.length}`], ['Correct answers', tot], ['Current streak', streak], ['Still shaky', Object.keys(st.wrong).filter((i) => st.wrong[i] >= (st.right[i] || 0)).length]].forEach(([k, v]) => board.append(h('div', { class: 'stat' }, h('b', null, v), h('span', null, k))));
        weak.textContent = '';
        [...new Set(CARDS.map((c) => c[0]))].forEach((t) => {
          const ids = CARDS.map((c, i) => [c, i]).filter(([c]) => c[0] === t), done = ids.filter(([, i]) => st.right[i]).length, b = ui.bar(done === ids.length ? 'res' : ''); b.set((done / ids.length) * 100);
          weak.append(h('div', { class: 'small mono', style: { marginBottom: '4px' } }, `${t} ${done}/${ids.length}`, b));
        });
      }
      function next() {
        cur = order.shift(); if (cur == null) { build(); return; }
        const c = CARDS[cur], opts = c[2].map((t, i) => [t, i]).sort(() => Math.random() - .5);
        area.textContent = '';
        const why = h('div', { class: 'small hide', style: { marginTop: '8px' } }), nextB = ui.btn('Next card', next, { kind: 'primary', id: 'tr-next' });
        nextB.classList.add('hide');
        const btns = opts.map(([t, i]) => h('button', { onclick() {
          const right = i === c[3];
          btns.forEach((b, j) => { b.disabled = true; if (opts[j][1] === c[3]) b.classList.add('right'); else if (j === btns.indexOf(this_(i))) b.classList.add('wrong'); });
          if (right) { st.right[cur] = (st.right[cur] || 0) + 1; streak++; } else { st.wrong[cur] = (st.wrong[cur] || 0) + 1; streak = 0; order.splice(Math.min(3, order.length), 0, cur); }
          save('roundtrip.trainer', st);
          const tot = Object.values(st.right).reduce((a, b) => a + b, 0);
          if (tot >= 10) ctx.mission('ten'); if (streak >= 8) ctx.mission('streak'); if (Object.keys(st.right).length >= CARDS.length) ctx.mission('all');
          why.classList.remove('hide'); why.textContent = ''; why.append(h('p', null, c[4]), h('a', { href: '#' + c[5] }, 'Open the related lab'));
          nextB.classList.remove('hide'); board_();
        } }, t));
        const this_ = (i) => btns[opts.findIndex((o) => o[1] === i)];
        area.append(ui.card(c[0], h('div', { class: 'quiz' }, h('p', { style: { fontSize: '17px' } }, c[1]), btns, why), h('div', { style: { height: '8px' } }), nextB));
        board_();
      }
      build();
    },
  });
})();
