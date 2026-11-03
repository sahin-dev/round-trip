/* Availability and retries, heartbeat and leader election, quorum, checksum. */
(function () {
  const { h, s, ui, Net, hexOf, sha256, utf8, seeded } = RT;
  const pct = (v) => (v * 100).toFixed(v > .9999 ? 5 : v > .999 ? 4 : 3).replace(/0+$/, '').replace(/\.$/, '') + '%';
  const dur = (hours) => (hours >= 24 ? (hours / 24).toFixed(1) + ' days' : hours >= 1 ? hours.toFixed(1) + ' h' : hours * 60 >= 1 ? (hours * 60).toFixed(1) + ' min' : (hours * 3600).toFixed(0) + ' s');

  function ninesTab(root, ctx) {
    const tiers = [{ name: 'Load balancer', a: 99.9, n: 1 }, { name: 'App servers', a: 99, n: 1 }, { name: 'Database', a: 99.5, n: 1 }];
    const box = h('div', { style: { display: 'grid', gap: '8px' } });
    const res = ui.stats([['sys', 'System availability'], ['yr', 'Downtime per year'], ['mo', 'Downtime per month'], ['weak', 'Weakest tier']]);
    const strip = h('div', { style: { height: '26px', background: 'var(--ok-soft)', borderRadius: '2px', overflow: 'hidden' } });
    const stripI = h('div', { style: { height: '100%', background: 'var(--bad)', width: '0' } }); strip.append(stripI);
    const stripT = h('p', { class: 'small muted', style: { marginTop: '4px' } });
    const formula = h('p', { class: 'mono small' });
    root.append(ui.card('Build your system: tiers in series, copies in parallel', box), res, ui.card('One year, drawn to scale', strip, stripT), ui.card('The maths', formula, h('p', { class: 'small muted' }, 'Requests pass through every tier, so tier availabilities multiply. A tier only fails if every copy fails, so its failure rates multiply. This assumes copies fail independently, which shared power, networks or bugs can break.')));
    tiers.forEach((t, i) => {
      const a = ui.slider({ id: 'av-a' + i, label: 'One copy', min: 90, max: 99.99, step: .01, value: t.a, fmt: (v) => v + '%', onInput(v) { t.a = v; calc(); } });
      const n = ui.slider({ id: 'av-n' + i, label: 'Copies', min: 1, max: 5, value: 1, onInput(v) { t.n = v; calc(); } });
      box.append(h('div', { class: 'controls flat' }, h('b', { style: { width: '124px' } }, t.name), a, n));
    });
    function calc() {
      const tv = tiers.map((t) => 1 - Math.pow(1 - t.a / 100, t.n));
      const sys = tv.reduce((x, y) => x * y, 1), hrs = (1 - sys) * 8760;
      res.set('sys', pct(sys), sys >= .9999 ? 'good' : sys < .99 ? 'bad' : '');
      res.set('yr', dur(hrs)); res.set('mo', dur(hrs / 12));
      const wi = tv.indexOf(Math.min(...tv)); res.set('weak', tiers[wi].name.split(' ')[0]);
      stripI.style.width = Math.max(.15, (1 - sys) * 100) + '%';
      stripT.textContent = `The red sliver is ${dur(hrs)} of ${365} days.${(1 - sys) < .0015 ? ' It is drawn at the minimum visible width.' : ''}`;
      formula.textContent = tiers.map((t, i) => `[1 − (1 − ${t.a / 100})^${t.n}]`).join(' × ') + ' = ' + pct(sys);
      if (tiers.every((t) => t.n === 1) && sys < Math.min(...tiers.map((t) => t.a / 100))) ctx.mission('series');
      if (sys >= .999) ctx.mission('three');
      if (sys >= .9999) ctx.mission('four');
    }
    calc();
  }

  function retryTab(root, ctx) {
    const CAP = 40, OUT = 40, STEPS = 150;
    const plan = ui.seg('Retry policy', [['none', 'Retry immediately'], ['exp', 'Exponential backoff'], ['jit', 'Backoff + jitter']], 'none', draw);
    const clients = ui.slider({ id: 'rt-clients', label: 'Clients', min: 100, max: 1000, step: 50, value: 400, onInput: draw });
    const svg = s('svg', { viewBox: '0 0 760 220', role: 'img', 'aria-label': 'Requests per tick against server capacity' });
    svg.style.cssText = 'width:100%;min-width:560px;display:block';
    const stats = ui.stats([['rec', 'Recovered at', '–'], ['peak', 'Peak load', '–'], ['wasted', 'Rejected attempts', '–']]);
    const say = h('div', { class: 'banner' });
    root.append(h('div', { class: 'controls' }, ui.field('Retry policy', plan), clients), say, h('div', { class: 'stage' }, svg), stats);
    function sim() {
      const rnd = seeded(5), pending = Array.from({ length: STEPS }, () => []), series = [];
      for (let i = 0; i < clients.value; i++) pending[Math.floor(rnd() * 12)].push(0);
      let wasted = 0, done = 0, rec = null;
      for (let t = 0; t < STEPS; t++) {
        const load = pending[t].length, cap = t < OUT ? 0 : CAP;
        series.push(load); let ok = 0;
        pending[t].forEach((att) => {
          if (ok < cap) { ok++; done++; return; }
          wasted++;
          const base = plan.value === 'none' ? 1 + Math.floor(rnd() * 2) : Math.min(40, 2 ** Math.min(att + 1, 6));
          const delay = plan.value === 'jit' ? 1 + Math.floor(rnd() * base) : base;
          const at = t + delay;
          if (at < STEPS) pending[at].push(att + 1);
        });
        if (rec == null && done >= clients.value) rec = t;
      }
      return { series, wasted, rec, peak: Math.max(...series) };
    }
    function draw() {
      const r = sim(), H = 190, x0 = 34, bw = (760 - x0 - 8) / STEPS, top = Math.max(r.peak, CAP * 1.5);
      const y = (v) => H - (v / top) * (H - 14);
      svg.textContent = '';
      svg.append(s('rect', { x: x0, y: 14, width: OUT * bw, height: H - 14, fill: 'var(--bad-soft)' }), s('text', { class: 'dim', x: x0 + 6, y: 28 }, 'server down'));
      r.series.forEach((v, i) => svg.append(s('rect', { x: x0 + i * bw, y: y(v), width: Math.max(1, bw - .6), height: H - y(v), fill: i >= OUT && v > CAP ? 'var(--bad)' : 'var(--accent)' })));
      svg.append(s('line', { x1: x0, x2: 752, y1: y(CAP), y2: y(CAP), stroke: 'var(--res)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }), s('text', { class: 'dim', x: 700, y: y(CAP) - 4 }, 'capacity'),
        s('line', { class: 'lnk', x1: x0, x2: 752, y1: H, y2: H }), s('text', { class: 'dim', x: 2, y: y(top) + 10 }, Math.round(top)), s('text', { class: 'dim', x: 16, y: H + 3 }, '0'), s('text', { class: 'dim', x: x0, y: H + 16 }, 'time →'));
      stats.set('rec', r.rec == null ? 'Not in view' : 'tick ' + r.rec, r.rec == null ? 'bad' : '');
      stats.set('peak', r.peak + ' req', r.peak > CAP * 3 ? 'bad' : ''); stats.set('wasted', r.wasted.toLocaleString());
      say.className = 'banner ' + (plan.value === 'none' ? 'bad' : plan.value === 'exp' ? 'warn' : 'ok');
      say.textContent = plan.value === 'none' ? 'Every client hammers the server as soon as it fails. The server comes back into a wall of retries.' : plan.value === 'exp' ? 'Backoff spreads retries out, but clients that failed together retry together, so you still get spikes.' : 'Jitter randomises each wait. The herd breaks up, and the load stays near capacity.';
      if (plan.value === 'jit') ctx.mission('jitter');
    }
    draw();
  }

  RT.lab({
    id: 'availability', title: 'Availability Calculator', short: 'Availability', chapter: 'Key Characteristics · Redundancy',
    lede: 'Each extra nine means ten times less downtime. Add copies, see how much each one buys, and find out what bad retry logic does to a recovering server.',
    missions: [['series', 'See that a chain is less reliable than its weakest link.'], ['three', 'Reach 99.9%.'], ['four', 'Reach 99.99%.'], ['jitter', 'Calm a retry storm with jitter.']],
    notes: `<ul><li><b>Series</b> components multiply downward. <b>Parallel</b> copies multiply failure downward.</li><li><b>High availability</b> aims to minimise downtime. <b>Fault tolerance</b> aims to keep working through a failure with no interruption, at a higher cost.</li><li>Availability is usually about redundancy at the weakest tier, not better hardware everywhere.</li><li>Retries with <b>exponential backoff and jitter</b> stop clients from knocking a recovering service back down.</li></ul>`,
    check: { q: 'Two services at 99.9% each are called in sequence. What is the overall availability?', options: ['99.9%', 'About 99.8%', '99.99%', '199.8%'], answer: 1, why: '0.999 × 0.999 ≈ 0.998. Both must work, so the failure chances add up.' },
    render(root, ctx) {
      const a = h('div', { class: 'labmain' }), b = h('div', { class: 'labmain hide' });
      let made = false;
      const tabs = ui.tabs([['n', 'Nines & redundancy'], ['r', 'Retry storm']], (v) => { a.classList.toggle('hide', v !== 'n'); b.classList.toggle('hide', v !== 'r'); if (v === 'r' && !made) { made = true; retryTab(b, ctx); } });
      root.append(tabs, a, b); ninesTab(a, ctx); tabs.set('n');
    },
  });

  /* ----- Heartbeat and leader election ----- */
  RT.lab({
    id: 'heartbeat', title: 'Heartbeat & Leader', short: 'Leader & heartbeat', chapter: 'Heartbeat · Leader and Follower',
    lede: 'One server leads, and silence is the alarm. Kill nodes and watch the cluster notice, hold an election, and keep going, or refuse to.',
    missions: [['follower', 'Kill a follower and see the leader carry on.'], ['leader', 'Kill the leader and watch a new one get elected.'], ['noquorum', 'Kill so many nodes that no one can win an election.'], ['back', 'Revive the old leader and see it step down to the newer term.'], ['write', 'Replicate a write to a majority.']],
    notes: `<ul><li>A <b>heartbeat</b> is a small "I'm alive" message. Missing several in a row means <i>suspected</i> dead, never certainly dead.</li><li>A single <b>leader</b> makes ordering simple, because all writes pass through one place.</li><li>Winning an election needs a <b>majority</b>. So two sides of a split can never both win, which prevents split brain.</li><li><b>Terms</b> act like epochs, so a stale leader can recognise it's stale.</li></ul>`,
    check: { q: 'A 5-node cluster splits into 3 and 2. What happens?', options: ['Both sides elect leaders', 'The 3-node side can elect a leader, and the 2-node side cannot', 'All nodes stop', 'The 2-node side wins by seniority'], answer: 1, why: 'Only the side with a majority (3 of 5) can win votes.' },
    render(root, ctx) {
      const NODES = 5, cx = 330, cy = 220, r = 158;
      const net = Net(ctx, { w: 660, h: 440, label: 'Cluster of five servers' });
      const N = Array.from({ length: NODES }, (_, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / NODES, id = 'n' + (i + 1);
        net.node(id, { x: cx + r * 1.35 * Math.cos(a), y: cy + r * Math.sin(a), label: 'Node ' + (i + 1), sub: 'follower', w: 112, h: 52, onClick: () => toggle(i) });
        return { id, i, up: true, role: 'follower', term: 1, voted: 0, timer: 2 + Math.random() * 2, votes: 0, log: 0 };
      });
      N[0].role = 'leader';
      const banner = h('div', { class: 'banner', role: 'status' }, 'Node 1 is the leader. Click a node to kill or revive it.');
      const stats = ui.stats([['term', 'Term', 1], ['leader', 'Leader', 'Node 1'], ['alive', 'Alive', '5/5'], ['commit', 'Committed writes', 0]]);
      const log = ui.log({ max: 170 });
      let hb = 0, committed = 0, everKilled = null;
      root.append(h('div', { class: 'controls' }, ui.btn('Client write', write, { kind: 'primary', id: 'hb-write' })), banner, h('div', { class: 'stage', style: { maxWidth: '760px' } }, net.svg), stats, ui.card('Events', log.el));
      const leader = () => N.find((n) => n.up && n.role === 'leader');
      const alive = () => N.filter((n) => n.up);
      const quorum = 3;
      function paint() {
        N.forEach((n) => { net.state(n.id, !n.up ? 'dead' : n.role === 'leader' ? 'hit' : n.role === 'candidate' ? 'miss' : ''); net.sub(n.id, !n.up ? 'down' : `${n.role}, term ${n.term}`); });
        const l = leader(); stats.set('leader', l ? 'Node ' + (l.i + 1) : 'None', l ? '' : 'bad'); stats.set('term', Math.max(...N.map((n) => n.term)));
        const al = alive().length; stats.set('alive', al + '/5', al < quorum ? 'bad' : '');
      }
      function toggle(i) {
        const n = N[i]; n.up = !n.up;
        if (!n.up) {
          const wasLeader = n.role === 'leader';
          log.add(`Node ${i + 1} crashed`, 'bad');
          if (wasLeader) { everKilled = n; banner.className = 'banner warn'; banner.textContent = 'The leader is down. Followers will notice when heartbeats stop.'; }
          else if (leader()) { ctx.mission('follower'); banner.className = 'banner'; banner.textContent = `Node ${i + 1} stopped answering. The leader carries on, since it still has a majority.`; }
          if (alive().length < quorum) { ctx.mission('noquorum'); banner.className = 'banner bad'; banner.textContent = `Only ${alive().length} of 5 alive. Nobody can get 3 votes, so the cluster refuses writes rather than risk split brain.`; if (leader()) leader().role = 'follower'; }
        } else {
          n.timer = 3 + Math.random() * 2; log.add(`Node ${i + 1} is back`, 'res');
          const top = Math.max(...N.filter((x) => x.up).map((x) => x.term));
          if (n.role === 'leader' && n.term < top) { n.role = 'follower'; n.term = top; log.add(`Node ${i + 1} sees term ${top} and steps down`, 'ref'); banner.className = 'banner ok'; banner.textContent = 'The old leader came back, saw a newer term, and stepped down to follower.'; ctx.mission('back'); }
          else if (n.role !== 'leader') { n.role = 'follower'; n.term = top; }
        }
        paint();
      }
      async function startElection(c) {
        c.role = 'candidate'; c.term++; c.votes = 1; c.voted = c.term; c.timer = 3 + Math.random() * 2;
        log.add(`Node ${c.i + 1} timed out and asks for votes in term ${c.term}`, 'ref'); paint();
        const term = c.term;
        await Promise.all(alive().filter((n) => n !== c).map(async (n) => {
          await net.send(c.id, n.id, { label: 'vote?', color: 'ref', dur: 420 });
          if (!n.up || n.voted >= term || n.term > term) return;
          n.voted = term; n.term = term; n.role = 'follower'; n.timer = 3 + Math.random() * 2; paint();
          await net.send(n.id, c.id, { label: 'yes', color: 'res', dur: 420 });
          c.votes++;
        }));
        if (c.up && c.role === 'candidate' && c.term === term && c.votes >= quorum) {
          c.role = 'leader'; log.add(`Node ${c.i + 1} won ${c.votes} votes and leads term ${term}`, 'res');
          banner.className = 'banner ok'; banner.textContent = `Node ${c.i + 1} won with ${c.votes} of 5 votes. Service resumes.`;
          ctx.mission('leader'); paint(); beat();
        } else if (c.role === 'candidate') { c.role = 'follower'; paint(); }
      }
      function beat() {
        const l = leader(); if (!l) return;
        alive().filter((n) => n !== l).forEach((n) => net.send(l.id, n.id, { color: 'cache', r: 3.5, dur: 480 }).then(() => { if (n.up && l.up && l.role === 'leader') { n.timer = 2.4 + Math.random() * 2; n.term = Math.max(n.term, l.term); if (n.role === 'candidate') n.role = 'follower'; } }));
      }
      async function write() {
        const l = leader();
        if (!l) { banner.className = 'banner bad'; banner.textContent = 'Write refused: there is no leader. The client must retry.'; return; }
        const v = ++l.log; let acks = 1;
        log.add(`Leader logged write #${v}`, 'req');
        await Promise.all(alive().filter((n) => n !== l).map(async (n) => {
          await net.send(l.id, n.id, { label: 'w' + v, color: 'req', dur: 480 }); if (!n.up) return;
          n.log = v; await net.send(n.id, l.id, { label: 'ok', color: 'res', dur: 400 }); acks++;
          if (acks === quorum) { committed++; stats.set('commit', committed); log.add(`Write #${v} is on a majority (${acks}/5): committed`, 'res'); ctx.mission('write'); }
        }));
      }
      ctx.loop((dt) => {
        const l = leader();
        hb += dt;
        if (hb >= 1.1) { hb = 0; beat(); }
        N.forEach((n) => {
          if (!n.up || n.role === 'leader') return;
          n.timer -= dt;
          if (n.timer <= 0) { if (alive().length >= quorum && !l) startElection(n); else n.timer = 2 + Math.random() * 2; }
        });
      });
      void everKilled;
      paint();
    },
  });

  /* ----- Quorum ----- */
  RT.lab({
    id: 'quorum', title: 'Quorum Tuner', short: 'Quorum', chapter: 'Quorum',
    lede: 'Set N, W and R, then write and read. You can always predict a stale read from one small inequality.',
    missions: [['stale', 'Get a stale read with R + W ≤ N.'], ['fresh', 'Set R + W > N and always read the latest.'], ['fail', 'Kill enough nodes that a write cannot reach W.'], ['even', 'Compare a 4-node and a 5-node cluster: both tolerate different failures.']],
    notes: `<ul><li>A <b>majority quorum</b> is ⌊N/2⌋ + 1.</li><li>If <b>R + W > N</b>, every read set overlaps every write set, so at least one replica has the latest version.</li><li>N=3, W=2, R=2 is the classic balance.</li><li>Lower W gives faster writes and weaker durability. Lower R gives faster reads.</li><li>Prefer odd N: 4 nodes survive 1 failure, the same as 3, and 5 survive 2.</li></ul>`,
    check: { q: 'With N=5 and W=3, what is the smallest R that guarantees fresh reads?', options: ['1', '2', '3', '5'], answer: 2, why: 'R + W must exceed N: 3 + 3 = 6 > 5, while 2 + 3 = 5 does not.' },
    render(root, ctx) {
      let nodes = [], version = 0, busy = false;
      const stage = h('div', { class: 'stage' });
      const N = ui.slider({ id: 'q-n', label: 'N (replicas)', min: 3, max: 7, value: 3, onInput: reset });
      const W = ui.slider({ id: 'q-w', label: 'W (write acks)', min: 1, max: 7, value: 1, onInput: rule });
      const R = ui.slider({ id: 'q-r', label: 'R (read replies)', min: 1, max: 7, value: 1, onInput: rule });
      const rl = h('div', { class: 'banner', role: 'status' });
      const res = h('div', { class: 'banner', role: 'status' }, 'Write a value, then read it back. Click a replica to kill or revive it.');
      root.append(h('div', { class: 'controls' }, N, W, R, ui.btn('Write', write, { kind: 'primary', id: 'q-write' }), ui.btn('Read', read, { id: 'q-read' })), rl, stage, res);
      let net;
      function draw() {
        net = Net(ctx, { w: 900, h: 290, label: 'Client and replicas' });
        net.node('c', { x: 450, y: 44, label: 'Client', sub: `latest write: v${version}`, w: 150 });
        nodes.forEach((n, i) => { n.id = 'r' + i; net.node(n.id, { x: ((i + .5) * 900) / nodes.length, y: 222, label: 'R' + (i + 1), sub: 'v' + n.v, w: Math.min(112, 800 / nodes.length - 10), h: 56, onClick: () => { n.up = !n.up; paint(); rule(); } }); net.link('c', n.id); });
        stage.textContent = ''; stage.append(net.svg); paint();
      }
      function paint() { nodes.forEach((n) => { net.sub(n.id, n.up ? 'v' + n.v : 'down'); net.state(n.id, !n.up ? 'dead' : n.v === version && version ? 'hit' : ''); }); net.sub('c', `latest write: v${version}`); }
      function reset() { nodes = Array.from({ length: N.value }, () => ({ v: 0, up: true })); version = 0; W.input.max = N.value; R.input.max = N.value; if (W.value > N.value) W.value = N.value; if (R.value > N.value) R.value = N.value; draw(); rule(); }
      function rule() {
        const n = N.value, w = W.value, r = R.value, ok = r + w > n, alive = nodes.filter((x) => x.up).length;
        rl.className = 'banner ' + (ok ? 'ok' : 'warn');
        rl.textContent = `R + W = ${r + w} ${ok ? '>' : '≤'} N = ${n}. ${ok ? 'Read and write sets must overlap, so reads see the latest write.' : 'A read can miss every replica that took the write.'} Tolerates ${Math.min(n - w, n - r)} node failure${n - Math.max(w, r) === 1 ? '' : 's'} for both reads and writes. Alive: ${alive}/${n}.`;
      }
      const pick = (k) => nodes.filter((x) => x.up).sort(() => Math.random() - .5).slice(0, k);
      async function write() {
        if (busy) return; busy = true;
        const alive = nodes.filter((x) => x.up);
        if (alive.length < W.value) { res.className = 'banner bad'; res.textContent = `Write failed: only ${alive.length} replicas alive and W is ${W.value}. Consistency was kept, at the cost of availability.`; ctx.mission('fail'); busy = false; return; }
        const v = version + 1, set = pick(W.value);
        await Promise.all(set.map(async (n) => { await net.send('c', n.id, { label: 'v' + v, color: 'req', dur: 600 }); n.v = v; await net.send(n.id, 'c', { color: 'res', dur: 420 }); }));
        version = v; paint();
        res.className = 'banner'; res.textContent = `v${v} acknowledged by ${set.length} of ${N.value} replicas. The rest still hold older data until repair catches up.`;
        if (N.value >= 4) { rule(); }
        busy = false;
      }
      async function read() {
        if (busy) return; busy = true;
        const alive = nodes.filter((x) => x.up);
        if (alive.length < R.value) { res.className = 'banner bad'; res.textContent = `Read failed: only ${alive.length} replicas alive and R is ${R.value}.`; ctx.mission('fail'); busy = false; return; }
        const set = pick(R.value);
        await Promise.all(set.map(async (n) => { await net.send('c', n.id, { label: 'get', color: 'req', dur: 480 }); net.state(n.id, 'on'); await net.send(n.id, 'c', { label: 'v' + n.v, color: n.v === version ? 'res' : 'ref', dur: 480 }); }));
        const got = Math.max(...set.map((n) => n.v)), stale = got < version;
        paint();
        res.className = 'banner ' + (stale ? 'bad' : 'ok');
        res.textContent = stale ? `Stale read: you got v${got}, but v${version} exists. None of the ${R.value} replicas asked had taken the write.` : `Read v${got}, the latest. The client took the highest version among ${R.value} replies.`;
        if (stale) ctx.mission('stale');
        if (!stale && version > 0 && R.value + W.value > N.value) ctx.mission('fresh');
        if ([4, 5].includes(N.value)) { const k = 'n' + N.value; seen.add(k); if (seen.size === 2) ctx.mission('even'); }
        busy = false;
      }
      const seen = new Set();
      reset();
    },
  });

  /* ----- Checksum ----- */
  RT.lab({
    id: 'checksum', title: 'Checksum Check', short: 'Checksum', chapter: 'Checksum',
    lede: 'Flip a single bit of stored data and see the real SHA-256 digest change beyond recognition. Then let the client catch the corruption and recover from a replica.',
    missions: [['flip', 'Flip one bit and see the digest change.'], ['avalanche', 'See about half of the 256 digest bits change.'], ['catch', 'Catch corruption on read.'], ['repair', 'Recover the block from a healthy replica.']],
    notes: `<ul><li>A checksum is stored alongside the data and rechecked on every read.</li><li>Good hashes have the <b>avalanche</b> property: one flipped bit changes about half of the output bits.</li><li>A mismatch doesn't fix anything, but it turns silent corruption into a detectable error, so the client can use another replica.</li><li>A checksum alone doesn't stop deliberate tampering. An attacker can recompute it, so that takes a key, as in HMAC or AES-GCM.</li></ul>`,
    check: { q: 'What does a checksum mismatch tell you?', options: ['Which bit is wrong', 'That the data changed somewhere, so do not trust it', 'That an attacker is present', 'That the disk is full'], answer: 1, why: 'It proves that the bytes differ from what was stored, not why, and not where.' },
    render(root, ctx) {
      const input = h('input', { type: 'text', id: 'ck-text', value: 'balance=1000', maxLength: 16, 'aria-label': 'Data block', oninput: store });
      let stored = '', bytes = [], digest = null;
      const bits = h('div', { class: 'bits', style: { gridTemplateColumns: 'repeat(16, minmax(14px, 1fr))', maxWidth: '520px' } });
      const a = h('div', { class: 'hexbox' }), b = h('div', { class: 'hexbox' }), diff = h('div', { class: 'seq-grid', style: { gap: '1px' } });
      const banner = h('div', { class: 'banner', role: 'status' }, 'Click any bit below to simulate a bad disk or a noisy link.');
      const net = Net(ctx, { w: 760, h: 110, label: 'Client reading from two replicas' });
      net.node('c', { x: 90, y: 56, label: 'Client', sub: 'verifies digest', w: 130 }).node('a', { x: 640, y: 26, label: 'Replica A', sub: 'has your block', w: 130, h: 42 }).node('b', { x: 640, y: 84, label: 'Replica B', sub: 'healthy copy', w: 130, h: 42 }).link('c', 'a').link('c', 'b');
      root.append(h('div', { class: 'controls' }, ui.field('Data block', input, 'grow'), ui.btn('Read and verify', read, { kind: 'primary', id: 'ck-read' }), ui.btn('Reset block', store)), banner,
        ui.card('Bits on Replica A (click to flip)', bits), h('div', { class: 'twocol' }, ui.card('Stored SHA-256', a), ui.card('SHA-256 of current data', b)), ui.card('Digest bits that differ', diff), h('div', { class: 'stage' }, net.svg));
      function store() { stored = input.value; bytes = Array.from(utf8(stored)); digest = sha256(new Uint8Array(bytes)); a.textContent = hexOf(digest); net.state('a', ''); draw(); }
      function draw() {
        bits.textContent = '';
        bytes.slice(0, 8).forEach((byte, bi) => {
          for (let i = 7; i >= 0; i--) {
            const on = (byte >> i) & 1;
            bits.append(h('button', { class: 'bit ' + (on ? 'on' : ''), 'aria-label': `Byte ${bi + 1} bit ${8 - i}`, onclick() { bytes[bi] ^= 1 << i; draw(); ctx.mission('flip'); } }, on));
          }
        });
        const now = sha256(new Uint8Array(bytes));
        b.textContent = hexOf(now);
        diff.textContent = ''; let n = 0;
        now.forEach((v, i) => { for (let k = 7; k >= 0; k--) { const d = ((v ^ digest[i]) >> k) & 1; n += d; diff.append(h('span', { style: { width: '6px', height: '6px', background: d ? 'var(--bad)' : 'var(--panel-2)' } })); } });
        if (n > 0) { banner.className = 'banner warn'; banner.textContent = `${n} of 256 digest bits changed. Close to half is what a good hash should do.`; if (n > 90) ctx.mission('avalanche'); }
        else { banner.className = 'banner ok'; banner.textContent = 'The data matches its stored digest.'; }
      }
      async function read() {
        await net.send('c', 'a', { label: 'read', color: 'req' });
        const same = hexOf(sha256(new Uint8Array(bytes))) === hexOf(digest);
        await net.send('a', 'c', { label: 'block + digest', color: same ? 'res' : 'bad' });
        if (same) { banner.className = 'banner ok'; banner.textContent = 'Verified. The digests match, so the client uses the data.'; return; }
        net.state('a', 'err'); ctx.mission('catch');
        banner.className = 'banner bad'; banner.textContent = 'Mismatch. The client returns no corrupt data, and tries Replica B.';
        await ctx.sleep(700);
        await net.send('c', 'b', { label: 'read', color: 'req' }); await net.send('b', 'c', { label: 'block + digest', color: 'res' });
        bytes = Array.from(utf8(stored)); draw(); net.state('a', '');
        banner.className = 'banner ok'; banner.textContent = 'Replica B\'s copy verified, and it repaired the bad block on Replica A.'; ctx.mission('repair');
      }
      store();
    },
  });
})();
