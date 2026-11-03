/* Checks the lab models: each must show the behaviour its topic teaches. */
require(require('./env').js + 'models.js');
const M = globalThis.RTModels;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL', m); } };
const near = (a, b, t) => Math.abs(a - b) <= t;

// Queueing: Little's Law holds, and delay climbs sharply near full load.
const q5 = M.queue(50, 10, 1), q9 = M.queue(90, 10, 1), q95 = M.queue(95, 10, 1);
ok(near(q5.response, 20, .01), 'M/M/1 at 50% takes twice the service time ' + q5.response);
ok(near(q9.response, 100, .01), 'M/M/1 at 90% takes ten times the service time ' + q9.response);
ok(near(q9.inSystem, 9, .01), 'L = λW ' + q9.inSystem);
ok(q95.response > q9.response * 1.9, 'the last few percent double the delay');
ok(!M.queue(120, 10, 1).stable, 'over capacity never settles');
ok(M.queue(90, 10, 2).response < q9.response / 4, 'a second server cuts the wait');
ok(M.queue(90, 10, 1).p95 > M.queue(90, 10, 1).response, 'p95 sits above the mean');

// Rate limiters.
const run = (kind, times, limit, win) => { const l = M.limiter(kind, limit, win); return times.filter((t) => l.allow(t)).length; };
const edge = [...Array(10).fill(9.9), ...Array(10).fill(10.1)];
ok(run('fixed', edge, 10, 10) === 20, 'fixed window lets a double burst through at the edge');
ok(run('sliding', edge, 10, 10) === 10, 'sliding log holds the limit at the edge');
ok(run('token', Array(30).fill(0), 10, 10) === 10, 'token bucket allows a full burst, then stops');
const tb = M.limiter('token', 10, 10); Array(10).fill(0).forEach(() => tb.allow(0));
ok(!tb.allow(.5) && tb.allow(1.5), 'tokens return at the refill rate');
ok(run('leaky', Array(30).fill(0), 5, 5) === 5, 'leaky bucket holds only what fits');
const lk = M.limiter('leaky', 5, 5); Array(4).fill(0).forEach(() => lk.allow(0));
ok(lk.delay() === 3, 'a leaky bucket delays queued requests');

// Idempotency keys.
const a = M.paymentServer(); a.pay(null, 100); a.pay(null, 100);
ok(a.ledger.length === 2, 'a retry with no key charges twice');
const b = M.paymentServer(), r1 = b.pay('k1', 100), r2 = b.pay('k1', 100);
ok(b.ledger.length === 1 && r2.replay && r1.charge === r2.charge, 'a retry with a key returns the first result');
ok(b.pay('k1', 900).status === 422, 'one key with a new body is refused');

// Isolation: this table is the point of the topic.
const want = { dirty: [1, 0, 0, 0], nonrepeat: [1, 1, 0, 0], phantom: [1, 1, 0, 0], lost: [1, 1, 0, 0], skew: [1, 1, 1, 0] };
Object.entries(want).forEach(([s, row]) => ['ru', 'rc', 'rr', 'ser'].forEach((l, i) => {
  const got = M.isolation(s, l);
  ok(!!got.anomaly === !!row[i], `${s} at ${l}: anomaly ${got.anomaly}, want ${!!row[i]} (A ${got.A}, B ${got.B})`);
}));
ok(M.isolation('lost', 'rr').B === 'aborted', 'first committer wins at repeatable read');
ok(M.isolation('skew', 'ser').B === 'aborted', 'serializable stops write skew');
ok(M.isolation('dirty', 'rc', 2).anomaly === null, 'a partial run has no verdict yet');

// LSM tree.
const t = M.lsm(4);
['a', 'b', 'c'].forEach((k, i) => t.put(k, i));
ok(t.files.length === 0 && t.wal.length === 3, 'writes wait in memory and the log');
t.put('d', 3);
ok(t.files.length === 1 && t.wal.length === 0 && t.mem.size === 0, 'a full memtable flushes to a sorted file');
ok(t.get('a').value === 0 && t.get('a').reads === 1, 'read from a file');
['a', 'e', 'f', 'g'].forEach((k) => t.put(k, 9));
ok(t.get('a').value === 9, 'the newest file wins');
t.del('e'); t.flush();
ok(t.get('e').found === false && t.get('e').value === null, 'a tombstone hides the old value');
ok(t.compact() && t.files.length === 1 && !t.files[0].rows.some((r) => r[0] === 'e'), 'compaction merges and drops tombstones');
ok(t.diskWrites > t.userWrites, 'write amplification shows up');

