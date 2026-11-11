/* Live incident checks: every scenario runs on every reference design with sane numbers, and each
   mechanism behaves the way an on-call engineer would expect. Each check names what it protects. */
const path = require('./env').js;
require(path + 'practice-engine.js'); require(path + 'practice-briefs.js'); require(path + 'practice-ops.js');
const D = globalThis.RTDesign, O = globalThis.RTOps;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL', m); } };
const brief = (id) => D.BRIEFS.find((b) => b.id === id);
const play = (design, b, stage, id, opts, respond) => {
  const s = O.create(design, b, stage, id, opts);
  while (!s.done) { s.step(); if (respond) respond(s); }
  return s;
};
const clone = (x) => JSON.parse(JSON.stringify(x));

// Every scenario on every reference design: finite, in range, repeatable.
const table = {};
for (const b of D.BRIEFS) for (let st = 0; st < 3; st++) {
  const ref = D.solve(b, st);
  for (const sc of O.SCENARIOS) {
    const s = play(ref, b, st, sc.id), r = s.report(), key = `${b.id}/${st}/${sc.id}`;
    (table[sc.id] = table[sc.id] || []).push(r.grade);
    ok(s.series.length === sc.len, key + ' runs every minute');
    ok(s.series.every((x) => [x.err, x.offered, x.served, x.cost, x.lag, x.budget].every(Number.isFinite)), key + ' numbers are finite');
    ok(s.series.every((x) => x.err >= 0 && x.err <= 1 && x.served <= x.offered + 1e-6), key + ' errors stay in range');
    ok(s.series.every((x, i) => !i || x.budget >= s.series[i - 1].budget), key + ' the error budget only goes down');
    ok(['S', 'A', 'B', 'C', 'D'].includes(r.grade) && r.insights.length > 0, key + ' has a postmortem');
    if (['evening', 'zone', 'primary', 'cache'].includes(sc.id)) ok(r.pass, `${key} a reference design survives what it was sized for: ${r.grade} ${(r.used * 100).toFixed(1)}%`);
  }
}
Object.entries(table).forEach(([k, v]) => console.log(k.padEnd(8), v.join('')));
{ const b = brief('feed'), ref = D.solve(b, 1), a = play(ref, b, 1, 'gameday'), c = play(ref, b, 1, 'gameday');
  ok(JSON.stringify(a.series) === JSON.stringify(c.series), 'the same run gives the same minutes'); }

const U = { id: 'u', type: 'users', regions: 1 }, url = brief('url');
/* What a student often draws: one balancer, a few servers, a cache, one database, all in one zone. */
const student = { nodes: [U, { id: 'l', type: 'lb', count: 1 }, { id: 'a', type: 'app', count: 3 }, { id: 'c', type: 'cache', count: 1, memGB: 8 }, { id: 'd', type: 'sql' }], edges: [['u', 'l'], ['l', 'a'], ['a', 'c'], ['a', 'd']] };

// Zones and replicas.
{ const z = play(student, url, 0, 'zone').report(); ok(!z.pass && z.worstErr > .9, 'a single-zone design goes dark with its zone');
  ok(play(D.solve(url, 0), url, 0, 'zone').report().pass, 'a design spread across zones survives');
  const lost = play(student, url, 0, 'primary').report(), restored = play(student, url, 0, 'primary', {}, (s) => { if (s.pages.length) s.act('restore'); }).report();
  ok(!lost.pass && lost.recovered === null, 'with no replica, the database stays down until someone restores it');
  ok(restored.used < lost.used * .6 && restored.recovered !== null, 'restoring from backup ends the outage');
  ok(restored.insights.some((x) => /backup was lost/.test(x)), 'a restore loses recent writes, and the postmortem says so');
  const shop = brief('shop'), sref = D.solve(shop, 1), fo = play(sref, shop, 1, 'primary');
  ok(fo.report().pass, 'a replica in another zone turns a crash into a short failover');
  ok(fo.series.some((x) => x.lag > 0) && fo.series[fo.series.length - 1].lag === 0, 'writes queue up during the failover, then drain'); }

