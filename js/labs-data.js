/* Sharding, replication, CAP, transactions, indexes, Bloom filters, distributed file system. */
(function () {
  const { h, s, ui, Net, hash } = RT;

  /* ----- Sharding ----- */
  RT.lab({
    id: 'sharding', title: 'Sharding Lab', short: 'Sharding', chapter: 'Data Partitioning',
    lede: 'Place 600 keys on your shards, then add one. See how many keys have to move under each scheme.',
    missions: [['mod', 'Add a shard under hash mod N and see most keys move.'], ['ring', 'Add a shard under consistent hashing and see about 1/N move.'], ['skew', 'See a hot range overload one shard under range sharding.'], ['vnode', 'Raise virtual nodes and see the load even out.']],
    notes: `<ul><li><b>Range</b>: great for range queries, but hot ranges cause skew.</li><li><b>Hash</b>: spreads keys evenly, but range queries must hit every shard.</li><li><b>Directory</b>: flexible, but the lookup table becomes critical.</li><li><b>Consistent hashing</b>: adding a node only moves keys from its neighbours.</li><li><b>Virtual nodes</b> give each server many ring positions, which evens out load.</li></ul>`,
    check: { q: 'You have 10 cache servers using hash(key) % N, and add an 11th. Roughly how many keys now map elsewhere?', options: ['About 9%', 'About 50%', 'About 91%', 'None'], answer: 2, why: 'A key stays put only if its hash mod 10 equals its hash mod 11, which is true for about 1 in 11.' },
    render(root, ctx) {
      const KEYS = Array.from({ length: 600 }, (_, i) => 'user:' + i);
      const SIZE = 340, C = SIZE / 2, Rr = 130;
      let n = 4, moved = 0, lastMap = null;
      const scheme = ui.seg('Scheme', [['mod', 'Hash mod N'], ['ring', 'Consistent hash'], ['range', 'Range'], ['dir', 'Directory']], 'mod', () => { lastMap = null; moved = 0; draw(); });
      const vn = ui.slider({ id: 'sh-v', label: 'Virtual nodes per shard', min: 1, max: 64, value: 1, onInput: () => { lastMap = null; moved = 0; draw(); } });
      const hot = ui.toggle({ id: 'sh-hot', label: 'Hot key range (new users)', onChange: draw });
      const svg = s('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, role: 'img', 'aria-label': 'Hash ring and shard positions' });
      svg.style.cssText = 'width:100%;max-width:340px;display:block;margin:auto;min-width:0';
      const bars = h('div', { style: { display: 'grid', gap: '6px' } });
      const stats = ui.stats([['shards', 'Shards', 4], ['moved', 'Keys moved by last change', '–'], ['pct', 'Share moved', '–'], ['max', 'Fullest shard vs ideal', '–']]);
      const say = h('div', { class: 'banner', role: 'status' }, 'Add or remove a shard and compare how much data has to move.');
      root.append(h('div', { class: 'controls' }, ui.field('Scheme', scheme), vn, hot, ui.btn('Add shard', () => change(1), { kind: 'primary', id: 'sh-add' }), ui.btn('Remove shard', () => change(-1), { id: 'sh-del' })), say, stats, h('div', { class: 'twocol' }, ui.card('Key space', svg), ui.card('Keys per shard', bars)));
      const dir = new Map();
      function mapper() {
        const sc = scheme.value;
        if (sc === 'mod') return (k) => hash(k) % n;
        if (sc === 'range') return (k) => { const id = +k.split(':')[1]; return Math.min(n - 1, Math.floor((id / 600) * n)); };
        if (sc === 'dir') return (k) => { if (!dir.has(k) || dir.get(k) >= n) dir.set(k, hash(k) % n); return dir.get(k); };
        const pts = [];
        for (let i = 0; i < n; i++) for (let v = 0; v < vn.value; v++) pts.push([hash(`shard-${i}-${v}`), i]);
        pts.sort((a, b) => a[0] - b[0]);
        return (k) => { const x = hash(k); let lo = 0, hi = pts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][0] < x) lo = m + 1; else hi = m; } return pts[lo % pts.length][1]; };
      }
      const color = (i) => `hsl(${(i * 67 + 210) % 360} 62% 50%)`;
      function draw() {
        const f = mapper(), map = KEYS.map(f), w = KEYS.map((k, i) => (hot.checked && i >= 510 ? 8 : 1));
        const counts = new Array(n).fill(0), loads = new Array(n).fill(0);
        map.forEach((sh, i) => { counts[sh]++; loads[sh] += w[i]; });
        const ideal = loads.reduce((a, b) => a + b, 0) / n, max = Math.max(...loads);
        bars.textContent = '';
        loads.forEach((v, i) => { const b = ui.bar(); b.firstChild.style.background = color(i); b.set((v / Math.max(max, ideal * 1.4)) * 100); bars.append(h('div', { class: 'small mono' }, `shard ${i + 1}: ${counts[i]} keys${hot.checked ? `, load ${v}` : ''}`, b)); });
        stats.set('shards', n); stats.set('max', (max / ideal).toFixed(2) + '×', max / ideal > 1.8 ? 'bad' : max / ideal < 1.25 ? 'good' : '');
        svg.textContent = '';
        svg.append(s('circle', { cx: C, cy: C, r: Rr, fill: 'none', stroke: 'var(--line)', 'stroke-width': 2 }));
        KEYS.forEach((k, i) => {
          const a = scheme.value === 'range' ? (i / 600) * 2 * Math.PI : (hash(k) / 4294967296) * 2 * Math.PI;
          const rr = Rr - 12 - (hash(k, 3) % 22);
          svg.append(s('circle', { cx: C + rr * Math.sin(a), cy: C - rr * Math.cos(a), r: 1.8, fill: color(map[i]) }));
        });
        if (scheme.value === 'ring') {
          for (let i = 0; i < n; i++) for (let v = 0; v < vn.value; v++) {
            const a = (hash(`shard-${i}-${v}`) / 4294967296) * 2 * Math.PI;
            svg.append(s('circle', { cx: C + Rr * Math.sin(a), cy: C - Rr * Math.cos(a), r: vn.value > 16 ? 3 : 6, fill: color(i), stroke: 'var(--panel)', 'stroke-width': 1.5 }));
          }
        }
        if (scheme.value === 'ring' && vn.value >= 32 && max / ideal < 1.3) ctx.mission('vnode');
        if (scheme.value === 'range' && hot.checked && max / ideal > 2) { ctx.mission('skew'); say.className = 'banner bad'; say.textContent = 'New users all land in the last range, so one shard takes the traffic while others sit idle. This is data skew.'; }
        lastMap = map;
      }
      function change(d) {
        if (n + d < 2 || n + d > 10) return;
        const before = lastMap; n += d; draw();
        const after = lastMap; moved = before.filter((v, i) => v !== after[i]).length;
        const p = Math.round((moved / 600) * 100);
        stats.set('moved', moved, p > 50 ? 'bad' : 'good'); stats.set('pct', p + '%', p > 50 ? 'bad' : 'good');
        say.className = 'banner ' + (p > 50 ? 'bad' : 'ok');
        say.textContent = `${moved} of 600 keys changed shard (${p}%). ${scheme.value === 'mod' ? 'Changing N reshuffles nearly everything.' : scheme.value === 'ring' ? `The ideal is about 1/${n} = ${Math.round(100 / n)}%.` : scheme.value === 'dir' ? 'The directory only moved keys you told it to, but every lookup now depends on it.' : 'Range boundaries moved, so data shifts along the line.'}`;
        if (d > 0 && scheme.value === 'mod' && p > 50) ctx.mission('mod');
        if (d > 0 && scheme.value === 'ring' && p < 40) ctx.mission('ring');
      }
      draw();
    },
  });

  /* ----- Replication ----- */
  RT.lab({
    id: 'replication', title: 'Replication Lag', short: 'Replication', chapter: 'Redundancy and Replication',
    lede: 'A write lands on the leader. When does the client hear OK? That choice decides how fast you are, and what you lose when the leader dies.',
    missions: [['stale', 'Read stale data from a lagging follower.'], ['sync', 'Compare the wait for a synchronous write.'], ['lost', 'Kill the leader in async mode and lose acknowledged writes.'], ['safe', 'Kill the leader in sync mode and lose nothing.'], ['block', 'Kill a follower in sync mode and see writes hang.']],
    notes: `<ul><li><b>Synchronous</b>: no acknowledged write can be lost, but latency equals the slowest replica, and one dead replica blocks writes.</li><li><b>Asynchronous</b>: fast and available, but recent writes can vanish in a failover.</li><li><b>Semi-synchronous</b>: wait for one replica. A practical middle ground.</li><li>Replication protects against machine failure. It doesn't replace <b>backups</b>: a bad delete replicates too.</li></ul>`,
    check: { q: 'Someone runs DELETE FROM users by accident. Replication is instant. Can a replica save you?', options: ['Yes, it has a copy', 'No, the delete replicates too, so you need a backup', 'Only with sharding', 'Only under async'], answer: 1, why: 'Replication copies mistakes faithfully. Backups give you a point in the past to return to.' },
    render(root, ctx) {
      const net = Net(ctx, { w: 860, h: 300, label: 'Client, leader and three followers' });
      net.node('c', { x: 90, y: 150, label: 'Client', sub: '', w: 104 }).node('L', { x: 350, y: 150, label: 'Leader', sub: 'v0', w: 122, onClick: killLeader });
      const F = ['F1', 'F2', 'F3'].map((id, i) => { net.node(id, { x: 700, y: 55 + i * 95, label: 'Follower ' + (i + 1), sub: 'v0', w: 140, onClick: () => toggle(i) }); net.link('L', id); return { id, v: 0, up: true, lag: [0, .6, 1.5][i] }; });
      net.link('c', 'L');
      const mode = ui.seg('Mode', [['sync', 'Synchronous'], ['semi', 'Semi-sync'], ['async', 'Asynchronous']], 'async');
      const lag = ui.slider({ id: 'rp-lag', label: 'Replication delay', min: 200, max: 4000, step: 100, value: 1600, fmt: (v) => v + ' ms' });
      const banner = h('div', { class: 'banner', role: 'status' }, 'Write something, then read from Follower 3 before it catches up.');
      const stats = ui.stats([['ack', 'Last write acknowledged in', '–'], ['acked', 'Acknowledged writes', 0], ['lost', 'Acknowledged writes lost', 0]]);
      let leaderV = 0, acked = 0, lost = 0, leaderUp = true;
      root.append(h('div', { class: 'controls' }, ui.field('Mode', mode), lag, ui.btn('Write', write, { kind: 'primary', id: 'rp-write' }), ui.btn('Burst of 3 writes', async () => { write(); await ctx.sleep(300); write(); await ctx.sleep(300); write(); }), ui.btn('Read from Follower 3', read, { id: 'rp-read' }), ui.btn('Reset', reset)), banner, h('div', { class: 'stage' }, net.svg), stats);
      function paint() { F.forEach((f) => { net.sub(f.id, f.up ? 'v' + f.v : 'down'); net.state(f.id, !f.up ? 'dead' : f.v === leaderV ? 'hit' : 'miss'); }); net.sub('L', leaderUp ? 'v' + leaderV : 'down'); net.state('L', leaderUp ? 'on' : 'dead'); }
      function reset() { leaderV = 0; acked = 0; lost = 0; leaderUp = true; F.forEach((f) => { f.v = 0; f.up = true; }); net.label('L', 'Leader'); stats.set('acked', 0); stats.set('lost', 0); stats.set('ack', '–'); banner.className = 'banner'; banner.textContent = 'Reset.'; paint(); }
      function toggle(i) { F[i].up = !F[i].up; if (F[i].up) F[i].v = leaderV; paint(); }
      function repl(f, v) { const d = lag.value * (.5 + f.lag); return net.send('L', f.id, { label: 'v' + v, color: 'cache', dur: d }).then(() => { if (f.up && leaderUp) { f.v = Math.max(f.v, v); paint(); } }); }
      async function write() {
        if (!leaderUp) { banner.className = 'banner bad'; banner.textContent = 'There is no leader. Fail over first by clicking the dead leader.'; return; }
        const t0 = performance.now(), v = ++leaderV, m = mode.value; paint();
        await net.send('c', 'L', { label: 'v' + v, color: 'req', dur: 420 });
        const reps = F.filter((f) => f.up).map((f) => repl(f, v));
        const need = m === 'sync' ? 3 : m === 'semi' ? 1 : 0, alive = F.filter((f) => f.up).length;
        if (alive < need) { ctx.mission('block'); banner.className = 'banner bad'; banner.textContent = `Sync mode needs all 3 followers, but only ${alive} are up. This write hangs. Consistency is costing you availability.`; return; }
        if (need) { let got = 0; await new Promise((res) => reps.forEach((p) => p.then(() => { if (++got >= need) res(); }))); }
        await net.send('L', 'c', { label: 'OK', color: 'res', dur: 420 });
        const t = Math.round(performance.now() - t0); acked++; stats.set('ack', t + ' ms'); stats.set('acked', acked);
        banner.className = 'banner ok'; banner.textContent = m === 'sync' ? 'OK only after every follower confirmed. Slow, but no acknowledged data can be lost.' : m === 'semi' ? 'OK after the first follower confirmed.' : 'OK straight away. The followers will catch up later, if nothing goes wrong.';
        if (m === 'sync') ctx.mission('sync');
      }
      async function read() {
        const f = F[2];
        await net.send('c', f.id, { label: 'read', color: 'req', dur: 600 }); await net.send(f.id, 'c', { label: 'v' + f.v, color: f.v < leaderV ? 'ref' : 'res', dur: 600 });
        if (f.v < leaderV) { banner.className = 'banner warn'; banner.textContent = `Stale read: Follower 3 returned v${f.v}, but the leader has v${leaderV}.`; ctx.mission('stale'); } else { banner.className = 'banner ok'; banner.textContent = `Follower 3 is up to date at v${f.v}.`; }
      }
      function killLeader() {
        if (!leaderUp) {
          const best = F.filter((f) => f.up).reduce((a, b) => (b.v > a.v ? b : a));
          const dropped = Math.max(0, Math.min(acked, leaderV) - best.v);
          lost += dropped; acked = Math.max(0, acked - dropped); leaderV = best.v; leaderUp = true; F.forEach((f) => { if (f.up) f.v = Math.min(f.v, best.v); });
          net.label('L', 'New leader'); stats.set('lost', lost, lost ? 'bad' : 'good'); stats.set('acked', acked);
          banner.className = 'banner ' + (dropped ? 'bad' : 'ok');
          banner.textContent = dropped ? `Failed over to the most up-to-date follower at v${best.v}. ${dropped} acknowledged write(s) are gone.` : `Failed over to a follower at v${best.v}. Nothing was lost.`;
          if (dropped) ctx.mission('lost'); else if (mode.value === 'sync' && leaderV > 0) ctx.mission('safe');
          paint(); return;
        }
        leaderUp = false; paint(); banner.className = 'banner warn'; banner.textContent = 'The leader crashed. Click it again to promote the best follower.';
      }
      paint();
    },
  });

  /* ----- CAP ----- */
  RT.lab({
    id: 'cap', title: 'CAP Simulator', short: 'CAP & PACELC', chapter: 'CAP & PACELC Theorems',
    lede: 'Two replicas, one network cable. Cut the cable and decide what the system should do. There is no third option.',
    missions: [['cp', 'Cut the link in CP mode and see a request refused.'], ['ap', 'Cut the link in AP mode and read a stale value.'], ['heal', 'Heal an AP partition and resolve the conflict.'], ['pacelc', 'With no partition, trade latency for consistency.']],
    notes: `<ul><li>Partitions happen, so <b>P</b> isn't really optional. The real choice is C or A during a partition.</li><li><b>CP</b> (banking, Spanner, etcd): refuse rather than be wrong.</li><li><b>AP</b> (Dynamo, Cassandra, DNS): answer anyway, and reconcile later.</li><li><b>PACELC</b>: if Partitioned choose A or C, Else choose Latency or Consistency. The trade-off exists even on a good day.</li></ul>`,
    check: { q: 'Which suits a CP design?', options: ['A social media like counter', 'An account balance', 'A DNS record', 'A shopping-cart draft'], answer: 1, why: 'A wrong balance can cost real money, so refusing during a partition is better. A like count can drift for a while.' },
    render(root, ctx) {
      const net = Net(ctx, { w: 860, h: 280, label: 'Two replicas with a network link' });
      net.node('u1', { x: 90, y: 70, label: 'Client 1', sub: 'Europe', w: 104 }).node('u2', { x: 770, y: 70, label: 'Client 2', sub: 'Asia', w: 104 })
        .node('A', { x: 250, y: 200, label: 'Replica A', sub: '', w: 150, h: 64 }).node('B', { x: 610, y: 200, label: 'Replica B', sub: '', w: 150, h: 64 }).link('u1', 'A').link('u2', 'B').link('A', 'B');
      const mode = ui.seg('Mode', [['cp', 'CP: stay consistent'], ['ap', 'AP: stay available']], 'cp');
      const elc = ui.seg('When healthy', [['el', 'Fast: ack locally (EL)'], ['ec', 'Consistent: wait for peer (EC)']], 'ec');
      const banner = h('div', { class: 'banner', role: 'status' }, 'Both replicas agree. Try a write, then cut the link.');
      const stats = ui.stats([['a', 'A holds', 'cart=10'], ['b', 'B holds', 'cart=10'], ['lat', 'Write latency', '–'], ['st', 'Status', 'In sync']]);
      let a = 10, b = 10, cut = false, busy = false, tsA = 0, tsB = 0;
      const cutB = ui.btn('Cut the network', toggleCut, { kind: 'danger', id: 'cap-cut' });
      root.append(h('div', { class: 'controls' }, ui.field('During a partition', mode), ui.field('PACELC: without a partition', elc), cutB, ui.btn('Write via Client 1 (+1)', write, { kind: 'primary', id: 'cap-w' }), ui.btn('Read via Client 2', read, { id: 'cap-r' })), banner, h('div', { class: 'stage' }, net.svg), stats);
      function paint() { stats.set('a', 'cart=' + a); stats.set('b', 'cart=' + b); net.sub('A', 'cart=' + a); net.sub('B', 'cart=' + b); stats.set('st', cut ? 'Partitioned' : a === b ? 'In sync' : 'Diverged', cut || a !== b ? 'warn' : 'good'); net.linkClass('A', 'B', cut ? 'cut' : ''); }
      function toggleCut() {
        cut = !cut; cutB.textContent = cut ? 'Heal the network' : 'Cut the network';
        if (!cut && a !== b) { const w = tsA >= tsB ? a : b; banner.className = 'banner warn'; banner.textContent = `The link healed with A=${a} and B=${b}. Last write wins, so both become ${w}. Writes on the losing side are discarded. CRDTs or app logic could merge them instead.`; a = b = w; ctx.mission('heal'); }
        else if (cut) { banner.className = 'banner bad'; banner.textContent = 'The replicas can no longer talk. Each side is alive, but neither knows what the other has.'; }
        paint();
      }
      async function write() {
        if (busy) return; busy = true;
        await net.send('u1', 'A', { label: 'write', color: 'req', dur: 420 });
        if (cut) {
          if (mode.value === 'cp') { net.flash('A', 'err'); await net.send('A', 'u1', { label: '503', color: 'bad', dur: 420 }); banner.className = 'banner bad'; banner.textContent = 'CP: Replica A can\'t confirm with B, so it refuses the write. Consistent, but unavailable.'; ctx.mission('cp'); }
          else { a++; tsA = performance.now(); paint(); await net.send('A', 'u1', { label: 'OK', color: 'res', dur: 420 }); banner.className = 'banner warn'; banner.textContent = 'AP: Replica A accepted it locally. Available, but now the replicas disagree. Read from Client 2.'; }
        } else if (elc.value === 'ec') {
          a++; tsA = performance.now(); paint();
          await net.send('A', 'B', { label: 'sync', color: 'cache', dur: 700 }); b = a; paint(); await net.send('B', 'A', { color: 'res', dur: 500 });
          await net.send('A', 'u1', { label: 'OK', color: 'res', dur: 420 }); stats.set('lat', '120 ms'); banner.className = 'banner ok'; banner.textContent = 'EC: acknowledged after B confirmed. Consistent, but it pays a cross-region round trip on every write.'; ctx.mission('pacelc-ec');
        } else {
          a++; tsA = performance.now(); paint(); await net.send('A', 'u1', { label: 'OK', color: 'res', dur: 420 }); stats.set('lat', '5 ms');
          net.send('A', 'B', { label: 'later', color: 'cache', dur: 1700 }).then(() => { if (!cut) { b = Math.max(a, b); paint(); } });
          banner.className = 'banner warn'; banner.textContent = 'EL: acknowledged in 5 ms. B catches up in a moment, and a read there right now would be stale. That\'s the "else" in PACELC.'; ctx.mission('pacelc');
        }
        busy = false;
      }
      async function read() {
        if (busy) return; busy = true;
        await net.send('u2', 'B', { label: 'read', color: 'req', dur: 420 });
        if (cut && mode.value === 'cp') { net.flash('B', 'err'); await net.send('B', 'u2', { label: '503', color: 'bad', dur: 420 }); banner.className = 'banner bad'; banner.textContent = 'CP: Replica B might be out of date, so it refuses to answer.'; ctx.mission('cp'); }
        else {
          await net.send('B', 'u2', { label: 'cart=' + b, color: b === a ? 'res' : 'ref', dur: 420 });
          if (b !== a) { banner.className = 'banner warn'; banner.textContent = `Stale: Client 2 read ${b} while Replica A holds ${a}.`; if (cut) ctx.mission('ap'); }
          else { banner.className = 'banner ok'; banner.textContent = `Client 2 read cart=${b}.`; }
        }
        busy = false;
      }
      paint();
    },
  });

  /* ----- Transactions and normalization ----- */
  function normTab(root, ctx) {
    const ORDERS = [[1001, 'Keyboard'], [1002, 'Monitor'], [1003, 'Mouse'], [1004, 'Webcam'], [1005, 'Dock']];
    const mode = ui.seg('Schema', [['denorm', 'Denormalized: one wide table'], ['norm', 'Normalized: two tables']], 'denorm', draw);
    const partial = ui.toggle({ id: 'no-miss', label: 'The update job crashes after 3 rows' });
    const stats = ui.stats([['w', 'Rows changed by the move', '–'], ['r', 'Tables read to list orders', 1], ['s', 'Copies of Ana\'s city', 5]]);
    const say = h('div', { class: 'banner', role: 'status' }, 'Ana moves to Oslo. How many rows does that one fact touch?');
    const box = h('div', { class: 'twocol' });
    let cities = ['Lisbon', 'Lisbon', 'Lisbon', 'Lisbon', 'Lisbon'], one = 'Lisbon';
    root.append(h('div', { class: 'controls' }, ui.field('Schema', mode), partial, ui.btn('Ana moves to Oslo', move, { kind: 'primary', id: 'no-move' }), ui.btn('Reset', () => { cities = cities.map(() => 'Lisbon'); one = 'Lisbon'; say.className = 'banner'; say.textContent = 'Back in Lisbon.'; stats.set('w', '–'); draw(); })), say, box, stats);
    const table = (title, heads, rows) => ui.card(title, h('div', { class: 'scroll' }, h('table', { class: 'table' }, h('tr', null, heads.map((t) => h('th', null, t))), rows.map((r) => h('tr', null, r.map((c) => h('td', { class: c === 'Lisbon' && cities.includes('Oslo') && mode.value === 'denorm' ? 'badtxt' : '' }, c)))))));
    function draw() {
      box.textContent = '';
      const de = mode.value === 'denorm';
      if (de) box.append(table('orders', ['order', 'item', 'customer', 'city'], ORDERS.map((o, i) => [o[0], o[1], 'Ana', cities[i]])));
      else box.append(table('customers', ['id', 'name', 'city'], [[7, 'Ana', one]]), table('orders', ['order', 'item', 'customer_id'], ORDERS.map((o) => [o[0], o[1], 7])));
      stats.set('r', de ? 1 : 2); stats.set('s', de ? 5 : 1, de ? 'warn' : 'good');
    }
    function move() {
      if (mode.value === 'norm') {
        one = 'Oslo'; stats.set('w', 1, 'good'); say.className = 'banner ok'; say.textContent = 'One row changed, and every order agrees at once. The price is a JOIN whenever you need orders with cities.'; ctx.mission('norm');
      } else {
        const n = partial.checked ? 3 : 5; cities = cities.map((c, i) => (i < n ? 'Oslo' : c)); stats.set('w', n, 'warn');
        if (partial.checked) { say.className = 'banner bad'; say.textContent = 'Update anomaly: the table now says Ana lives in two cities, and nothing shows which is right.'; ctx.mission('anomaly'); }
        else { say.className = 'banner warn'; say.textContent = 'Five rows changed for one fact. Reads are simple with no join, but every write must find every copy.'; }
      }
      draw();
    }
    draw();
  }

  /* ----- Transactions ----- */
  RT.lab({
    id: 'acid', title: 'ACID Transactions', short: 'ACID vs BASE', chapter: 'Databases',
    lede: 'Transfer money between accounts, pull the plug halfway through, then let two transfers collide. In the second tab, see why a database should store each fact once.',
    missions: [['vanish', 'Crash without a transaction and make money vanish.'], ['rollback', 'Crash inside a transaction and see it roll back.'], ['lost', 'Lose an update with two concurrent transfers.'], ['lock', 'Isolate the transfers and keep the total correct.'], ['anomaly', 'Create an update anomaly in a denormalized table.'], ['norm', 'Make the same change in one row of a normalized table.']],
    notes: `<ul><li><b>Atomicity</b>: all or nothing.</li><li><b>Consistency</b>: rules hold before and after.</li><li><b>Isolation</b>: concurrent work doesn't interfere.</li><li><b>Durability</b>: committed means it survives a crash.</li><li><b>BASE</b> relaxes these for scale: Basically Available, Soft state, Eventual consistency.</li><li><b>Normalization</b> stores each fact once, so writes stay simple and reads need joins. <b>Denormalization</b> reverses that trade.</li></ul>`,
    check: { q: 'A crash happens after the debit but before COMMIT. What does atomicity guarantee?', options: ['The credit still runs', 'The debit is undone on recovery', 'The balance is halved', 'Nothing'], answer: 1, why: 'Uncommitted changes are rolled back, usually using a write-ahead log.' },
    render(outer, ctx) {
      const root = h('div', { class: 'labmain' }), pane = h('div', { class: 'labmain hide' });
      let made = false;
      const tabs = ui.tabs([['t', 'Transactions'], ['n', 'Normalization']], (v) => { root.classList.toggle('hide', v !== 't'); pane.classList.toggle('hide', v !== 'n'); if (v === 'n' && !made) { made = true; normTab(pane, ctx); } });
      outer.append(tabs, root, pane); tabs.set('t');
      const txn = ui.toggle({ id: 'ac-txn', label: 'Use a transaction', checked: true });
      const iso = ui.toggle({ id: 'ac-iso', label: 'Row locks (isolation)', checked: true });
      const crashAt = ui.select({ id: 'ac-crash', label: 'Crash', value: 'none', options: [['none', 'No crash'], ['mid', 'After debit, before credit']] });
      const accts = { Ana: 500, Ben: 500 };
      const sql = h('pre', { class: 'dig', style: { minHeight: '132px' } });
      const banner = h('div', { class: 'banner', role: 'status' }, 'Total money in the system should always be 1000.');
      const stats = ui.stats([['a', 'Ana', 500], ['b', 'Ben', 500], ['t', 'Total', 1000]]);
      root.append(h('div', { class: 'controls' }, txn, iso, crashAt, ui.btn('Transfer 100: Ana → Ben', transfer, { kind: 'primary', id: 'ac-go' }), ui.btn('Two concurrent deposits to Ana', race, { id: 'ac-race' }), ui.btn('Reset', reset)), banner, stats, ui.card('Statement log', sql));
      let busy = false;
      const paint = () => { const t = accts.Ana + accts.Ben; stats.set('a', accts.Ana); stats.set('b', accts.Ben); stats.set('t', t, t === total ? 'good' : 'bad'); };
      let total = 1000;
      function reset() { accts.Ana = 500; accts.Ben = 500; total = 1000; sql.textContent = ''; banner.className = 'banner'; banner.textContent = 'Reset.'; paint(); }
      const line = async (t, cls) => { sql.append(h('span', { class: cls || '' }, t + '\n')); await ctx.sleep(520); };
      async function transfer() {
        if (busy) return; busy = true; sql.textContent = ''; const useT = txn.checked, crash = crashAt.value === 'mid', a0 = accts.Ana, b0 = accts.Ben;
        if (useT) await line('BEGIN;');
        accts.Ana -= 100; paint(); await line("UPDATE accounts SET balance = balance - 100 WHERE name = 'Ana';");
        if (crash) {
          await line('-- power failure --', 'b');
          if (useT) { await line('-- recovery: transaction never committed, undoing from the log', 'c'); accts.Ana = a0; accts.Ben = b0; paint(); banner.className = 'banner ok'; banner.textContent = 'Rolled back. As far as anyone can tell, the transfer never happened. Atomicity at work.'; ctx.mission('rollback'); }
          else { banner.className = 'banner bad'; banner.textContent = `$100 has vanished. Total is ${accts.Ana + accts.Ben}. Each statement was saved on its own, with nothing tying them together.`; ctx.mission('vanish'); }
          busy = false; return;
        }
        accts.Ben += 100; paint(); await line("UPDATE accounts SET balance = balance + 100 WHERE name = 'Ben';");
        if (useT) await line('COMMIT;', 'g');
        banner.className = 'banner ok'; banner.textContent = 'Transfer complete. Total unchanged.'; busy = false;
      }
      async function race() {
        if (busy) return; busy = true; sql.textContent = ''; const start = accts.Ana; total += 100; total += 100;
        if (iso.checked) {
          await line('T1: BEGIN; SELECT ... FOR UPDATE  -- locks the row'); accts.Ana += 100; paint(); await line('T1: UPDATE Ana + 100; COMMIT;', 'g');
          await line('T2: was blocked, now reads the new balance'); accts.Ana += 100; paint(); await line('T2: UPDATE Ana + 100; COMMIT;', 'g');
          banner.className = 'banner ok'; banner.textContent = 'T2 waited for T1, so both deposits counted. Isolation costs some concurrency.'; ctx.mission('lock');
        } else {
          await line(`T1: reads Ana = ${start}`); await line(`T2: reads Ana = ${start}`);
          accts.Ana = start + 100; paint(); await line(`T1: writes ${start + 100}`); accts.Ana = start + 100; paint(); await line(`T2: writes ${start + 100}  -- overwrites T1`, 'b');
          banner.className = 'banner bad'; banner.textContent = 'Two $100 deposits happened, but the balance rose by only $100. This is a lost update.'; ctx.mission('lost');
        }
        busy = false;
      }
      paint();
    },
  });

  /* ----- Index ----- */
  RT.lab({
    id: 'index', title: 'Index Explorer', short: 'Indexes', chapter: 'Indexes',
    lede: 'Find one row among millions. Watch a full table scan race a B-tree lookup, then see what every extra index costs your writes.',
    missions: [['scan', 'Run a full table scan.'], ['tree', 'Find the same row with a B-tree.'], ['scale', 'Grow the table to 1 billion rows and compare.'], ['write', 'Add indexes until writes slow down.']],
    notes: `<ul><li>An index is a sorted structure that points to rows, like the catalogue in a library.</li><li>A <b>B-tree</b> with fan-out 200 finds any of a billion rows in about 4 page reads.</li><li>Each index must also be updated on every write, so indexes speed reads and slow writes.</li><li>Composite indexes follow the <b>leftmost prefix</b>. An index on (a, b) helps with a, or a and b, but not b alone.</li></ul>`,
    check: { q: 'An index on (country, city) exists. Which query can use it?', options: ['WHERE city = \'Paris\'', 'WHERE country = \'FR\'', 'WHERE zip = 75001', 'None'], answer: 1, why: 'Composite indexes are sorted by the first column first, so they need a condition on the leftmost column.' },
    render(root, ctx) {
      const ROWS = 96;
      const pos = 67;
      const grid = h('div', { class: 'bits', style: { gridTemplateColumns: 'repeat(24, minmax(12px, 1fr))' } }, Array.from({ length: ROWS }, () => h('div', { class: 'bit', style: { cursor: 'default' } })));
      const scale = ui.slider({ id: 'ix-n', label: 'Table size', min: 3, max: 9, value: 6, fmt: (v) => '10^' + v + ' rows', onInput: calc });
      const idx = ui.slider({ id: 'ix-k', label: 'Indexes on the table', min: 0, max: 10, value: 2, onInput: calc });
      const stats = ui.stats([['scan', 'Scan: rows read (average)'], ['btree', 'B-tree: page reads'], ['ratio', 'Speed-up'], ['write', 'Cost of one insert']]);
      const banner = h('div', { class: 'banner', role: 'status' }, "SELECT * FROM users WHERE email = 'kim@example.com'");
      const net = Net(ctx, { w: 800, h: 200, label: 'B-tree' });
      net.node('root', { x: 400, y: 34, label: 'a…z', sub: 'root page', w: 124, h: 44 });
      [['a', 130, 'a…h'], ['b', 400, 'i…p'], ['c', 670, 'q…z']].forEach(([id, x, t]) => { net.node(id, { x, y: 104, label: t, sub: 'internal', w: 104, h: 42 }); net.link('root', id); });
      [['l1', 310, 'ia…jz'], ['l2', 400, 'ka…kz'], ['l3', 490, 'la…pz']].forEach(([id, x, t]) => { net.node(id, { x, y: 172, label: t, sub: 'leaf', w: 80, h: 42 }); net.link('b', id); });
      root.append(h('div', { class: 'controls' }, ui.btn('Full table scan', scan, { id: 'ix-scan' }), ui.btn('Use the index', tree, { kind: 'primary', id: 'ix-tree' }), scale, idx), banner, ui.card('Table pages (a sample of the rows)', grid), h('div', { class: 'stage' }, net.svg), stats);
      let busy = false;
      function calc() {
        const n = 10 ** scale.value, depth = Math.max(1, Math.ceil(Math.log(n) / Math.log(200)));
        stats.set('scan', (n / 2).toLocaleString()); stats.set('btree', depth + 1, 'good'); stats.set('ratio', Math.round(n / 2 / (depth + 1)).toLocaleString() + '×', 'good');
        const c = 1 + idx.value; stats.set('write', c + ' structure' + (c > 1 ? 's' : ''), c > 6 ? 'bad' : '');
        if (scale.value >= 9) ctx.mission('scale');
        if (idx.value >= 8) { ctx.mission('write'); banner.className = 'banner warn'; banner.textContent = `Every insert must now update ${c} structures. Reads got faster, but writes pay for each index.`; }
      }
      async function scan() {
        if (busy) return; busy = true; [...grid.children].forEach((c) => { c.className = 'bit'; });
        for (let i = 0; i <= pos; i++) { grid.children[i].classList.add(i === pos ? 'on' : 'probe'); if (i && i < pos) grid.children[i - 1].classList.replace('probe', 'miss'); await ctx.sleep(22); }
        banner.className = 'banner warn'; banner.textContent = `Read ${pos + 1} rows to find one. On a real table this is every page, every time.`;
        ctx.mission('scan'); busy = false;
      }
      async function tree() {
        if (busy) return; busy = true;
        ['root', 'b', 'l2'].forEach((n) => net.state(n, ''));
        const path = [['root', 'b'], ['b', 'l2']];
        net.state('root', 'on'); await ctx.sleep(300);
        for (const [a, b] of path) { await net.send(a, b, { label: "'kim'", color: 'req', dur: 480 }); net.state(b, 'on'); }
        net.state('l2', 'hit'); [...grid.children].forEach((c) => { c.className = 'bit'; }); grid.children[pos].classList.add('on');
        banner.className = 'banner ok'; banner.textContent = 'Three page reads: root, internal, leaf. The leaf points straight to the row.';
        ctx.mission('tree'); busy = false;
      }
      calc();
    },
  });

  /* ----- Bloom filter ----- */
  RT.lab({
    id: 'bloom', title: 'Bloom Filter', short: 'Bloom filter', chapter: 'Bloom Filters',
    lede: 'A tiny bit array that remembers what it has seen. It can say "definitely not" with certainty, and "probably yes" with a small chance of being wrong.',
    missions: [['add', 'Add an item and see its bits set.'], ['no', 'Query something and get "definitely not".'], ['fp', 'Find a false positive: a yes for an item you never added.'], ['tune', 'Bring the predicted false-positive rate under 5% with 5 or more items added.']],
    notes: `<ul><li>Adding sets k bits. Querying checks those k bits.</li><li>Any 0 bit proves absence, so there are <b>no false negatives</b>.</li><li>All 1s may be a coincidence, so <b>false positives</b> can happen.</li><li>You can't remove items, because clearing a bit may erase others. <b>Counting Bloom filters</b> fix this at a memory cost.</li><li>Databases use them to skip disk reads for keys that aren't there.</li></ul>`,
    check: { q: 'A Bloom filter says "not present". How sure are you?', options: ['Probably right', 'Certain', 'Depends on k', 'Cannot tell'], answer: 1, why: 'If the item had been added, all of its bits would be 1. Any 0 proves it wasn\'t.' },
    render(root, ctx) {
      const items = new Set(); let bits = [];
      const m = ui.slider({ id: 'bf-m', label: 'Bits (m)', min: 16, max: 96, step: 8, value: 32, onInput: reset });
      const k = ui.slider({ id: 'bf-k', label: 'Hash functions (k)', min: 1, max: 6, value: 3, onInput: reset });
      const input = h('input', { type: 'text', id: 'bf-in', value: 'alice', 'aria-label': 'Item', onkeydown(e) { if (e.key === 'Enter') add(); } });
      const grid = h('div', { class: 'bits' });
      const banner = h('div', { class: 'banner', role: 'status' }, 'Add a few names, then query some you never added.');
      const stats = ui.stats([['n', 'Items added', 0], ['fill', 'Bits set', '0%'], ['fp', 'Predicted false-positive rate', '0%']]);
      const added = h('div', { class: 'chips' });
      const hashesBox = h('p', { class: 'mono small muted' });
      root.append(h('div', { class: 'controls' }, ui.field('Item', input, 'grow'), ui.btn('Add', add, { kind: 'primary', id: 'bf-add' }), ui.btn('Query', query, { id: 'bf-query' }), ui.btn('Add 5 random names', many), m, k, ui.btn('Clear', reset)), banner, ui.card('Bit array', grid, hashesBox), stats, ui.card('Items actually stored (the filter does not keep these)', added));
      const pos = (t) => Array.from({ length: k.value }, (_, i) => hash(t, i * 7919 + 1) % m.value);
      function draw(marks, cls) {
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(24px, 1fr))';
        grid.textContent = '';
        bits.forEach((b, i) => grid.append(h('div', { class: 'bit ' + (b ? 'on ' : '') + (marks && marks.includes(i) ? (cls ? cls(i) : 'probe') : ''), style: { cursor: 'default' } }, b)));
        const set = bits.filter(Boolean).length, n = items.size, fp = Math.pow(1 - Math.exp(-k.value * n / m.value), k.value) * 100;
        stats.set('n', n); stats.set('fill', Math.round((set / m.value) * 100) + '%'); stats.set('fp', fp.toFixed(fp < 1 ? 2 : 1) + '%', fp > 25 ? 'bad' : fp < 5 ? 'good' : '');
        if (n >= 5 && fp < 5) ctx.mission('tune');
        added.textContent = ''; [...items].forEach((t) => added.append(h('span', { class: 'chip', style: { cursor: 'default' } }, t)));
      }
      function reset() { items.clear(); bits = new Array(m.value).fill(0); hashesBox.textContent = ''; draw(); }
      function add(t) {
        const v = typeof t === 'string' ? t : input.value.trim(); if (!v) return;
        const p = pos(v); p.forEach((i) => { bits[i] = 1; }); items.add(v);
        hashesBox.textContent = `${v} → positions ${p.join(', ')}`;
        banner.className = 'banner'; banner.textContent = `Added ${v}. Its ${k.value} bits are set to 1, and the name itself is not stored.`;
        draw(p); ctx.mission('add');
      }
      const NAMES = 'nora omar priya quinn rosa sam tara uma vik wen xena yuki zane ivan jade kofi lena mira noel ola'.split(' ');
      function many() { for (let i = 0; i < 5; i++) add(NAMES[Math.floor(Math.random() * NAMES.length)] + Math.floor(Math.random() * 90)); }
      function query() {
        const v = input.value.trim(); if (!v) return;
        const p = pos(v), zero = p.filter((i) => !bits[i]);
        hashesBox.textContent = `${v} → positions ${p.join(', ')}`;
        draw(p, (i) => (bits[i] ? 'hit' : 'miss'));
        if (zero.length) { banner.className = 'banner ok'; banner.textContent = `Definitely not present: position ${zero[0]} is 0. No database lookup needed.`; ctx.mission('no'); }
        else if (items.has(v)) { banner.className = 'banner'; banner.textContent = 'Probably present, and it really was added.'; }
        else { banner.className = 'banner bad'; banner.textContent = `False positive: all ${p.length} bits are 1, but ${v} was never added. Other items set those bits. The real lookup would catch this.`; ctx.mission('fp'); }
      }
      reset();
    },
  });

  /* ----- Distributed file system ----- */
  RT.lab({
    id: 'dfs', title: 'Distributed File System', short: 'Distributed files', chapter: 'Distributed File Systems',
    lede: 'Split a file into blocks, scatter copies across racks, then start killing machines. The metadata server knows where every copy lives.',
    missions: [['write', 'Write a file into blocks with replication.'], ['read', 'Read it back from the block copies.'], ['fix', 'Kill a data node and see the blocks re-replicate.'], ['loss', 'Set replication to 1 and lose a block for good.']],
    notes: `<ul><li>The <b>metadata server</b> holds the map: which blocks make a file, and where they live. It never touches file data.</li><li><b>Data nodes</b> store the blocks, and clients read from them directly.</li><li>Copies span racks, so a rack failure can't take all of them.</li><li>Replication factor 3 means 200% storage overhead. Erasure coding reduces that.</li></ul>`,
    check: { q: 'Why don\'t file reads flow through the metadata server?', options: ['It has no network', 'It would become a bottleneck, so clients go straight to the data nodes', 'It stores no data about files', 'Security'], answer: 1, why: 'Keeping the data path away from metadata lets throughput scale with the number of data nodes.' },
    render(root, ctx) {
      const NODES = 6;
      const nn = Array.from({ length: NODES }, (_, i) => ({ id: 'D' + (i + 1), rack: Math.floor(i / 2), up: true, blocks: new Set() }));
      const net = Net(ctx, { w: 860, h: 300, label: 'Client, metadata server and six data nodes in three racks' });
      net.node('c', { x: 90, y: 56, label: 'Client', sub: '', w: 104 }).node('nn', { x: 430, y: 56, label: 'Metadata server', sub: 'NameNode', w: 170 }).link('c', 'nn');
      for (let r = 0; r < 3; r++) net.back.append(s('rect', { x: 32 + r * 280, y: 128, width: 248, height: 160, rx: 5, fill: 'none', stroke: 'var(--line)', 'stroke-dasharray': '4 4' }), s('text', { class: 'dim', x: 42 + r * 280, y: 280 }, 'Rack ' + (r + 1)));
      nn.forEach((n, i) => { net.node(n.id, { x: 92 + n.rack * 280 + (i % 2) * 128, y: 196, label: n.id, sub: 'empty', w: 116, h: 92, onClick: () => toggle(n) }); });
      const rf = ui.slider({ id: 'df-rf', label: 'Replication factor', min: 1, max: 3, value: 3 });
      const banner = h('div', { class: 'banner', role: 'status' }, 'Write a 512 MB file. It splits into 4 blocks of 128 MB.');
      const meta = h('div', { class: 'scroll' });
      let map = {}, busy = false;
      root.append(h('div', { class: 'controls' }, rf, ui.btn('Write file', write, { kind: 'primary', id: 'df-w' }), ui.btn('Read file', read, { id: 'df-r' })), banner, h('div', { class: 'stage' }, net.svg), ui.card('Metadata table', meta));
      function paint() {
        nn.forEach((n) => { net.sub(n.id, n.up ? ([...n.blocks].join(' ') || 'empty') : 'down'); net.state(n.id, n.up ? '' : 'dead'); });
        meta.textContent = '';
        const b = Object.keys(map);
        if (!b.length) { meta.append(h('p', { class: 'small muted' }, 'No files yet.')); return; }
        meta.append(h('table', { class: 'table' }, h('tr', null, h('th', null, 'Block'), h('th', null, 'Copies on'), h('th', null, 'Health')), b.map((k) => { const live = map[k].filter((id) => nn.find((x) => x.id === id).up); return h('tr', null, h('td', null, k), h('td', null, map[k].join(', ')), h('td', { class: live.length === 0 ? 'badtxt' : live.length < rf.value ? '' : 'good' }, live.length === 0 ? 'LOST' : `${live.length}/${rf.value}`)); })));
      }
      async function write() {
        if (busy) return; busy = true; map = {}; nn.forEach((n) => n.blocks.clear());
        await net.send('c', 'nn', { label: 'create', color: 'req', dur: 450 }); await net.send('nn', 'c', { label: 'block plan', color: 'cache', dur: 450 });
        for (let b = 1; b <= 4; b++) {
          const name = 'B' + b, used = new Set(), targets = [];
          const rot = nn.filter((n) => n.up).sort((x, y) => (hash(name + x.id) - hash(name + y.id)));
          for (const n of rot) { if (targets.length < rf.value && !used.has(n.rack)) { used.add(n.rack); targets.push(n); } }
          for (const n of rot) if (targets.length < rf.value && !targets.includes(n)) targets.push(n);
          let prev = 'c';
          for (const t of targets) { await net.send(prev, t.id, { label: name, color: 'req', dur: 360 }); t.blocks.add(name); prev = t.id; paint(); }
          map[name] = targets.map((t) => t.id); paint();
        }
        banner.className = 'banner ok'; banner.textContent = `Stored 4 blocks with ${rf.value} copies each, using ${4 * rf.value * 128} MB of disk for a 512 MB file.`;
        ctx.mission('write'); busy = false;
      }
      async function read() {
        if (busy || !Object.keys(map).length) return; busy = true;
        await net.send('c', 'nn', { label: 'locate', color: 'req', dur: 420 }); await net.send('nn', 'c', { label: 'block map', color: 'cache', dur: 420 });
        const missing = [];
        for (const b of Object.keys(map)) {
          const src = map[b].find((id) => nn.find((x) => x.id === id).up);
          if (!src) { missing.push(b); continue; }
          await net.send('c', src, { color: 'req', dur: 300 }); await net.send(src, 'c', { label: b, color: 'res', dur: 300 });
        }
        banner.className = 'banner ' + (missing.length ? 'bad' : 'ok');
        banner.textContent = missing.length ? `Read failed: ${missing.join(', ')} had no surviving copy.` : 'All 4 blocks read directly from data nodes. The metadata server only gave directions.';
        if (!missing.length) ctx.mission('read'); busy = false;
      }
      async function toggle(n) {
        n.up = !n.up;
        if (n.up) { n.blocks.clear(); Object.values(map).forEach((list) => { const i = list.indexOf(n.id); if (i >= 0) list.splice(i, 1); }); paint(); return; }
        paint();
        const lost = Object.entries(map).filter(([, l]) => l.length && l.every((id) => !nn.find((x) => x.id === id).up)).map(([b]) => b);
        if (lost.length) { banner.className = 'banner bad'; banner.textContent = `${lost.join(', ')} had no other copy, so that data is gone.`; ctx.mission('loss'); return; }
        if (!Object.keys(map).length) return;
        banner.className = 'banner warn'; banner.textContent = `${n.id} missed its heartbeats. The metadata server is copying its blocks elsewhere.`;
        await ctx.sleep(600);
        let did = 0;
        for (const b of [...n.blocks]) {
          const list = map[b], src = list.map((id) => nn.find((x) => x.id === id)).find((x) => x.up);
          const dst = nn.filter((x) => x.up && !x.blocks.has(b)).sort((x, y) => (x.rack === src.rack) - (y.rack === src.rack))[0];
          if (src && dst) { await net.send(src.id, dst.id, { label: b, color: 'cache', dur: 480 }); dst.blocks.add(b); list.splice(list.indexOf(n.id), 1, dst.id); did++; paint(); }
        }
        if (did) { banner.className = 'banner ok'; banner.textContent = `Re-replicated ${did} block(s). The cluster is back to full replication, with no human involved.`; ctx.mission('fix'); }
      }
      paint();
    },
  });
})();