// Retries and breakers. Immediate retries multiply the load; a breaker sheds it.
const plain = M.resilience({ retries: 0 }), storm = M.resilience({ retries: 3 }), calm = M.resilience({ retries: 3, backoff: true, jitter: true }), safe = M.resilience({ retries: 3, backoff: true, jitter: true, breaker: true }), capped = M.resilience({ retries: 3, backoff: true, jitter: true, budget: true });
console.log('peak load / recovery s:', [plain, storm, calm, safe, capped].map((r) => `${r.peak} / ${r.recovery}`).join('  '));
ok(storm.peak > plain.peak * 2, 'immediate retries at least double the peak load');
ok(storm.recovery === null, 'in a long outage a retry storm outlives the outage');
ok(calm.recovery === null, 'backoff alone does not stop a long retry storm');
ok(capped.peak < 125 && capped.recovery != null, 'a retry budget caps the extra load: ' + capped.peak + ' ' + capped.recovery);
const blip = { from: 20, to: 23 }, sharp = M.resilience({ ...blip, retries: 3 }), soft = M.resilience({ ...blip, retries: 3, backoff: true, jitter: true });
console.log('short blip peak:', sharp.peak, soft.peak);
ok(soft.peak < sharp.peak, 'backoff and jitter soften a short blip');
ok(safe.peak < calm.peak, 'a breaker lowers the peak');
ok(safe.recovery != null && safe.recovery < 20, 'with a breaker the service recovers: ' + safe.recovery);
ok(safe.total.shed > 0, 'a breaker fails fast while open');

// Delivery guarantees.
const am = M.delivery('atmost'), al = M.delivery('atleast'), ex = M.delivery('exactly');
console.log('lost/dupes:', [am, al, ex].map((r) => `${r.lost}/${r.dupes}`).join('  '));
ok(am.lost > 0 && am.dupes === 0, 'at-most-once can lose but never repeats');
ok(al.dupes > 0, 'at-least-once can repeat');
ok(ex.dupes === 0 && ex.lost <= al.lost, 'deduplication removes repeats');

// Windows and watermarks: a longer wait means fewer late events and slower results.
const ev = M.streamEvents(240, 5, 10), w1 = M.windows(ev.map((e) => ({ ...e })), 10, 0), w2 = M.windows(ev.map((e) => ({ ...e })), 10, 12);
console.log('late/wait:', `${w1.late}/${w1.wait.toFixed(1)}  ${w2.late}/${w2.wait.toFixed(1)}`);
ok(w1.late > w2.late, 'a longer watermark lag drops fewer events');
ok(w2.wait > w1.wait, 'a longer lag delays the result');
ok(w2.list.reduce((s, w) => s + w.counted + w.late, 0) === 240, 'every event lands in a window');

// Ids.
const sf = M.ids.snowflake(M.ids.EPOCH + 123456, 42, 7), d = M.ids.decode(sf);
ok(d.ms === M.ids.EPOCH + 123456 && d.worker === 42 && d.seq === 7, 'a Snowflake id decodes to its parts');
ok(M.ids.snowflake(M.ids.EPOCH + 2, 0, 0) > M.ids.snowflake(M.ids.EPOCH + 1, 1023, 4095), 'later ids sort after earlier ones');
ok(M.ids.bits(sf).length === 64, 'an id is 64 bits');
const rnd = M.rng(3), u = M.ids.uuid4(rnd);
ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u), 'uuid4 has the right shape ' + u);
ok(M.ids.ulid(1000, rnd).slice(0, 10) < M.ids.ulid(2000, rnd).slice(0, 10) && M.ids.ulid(1000, rnd).length === 26, 'ulids sort by time');

// Pagination: a new row shifts offset pages, and keyset pages stay put.
const rows = Array.from({ length: 20 }, (_, i) => ({ id: 20 - i })), first = M.pages.offset(rows, 0, 5).rows;
const shifted = [{ id: 21 }, ...rows];
ok(M.pages.offset(shifted, 5, 5).rows[0].id === first[4].id, 'offset repeats a row after an insert');
ok(M.pages.keyset(shifted, first[4].id, 5).rows[0].id === first[4].id - 1, 'keyset carries on from the last row');
ok(M.pages.offset(rows, 15, 5).scanned === 20 && M.pages.keyset(rows, 6, 5).scanned === 5, 'keyset reads only one page of rows');

