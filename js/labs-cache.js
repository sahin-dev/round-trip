/* Cache eviction, cache read/write strategies, stampede. */
(function () {
  const { h, s, ui, Net, seeded, fmtMs } = RT;

  RT.lab({
    id: 'eviction', title: 'Cache Eviction', short: 'Cache eviction', chapter: 'Caching',
    lede: 'Four caches get the same requests. When they fill up, each one throws out a different item. Press keys or play a workload to see which policy wins.',
    missions: [['hit', 'Get a cache hit.'], ['scan', 'Run the scan workload and see LFU protect its hot keys better than LRU.'], ['loop', 'Run a loop one key larger than the cache and wipe out LRU\'s hit rate.'], ['bigger', 'Double the cache size and see how the hit rate responds.']],
    notes: `<ul><li><b>LRU</b> evicts the item unused for longest. It's the usual default.</li><li><b>LFU</b> evicts the item used least often. It protects hot keys, but old favourites linger.</li><li><b>FIFO</b> evicts the oldest arrival, however popular.</li><li><b>Random</b> needs no bookkeeping, and it does surprisingly well.</li><li><b>Hit rate</b> is hits ÷ total requests. It's the number that matters most.</li></ul>`,
    check: { q: 'A nightly job reads every row once. Which policy lets it flush out your hot data?', options: ['LRU', 'LFU', 'Both equally', 'Neither'], answer: 0, why: 'Each row looks "recently used" to LRU, so hot items get pushed out. This is cache pollution. LFU keeps the items with real frequency.' },
    render(root, ctx) {
      const POL = ['LRU', 'LFU', 'FIFO', 'Random'];
      const KEYS = 'ABCDEFGHIJ'.split('');
      const rnd = seeded(11);
      const size = ui.slider({ id: 'ev-size', label: 'Cache size', min: 2, max: 8, value: 4, onInput: () => reset() });
      const pads = h('div', { class: 'chips' }, KEYS.map((k) => h('button', { class: 'btn', style: { width: '40px', padding: '7px 0' }, onclick() { access(k); } }, k)));
      const load = ui.select({ id: 'ev-load', label: 'Workload', value: 'zipf', options: [['zipf', 'Skewed (a few hot keys)'], ['loop', 'Loop (cache size + 1 keys)'], ['scan', 'Hot keys, then a full scan'], ['uni', 'Uniform random']] });
      const cards = {};
      const grid = h('div', { class: 'twocol' }, POL.map((p) => {
        const slots = h('div', { class: 'slots' }), hit = h('b', { class: 'mono' }, '0%'), bar = ui.bar('res'), evict = h('div', { class: 'small muted', style: { minHeight: '20px' } }, 'empty');
        cards[p] = { slots, hit, bar, evict, items: [], freq: {}, hits: 0, total: 0 };
        return ui.card(p, h('div', { style: { display: 'grid', gap: '6px' } }, slots, h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, h('span', { class: 'small' }, 'Hit rate'), hit), bar, evict));
      }));
      const stream = h('div', { class: 'mono small muted', style: { overflow: 'hidden', whiteSpace: 'nowrap' } }, 'Requests: ');
      const playB = ui.btn('Play 60 requests', play, { kind: 'primary', id: 'ev-play' });
      root.append(ui.card('Press a key to request it', pads), h('div', { class: 'controls' }, size, load, playB, ui.btn('Clear', reset)), stream, grid);
      let playing = false, lastSize = 4, base = null;
      function reset() {
        POL.forEach((p) => { const c = cards[p]; c.items = []; c.freq = {}; c.hits = 0; c.total = 0; c.evict.textContent = 'empty'; draw(c); });
        stream.textContent = 'Requests: ';
      }
      function draw(c, flash, ghost) {
        c.slots.textContent = '';
        c.items.forEach((k) => c.slots.append(h('div', { class: 'slot ' + (flash && flash[0] === k ? flash[1] : '') }, k, h('sup', null, c.freq[k] || ''))));
        if (ghost) c.slots.append(h('div', { class: 'slot ghost' }, ghost));
        const r = c.total ? (c.hits / c.total) * 100 : 0;
        c.hit.textContent = Math.round(r) + '%'; c.bar.set(r);
      }
      function access(k) {
        stream.textContent += k; if (stream.textContent.length > 110) stream.textContent = 'Requests: …' + stream.textContent.slice(-90);
        POL.forEach((p) => {
          const c = cards[p]; c.total++;
          c.freq[k] = (c.freq[k] || 0) + 1;
          if (c.items.includes(k)) {
            c.hits++; ctx.mission('hit');
            if (p === 'LRU') { c.items.splice(c.items.indexOf(k), 1); c.items.push(k); }
            c.evict.textContent = 'hit'; draw(c, [k, 'flashhit']);
            return;
          }
          let out = null;
          if (c.items.length >= size.value) {
            let i = 0;
            if (p === 'LFU') { let m = Infinity; c.items.forEach((x, j) => { if (c.freq[x] < m) { m = c.freq[x]; i = j; } }); }
            else if (p === 'Random') i = Math.floor(rnd() * c.items.length);
            out = c.items.splice(i, 1)[0];
          }
          c.items.push(k);
          c.evict.textContent = out ? `miss, evicted ${out}` : 'miss';
          draw(c, [k, 'flashnew'], out);
        });
      }
      function nextKey(i) {
        const sz = size.value;
        switch (load.value) {
          case 'loop': return KEYS[i % (sz + 1)];
          case 'scan': return i < 24 ? 'ABC'[Math.floor(rnd() * 3)] : i < 46 ? KEYS[3 + (i % 7)] : 'ABC'[Math.floor(rnd() * 3)];
          case 'uni': return KEYS[Math.floor(rnd() * 10)];
          default: { const x = rnd(); return KEYS[Math.floor(x * x * x * 10)]; }
        }
      }
      async function play() {
        if (playing) return; playing = true; playB.disabled = true; reset();
        for (let i = 0; i < 60; i++) { access(nextKey(i)); await ctx.sleep(110); }
        const rate = (p) => cards[p].hits / cards[p].total;
        if (load.value === 'scan' && rate('LFU') > rate('LRU')) ctx.mission('scan');
        if (load.value === 'loop' && rate('LRU') < .05) ctx.mission('loop');
        if (load.value === 'zipf') {
          if (base && size.value >= base.size * 2 && rate('LRU') > base.r) ctx.mission('bigger');
          if (!base || size.value < base.size) base = { size: size.value, r: rate('LRU') };
        }
        playing = false; playB.disabled = false;
      }
      void lastSize;
      reset();
    },
  });

  RT.lab({
    id: 'cacheflow', title: 'Cache Strategies', short: 'Read & write paths', chapter: 'Caching',
    lede: 'Who talks to the database, and when? Pick a strategy, read and write some values, then crash the cache at the worst moment.',
    missions: [['aside', 'Handle a cache-aside miss, with the app loading the cache itself.'], ['stale', 'Create a stale read with write-around.'], ['fast', 'See write-back acknowledge a write far faster than write-through.'], ['lost', 'Crash the cache and lose unflushed write-back data.'], ['safe', 'Crash the cache under write-through and lose nothing.']],
    notes: `<ul><li><b>Cache-aside</b>: the app manages the cache. It survives cache failure, but needs more code.</li><li><b>Read-through</b>: the cache loads missing data itself.</li><li><b>Write-through</b>: writes both, synchronously. It's safe but slower.</li><li><b>Write-around</b>: writes the database only. Good for write-once data, but reads may go stale.</li><li><b>Write-back</b>: writes the cache and flushes later. It's fast, but a crash can lose data.</li></ul>`,
    check: { q: 'A payments ledger must never lose an acknowledged write. Which should you avoid?', options: ['Write-through', 'Write-around', 'Write-back', 'Cache-aside'], answer: 2, why: 'Write-back acknowledges before the database has the data, so a cache crash loses it.' },
    render(root, ctx) {
      const net = Net(ctx, { w: 860, h: 230, label: 'App, cache and database' });
      net.node('app', { x: 110, y: 115, label: 'App', sub: '', w: 110 }).node('cache', { x: 430, y: 55, label: 'Cache', sub: '1 ms', w: 170 }).node('db', { x: 740, y: 150, label: 'Database', sub: '30 ms', w: 170 });
      net.link('app', 'cache').link('cache', 'db').link('app', 'db');
      const strat = ui.seg('Strategy', [['aside', 'Cache-aside'], ['rt', 'Read-through'], ['wt', 'Write-through'], ['wa', 'Write-around'], ['wb', 'Write-back']], 'aside', changed);
      const banner = h('div', { class: 'banner', role: 'status' }, 'Read x from a cold cache to begin.');
      const stats = ui.stats([['lat', 'Last operation', '–'], ['cv', 'Cache has x', '–'], ['dv', 'Database has x', '100'], ['dirty', 'Unflushed writes', 0]]);
      let cv = null, dv = 100, dirty = 0, next = 101, busy = false, crashed = false;
      root.append(h('div', { class: 'controls' }, ui.field('Strategy', strat), ui.btn('Read x', read, { kind: 'primary', id: 'cf-read' }), ui.btn('Write x', write, { id: 'cf-write' }), ui.btn('Flush to DB', flush), ui.btn('Crash cache', crash, { kind: 'danger', id: 'cf-crash' })), banner, h('div', { class: 'stage' }, net.svg), stats);
      function paint() { stats.set('cv', cv == null ? 'empty' : cv, cv != null && cv !== dv ? 'warn' : ''); stats.set('dv', dv); stats.set('dirty', dirty, dirty ? 'warn' : ''); net.sub('cache', cv == null ? 'empty' : 'x = ' + cv); net.sub('db', 'x = ' + dv); net.state('cache', crashed ? 'dead' : ''); }
      function changed() { paint(); }
      const fin = (lat, cls, text) => { stats.set('lat', lat + ' ms', lat < 5 ? 'good' : ''); banner.className = 'banner ' + cls; banner.textContent = text; busy = false; paint(); };
      async function read() {
        if (busy) return; busy = true; const v = strat.value, rt = v === 'rt';
        if (crashed) {
          if (rt) { await net.send('app', 'cache', { label: 'GET', color: 'bad' }); return fin(0, 'bad', 'Read-through has no way around a dead cache: reads fail until it returns.'); }
          await net.send('app', 'db', { label: 'SELECT', color: 'req' }); await net.send('db', 'app', { label: dv, color: 'res' });
          return fin(30, 'warn', 'The cache is down, so the app goes straight to the database. Slower, but still working.');
        }
        await net.send('app', 'cache', { label: 'GET x', color: 'req', dur: 500 });
        if (cv != null) {
          net.flash('cache', 'hit');
          await net.send('cache', 'app', { label: cv, color: 'res', dur: 500 });
          if (cv !== dv && v === 'wa') ctx.mission('stale');
          return fin(1, cv !== dv ? 'bad' : 'ok', cv !== dv ? `Stale read: the cache said ${cv}, but the database holds ${dv}.` : `Cache hit: x = ${cv}.`);
        }
        net.flash('cache', 'miss');
        if (rt) {
          await net.send('cache', 'db', { label: 'load', color: 'ref' }); await net.send('db', 'cache', { label: dv, color: 'res' }); cv = dv;
          await net.send('cache', 'app', { label: cv, color: 'res' });
          return fin(32, 'ok', 'Miss. The cache loaded x from the database by itself. The app never knew.');
        }
        await net.send('cache', 'app', { label: 'miss', color: 'ref', dur: 400 });
        await net.send('app', 'db', { label: 'SELECT', color: 'req' }); await net.send('db', 'app', { label: dv, color: 'res' });
        await net.send('app', 'cache', { label: 'SET', color: 'req', dur: 500 }); cv = dv;
        if (v === 'aside') ctx.mission('aside');
        fin(33, 'ok', 'Miss. The app read the database, then stored the value in the cache itself.');
      }
      async function write() {
        if (busy) return; busy = true; const v = strat.value === 'aside' || strat.value === 'rt' ? 'inv' : strat.value, val = next++;
        if (crashed && v !== 'wa' && v !== 'inv') { busy = false; banner.className = 'banner bad'; banner.textContent = 'The cache is down. Restart it first.'; return; }
        if (v === 'inv') {
          await net.send('app', 'db', { label: 'UPDATE', color: 'req' }); dv = val; await net.send('db', 'app', { color: 'res' });
          if (!crashed) { await net.send('app', 'cache', { label: 'DEL', color: 'ref', dur: 500 }); cv = null; }
          return fin(31, 'ok', 'Updated the database and deleted the cache entry, so the next read reloads a fresh value.');
        }
        if (v === 'wt') {
          await net.send('app', 'cache', { label: 'SET', color: 'req' }); cv = val; await net.send('cache', 'db', { label: 'write', color: 'req' }); dv = val;
          await net.send('db', 'cache', { color: 'res' }); await net.send('cache', 'app', { label: 'ok', color: 'res' });
          return fin(31, 'ok', 'Write-through: both stores match before the app is told OK. Safe, but it costs the database\'s latency.');
        }
        if (v === 'wa') {
          await net.send('app', 'db', { label: 'UPDATE', color: 'req' }); dv = val; await net.send('db', 'app', { label: 'ok', color: 'res' });
          return fin(30, cv != null ? 'warn' : 'ok', cv != null ? `Write-around skipped the cache, which still holds ${cv}. Read x to see the problem.` : 'Write-around went straight to the database.');
        }
        await net.send('app', 'cache', { label: 'SET', color: 'req' }); cv = val; dirty++;
        await net.send('cache', 'app', { label: 'ok', color: 'res' });
        ctx.mission('fast');
        fin(1, 'warn', `Write-back: acknowledged in 1 ms, versus 31 ms. The database still says ${dv}. ${dirty} write(s) exist only in the cache.`);
      }
      async function flush() {
        if (busy || !dirty || crashed) return; busy = true;
        await net.send('cache', 'db', { label: 'flush ' + dirty, color: 'cache' }); dv = cv; dirty = 0;
        fin(30, 'ok', 'Flushed. The database has caught up.');
      }
      function crash() {
        if (crashed) { crashed = false; paint(); banner.className = 'banner'; banner.textContent = 'The cache has restarted, empty.'; document.getElementById('cf-crash').textContent = 'Crash cache'; return; }
        crashed = true; const lost = dirty; const safe = strat.value === 'wt' && cv != null && cv === dv; dirty = 0; cv = null; paint();
        document.getElementById('cf-crash').textContent = 'Restart cache';
        if (lost) { banner.className = 'banner bad'; banner.textContent = `${lost} acknowledged write(s) are gone forever. The app was told OK, but the database never got them.`; ctx.mission('lost'); }
        else { banner.className = 'banner ok'; banner.textContent = 'The cache died, and every acknowledged write is safe in the database.'; if (safe) ctx.mission('safe'); }
      }
      paint();
    },
  });

  RT.lab({
    id: 'stampede', title: 'Cache Stampede', short: 'Stampede', chapter: 'Caching Challenges',
    lede: 'A popular key expires and thousands of requests miss at the same moment. Turn the fixes on one at a time and see the database survive.',
    missions: [['melt', 'Melt the database with no protection.'], ['lock', 'Use a cache lock so that one request rebuilds.'], ['bg', 'Refresh early in the background, so the key never expires.'], ['jit', 'Spread many keys\' expiries out with TTL jitter.']],
    notes: `<ul><li><b>Thundering herd</b>: many keys expire at once. Fix it with staggered TTLs.</li><li><b>Stampede</b>: one hot key expires, and every reader rebuilds it. Fix it with request coalescing or a lock.</li><li><b>Background refresh</b> updates the value before it expires.</li><li>Related: <b>cache penetration</b> is misses on keys that don't exist. Negative caching or a Bloom filter fixes that.</li></ul>`,
    check: { q: 'What does request coalescing do?', options: ['Compresses requests', 'Merges concurrent misses into one database query', 'Drops most requests', 'Shortens the TTL'], answer: 1, why: 'One request rebuilds the value, and the rest wait for that result.' },
    render(root, ctx) {
      const scenario = ui.seg('Scenario', [['one', 'One hot key'], ['many', '100 keys, same TTL']], 'one', draw);
      const lock = ui.toggle({ id: 'st-lock', label: 'Cache lock (coalesce)', onChange: draw });
      const bg = ui.toggle({ id: 'st-bg', label: 'Background refresh', onChange: draw });
      const jit = ui.toggle({ id: 'st-jit', label: 'TTL jitter', onChange: draw });
      const svg = s('svg', { viewBox: '0 0 760 230', role: 'img', 'aria-label': 'Database queries per second over time' });
      svg.style.cssText = 'width:100%;min-width:560px;display:block';
      const stats = ui.stats([['peak', 'Peak DB queries/s', '–'], ['state', 'Database', '–'], ['lat', 'Slowest user wait', '–']]);
      const say = h('div', { class: 'banner', role: 'status' });
      root.append(h('div', { class: 'controls' }, ui.field('Scenario', scenario), lock, bg, jit), say, h('div', { class: 'stage' }, svg), stats);
      const CAP = 500, RPS = 8000, REBUILD = 2;
      function draw() {
        const many = scenario.value === 'many', T = 120, series = new Array(T).fill(20), H = 196, x0 = 44;
        if (many) {
          const add = (i, v) => { if (i < T) series[i] += v; };
          for (let k = 0; k < 100; k++) {
            const at = 40 + (jit.checked ? Math.floor((k / 100) * 60) : 0);
            if (bg.checked) add(at, 1);
            else for (let i = 0; i < REBUILD * 2; i++) add(at + i, lock.checked ? 1 : 60);
          }
        } else if (bg.checked) series[40] += 1;
        else if (lock.checked) for (let i = 40; i < 40 + REBUILD * 2; i++) series[i] += 1;
        else for (let i = 40; i < 40 + REBUILD * 2; i++) series[i] += RPS / 4;
        const peak = Math.max(...series), top = Math.max(CAP * 1.4, peak);
        const y = (v) => H - (v / top) * (H - 16), bw = (760 - x0 - 8) / T;
        svg.textContent = '';
        series.forEach((v, i) => svg.append(s('rect', { x: x0 + i * bw, y: y(v), width: Math.max(1, bw - 1), height: Math.max(1, H - y(v)), fill: v > CAP ? 'var(--bad)' : 'var(--accent)' })));
        svg.append(s('line', { x1: x0, x2: 752, y1: y(CAP), y2: y(CAP), stroke: 'var(--res)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }), s('text', { class: 'dim', x: x0 + 4, y: y(CAP) - 4 }, 'database limit: 500/s'),
          s('line', { class: 'lnk', x1: x0, x2: 752, y1: H, y2: H }), s('text', { class: 'dim', x: 2, y: 22 }, Math.round(top)), s('text', { class: 'dim', x: 30, y: H + 3 }, '0'), s('text', { class: 'dim', x: x0, y: H + 16 }, 'time →'), s('text', { class: 'dim', x: x0 + 40 * bw - 18, y: H + 16 }, 'expiry'));
        const over = peak > CAP;
        stats.set('peak', Math.round(peak).toLocaleString(), over ? 'bad' : 'good');
        stats.set('state', over ? 'Overloaded' : 'Healthy', over ? 'bad' : 'good');
        stats.set('lat', over ? 'Timeouts' : (lock.checked && !bg.checked && !jit.checked) ? fmtMs(REBUILD * 25) : '1 ms');
        say.className = 'banner ' + (over ? 'bad' : 'ok');
        say.textContent = over ? `Expiry sends ${Math.round(peak).toLocaleString()} queries a second at a database that can take 500.`
          : bg.checked ? 'The value is replaced before it expires, so users never see a miss.' : lock.checked ? 'One request rebuilds, and the rest wait briefly for its result. The database barely notices.' : 'Expiries are spread out, so the extra load stays below the limit.';
        if (over && !lock.checked && !bg.checked) ctx.mission('melt');
        if (!over && lock.checked) ctx.mission('lock');
        if (!over && bg.checked) ctx.mission('bg');
        if (many && jit.checked && !over) ctx.mission('jit');
      }
      draw();
    },
  });
})();