// Auto-scaling takes time, then gives servers back.
{ const b = brief('feed'), ref = D.solve(b, 1), s = play(ref, b, 1, 'push'), app = ref.nodes.find((n) => n.type === 'app');
  const at = O.SCENARIOS.find((x) => x.id === 'push').events[0].at, fleet = (t) => s.series[t].fleet[app.id];
  ok(fleet(at + O.BOOT - 1) === fleet(at - 1), 'new servers do not appear before they have booted');
  ok(Math.max(...s.series.map((x) => x.fleet[app.id])) > fleet(at - 1), 'auto-scaling grows the tier during a surge');
  ok(fleet(s.len - 1) < Math.max(...s.series.map((x) => x.fleet[app.id])), 'auto-scaling shrinks the tier once the surge has passed');
  const lean = clone(ref); lean.nodes.forEach((n) => { if (n.type === 'app') n.count = Math.ceil(n.count / 2); });
  const fixed = clone(lean); fixed.nodes.forEach((n) => { n.auto = false; });
  ok(play(fixed, b, 1, 'push').report().used > play(lean, b, 1, 'push').report().used * 1.5, 'without auto-scaling a surge hurts more'); }

// The runbook works, but only after its delay.
{ const late = play(D.solve(url, 0), url, 0, 'deploy').report(), rb = play(D.solve(url, 0), url, 0, 'deploy', {}, (s) => { if (s.pages.length) s.act('rollback'); }).report();
  ok(!late.pass && rb.used < late.used / 3, 'rolling back a bad release ends the incident');
  const s = O.create(D.solve(url, 0), url, 0, 'deploy'); for (let i = 0; i < 20; i++) s.step();
  ok(s.act('scale', 'app') && !s.act('scale', 'nope'), 'only real tiers can be scaled');
  const before = s.fleet.app; s.step(); ok(s.fleet.app === before, 'added servers are not there the next minute');
  for (let i = 0; i < 4; i++) s.step(); ok(s.fleet.app > before, 'added servers arrive after they boot');
  ok(!s.act('fixdb'), 'an action that does not fit the incident is refused'); }
{ const slow = play(D.solve(url, 1), url, 1, 'slowdb').report(), fixed = play(D.solve(url, 1), url, 1, 'slowdb', {}, (s) => { if (s.pages.length) s.act('fixdb'); }).report();
  ok(fixed.used < slow.used, 'fixing the slow query shortens the incident'); }

// A cold cache: misses hit the database, coalescing protects it, and the cache warms again.
{ const d = clone(student); d.nodes.find((n) => n.id === 'c').memGB = 64; d.nodes.find((n) => n.id === 'c').count = 2;
  const s = play(d, url, 1, 'cache'), at = O.SCENARIOS.find((x) => x.id === 'cache').events[0].at;
  ok(s.series[at].hit < .05 && s.series[s.len - 1].hit > .8, 'the cache restarts empty and warms again');
  ok(s.series[at].util.d > s.series[at - 1].util.d * 3, 'an empty cache sends its reads to the database');
  const c = clone(d); c.nodes.find((n) => n.id === 'c').coalesce = true;
  ok(play(c, url, 1, 'cache').series[at].util.d < s.series[at].util.d, 'coalescing misses protects the database'); }

// Retries: a short fault can keep a system down, unless clients back off or the door sheds load.
{ const lean = D.solve(url, 1); lean.nodes.forEach((n) => { if (n.type === 'app') { n.auto = false; n.count = Math.ceil(n.count * .3); } });
  const until = O.SCENARIOS.find((x) => x.id === 'retry').events[0].until;
  const naive = play(lean, url, 1, 'retry', { retry: 'naive' }), back = play(lean, url, 1, 'retry', { retry: 'backoff' });
  const shed = play(lean, url, 1, 'retry', { retry: 'naive' }, (s) => { if (s.pages.length) s.act('shed'); });
  ok(naive.series[until + 10].err > .5, 'naive retries keep the system down after the fault has gone: a metastable failure');
  ok(naive.series[until].offered > naive.series[until].organic * 2, 'retries multiply the load');
  ok(back.series[until + 2].err < .01, 'backoff with a retry budget lets the system recover');
  ok(shed.series[shed.len - 1].err < .01 && shed.report().used < naive.report().used / 3, 'load shedding at the door breaks the storm');
  ok(naive.report().insights.some((x) => /metastable/.test(x)), 'the postmortem names the metastable failure'); }