// Logical clocks.
const c = M.clocks(3), e1 = c.send(0), e2 = c.receive(1, e1), e3 = c.local(2);
ok(e2.lam > e1.lam, 'a receive follows its send');
ok(M.order(e1.vec, e2.vec) === 'before', 'vector clocks see cause and effect');
ok(M.order(e2.vec, e3.vec) === 'concurrent', 'vector clocks see concurrency');
ok(c.local(0).lam === 2 && e3.lam === 1, 'lamport counters tick on each event');

// Error budgets.
const eb = M.budget(.999, 30, 1000000, 15000);
ok(near(eb.allowed, 30000, 1) && near(eb.minutes, 43.2, .01) && near(eb.used, .5, .001), 'a 99.9% target over 30 days allows 43 minutes');
ok(near(M.burnRate(.01, .999), 10, .001), 'a 1% error rate burns a 99.9% budget ten times too fast');

// Network metrics: each number changes what its topic says it changes.
const net = (o) => M.network({ bandwidth: 100, rtt: 40, sizeKB: 50, rps: 100, ...o });
const n0 = net({});
ok(n0.limit === 'bandwidth' && n0.speed === 100, 'a clean link runs at its bandwidth');
ok(near(n0.bdpKB, 500, .01), 'bandwidth-delay product: 100 Mbps × 40 ms is 500 KB');
ok(near(n0.parts.rampUp, 80, .01), 'a 50 KB response needs two extra round trips of slow start');
ok(near(n0.rho, .4, .01), '100 × 50 KB is 40% of a 100 Mbps link');
ok(near(n0.inFlight, (100 * n0.response) / 1000, .001), 'Little\'s Law sets the open connections');
const gain = (o) => 1 - net(o).response / n0.response;
ok(gain({ bandwidth: 200 }) < .05 && gain({ rtt: 20 }) > .3, 'small responses wait on latency, not bandwidth');
const big = { sizeKB: 25000, rps: .1 }, gainBig = (o) => 1 - net({ ...big, ...o }).response / net(big).response;
ok(gainBig({ bandwidth: 200 }) > .3 && gainBig({ bandwidth: 200 }) > gainBig({ rtt: 20 }), 'large transfers wait on bandwidth');
ok(M.network({ bandwidth: 1000, rtt: 200, sizeKB: 50, rps: 10, windowKB: 64 }).limit === 'window', 'a small window caps a long, fat link');
ok(near(M.network({ bandwidth: 1000, rtt: 200, sizeKB: 50, rps: 10, windowKB: 64 }).speed, 2.56, .01), '64 KB ÷ 200 ms is 2.56 Mbps');
ok(net({ loss: 1 }).limit === 'loss' && net({ loss: 2 }).speed < net({ loss: 1 }).speed, 'loss caps a connection, and more loss caps it harder');
ok(near(net({ loss: 4 }).byLoss * 2, net({ loss: 1 }).byLoss, .01), 'four times the loss halves the Mathis limit');
ok(net({ jitter: 40 }).response === n0.response && near(net({ jitter: 40 }).p95 - net({}).p95, 80, .01), 'jitter leaves the average alone and hurts p95');
ok(net({ jitter: 80 }).call !== 'good' && n0.call === 'good', 'jitter spoils a call that bandwidth cannot save');
ok(net({ rps: 500 }).call === 'poor', 'a saturated link spoils a call');
ok(near(net({ reuse: false }).parts.handshake, 80, .01), 'a new connection costs two round trips');
ok(net({ rtt: 200 }).workers > n0.workers, 'the same traffic needs more workers when latency rises');
ok(net({ rtt: 200 }).costMonth === n0.costMonth, 'latency does not change the data bill');
ok(net({ rps: 200 }).costMonth > n0.costMonth * 1.9, 'twice the traffic is twice the data bill');
ok(!isFinite(net({ rps: 500 }).response) && near(net({ rps: 500 }).failed, .5, .01), 'twice what the link carries fails half the requests');
ok(near(net({ rps: 500 }).goodput, 100, .01), 'an overloaded link still delivers its bandwidth');
ok(net({ rps: 240 }).response > net({ rps: 120 }).response, 'a fuller link adds queueing delay');
const sweep = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].map((b) => M.network({ bandwidth: b, rtt: 40, sizeKB: 5000, rps: .01 }).response);
ok(sweep.every((v, i) => !i || v <= sweep[i - 1]), 'more bandwidth never makes a response slower: ' + sweep.map(Math.round));

console.log(fails ? fails + ' FAILED' : 'all model checks passed');
process.exitCode = fails ? 1 : 0;
