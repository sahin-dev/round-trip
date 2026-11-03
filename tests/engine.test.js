/* Engine checks: reference designs must pass, naive designs must fail, and each
   design decision must move the numbers in the direction a practitioner expects. */
const path = require('./env').js;
require(path + 'practice-engine.js'); require(path + 'practice-briefs.js');
const D = globalThis.RTDesign;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL', m); } };
const money = (n) => '$' + Math.round(n).toLocaleString();

console.log('brief/stage            cost        budget    p95r  avail      score nodes');
for (const b of D.BRIEFS) for (let s = 0; s < 3; s++) {
  const des = D.solve(b, s), g = D.grade(des, b, s);
  const r = g.r;
  console.log(`${(b.id + '/' + s).padEnd(14)} ${money(r.cost).padStart(11)} ${money(g.limit).padStart(11)} ${String(Math.round((r.classes.read || r.classes.write).p95)).padStart(6)} ${(r.avail * 100).toFixed(4)}% ${String(g.score).padStart(5)} ${g.letter} chaos ${g.tests.filter((t) => t.pass).length}/${g.tests.length} app=${(des.nodes.find((n) => n.type === 'app') || {}).count}`);
  ok(g.passed, `${b.id}/${s} reference does not pass: ${JSON.stringify(r.checks)} cost ok ${g.costOk} ${Object.entries(r.classes).map(([k, c]) => k + ':' + Math.round(c.p95) + '/' + r.d.slo[k]).join(' ')}`);
  ok(g.tests.every((t) => t.pass), `${b.id}/${s} reference fails chaos: ${g.tests.filter((t) => !t.pass).map((t) => t.id + ' ' + t.succ.toFixed(3)).join(',')}`);
  // Naive design: one server and one database.
  const naive = { nodes: [{ id: 'u', type: 'users', regions: 1 }, { id: 'a', type: 'app', ...D.DEFAULTS.app }, { id: 'd', type: 'sql', ...D.DEFAULTS.sql }], edges: [['u', 'a'], ['a', 'd']] };
  const n = D.grade(naive, b, s);
  ok(s === 0 || !n.passed, `${b.id}/${s} naive design passes`);
  ok(n.findings.length > 0, `${b.id}/${s} naive gets no findings`);
}

// Direction tests on the feed brief at Growth.
const b = D.BRIEFS.find((x) => x.id === 'feed'), S = 1, base = D.solve(b, S);
const clone = () => JSON.parse(JSON.stringify(base));
const ev = (d, f) => D.evaluate(d, b, S, f);
const node = (d, t) => d.nodes.find((n) => n.type === t);
const dropEdge = (d, a, c) => { d.edges = d.edges.filter(([x, y]) => !(x === a && y === c)); };