// Regions, hot keys and bots.
{ const b = brief('feed'), one = D.solve(b, 1), two = clone(one); one.nodes.find((n) => n.type === 'users').regions = 1; two.nodes.find((n) => n.type === 'users').regions = 2;
  const r1 = play(one, b, 1, 'region').report(), r2 = play(two, b, 1, 'region').report();
  ok(r1.worstErr === 1 && r2.used < r1.used / 3, 'a second region turns a regional outage into a short blip');
  const hot = play(D.solve(url, 2), url, 2, 'hotkey'), fixedH = play(D.solve(url, 2), url, 2, 'hotkey', {}, (s) => { if (s.t === 16) s.act('hotcache'); });
  const cacheId = D.solve(url, 2).nodes.find((n) => n.type === 'cache').id;
  ok(hot.series[30].util[cacheId] > hot.series[10].util[cacheId] * 2, 'one hot key overloads the cache node that holds it');
  ok(fixedH.series[30].util[cacheId] < hot.series[30].util[cacheId] * .7, 'caching the hot key in each app server takes it off the cache');
  const gw = D.solve(brief('shop'), 1), noGw = clone(gw); noGw.nodes = noGw.nodes.filter((n) => n.type !== 'gateway'); noGw.edges = noGw.edges.filter(([x, y]) => x !== 'gw' && y !== 'gw'); noGw.edges.push(['lb', 'app']);
  ok(play(gw, brief('shop'), 1, 'bots').report().used < play(noGw, brief('shop'), 1, 'bots').report().used, 'a gateway stops a bot flood that capacity alone cannot'); }

// The engine options the live runs rely on.
{ const ref = D.solve(url, 1), ev = (f) => D.evaluate(ref, url, 1, f), db = ref.nodes.find((n) => n.type === 'nosql' || n.type === 'sql').id, app = 'app', cache = ref.nodes.find((n) => n.type === 'cache').id;
  ok(ev({ warm: 0 }).nodes[cache].hit < ev({ warm: .5 }).nodes[cache].hit && ev({ warm: .5 }).nodes[cache].hit < ev({}).nodes[cache].hit, 'a warming cache hits more as it fills');
  ok(ev({ degrade: { [app]: { cap: .5, lat: 3 } } }).nodes[app].util > ev({}).nodes[app].util * 1.9, 'a degraded tier does less work');
  ok(ev({ degrade: { [app]: { cap: 1, lat: 3 } } }).classes.read.p95 > ev({}).classes.read.p95, 'a degraded tier is slower');
  ok(ev({ hot: .3 }).nodes[cache].util > ev({}).nodes[cache].util, 'a hot key concentrates load');
  ok(ev({ down: [db, cache] }).succ < .5, 'unreachable tiers fail the requests that need them');
  const sql = D.solve(brief('shop'), 1), cut = clone(sql); cut.edges = cut.edges.filter(([x, y]) => x !== 'q' && y !== 'q' && x !== 'w');
  ok(D.evaluate(cut, brief('shop'), 1, { failover: true }).classes.write.succ === 0 && D.evaluate(cut, brief('shop'), 1, { failover: true }).classes.read.succ > .99, 'during failover writes fail and reads carry on');
  ok(D.evaluate(sql, brief('shop'), 1, { failover: true }).classes.write.succ > .99, 'a queue accepts writes while the primary fails over'); }

console.log(fails ? `\n${fails} FAILED` : '\nall live incident checks passed');
process.exitCode = fails ? 1 : 0;
