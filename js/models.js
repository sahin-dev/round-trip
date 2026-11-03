/* Pure models behind the newer labs. No page code here, so tests/models.test.js can run them
   directly. Each one is a teaching model: small enough to read, faithful to the real behaviour. */
(function () {
  'use strict';

  const rng = (seed) => {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };

  /* ---------- queueing: an M/M/c queue, solved with the Erlang C formula ---------- */
  function queue(arrivals, serviceMs, servers) {
    const mu = 1000 / serviceMs, load = arrivals / mu, rho = load / servers;
    if (rho >= 1) return { rho, stable: false, wait: Infinity, response: Infinity, p95: Infinity, inSystem: Infinity, queued: Infinity };
    let b = 1;
    for (let k = 1; k <= servers; k++) b = (load * b) / (k + load * b);
    const c = b / (1 - rho * (1 - b)), spare = servers * mu - arrivals;
    const wait = (c / spare) * 1000, response = wait + serviceMs;
    const p95Wait = c > .05 ? (Math.log(c / .05) / spare) * 1000 : 0;
    return { rho, stable: true, wait, response, p95: p95Wait + serviceMs * 1.6, inSystem: (arrivals * response) / 1000, queued: (arrivals * wait) / 1000 };
  }

  /* ---------- rate limiters: allow(t) with t in seconds ---------- */
  function limiter(kind, limit, windowS) {
    let count = 0, win = -1, log = [], tokens = limit, last = 0, level = 0;
    const rate = limit / windowS;
    return {
      kind,
      allow(t) {
        if (kind === 'fixed') {
          const w = Math.floor(t / windowS);
          if (w !== win) { win = w; count = 0; }
          if (count >= limit) return false;
          count++; return true;
        }
        if (kind === 'sliding') {
          log = log.filter((x) => x > t - windowS);
          if (log.length >= limit) return false;
          log.push(t); return true;
        }
        if (kind === 'token') {
          tokens = Math.min(limit, tokens + (t - last) * rate); last = t;
          if (tokens < 1) return false;
          tokens -= 1; return true;
        }
        level = Math.max(0, level - (t - last) * rate); last = t;
        if (level + 1 > limit) return false;
        level += 1; return true;
      },
      level(t) {
        if (kind === 'fixed') return Math.floor(t / windowS) === win ? limit - count : limit;
        if (kind === 'sliding') return limit - log.filter((x) => x > t - windowS).length;
        if (kind === 'token') return Math.min(limit, tokens + (t - last) * rate);
        return limit - Math.max(0, level - (t - last) * rate);
      },
      /* Leaky bucket also shapes traffic: this is how long a request waits to leave. */
      delay() { return kind === 'leaky' ? Math.max(0, (level - 1) / rate) : 0; },
    };
  }

  /* ---------- idempotency keys ---------- */
  function paymentServer() {
    const keys = new Map(), ledger = [];
    return {
      ledger,
      pay(key, amount) {
        if (key && keys.has(key)) {
          const old = keys.get(key);
          if (old.amount !== amount) return { status: 422, replay: true, error: 'mismatch' };
          return { status: old.status, replay: true, charge: old.charge };
        }
        const charge = 'ch_' + (ledger.length + 1);
        ledger.push({ charge, amount });
        if (key) keys.set(key, { amount, status: 200, charge });
        return { status: 200, replay: false, charge };
      },
    };
  }

  /* ---------- isolation levels, on a small multi-version store ----------
     Modelled on snapshot databases such as PostgreSQL. A transaction at repeatable read sees
     the snapshot from its start, and the first of two conflicting writers to commit wins.
     Serializable also checks that nothing the transaction read changed underneath it. */
  const SCENARIOS = {
    dirty: { init: { x: 100 }, steps: [['B', 'write', 'x', 50], ['A', 'read', 'x'], ['B', 'abort'], ['A', 'read', 'x'], ['A', 'commit']] },
    nonrepeat: { init: { x: 100 }, steps: [['A', 'read', 'x'], ['B', 'write', 'x', 50], ['B', 'commit'], ['A', 'read', 'x'], ['A', 'commit']] },
    phantom: { init: { 'order:1': 1, 'order:2': 1 }, steps: [['A', 'count', 'order:'], ['B', 'write', 'order:3', 1], ['B', 'commit'], ['A', 'count', 'order:'], ['A', 'commit']] },
    lost: { init: { x: 100 }, steps: [['A', 'read', 'x'], ['B', 'read', 'x'], ['A', 'spend', 'x', 30], ['A', 'commit'], ['B', 'spend', 'x', 20], ['B', 'commit']] },
    skew: { init: { 'oncall:ana': 1, 'oncall:ben': 1 }, steps: [['A', 'count', 'oncall:'], ['B', 'count', 'oncall:'], ['A', 'off', 'oncall:ana'], ['B', 'off', 'oncall:ben'], ['A', 'commit'], ['B', 'commit']] },
  };
  function isolation(name, level, upto) {
    const sc = SCENARIOS[name], ver = {}; let seq = 0;
    Object.entries(sc.init).forEach(([k, v]) => { ver[k] = [{ v, by: 'init', at: 0 }]; });
    const T = {}, begin = (t) => (T[t] = T[t] || { name: t, start: seq, reads: new Set(), prefixes: new Set(), writes: new Set(), seen: {}, last: null, state: 'active', read: [] });
    const committedAt = (k, t) => (ver[k] || []).filter((x) => x.at != null && x.at <= t);
    const newest = (a) => a.slice().sort((x, y) => x.at - y.at).pop();
    const see = (tx, k) => {
      const own = (ver[k] || []).filter((x) => x.by === tx.name).pop();
      if (own) return own.v;
      if (level === 'ru') { const all = ver[k] || []; return all.length ? all[all.length - 1].v : undefined; }
      const c = committedAt(k, level === 'rc' ? seq : tx.start);
      return c.length ? newest(c).v : undefined;
    };
    const fail = (tx) => { tx.state = 'aborted'; Object.keys(ver).forEach((k) => { ver[k] = ver[k].filter((x) => x.by !== tx.name); }); };
    const put = (tx, k, v) => {
      if (level === 'rr' || level === 'ser') {
        const c = committedAt(k, Infinity);
        if (c.length && newest(c).at > tx.start) { fail(tx); return false; }
      }
      (ver[k] = ver[k] || []).push({ v, by: tx.name, at: null }); tx.writes.add(k); return true;
    };
    const log = [], stop = upto == null ? sc.steps.length : upto;
    sc.steps.slice(0, stop).forEach(([who, op, key, val]) => {
      const tx = begin(who), row = { who, op, key, val };
      log.push(row);
      if (tx.state !== 'active') { row.skipped = true; return; }
      if (op === 'read') { tx.reads.add(key); row.value = see(tx, key); tx.seen[key] = row.value; tx.read.push(row.value); }
      else if (op === 'count') { tx.prefixes.add(key); row.value = Object.keys(ver).filter((k) => k.startsWith(key) && see(tx, k)).length; tx.read.push(row.value); }
      else if (op === 'write') { row.ok = put(tx, key, val); }
      else if (op === 'spend') { row.ok = put(tx, key, tx.seen[key] - val); row.value = tx.seen[key] - val; }
      else if (op === 'off') { row.ok = put(tx, key, 0); }
      else if (op === 'abort') { fail(tx); row.ok = true; }
      else if (op === 'commit') {
        const others = Object.values(T).filter((o) => o !== tx && o.state === 'committed' && o.commitAt > tx.start);
        const touched = (o) => [...o.writes].some((k) => tx.reads.has(k) || [...tx.prefixes].some((p) => k.startsWith(p)));
        if (level === 'ser' && tx.writes.size && others.some(touched)) { fail(tx); row.ok = false; return; }
        seq++; tx.commitAt = seq; tx.state = 'committed'; row.ok = true;
        Object.keys(ver).forEach((k) => ver[k].forEach((x) => { if (x.by === tx.name && x.at == null) x.at = seq; }));
      }
    });
    const A = T.A || { read: [], state: 'active' }, B = T.B || { state: 'active' }, val = (k) => { const c = committedAt(k, Infinity); return c.length ? newest(c).v : undefined; };
    const done = stop >= sc.steps.length;
    const anomaly = !done ? null : name === 'dirty' ? A.read[0] === 50 : name === 'nonrepeat' || name === 'phantom' ? A.read[0] !== A.read[1]
      : name === 'lost' ? A.state === 'committed' && B.state === 'committed' && val('x') !== 50
        : A.state === 'committed' && B.state === 'committed' && !val('oncall:ana') && !val('oncall:ben');
    return { log, anomaly, A: A.state, B: B.state, value: (k) => val(k), steps: sc.steps.length, sc };
  }

  /* ---------- LSM tree: memtable, write-ahead log, sorted files, compaction ---------- */
  function bloomOf(keys) {
    const bits = new Set(), hash = (k, s) => { let x = (0x811c9dc5 ^ s) >>> 0; for (const c of k) { x ^= c.charCodeAt(0); x = Math.imul(x, 0x01000193) >>> 0; } return (x ^ (x >>> 15)) % 64; };
    keys.forEach((k) => { bits.add(hash(k, 1)); bits.add(hash(k, 7)); });
    return { has: (k) => bits.has(hash(k, 1)) && bits.has(hash(k, 7)) };
  }
  function lsm(limit) {
    const memLimit = limit || 4;
    let mem = new Map(), wal = [], files = [], nextId = 1, userWrites = 0, diskWrites = 0;
    const api = {
      get mem() { return mem; }, get wal() { return wal; }, get files() { return files; }, get userWrites() { return userWrites; }, get diskWrites() { return diskWrites; },
      put(k, v) {
        wal.push([k, v]); mem.set(k, v); userWrites++; diskWrites++;
        if (mem.size >= memLimit) { api.flush(); return true; }
        return false;
      },
      del(k) { return api.put(k, null); },
      flush() {
        if (!mem.size) return false;
        const rows = [...mem.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
        files.unshift({ id: nextId++, rows, bloom: bloomOf(rows.map((r) => r[0])) });
        diskWrites += rows.length; mem = new Map(); wal = [];
        return true;
      },
      get(k) {
        const path = [];
        if (mem.has(k)) { path.push({ at: 'memtable', hit: true }); const v = mem.get(k); return { value: v, found: v !== null, path, reads: 0 }; }
        path.push({ at: 'memtable', hit: false });
        let reads = 0;
        for (const f of files) {
          if (!f.bloom.has(k)) { path.push({ at: 'file', id: f.id, skipped: true }); continue; }
          reads++;
          const row = f.rows.find((r) => r[0] === k);
          path.push({ at: 'file', id: f.id, hit: !!row });
          if (row) return { value: row[1], found: row[1] !== null, path, reads };
        }
        return { value: undefined, found: false, path, reads };
      },
      /* Merge every file into one. The newest value wins, and tombstones disappear because
         no older file is left for them to hide. */
      compact() {
        if (files.length < 2) return false;
        const merged = new Map();
        files.slice().reverse().forEach((f) => f.rows.forEach(([k, v]) => merged.set(k, v)));
        const rows = [...merged.entries()].filter((r) => r[1] !== null).sort((a, b) => (a[0] < b[0] ? -1 : 1));
        files = rows.length ? [{ id: nextId++, rows, bloom: bloomOf(rows.map((r) => r[0])) }] : [];
        diskWrites += rows.length;
        return true;
      },
    };
    return api;
  }

  /* ---------- retries, backoff and circuit breakers ----------
     One client population calls one dependency. Capacity drops for a while, then returns.
     An overloaded server wastes work on timeouts, so its output falls below capacity. */
  function resilience(o) {
    const opt = Object.assign({ base: 100, capacity: 130, low: 30, from: 20, to: 45, seconds: 120, retries: 0, backoff: false, jitter: false, breaker: false, budget: false, seed: 7 }, o);
    const rand = rng(opt.seed), later = {}, series = [];
    let state = 'closed', openUntil = 0, recent = [];
    for (let t = 0; t < opt.seconds; t++) {
      const capacity = t >= opt.from && t < opt.to ? opt.low : opt.capacity;
      const waiting = later[t] || [];
      const attempts = Array.from({ length: opt.base }, () => 0).concat(waiting);
      if (state === 'open' && t >= openUntil) state = 'half';
      let sent = attempts, shed = [];
      if (state === 'open') { sent = []; shed = attempts; }
      else if (state === 'half') { sent = attempts.slice(0, 10); shed = attempts.slice(10); }
      const offered = sent.length;
      const useful = offered <= capacity ? offered : capacity * Math.max(.2, capacity / offered);
      const okRate = offered ? useful / offered : 1;
      let ok = 0, failed = 0, spent = 0;
      const retry = (n) => {
        if (n >= opt.retries || (opt.budget && spent >= opt.base * .1)) return;
        spent++;
        const wait = opt.backoff ? Math.pow(2, n + 1) : 1;
        const at = t + Math.max(1, Math.round(opt.jitter ? 1 + rand() * wait * 2 : wait));
        (later[at] = later[at] || []).push(n + 1);
      };
      sent.forEach((n) => { if (rand() < okRate) ok++; else { failed++; retry(n); } });
      recent.push([ok, failed]); if (recent.length > 5) recent.shift();
      if (opt.breaker) {
        const [gs, bs] = recent.reduce((a, r) => [a[0] + r[0], a[1] + r[1]], [0, 0]);
        if (state === 'half') {
          if (failed > 2) { state = 'open'; openUntil = t + 5; } else if (offered) { state = 'closed'; recent = []; }
        } else if (state === 'closed' && gs + bs > 50 && bs / (gs + bs) > .5) { state = 'open'; openUntil = t + 5; }
      }
      series.push({ t, capacity, offered, ok, failed, shed: shed.length, state });
    }
    const after = series.filter((p) => p.t >= opt.to);
    const healthy = after.find((p) => p.ok >= opt.base * .95);
    const total = series.reduce((a, p) => ({ ok: a.ok + p.ok, failed: a.failed + p.failed, shed: a.shed + p.shed, offered: a.offered + p.offered }), { ok: 0, failed: 0, shed: 0, offered: 0 });
    return { series, peak: Math.max(...series.map((p) => p.offered)), recovery: healthy ? healthy.t - opt.to : null, total };
  }

  /* ---------- delivery guarantees ---------- */
  function delivery(mode, o) {
    const opt = Object.assign({ n: 12, crashBefore: .2, crashAfter: .2, seed: 11 }, o), rand = rng(opt.seed), rows = [];
    const dedupe = new Set();
    for (let id = 1; id <= opt.n; id++) {
      const row = { id, attempts: 0, effects: 0, notes: [] };
      for (let tries = 0; tries < 4; tries++) {
        row.attempts++;
        const before = rand() < opt.crashBefore, after = rand() < opt.crashAfter;
        if (mode === 'atmost') { row.acked = true; if (!before) row.effects++; else row.notes.push('lost'); break; }
        if (before) { row.notes.push('crash-before'); continue; }
        if (mode === 'exactly' && dedupe.has(id)) { row.notes.push('deduped'); if (after) continue; break; }
        row.effects++; dedupe.add(id);
        if (after) { row.notes.push('crash-after'); continue; }
        break;
      }
      rows.push(row);
    }
    return { rows, lost: rows.filter((r) => r.effects === 0).length, dupes: rows.filter((r) => r.effects > 1).length, ok: rows.filter((r) => r.effects === 1).length };
  }

  /* ---------- windows and watermarks ---------- */
  function streamEvents(n, seed, maxDelay) {
    const rand = rng(seed), out = [];
    for (let i = 0; i < n; i++) {
      const event = rand() * 60, slow = rand() < .18;
      out.push({ id: i + 1, event, arrive: event + (slow ? 2 + rand() * maxDelay : rand() * 1.5) });
    }
    return out.sort((a, b) => a.arrive - b.arrive);
  }
  function windows(events, size, lag) {
    const wins = new Map();
    const win = (a) => { if (!wins.has(a)) wins.set(a, { start: a, end: a + size, counted: 0, late: 0, closed: null }); return wins.get(a); };
    let mark = -Infinity;
    events.forEach((e) => {
      const w = win(Math.floor(e.event / size) * size);
      if (w.closed != null) { w.late++; e.late = true; } else { w.counted++; e.late = false; }
      mark = Math.max(mark, e.event - lag);
      wins.forEach((x) => { if (x.closed == null && mark >= x.end) x.closed = e.arrive; });
    });
    const last = events.length ? events[events.length - 1].arrive : 0;
    const list = [...wins.values()].sort((a, b) => a.start - b.start);
    list.forEach((w) => { if (w.closed == null) w.closed = last; });
    const closes = list.map((w) => w.closed - w.end);
    return { list, late: list.reduce((a, w) => a + w.late, 0), wait: closes.reduce((a, b) => a + b, 0) / (closes.length || 1), mark };
  }

  /* ---------- unique ids ---------- */
  const EPOCH = 1577836800000n; /* 1 January 2020 */
  const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const ids = {
    EPOCH: Number(EPOCH),
    snowflake(ms, worker, seq) { return ((BigInt(ms) - EPOCH) << 22n) | (BigInt(worker) << 12n) | BigInt(seq); },
    decode(id) { const v = BigInt(id); return { ms: Number((v >> 22n) + EPOCH), worker: Number((v >> 12n) & 1023n), seq: Number(v & 4095n) }; },
    bits(id) { return BigInt(id).toString(2).padStart(64, '0'); },
    uuid4(rand) {
      const b = Array.from({ length: 16 }, () => Math.floor(rand() * 256));
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const hex = b.map((x) => x.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
    ulid(ms, rand) {
      let t = ms, time = '';
      for (let i = 0; i < 10; i++) { time = CROCK[t % 32] + time; t = Math.floor(t / 32); }
      let r = '';
      for (let i = 0; i < 16; i++) r += CROCK[Math.floor(rand() * 32)];
      return time + r;
    },
  };

  /* ---------- pagination ---------- */
  const pages = {
    offset(rows, offset, limit) { return { rows: rows.slice(offset, offset + limit), scanned: Math.min(rows.length, offset + limit) }; },
    keyset(rows, after, limit) {
      const i = after == null ? 0 : rows.findIndex((r) => r.id < after);
      const from = i === -1 ? rows.length : i;
      return { rows: rows.slice(from, from + limit), scanned: Math.min(limit, rows.length - from) };
    },
  };

  /* ---------- logical clocks ---------- */
  function clocks(n) {
    const lam = Array(n).fill(0), vec = Array.from({ length: n }, () => Array(n).fill(0)), events = [];
    const add = (p, kind, from) => { const e = { id: events.length + 1, p, kind, lam: lam[p], vec: vec[p].slice(), from }; events.push(e); return e; };
    return {
      events,
      local(p) { lam[p]++; vec[p][p]++; return add(p, 'local'); },
      send(p) { lam[p]++; vec[p][p]++; return add(p, 'send'); },
      receive(p, msg) {
        lam[p] = Math.max(lam[p], msg.lam) + 1;
        vec[p] = vec[p].map((v, i) => Math.max(v, msg.vec[i])); vec[p][p]++;
        return add(p, 'recv', msg.id);
      },
    };
  }
  function order(a, b) {
    const le = a.every((v, i) => v <= b[i]), ge = a.every((v, i) => v >= b[i]);
    return le && ge ? 'same' : le ? 'before' : ge ? 'after' : 'concurrent';
  }

  /* ---------- error budgets ---------- */
  function budget(target, days, perDay, failed) {
    const share = 1 - target, requests = perDay * days, allowed = requests * share, minutes = days * 24 * 60 * share;
    return { requests, allowed, minutes, used: allowed ? failed / allowed : 0, left: allowed - failed };
  }
  const burnRate = (errorRate, target) => errorRate / (1 - target);

  /* ---------- network metrics: one link, one kind of response, steady traffic ----------
     A connection's speed is the lowest of three limits: bandwidth, window ÷ RTT, and the Mathis
     formula for loss. The link is a single queue. Sizes in KB, times in ms, rates in Mbps. */
  function network({ bandwidth, rtt, loss = 0, jitter = 0, sizeKB, rps, windowKB = 1024, reuse = true, serverMs = 20 }) {
    const MSS = 1460, FIRST_WINDOW = 14600, BYTES_PER_MS = 125, p = loss / 100, bytes = sizeKB * 1000;
    const byWindow = (windowKB * 1000) / (rtt * BYTES_PER_MS), byLoss = p ? (MSS / (rtt * BYTES_PER_MS)) * (1.22 / Math.sqrt(p)) : Infinity;
    const speed = Math.min(bandwidth, byWindow, byLoss), limit = speed === bandwidth ? 'bandwidth' : speed === byWindow ? 'window' : 'loss';
    const perMs = speed * BYTES_PER_MS, full = perMs * rtt;
    let left = bytes, sent = FIRST_WINDOW, rounds = 0;
    while (left > sent && sent < full) { left -= sent; sent *= 2; rounds++; }
    const serviceMs = bytes / (1 - p) / (bandwidth * BYTES_PER_MS), q = queue(rps, serviceMs, 1);
    const parts = { handshake: (reuse ? 0 : 2) * rtt, request: rtt, server: serverMs, rampUp: rounds * rtt, send: left / perMs, queue: q.wait };
    const hit = 1 - (1 - p) ** Math.ceil(bytes / MSS), resend = hit > .05 ? Math.max(200, 2 * rtt) : 0;
    const quiet = parts.handshake + parts.request + parts.server + parts.rampUp + parts.send;
    const response = quiet + q.wait, p95 = q.stable ? quiet + q.p95 - serviceMs * 1.6 + 2 * jitter + resend : Infinity;
    const capacity = 1000 / serviceMs, delivered = Math.min(rps, capacity), inFlight = (rps * response) / 1000;
    const oneWay = rtt / 2 + 2 * jitter + 20, call = oneWay < 150 && loss < 1 && bandwidth >= 2 && q.rho < .8 ? 'good' : oneWay < 300 && loss < 3 && bandwidth >= 1 && q.rho < 1 ? 'fair' : 'poor';
    return {
      speed, limit, byWindow, byLoss, parts, response, p95, rho: q.rho, inFlight, delivered, capacity, call,
      bdpKB: (bandwidth * BYTES_PER_MS * rtt) / 1000, goodput: (delivered * bytes * 8) / 1e6, failed: 1 - delivered / rps,
      workers: Math.ceil(inFlight / .7), costMonth: ((delivered * bytes) / (1 - p) / 1e9) * 2.63e6 * .09,
    };
  }

  globalThis.RTModels = { rng, queue, limiter, paymentServer, SCENARIOS, isolation, lsm, resilience, delivery, streamEvents, windows, ids, pages, clocks, order, budget, burnRate, network };
})();