{ const d = clone(); node(d, 'cache').memGB = 1; const r1 = ev(d), r0 = ev(base);
  ok(r1.nodes.db.util > r0.nodes.db.util, 'smaller cache must load the database more'); }
{ const d = clone(); dropEdge(d, 'app', 'cache'); d.nodes = d.nodes.filter((n) => n.id !== 'cache'); const r = ev(d);
  ok(r.nodes.db.util > ev(base).nodes.db.util * 2, 'removing the cache must load the database far more'); }
{ const d = clone(); node(d, 'app').count = 1; const r = ev(d); ok(r.succ < .999, 'one app server must overload'); ok(!r.checks.capacity, 'capacity check must fail'); }
{ const d = clone(); dropEdge(d, 'app', 'q'); dropEdge(d, 'q', 'w'); dropEdge(d, 'w', 'db'); d.nodes = d.nodes.filter((n) => !['q', 'w'].includes(n.id)); const r = ev(d), r0 = ev(base);
  ok(r.nodes.app.util > r0.nodes.app.util, 'without a queue the app must do fan-out itself');
  ok(r.classes.write.p95 > r0.classes.write.p95, 'without a queue writes must be slower'); }
{ const d = clone(); dropEdge(d, 'cdn', 'blob'); d.nodes = d.nodes.filter((n) => n.id !== 'cdn'); d.edges = d.edges.filter(([a, c]) => a !== 'cdn' && c !== 'cdn'); d.edges.push(['users', 'blob']); const r = ev(d), r0 = ev(base);
  ok(r.classes.media.p95 > r0.classes.media.p95 * 1.3, `removing the CDN must slow media (${r.classes.media.p95} vs ${r0.classes.media.p95})`); }
{ const d = clone(); node(d, 'users').regions = 1; const r = ev(d); d.nodes[0].regions = 3; const r3 = ev(d);
  ok(r3.classes.read.p95 < r.classes.read.p95, 'more regions must cut latency'); ok(r3.cost > r.cost, 'more regions must cost more'); }
{ const d = clone(); node(d, 'users').regions = 1; node(d, 'lb').multiAZ = false; const r = ev(d, { zone: true }); ok(r.succ < .5, 'a single-zone LB must die in a zone outage'); ok(ev(base, { zone: true }).succ > .98, 'multi-AZ survives'); }
{ const d = clone(); const k = node(d, 'cache'); k.coalesce = false; const a = ev(d, { cold: true }); k.coalesce = true; const c = ev(d, { cold: true });
  ok(c.nodes.db.util < a.nodes.db.util, 'coalescing must reduce load on the database during a cold cache'); }
{ const f = D.BRIEFS.find((x) => x.id === 'shop'), d = D.solve(f, 1); const dbn = node(d, 'sql');
  const r0 = D.evaluate(d, f, 1), rw = { ...dbn }; ok(r0.classes.write.p95 < f.slo.write, 'shop writes meet SLO');
  dbn.replicas = 0; const r = D.evaluate(d, f, 1, { primary: true }); ok(r.succ < .98, 'no replica must fail the primary-death test'); void rw;
  const d2 = D.solve(f, 1); d2.nodes.find((n) => n.id === 'db').type = 'nosql'; d2.nodes.find((n) => n.id === 'db').count = 6; const r2 = D.evaluate(d2, f, 1); ok(!r2.checks.strong, 'NoSQL must fail a strong-consistency brief'); }
{ const d = clone(); const a = ev(d); node(d, 'app').count *= 4; ok(ev(d).cost > a.cost, 'more servers must cost more'); }
// Replicas must not help writes; shards must.
{ const f = D.BRIEFS.find((x) => x.id === 'shop'), d = D.solve(f, 1), n = d.nodes.find((x) => x.id === 'db'); d.edges = d.edges.filter(([a, c]) => !(a === 'w' || c === 'w' || c === 'q')); d.nodes = d.nodes.filter((x) => !['w', 'q'].includes(x.id));
  n.shards = 1; n.replicas = 1; const r1 = D.evaluate(d, f, 1); n.replicas = 3; const r2 = D.evaluate(d, f, 1); n.replicas = 1; n.shards = 3; const r3 = D.evaluate(d, f, 1);
  const w = (r) => r.nodes.db.load.write / r.nodes.db.cap.w;
  ok(w(r1) === w(r2), 'replicas must not change write utilisation'); ok(w(r3) < w(r1), 'shards must lower write utilisation'); }
// Broken graphs must not crash.
{ const cases = [{ nodes: [], edges: [] }, { nodes: [{ id: 'u', type: 'users' }], edges: [] }, { nodes: [{ id: 'u', type: 'users' }, { id: 'a', type: 'app', count: 1 }, { id: 'b', type: 'lb', count: 1 }], edges: [['u', 'a'], ['a', 'b'], ['b', 'a']] }];
  cases.forEach((c, i) => { try { const g = D.grade(c, b, 0); ok(!g.passed, 'broken graph ' + i + ' must not pass'); ok(Number.isFinite(g.score), 'score must be finite for ' + i); } catch (e) { ok(false, 'graph ' + i + ' threw ' + e.message); } }); }
