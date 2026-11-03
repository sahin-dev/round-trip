/* Proves the game is fair: every episode can be passed, every episode actually needs
   something new, and scaling the old design harder is not enough where a lesson is structural. */
const P = require('./env').js;
require(P + 'practice-engine.js'); require(P + 'practice-briefs.js'); require(P + 'game-data.js');
const G = globalThis.RTGame, D = globalThis.RTDesign;
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL', m); } };
const money = (n) => '$' + Math.round(n).toLocaleString();
console.log('ep  users        reads/s  cost/budget                app  db                 prev-design   scaled-prev');
G.EPISODES.forEach((ep, i) => {
  const des = G.solution(i), res = G.play(ep, des), r = res.r, app = des.nodes.find((n) => n.type === 'app'), db = des.nodes.find((n) => n.type === 'sql');
  let prev = '-', scaled = '-';
  if (i) {
    const p = G.solution(i - 1), pr = G.play(ep, p);
    prev = pr.pass ? 'PASSES' : (pr.failedGate || 'obstacle:' + (pr.failedStep && pr.failedStep.o.name.en));
    ok(!pr.pass, `${ep.id}: last episode's design must fail here`);
    // Brute force: same structure, but make every existing tier bigger.
    const bf = D.fit(JSON.parse(JSON.stringify(p)), { ...G.briefOf(ep) }, 0, ep.obstacles.map((o) => o.fault).filter((f) => Object.keys(f).length), .6, true);
    const sp = G.play(ep, bf);
    scaled = sp.pass ? 'PASSES' : (sp.failedGate || 'obstacle');
    ok(!sp.pass, `${ep.id}: scaling up last episode's design must not skip the lesson`);
  }
  console.log(`${String(i + 1).padEnd(3)} ${String(ep.dau).padEnd(10)} ${String(Math.round(r.d.read)).padStart(8)}  ${(money(r.cost) + '/' + money(res.limit)).padEnd(26)} ${String(app.count).padEnd(4)} ${String(db.shards + 'x' + db.cpu + 'c r' + db.replicas).padEnd(18)} ${prev.padEnd(26).slice(0, 26)} ${scaled}`);
  ok(res.pass, `${ep.id} solution must pass: gate=${res.failedGate} step=${res.failedStep && res.failedStep.o.name.en} succ=${res.failedStep && res.failedStep.r.succ.toFixed(3)} checks=${JSON.stringify(r.checks)} ${Object.entries(r.classes).map(([k, c]) => k + ':' + Math.round(c.p95) + '/' + r.d.slo[k]).join(' ')} cost ${money(r.cost)} avail ${r.avail.toFixed(5)}`);
  const text = [ep.title, ep.story, ep.goal, ep.learn, ep.tagline, ...ep.obstacles.flatMap((o) => [o.name, o.say, o.hint])];
  ok(text.every((t) => t.en && t.bn), `${ep.id} must have English and Bengali text`);
});
const nothing = G.play(G.EPISODES[0], G.blank());
ok(!nothing.pass, 'an empty canvas must not pass episode 1');
console.log(fails ? `\n${fails} FAILED` : '\nall game checks passed');