// Load tests: an empty test changes nothing, and every slider moves the numbers the way it should.
for (const x of D.BRIEFS) for (let s = 0; s < 3; s++) {
  const des = D.solve(x, s), plain = D.evaluate(des, x, s), same = D.evaluate(des, x, s, { load: {} });
  ok(JSON.stringify([plain.nodes, plain.classes, plain.cost, plain.edges]) === JSON.stringify([same.nodes, same.classes, same.cost, same.edges]), `${x.id}/${s} an empty load test must change nothing`);
  const bp = D.breakPoint(des, x, s, {});
  ok(bp.scale >= 1, `${x.id}/${s} a reference must hold at its own traffic, broke at ${bp.scale}`);
  ok(bp.scale === Infinity || D.holds(D.evaluate(des, x, s, { load: { scale: bp.scale } })), `${x.id}/${s} the break point must still hold`);
}
{ const lo = (l) => ev(base, { load: l }), r0 = lo({});
  ok(lo({ readX: 5 }).nodes.db.load.read > r0.nodes.db.load.read * 3, 'more reads must load the database');
  ok(lo({ readX: 5 }).nodes.db.load.write === r0.nodes.db.load.write, 'more reads must leave writes alone');
  ok(lo({ writeX: 5 }).nodes.w.load.write > r0.nodes.w.load.write * 4, 'more writes must load the workers');
  ok(lo({ writeX: 5 }).d.storageTB > r0.d.storageTB * 4, 'more writes must grow the data faster');
  ok(lo({ scale: 3 }).d.read === r0.d.read * 3 && lo({ scale: 3 }).d.media === r0.d.media * 3, 'all traffic moves every class');
  ok(lo({ where: 'far' }).classes.read.p95 > lo({ where: 'near' }).classes.read.p95 + 40, 'distant users must wait longer');
  ok(lo({ respKB: 500 }).classes.read.p95 > r0.classes.read.p95 * 1.5, 'large responses must be slower to send');
  ok(lo({ respKB: 500 }).nodes.lb.util > r0.nodes.lb.util * 3, 'large responses must fill the load balancer');
  ok(lo({ respKB: 500 }).cost > r0.cost, 'large responses must cost more to send');
  ok(lo({ respKB: 500 }).nodes.cache.util > r0.nodes.cache.util, 'large responses must work the cache harder');
  const gap = (kb) => lo({ scale: .01, respKB: kb, where: 'far' }).classes.read.p95 - lo({ scale: .01, respKB: kb, where: 'near' }).classes.read.p95;
  ok(gap(1000) > gap(2) * 1.5, 'distance must cost more when a response needs several round trips');
  ok(lo({ writeKB: 500 }).classes.write.p95 > r0.classes.write.p95, 'large writes must be slower');
  ok(lo({ maxHit: .3 }).nodes.db.load.read > r0.nodes.db.load.read * 2, 'fewer cacheable reads must load the database');
  ok(lo({ fanout: b.fanout ? b.fanout * 20 : 100 }).nodes.w.util > r0.nodes.w.util * 5, 'more fan-out must load the workers');
  ok(lo({ scale: 40 }).succ < .999, 'far more traffic than the design was sized for must overload it');
  const stat = clone(); stat.nodes.forEach((n) => { n.auto = false; });
  const fixed = D.evaluate(stat, b, S, { load: { scale: 5 } }), elastic = lo({ scale: 5 });
  ok(elastic.nodes.app.util < fixed.nodes.app.util, 'auto-scaling must absorb sustained traffic');
  ok(elastic.nodes.app.cost > r0.nodes.app.cost * 4, 'auto-scaling must cost more while it is scaled out');
  ok(lo({ scale: 20 }).nodes.app.cap.all === lo({ scale: 40 }).nodes.app.cap.all, 'auto-scaling has a ceiling');
  const more = clone(); more.nodes.forEach((n) => { if (n.count) n.count *= 3; if (n.shards) n.shards *= 3; });
  ok(D.breakPoint(more, b, S, {}).scale > D.breakPoint(base, b, S, {}).scale * 1.3, 'more capacity must raise the break point');
  const naive = { nodes: [{ id: 'u', type: 'users', regions: 1 }, { id: 'a', type: 'app', count: 2 }, { id: 'd', type: 'sql' }], edges: [['u', 'a'], ['a', 'd']] };
  const nb = D.BRIEFS.find((x) => x.id === 'url'), np = D.breakPoint(naive, nb, 0, {});
  ok(np.why.id === 'a', 'the break point must name the busiest tier: ' + JSON.stringify(np.why));
  ok(D.breakPoint({ nodes: [{ id: 'u', type: 'users' }], edges: [] }, nb, 0, {}).why.kind === 'route', 'a design with no path must say so');
  ok(D.breakPoint(base, b, S, { where: 'far', respKB: 5000 }).why.kind === 'latency', 'latency can be what stops a design'); }
// How a real system behaves: each check below failed on the first version of this engine.
{ const U = { id: 'u', type: 'users', regions: 1 }, url = D.BRIEFS.find((x) => x.id === 'url'), shop = D.BRIEFS.find((x) => x.id === 'shop');
  const near = (a, c, t) => Math.abs(a - c) <= (t === undefined ? Math.abs(c) * .01 + 1e-9 : t);
  const stack = (count, extra) => ({ nodes: [U, { id: 'l', type: 'lb', count: 2, multiAZ: true }, { id: 'a', type: 'app', count }, { id: 'd', type: 'nosql', count: 3 }, ...(extra || [])], edges: [['u', 'l'], ['l', 'a'], ['a', 'd']] });
  const over = D.evaluate(stack(1), url, 0, { load: { scale: 100 } });
  ok(over.classes.read.timedOut && over.classes.read.p95 === D.TIMEOUT_MS, 'an overloaded system times out, and does not report a normal latency');
  const worst = Math.max(...Object.values(over.nodes).map((n) => n.util));
  ok(near(over.succ, 1 / worst), 'one bottleneck sets the success rate: ' + over.succ + ' against ' + 1 / worst);
  ok(over.nodes.d.load.read <= over.nodes.a.cap.all * 1.01, 'tiers behind a bottleneck only see what it lets through');
  const met = D.BRIEFS.find((x) => x.id === 'metrics'), big = D.solve(met, 2), many = D.evaluate(big, met, 2, { load: { scale: 10 } }), tight = Math.max(...Object.values(many.nodes).map((n) => n.util));
  ok(many.succ > .9 / tight, 'several full tiers do not multiply their failures: ' + many.succ);
  const lat = (count, x) => D.evaluate(stack(count), url, 0, { load: { scale: x } }).classes.read.p95;
  ok(lat(100, 1) > lat(100, 40) * .9, 'a large pool at half load barely queues');
  ok(lat(1, 2) > lat(1, 1), 'a single busy server queues');
  const shopD = D.solve(shop, 1), far = { ...shop, global: true, strong: false }, u0 = shopD.nodes.find((n) => n.type === 'users');
  shopD.edges = shopD.edges.filter(([a, c]) => !(c === 'q' || a === 'q' || a === 'w')); shopD.nodes = shopD.nodes.filter((n) => !['q', 'w'].includes(n.id));
  u0.regions = 1; const w1 = D.evaluate(shopD, far, 1).classes.write.net; u0.regions = 3; const w3 = D.evaluate(shopD, far, 1).classes.write.net, r3 = D.evaluate(shopD, far, 1).classes.read.net;
  ok(near(w1, w3) && r3 < w3, 'writes keep travelling to the primary, while reads get closer');
  const reg = clone(); node(reg, 'users').regions = 1; const one = ev(reg); node(reg, 'users').regions = 3; const three = ev(reg);
  ok(three.nodes.app.util < one.nodes.app.util * .4, 'each region adds stateless capacity');
  ok(three.nodes.db.cap.w === one.nodes.db.cap.w, 'regions do not add write capacity');
  const rep = (w) => D.evaluate({ nodes: [U, { id: 'a', type: 'app', count: 900 }, { id: 'd', type: 'sql', shards: 1, replicas: 3, cpu: 8, ram: 32 }], edges: [['u', 'a'], ['a', 'd']] }, url, 2, { load: { writeX: w } });
  ok(rep(3000).nodes.d.util > rep(1).nodes.d.util + (rep(3000).nodes.d.load.write / rep(3000).nodes.d.cap.w) * .99, 'replicas lose read room to replaying writes');
  const spiky = clone(); node(spiky, 'app').count = Math.ceil(node(spiky, 'app').count / 2);
  ok(ev(spiky, { spike: 6 }).nodes.app.util > ev(spiky).nodes.app.util * 2, 'auto-scaling cannot absorb a sudden spike at once');
  const sqlD = D.solve(shop, 1); const before = D.evaluate(sqlD, shop, 1), lost = D.evaluate(sqlD, shop, 1, { primary: true });
  ok(lost.nodes.db.cap.r < before.nodes.db.cap.r, 'losing the primary costs a replica');
  const miss = D.evaluate({ nodes: [U, { id: 'a', type: 'app', count: 3 }, { id: 'c', type: 'cache', count: 2, memGB: 1 }, { id: 'd', type: 'sql' }], edges: [['u', 'a'], ['a', 'c'], ['a', 'd']] }, url, 0);
  ok(miss.classes.read.path.some(([id]) => id === 'd'), 'with over 5% misses, p95 follows the database path');
  // Impossible designs.
  const cheat = (edges, nodes) => D.grade({ nodes: [U, ...nodes], edges }, url, 0);
  ok(!cheat([['u', 'd']], [{ id: 'd', type: 'nosql', count: 3 }]).passed, 'a browser cannot call a database');
  ok(!cheat([['u', 'c'], ['c', 'd']], [{ id: 'c', type: 'cache', count: 2, memGB: 8 }, { id: 'd', type: 'nosql', count: 3 }]).passed, 'a browser cannot call a cache');
  ok(!cheat([['u', 'a'], ['a', 'd']], [{ id: 'a', type: 'app', count: 3, multiAZ: true }, { id: 'd', type: 'nosql', count: 3 }]).passed, 'several servers need something sharing the traffic');
  const small = { nodes: [U, { id: 'a', type: 'app', count: 3 }, { id: 'c', type: 'cache', count: 1, memGB: 100000 }, { id: 'd', type: 'nosql', count: 3 }], edges: [['u', 'a'], ['a', 'c'], ['a', 'd']] };
  ok(D.review(small, url, 2, D.evaluate(small, url, 2)).some((f) => /more than the hardware/.test(f.text)), 'one node cannot hold 100 TB of memory');
  const clean = D.sanitize({ nodes: [{ id: 'u', type: 'users', regions: 9 }, { id: 'u', type: 'users' }, { id: 'a', type: 'app', count: -5, cpu: 0, ram: 'x', auto: 1 }, { id: 'z', type: 'robot' }, null], edges: [['u', 'a'], ['u', 'a'], ['a', 'a'], ['a', 'gone'], 7] });
  ok(clean.nodes.length === 2 && clean.edges.length === 1, 'bad nodes and connections are dropped');
  ok(clean.nodes[0].regions === 3 && clean.nodes[1].count === 1 && clean.nodes[1].cpu === 1 && clean.nodes[1].ram === undefined && clean.nodes[1].auto === true, 'bad values are clamped or reset');
  ok(JSON.stringify(D.sanitize(clean)) === JSON.stringify(clean), 'cleaning twice changes nothing');
  ['junk', null, {}, { nodes: 'x' }, { nodes: [{ id: 1, type: 'app', count: 'NaN' }], edges: 'y' }].forEach((v, i) => { try { const g = D.grade(v, url, 0); ok(Number.isFinite(g.score) && !g.passed, 'bad input ' + i + ' must not pass'); } catch (e) { ok(false, 'bad input ' + i + ' threw ' + e.message); } });

  // Every connection carries what it should.
  const chat = D.BRIEFS.find((x) => x.id === 'chat'), wsD = { nodes: [U, { id: 'l', type: 'lb', count: 2 }, { id: 'w', type: 'ws', count: 40 }, { id: 'q', type: 'queue', count: 2 }, { id: 'k', type: 'worker', count: 20 }, { id: 'd', type: 'nosql', count: 9 }, { id: 'c', type: 'cache', count: 2 }, { id: 'x', type: 'search', count: 2 }], edges: [['u', 'l'], ['l', 'w'], ['w', 'q'], ['w', 'c'], ['q', 'k'], ['k', 'd'], ['k', 'x']] };
  const wr = D.evaluate(wsD, chat, 1), rt = wr.d.rt;
  ok(rt > 0 && near(wr.edges['w>q'], rt, rt * .01), 'WebSocket servers pass messages on to a queue: ' + wr.edges['w>q'] + ' of ' + rt);
  ok(wr.edges['w>c'] > 0 && wr.nodes.c.load.other > 0, 'WebSocket servers can use a cache');
  ok(wr.edges['q>k'] > 0 && wr.edges['k>d'] > 0, 'those messages carry on to the store');
  ok(wr.edges['k>x'] > 0 && wr.nodes.x.load.other > 0, 'workers keep a search index updated');
  ok(D.review({ ...wsD, edges: [['u', 'l'], ['l', 'w'], ['w', 'q']] }, chat, 1, D.evaluate({ ...wsD, edges: [['u', 'l'], ['l', 'w'], ['w', 'q']] }, chat, 1)).some((f) => /carries no traffic/.test(f.text)), 'an unused connection says why');
  const noWs = D.evaluate({ nodes: [U, { id: 'a', type: 'app', count: 3 }, { id: 'd', type: 'nosql', count: 3 }], edges: [['u', 'a'], ['a', 'd']] }, chat, 1);
  ok(!noWs.classes.rt.routed, 'realtime still needs WebSocket servers');

  // Laws that must hold for any design at all.
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }, pick = (a) => a[Math.floor(rnd() * a.length)];
  const kinds = Object.keys(D.TYPES).filter((t) => t !== 'users');
  for (let i = 0; i < 1500; i++) {
    const nodes = [{ ...U }], n = 1 + Math.floor(rnd() * 8);
    for (let k = 0; k < n; k++) nodes.push({ id: 'n' + k, type: pick(kinds), count: 1 + Math.floor(rnd() * 20), shards: 1 + Math.floor(rnd() * 4), replicas: Math.floor(rnd() * 3), multiAZ: rnd() > .5, auto: rnd() > .7, memGB: pick([1, 8, 64]) });
    const edges = []; for (let k = 0; k < n * 3; k++) edges.push([pick(nodes).id, pick(nodes).id]);
    const des = { nodes, edges }, x = pick(D.BRIEFS), s = Math.floor(rnd() * 3), r = D.evaluate(des, x, s), g = D.grade(des, x, s);
    const bad = (m) => { ok(false, 'design ' + i + ' on ' + x.id + ': ' + m); };
    if (![r.succ, r.cost, r.avail, g.score].every(Number.isFinite) || Object.values(r.classes).some((c) => !Number.isFinite(c.p95))) bad('a number is not finite');
    if (r.succ < 0 || r.succ > 1 || r.avail < 0 || r.avail > 1 || r.cost < 0) bad('a number is out of range');
    if (Object.values(r.nodes).some((v) => v.util < 0)) bad('negative load');
    const more = JSON.parse(JSON.stringify(des)); more.nodes.forEach((v) => { if (v.type !== 'users') { v.count *= 2; v.shards *= 2; } });
    const r2 = D.evaluate(more, x, s);
    if (r2.succ < r.succ - 1e-9) bad('more capacity lowered success: ' + r.succ + ' to ' + r2.succ);
    if (D.evaluate(des, x, s, { load: { scale: 3 } }).succ > r.succ + 1e-9) bad('more traffic raised success');
  } }
console.log(fails ? `\n${fails} FAILED` : '\nall engine checks passed');
