/* Design engine: turns a drawn system plus a brief into load, latency, availability,
   cost and a graded review. It has no DOM so it can be tested on its own. All capacities
   and prices are illustrative round numbers, chosen to make trade-offs realistic. */
(function (root) {
  'use strict';
  const TYPES = {
    users: { label: 'Users', short: 'Entry point of all traffic' },
    cdn: { label: 'CDN', short: 'Serves media from the edge', lat: 4, a: .9999 },
    lb: { label: 'Load balancer', short: 'Spreads requests across servers', cap: 60000, lat: 1, price: 30, a: .999 },
    gateway: { label: 'API gateway', short: 'Auth, rate limits, routing', cap: 15000, lat: 4, price: 150, a: .999 },
    app: { label: 'App servers', short: 'Stateless business logic', cap: 900, lat: 25, a: .995 },
    ws: { label: 'WebSocket servers', short: 'Long-lived realtime connections', cap: 12000, lat: 6, price: 220, a: .995 },
    cache: { label: 'Cache', short: 'In-memory reads, such as Redis', cap: 100000, lat: 1, a: .995 },
    sql: { label: 'SQL database', short: 'Transactions, strong consistency', lat: 6, a: .995 },
    nosql: { label: 'NoSQL store', short: 'Horizontal scale, eventual consistency', lat: 5, a: .998 },
    queue: { label: 'Message queue', short: 'Buffers work, decouples writes', cap: 50000, lat: 4, price: 160, a: .999 },
    worker: { label: 'Workers', short: 'Consume queued work', cap: 300, lat: 40, price: 100, a: .995 },
    blob: { label: 'Object storage', short: 'Durable files and media', lat: 30, a: .9999 },
    search: { label: 'Search index', short: 'Full-text and prefix queries', cap: 3000, lat: 18, price: 500, a: .995 },
  };
  /* Reference hardware for one instance. Capacity and price scale from these. */
  const HW = {
    lb: { cpu: 2, ram: 4, price: 30 }, gateway: { cpu: 4, ram: 8, price: 150 }, app: { cpu: 4, ram: 8, price: 140 }, ws: { cpu: 4, ram: 16, price: 220 },
    worker: { cpu: 2, ram: 4, price: 100 }, queue: { cpu: 4, ram: 16, disk: 2, price: 160 }, search: { cpu: 8, ram: 32, disk: 1, price: 500 },
    sql: { cpu: 8, ram: 32, disk: 4, price: 700 }, nosql: { cpu: 8, ram: 32, disk: 6, price: 450 },
  };
  const CPU_STEPS = [1, 2, 4, 8, 16, 32, 64], RAM_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256], DISK_STEPS = [.1, .5, 1, 2, 4, 8, 16];
  /* Doubling hardware doubles work only up to a point, then coordination costs bite. */
  const perf = (x) => (x <= 2 ? x : 2 * Math.pow(x / 2, .85));
  function hwOf(n) {
    const b = HW[n.type];
    if (!b) return { mul: 1, readMul: 1, writeMul: 1, limit: null };
    const cr = (n.cpu || b.cpu) / b.cpu, rr = (n.ram || b.ram) / b.ram, hdd = n.diskType === 'hdd';
    return { mul: Math.min(perf(cr), perf(rr)), limit: cr > rr * 1.01 ? 'ram' : rr > cr * 1.01 ? 'cpu' : 'balanced', readMul: hdd ? .5 : 1, writeMul: hdd ? .3 : 1, hdd };
  }
  function hwPrice(n) {
    const b = HW[n.type], cr = n.cpu / b.cpu, rr = n.ram / b.ram;
    if (!b.disk) return b.price * (.6 * Math.pow(cr, 1.1) + .4 * rr);
    return b.price * (.55 * Math.pow(cr, 1.1) + .35 * rr + .1 * (n.disk / b.disk) * (n.diskType === 'hdd' ? .3 : 1));
  }
  const SQL = { capR: 12000, capW: 4000, tb: 4, price: 700 };
  const NOSQL = { capR: 10000, capW: 12000, tb: 6, price: 450 };
  const DEFAULTS = {
    users: { regions: 1 }, cdn: {}, lb: { count: 1, multiAZ: false }, gateway: { count: 1, multiAZ: false },
    app: { count: 2, multiAZ: false, auto: false }, ws: { count: 1, multiAZ: false },
    cache: { count: 1, memGB: 8, multiAZ: false, coalesce: false },
    sql: { shards: 1, replicas: 0, multiAZ: false, syncRep: false }, nosql: { count: 3, rf: 3, multiAZ: true },
    queue: { count: 1, multiAZ: false }, worker: { count: 2, multiAZ: false, auto: false }, blob: {}, search: { count: 1, multiAZ: false },
  };
  Object.entries(HW).forEach(([k, b]) => Object.assign(DEFAULTS[k], { cpu: b.cpu, ram: b.ram }, b.disk ? { disk: b.disk, diskType: 'ssd' } : {}));
  /* What may call what. A browser cannot reach a database or a cache, so no design may wire one up. */
  const LINKS = {
    users: ['cdn', 'lb', 'gateway', 'app', 'blob', 'ws'], cdn: ['blob', 'lb'], lb: ['gateway', 'app', 'ws'], gateway: ['app', 'ws', 'lb'],
    app: ['cache', 'sql', 'nosql', 'queue', 'blob', 'search'], ws: ['queue', 'cache', 'app'], cache: ['sql', 'nosql'], queue: ['worker'], worker: ['sql', 'nosql', 'cache', 'search', 'blob'],
    sql: [], nosql: [], blob: [], search: [],
  };
  const LIMITS = { count: [1, 100000], shards: [1, 500], replicas: [0, 5], rf: [1, 5], memGB: [1, 1000000], regions: [1, 3], cpu: [1, 64], ram: [1, 256], disk: [.1, 16] };
  const SWITCHES = ['multiAZ', 'auto', 'coalesce', 'syncRep'];
  /* Makes any stored or pasted design safe to run: bad values fall back to defaults, and impossible parts are dropped. */
  function sanitize(design) {
    const src = design && typeof design === 'object' ? design : {}, ids = new Set(), nodes = [];
    (Array.isArray(src.nodes) ? src.nodes : []).forEach((raw) => {
      if (!raw || !TYPES[raw.type] || raw.id === undefined || raw.id === null || ids.has(raw.id)) return;
      if (raw.type === 'users' && nodes.some((n) => n.type === 'users')) return;
      const n = { ...raw };
      Object.entries(LIMITS).forEach(([k, [low, high]]) => {
        if (n[k] === undefined) return;
        const v = +n[k];
        if (!Number.isFinite(v) || n[k] === null || n[k] === '') delete n[k]; else n[k] = Math.min(high, Math.max(low, k === 'disk' ? v : Math.round(v)));
      });
      SWITCHES.forEach((k) => { if (n[k] !== undefined) n[k] = !!n[k]; });
      if (n.diskType !== undefined && n.diskType !== 'hdd' && n.diskType !== 'ssd') delete n.diskType;
      ['x', 'y'].forEach((k) => { if (n[k] !== undefined && !Number.isFinite(+n[k])) delete n[k]; });
      ids.add(n.id); nodes.push(n);
    });
    const byId = new Map(nodes.map((n) => [n.id, n])), seen = new Set();
    const edges = (Array.isArray(src.edges) ? src.edges : []).filter((e) => {
      if (!Array.isArray(e) || !byId.has(e[0]) || !byId.has(e[1]) || e[0] === e[1]) return false;
      const key = JSON.stringify([e[0], e[1]]);
      if (seen.has(key) || !LINKS[byId.get(e[0]).type].includes(byId.get(e[1]).type)) return false;
      seen.add(key); return true;
    }).map(([a, b]) => [a, b]);
    return { nodes, edges };
  }
  function normalize(design) {
    const clean = sanitize(design);
    return { nodes: clean.nodes.map((n) => {
      const out = { ...DEFAULTS[n.type], ...n };
      if (n.cpu === undefined && n.size) { const m = { s: [2, 4], m: [4, 8], l: [8, 16] }[n.size] || [4, 8]; out.cpu = m[0]; out.ram = m[1]; }
      if (out.type === 'nosql') out.rf = Math.min(out.rf, out.count);
      return out;
    }), edges: clean.edges };
  }
  const BASE = { app: 900, sqlR: SQL.capR, sqlW: SQL.capW, nR: NOSQL.capR, nW: NOSQL.capW, cache: TYPES.cache.cap, queue: TYPES.queue.cap, worker: TYPES.worker.cap, ws: TYPES.ws.cap, search: TYPES.search.cap };
  const settingsNow = { price: 1, floor: .98 };
  function setAssumptions(a) {
    TYPES.app.cap = BASE.app * a.app;
    TYPES.worker.cap = BASE.worker * a.app; TYPES.ws.cap = BASE.ws * a.app;
    SQL.capR = BASE.sqlR * a.db; SQL.capW = BASE.sqlW * a.db; NOSQL.capR = BASE.nR * a.db; NOSQL.capW = BASE.nW * a.db; TYPES.search.cap = BASE.search * a.db;
    TYPES.cache.cap = BASE.cache * a.cache; TYPES.queue.cap = BASE.queue * a.cache;
    settingsNow.price = a.price; settingsNow.floor = a.floor / 100;
    Object.keys(budgets).forEach((k) => delete budgets[k]);
  }
  const CLASSES = { read: 'Reads', write: 'Writes', media: 'Media', search: 'Search', rt: 'Realtime' };
  const CHAOS = [
    ['spike', 'Traffic spike', 'Traffic jumps to several times the peak.', 'lb'],
    ['zone', 'Zone outage', 'One availability zone goes dark.', 'availability'],
    ['primary', 'Primary database dies', 'The SQL primary is gone and must fail over.', 'replication'],
    ['cold', 'Cache goes cold', 'The cache restarts empty, and every read misses.', 'stampede'],
  ];

  /* Round trip to the nearest region, in ms, with one, two or three regions. */
  const WHERE = { near: [10, 10, 10], country: [30, 25, 20], world: [120, 60, 35], far: [220, 110, 50] };
  /* The message size, in KB, at which a tier runs out of network before it runs out of processor. */
  const WIRE_KB = { lb: 20, gateway: 80, app: 140, cache: 12, sql: 60, nosql: 60 };
  const AUTO_MAX = 10, AUTO_BURST = 2, USER_MBPS = 25, FIRST_KB = 14.6, TRANSFER_TB = 90, SECONDS_A_MONTH = 2.63e6;
  const TIMEOUT_MS = 5000, TAIL = 1.6, CACHE_NODE_GB = 256, BURSTINESS = 2;
  /* Queueing on a pool of workers (Sakasegawa's approximation of M/M/c). Parallelism comes from Little's Law:
     capacity × service time. So one busy server queues at 50%, while a large pool stays quick to about 90%. */
  function queueFactor(rho, capacity, serviceMs) {
    if (!(rho > 0)) return 1;
    const p = Math.min(rho, .98), c = Math.max(1, (capacity * serviceMs) / 1000);
    return 1 + (BURSTINESS * Math.pow(p, Math.sqrt(2 * (c + 1)) - 1)) / (c * (1 - p));
  }
  /* Time to send a message: extra slow-start round trips, then the bytes over the user's link. */
  const sendMs = (kb, rtt) => (kb > FIRST_KB ? Math.ceil(Math.log2(kb / FIRST_KB + 1)) - 1 : 0) * rtt + (kb * 8) / USER_MBPS;

  /* A load test changes a brief's numbers. Every field is optional, and an empty test changes nothing:
     scale moves all traffic, readX and writeX move one kind, and the rest replace the brief's value. */
  function loaded(b, l) {
    if (!l) return b;
    const scale = l.scale || 1, readX = l.readX || 1, writeX = l.writeX || 1, respKB = l.respKB || b.recordKB, writeKB = l.writeKB || b.recordKB, where = l.where || (b.global ? 'world' : 'country');
    const d = { ...b, read: b.read * scale * readX, write: b.write * scale * writeX, media: b.media * scale, search: b.search * scale, rt: b.rt * scale, respKB, writeKB, rtts: WHERE[where], global: where === 'world' || where === 'far', maxHit: l.maxHit === undefined ? b.maxHit : l.maxHit, fanout: l.fanout || b.fanout };
    const sum = (x) => x.read + x.write + x.media + x.search + x.rt;
    d.storageTB = b.storageTB * scale * writeX * (writeKB / b.recordKB);
    d.hotGB = Math.max(1, b.hotGB * scale * (respKB / b.recordKB));
    d.egressTB = b.egressTB * scale;
    d.grow = Math.min(AUTO_MAX, Math.max(1, sum(d) / (sum(b) || 1)));
    return d;
  }

  function demand(brief, stage) {
    const s = brief.stages[stage], b = brief, day = 86400, pk = b.peak || 3;
    const rate = (n) => (s.dau * (n || 0) / day) * pk;
    return {
      name: s.name, dau: s.dau, read: rate(b.reads), write: rate(b.writes), media: rate(b.media), search: rate(b.searches), rt: rate(b.realtime),
      storageTB: (s.dau * (b.writes || 0) * 365 * (b.years || 3) * (b.recordKB || 1)) / 1e9,
      hotGB: Math.max(1, (s.dau * (b.reads || 0) * (b.recordKB || 1) * (b.hotShare || .2)) / 1e6),
      egressTB: (s.dau * (b.media || 0) * 30 * (b.mediaKB || 0)) / 1e9,
      slo: b.slo, strong: !!b.strong, global: !!b.global, fanout: b.fanout || 1, maxHit: b.maxHit || .95, spike: b.spike || 3, mediaKB: b.mediaKB || 0, recordKB: b.recordKB || 1, peak: pk,
    };
  }

  function evaluate(raw, brief, stage, faults) {
    const design = normalize(raw), f = faults || {}, base = loaded(demand(brief, stage), f.load), mult = f.spike ? (typeof f.spike === 'number' ? f.spike : base.spike) : 1;
    const d = { ...base };
    /* How much harder a message of this size works a tier than the brief's normal size does. */
    const wire = (t, cls) => { const kb = cls === 'read' ? d.respKB : cls === 'write' ? d.writeKB : 0, at = WIRE_KB[t]; return kb && at ? Math.max(1, kb / at) / Math.max(1, d.recordKB / at) : 1; };
    Object.keys(CLASSES).forEach((c) => { d[c] = base[c] * mult; });
    /* An attack multiplies reads unless a gateway is rate limiting at the door. */
    if (f.ddos) d.read *= design.nodes.some((n) => n.type === 'gateway') ? 1.4 : f.ddos;
    const byId = {}, out = {};
    design.nodes.forEach((n) => { byId[n.id] = n; out[n.id] = []; });
    design.edges.forEach(([a, b]) => { if (byId[a] && byId[b] && !out[a].includes(b)) out[a].push(b); });
    const users = design.nodes.find((n) => n.type === 'users');
    const regions = users ? users.regions || 1 : 1, regionGone = f.region && regions < 2;
    const load = {}, edges = {};
    design.nodes.forEach((n) => { load[n.id] = { read: 0, write: 0, other: 0, by: {} }; });

    const isDown = (n) => {
      if (f.kill === n.id || (Array.isArray(f.down) && f.down.includes(n.id))) return true;
      if (f.killOne === n.type && (n.count || 1) < 2) return true;
      if (f.zone && !['users', 'cdn', 'blob'].includes(n.type) && regions < 2) {
        const many = (n.count || n.shards || 1) >= 2 || n.type === 'sql';
        if (!(n.multiAZ && many)) return n.type === 'sql' ? !(n.replicas > 0 && n.multiAZ) : true;
      }
      return false;
    };
    /* An outage takes half a spread tier in one region, or all of an unspread tier there. Other regions carry on. */
    const zoneShare = (n) => (n.multiAZ && ((n.count || n.shards || 1) >= 2 || n.type === 'sql') ? .5 : 0);
    const zoneFactor = (n) => (f.zone ? (regions < 2 ? (n.multiAZ ? .5 : 1) : (regions - 1 + zoneShare(n)) / regions) : 1) * (f.killOne === n.type && n.count > 1 ? (n.count - 1) / n.count : 1);
    /* Each region runs a full stack, so it adds capacity. Writes still reach every copy of the data, so they do not scale this way. */
    const regional = Math.max(1, regions - (f.region ? 1 : 0));
    /* A degraded tier, such as a bad release or a slow query, does less work per second and takes longer over each request. */
    const slowOf = (n) => (f.degrade && f.degrade[n.id]) || null;
    function capacity(n) {
      const c = rawCapacity(n), g = slowOf(n);
      if (!g || !(g.cap > 0) || g.cap === 1) return c;
      const out = {};
      Object.keys(c).forEach((k) => { out[k] = c[k] * g.cap; });
      return out;
    }
    /* One key that takes a share of all reads lives on one cache node or one shard, however many there are. */
    function hotSkew(n) {
      if (!(f.hot > 0)) return 1;
      const spread = n.type === 'cache' ? n.count || 1 : n.type === 'sql' ? n.shards || 1 : n.type === 'nosql' ? Math.max(1, (n.count || 1) / (n.rf || 3)) : 1;
      return 1 + Math.min(1, f.hot) * (spread - 1);
    }
    function rawCapacity(n) {
      const scale = zoneFactor(n) * regional, hw = hwOf(n), elastic = n.auto ? (f.spike ? Math.min(mult, AUTO_BURST) : 1) * (d.grow || 1) : 1;
      switch (n.type) {
        case 'app': case 'worker': return { all: n.count * TYPES[n.type].cap * hw.mul * scale * elastic };
        case 'sql': return { r: (n.shards || 1) * (1 + Math.max(0, (n.replicas || 0) - (f.primary ? 1 : 0))) * SQL.capR * hw.mul * hw.readMul * scale, w: (n.shards || 1) * SQL.capW * hw.mul * hw.writeMul };
        case 'nosql': return { r: n.count * NOSQL.capR * hw.mul * hw.readMul * scale, w: (n.count * NOSQL.capW * hw.mul * hw.writeMul * zoneFactor(n)) / (n.rf || 3) };
        case 'cdn': case 'blob': return { all: Infinity };
        case 'cache': return { all: (n.count || 1) * TYPES.cache.cap * scale };
        default: return { all: (n.count || 1) * (TYPES[n.type].cap || Infinity) * hw.mul * scale };
      }
    }
    function stats(n) {
      const c = capacity(n), l = load[n.id];
      /* Every replica replays every write, and that work comes out of the room it has for reads. */
      const copies = 1 + Math.max(0, (n.replicas || 0) - (f.primary ? 1 : 0)), replay = n.type === 'sql' && copies > 1 ? (1 + (copies - 1) * (1 - Math.min(.9, l.write / c.w))) / copies : 1;
      const skew = hotSkew(n);
      const util = n.type === 'sql' || n.type === 'nosql' ? (l.read * skew) / (c.r * replay) + l.write / c.w : (l.read * skew + l.write + l.other) / (c.all || Infinity);
      const down = isDown(n) || (f.primary && n.type === 'sql' && !n.replicas) || (f.zone && n.type === 'nosql' && n.rf < 2 && regions < 2);
      return { util: util || 0, ok: down ? 0 : util > 1 ? 1 / util : 1, qf: queueFactor(util, c.all === Infinity ? 0 : c.all || c.r, TYPES[n.type].lat || 1), down };
    }
    function tierA(n) {
      const a = TYPES[n.type].a, count = n.type === 'sql' ? 1 + (n.replicas || 0) : n.count || 1;
      const inst = 1 - Math.pow(1 - a, count);
      if (n.type === 'cdn' || n.type === 'blob') return a;
      return inst * (n.multiAZ && count >= 2 ? .99999 : .9993);
    }
    function hitOf(n) {
      if (isDown(n)) return 0;
      if (n.type === 'cdn') return .93;
      const full = d.maxHit * (1 - Math.exp(-3.2 * Math.min(n.memGB || 0, (n.count || 1) * CACHE_NODE_GB) / d.hotGB));
      if (f.cold) return n.coalesce ? full * .65 : 0;
      /* A cache that is filling again after a restart: warm runs from 0 (empty) to 1 (full). */
      if (f.warm !== undefined && f.warm < 1) { const w = Math.max(0, f.warm); return full * (n.coalesce ? .65 + .35 * w : w); }
      return full;
    }
    const memo = {};
    function serves(id, cls, seen) {
      const key = id + cls;
      if (memo[key] !== undefined) return memo[key];
      const s = seen || [];
      if (s.includes(id)) return false;
      const n = byId[id], t = n.type, kids = () => out[id].some((k) => serves(k, cls, [...s, id]));
      let r;
      if (t === 'sql' || t === 'nosql') r = cls === 'read' || cls === 'write';
      else if (t === 'blob') r = cls === 'media';
      else if (t === 'search') r = cls === 'search';
      else if (t === 'ws') r = cls === 'rt';
      else if (t === 'cdn') r = cls === 'media' && kids();
      else if (t === 'queue' || t === 'worker') r = cls === 'write' && kids();
      else if (t === 'cache') r = (cls === 'read' || cls === 'write') && kids();
      else r = kids();
      memo[key] = r; return r;
    }
    const dead = { lat: 0, tail: 0, ok: 0, a: 0, edge: 0, none: true, steps: [] };
    /* The share of its traffic each tier lets through. A bottleneck shields the tiers behind it. */
    const gate = {}, through = (id) => (gate[id] === undefined ? 1 : gate[id]);
    let measure = false, backlog = false;

    /* Work handed on beside a request. It loads the next tier, but the sender does not wait for it:
       a WebSocket server stores a message after delivering it, and a worker updates an index after saving. */
    function handOn(id, targets, rate, path) {
      const sent = rate * through(id);
      targets.forEach((k) => {
        const type = byId[k].type, kind = type === 'cache' ? 'read' : 'write';
        const sink = ['cache', 'search', 'blob'].includes(type), taken = serves(k, kind);
        if (!measure && (taken || sink)) edges[id + '>' + k] = (edges[id + '>' + k] || 0) + sent;
        if (taken) go(k, kind, sent, path);
        else if (!measure && sink) { load[k].other += sent; load[k].by[kind] = (load[k].by[kind] || 0) + sent; }
      });
    }
    function go(id, cls, rate, stack) {
      const n = byId[id], t = n.type;
      if (stack.includes(id)) return dead;
      const path = [...stack, id];
      let kids = out[id].filter((k) => serves(k, cls));
      const helpers = cls === 'read' ? out[id].filter((k) => byId[k].type === 'cache' && !serves(k, 'read')) : [];
      if (cls === 'read' && kids.some((k) => byId[k].type === 'cache')) kids = kids.filter((k) => byId[k].type === 'cache');
      if (cls === 'write') {
        if (kids.some((k) => byId[k].type === 'queue')) kids = kids.filter((k) => byId[k].type === 'queue');
        else if (kids.some((k) => byId[k].type !== 'cache')) kids = kids.filter((k) => byId[k].type !== 'cache');
      }
      if (cls === 'media' && kids.some((k) => byId[k].type === 'cdn')) kids = kids.filter((k) => byId[k].type === 'cdn');

      let weight = 1;
      if (cls === 'write' && t === 'worker') weight = d.fanout;
      if (cls === 'write' && t === 'app' && !kids.some((k) => byId[k].type === 'queue')) weight = d.fanout;
      if (cls === 'media' && t === 'app') weight = Math.max(1, d.mediaKB / 100);
      if (!measure && t !== 'users') {
        const l = load[id], work = rate * weight * wire(t, cls);
        if (cls === 'read') l.read += work; else if (cls === 'write') l.write += work; else l.other += work;
        l.by[cls] = (l.by[cls] || 0) + rate;
      }
      const st = t === 'users' ? { ok: 1, qf: 1 } : stats(n);
      let lat = t === 'users' ? 0 : (TYPES[t].lat || 0) * st.qf;
      if (t === 'sql') lat = ((cls === 'write' ? 12 + (n.syncRep ? 10 : 0) : 6) + (n.diskType === 'hdd' ? 8 : 0)) * st.qf;
      if (t === 'nosql') lat = ((cls === 'write' ? 6 : 5) + (n.diskType === 'hdd' ? 8 : 0)) * st.qf;
      if (t === 'app' && cls === 'write' && weight > 1) lat += Math.min(400, weight * 1.5);
      if (t !== 'users' && slowOf(n) && slowOf(n).lat > 0) lat *= slowOf(n).lat;
      const a = t === 'users' ? 1 : tierA(n);
      const end = (t === 'sql' || t === 'nosql') || (t === 'blob' && cls === 'media') || (t === 'search' && cls === 'search') || (t === 'ws' && cls === 'rt');
      if (t === 'ws' && cls === 'rt') handOn(id, out[id], rate, path);
      if (t === 'worker' && cls === 'write') handOn(id, out[id].filter((k) => !kids.includes(k) && ['cache', 'search', 'blob'].includes(byId[k].type)), rate, path);
      /* While a replica is being promoted, the SQL tier has no primary, so writes fail and reads carry on. */
      if (end) return { lat, tail: lat, ok: f.failover && t === 'sql' && cls === 'write' ? 0 : st.ok, a, edge: 0, home: t === 'sql' && cls === 'write', steps: [[id, lat]] };

      const hitHere = t === 'cdn' || (t === 'cache' && cls === 'read') ? hitOf(n) : 0;
      let miss = rate * (1 - hitHere), extra = 0;
      helpers.forEach((h) => {
        const hn = byId[h], ratio = hitOf(hn);
        if (!measure) { load[h].read += miss * wire('cache', 'read'); edges[id + '>' + h] = (edges[id + '>' + h] || 0) + miss; }
        const hs = stats(hn);
        if (measure) extra += (hs.ok ? 1 : 0) * TYPES.cache.lat * hs.qf;
        miss *= 1 - (hs.ok || !measure ? ratio : 0);
      });
      if (!kids.length) return miss <= 1e-9 ? { lat: lat + extra, tail: lat + extra, ok: st.ok, a, edge: 0, steps: [[id, lat + extra]] } : dead;

      if (t === 'queue') {
        /* A queue absorbs a spike: consumers keep their normal pace and the backlog drains later. */
        const each = (rate * through(id)) / kids.length / mult;
        kids.forEach((k) => { if (!measure) edges[id + '>' + k] = (edges[id + '>' + k] || 0) + each; const r = go(k, cls, each, path); if (measure && r.ok < 1) backlog = true; });
        return { lat, tail: lat, ok: st.ok, a, edge: 0, steps: [[id, lat]] };
      }
      const each = (miss * through(id)) / kids.length;
      let sum = { lat: 0, tail: 0, ok: 0, a: 0, edge: 0, home: false, steps: [] };
      kids.forEach((k) => {
        if (!measure) edges[id + '>' + k] = (edges[id + '>' + k] || 0) + each;
        const r = go(k, cls, each, path);
        sum.lat += r.lat / kids.length; sum.ok += r.ok / kids.length; sum.a += r.a / kids.length; sum.edge += r.edge / kids.length; sum.home = sum.home || !!r.home;
        if (r.tail >= sum.tail) { sum.tail = r.tail; sum.steps = r.steps; }
      });
      const pass = rate ? miss / rate : 1;
      const edgeHit = t === 'cdn' ? hitHere : sum.edge;
      /* If more than 5% of requests take the slower branch, that branch is what p95 measures. */
      const slow = pass > .05;
      return { lat: lat + extra + pass * sum.lat, tail: lat + extra + (slow ? sum.tail : pass * sum.tail), ok: st.ok * ((1 - pass) + pass * sum.ok), a: a * (hitHere > .5 ? 1 - (1 - hitHere) * (1 - sum.a) : sum.a), edge: edgeHit, home: sum.home, steps: slow ? [[id, lat + extra], ...sum.steps] : [[id, lat + extra]] };
    }

    const classes = {};
    const active = Object.keys(CLASSES).filter((c) => d[c] > 0);
    if (users) {
      /* Offered load settles in a few passes: each tier's limit changes what the next tier receives. */
      for (let i = 0; i < 12; i++) {
        design.nodes.forEach((n) => { load[n.id] = { read: 0, write: 0, other: 0, by: {} }; });
        Object.keys(edges).forEach((k) => delete edges[k]);
        active.forEach((c) => { if (serves(users.id, c)) go(users.id, c, d[c], []); });
        let moved = false;
        design.nodes.forEach((n) => { if (n.type === 'users') return; const u = stats(n), g = u.util > 1 ? 1 / u.util : 1; if (Math.abs(through(n.id) - g) > 1e-6) moved = true; gate[n.id] = g; });
        if (!moved) break;
      }
      measure = true;
      active.forEach((c) => {
        if (!serves(users.id, c)) { classes[c] = { rate: d[c], routed: false, succ: 0, p95: 0, a: 0 }; return; }
        const r = go(users.id, c, d[c], []);
        /* A write to a single SQL primary travels to the primary's region, however many regions serve reads. */
        const rtts = d.rtts || (d.global ? WHERE.world : WHERE.country), rtt = rtts[r.home ? 0 : regions - 1];
        const netRtt = r.edge ? r.edge * Math.min(15, rtt) + (1 - r.edge) * rtt : rtt;
        const strongPenalty = c === 'write' && d.strong && regions > 1 ? 70 : 0;
        const kb = c === 'read' ? d.respKB : c === 'write' ? d.writeKB : 0, sending = kb ? Math.max(0, sendMs(kb, rtt) - sendMs(d.recordKB, rtt)) : 0;
        const succ = regionGone ? 0 : r.ok, net = netRtt + strongPenalty + sending, timedOut = succ < .95;
        classes[c] = { rate: d[c], routed: true, succ, p95: timedOut ? TIMEOUT_MS : TAIL * r.tail + net, raw: TAIL * r.tail + net, timedOut, net, path: r.steps.map(([id, ms]) => [id, ms * TAIL]), a: 1 - Math.pow(1 - r.a, regions) };
      });
    } else active.forEach((c) => { classes[c] = { rate: d[c], routed: false, succ: 0, p95: 0, a: 0 }; });

    const nodes = {};
    let cost = 0;
    design.nodes.forEach((n) => {
      const st = stats(n), c = nodeCost(n, d, regions);
      cost += c;
      nodes[n.id] = { util: n.type === 'users' ? 0 : st.util, down: st.down, cost: c, load: load[n.id], cap: capacity(n) };
      if (n.type === 'cache') nodes[n.id].hit = hitOf(n);
    });
    /* Sending data out of the cloud is billed. Data coming in is free, so writes add nothing here. */
    const transfer = classes.read && classes.read.routed ? Math.round(((d.respKB || d.recordKB) * base.read / base.peak) * SECONDS_A_MONTH / 1e9 * TRANSFER_TB * settingsNow.price) : 0;
    cost += transfer;
    const list = Object.entries(classes), total = list.reduce((t, [, c]) => t + c.rate, 0) || 1;
    const succ = list.reduce((t, [, c]) => t + c.succ * c.rate, 0) / total;
    const avail = list.length ? Math.min(...list.map(([, c]) => c.a)) : 0;
    const dbs = design.nodes.filter((n) => n.type === 'sql' || n.type === 'nosql');
    const stored = dbs.reduce((t, n) => t + (n.type === 'sql' ? (n.shards || 1) * n.disk : (n.count * n.disk) / (n.rf || 3)), 0);
    const checks = {
      routes: list.every(([, c]) => c.routed) && list.length > 0,
      capacity: succ >= .999 && !backlog,
      storage: stored >= d.storageTB,
      latency: list.every(([k, c]) => !c.routed || c.p95 <= (d.slo[k] || Infinity)),
      avail: avail >= d.slo.avail,
      strong: !d.strong || !dbs.some((n) => n.type === 'nosql' && design.edges.some(([, b]) => b === n.id)),
      balanced: !design.nodes.some((n) => n.type === 'app' && n.count > 1 && design.edges.some(([a, b]) => b === n.id && byId[a].type === 'users')),
    };
    return { d, nodes, classes, edges, cost, transfer, succ, avail, backlog, stored, checks, regions };
  }
  const holds = (r) => r.checks.routes && r.checks.capacity && r.checks.latency;

  /* The largest multiple of all traffic a design serves within its targets, and what stops it there. */
  function breakPoint(design, brief, stage, load, faults) {
    const run = (scale) => evaluate(design, brief, stage, { ...faults, load: { ...load, scale } });
    const total = (r) => Object.values(r.classes).reduce((t, c) => t + c.rate, 0);
    const MIN = .01, MAX = 1e4;
    if (!holds(run(MIN))) { const r = run(MIN); return { scale: 0, total: 0, why: stopper(r) }; }
    if (holds(run(MAX))) return { scale: Infinity, total: Infinity, why: null };
    let low = MIN, high = MAX;
    for (let i = 0; i < 18; i++) { const mid = Math.sqrt(low * high); if (holds(run(mid))) low = mid; else high = mid; }
    return { scale: low, total: total(run(low)), why: stopper(run(high)) };
  }
  function stopper(r) {
    const [id, top] = Object.entries(r.nodes).sort((a, b) => b[1].util - a[1].util)[0] || [];
    const late = Object.entries(r.classes).find(([k, c]) => c.routed && c.p95 > (r.d.slo[k] || Infinity));
    if (!r.checks.routes) return { kind: 'route' };
    if (top && top.util > 1) return { kind: 'tier', id, util: top.util };
    if (r.backlog) return { kind: 'backlog' };
    return late ? { kind: 'latency', cls: late[0], p95: late[1].p95, net: late[1].net, limit: r.d.slo[late[0]], id, util: top ? top.util : 0 } : { kind: 'tier', id, util: top ? top.util : 0 };
  }

  function nodeCost(n, d, regions) {
    const az = n.multiAZ ? 1.1 : 1, auto = n.auto ? 1.1 * (d.grow || 1) : 1;
    let c = 0;
    switch (n.type) {
      case 'users': return 0;
      case 'cdn': return Math.round((50 + d.egressTB * 25) * settingsNow.price);
      case 'blob': return Math.round((10 + d.egressTB * .5 + d.storageTB * 23) * settingsNow.price);
      case 'cache': c = (n.memGB || 0) * 9 + (n.count || 1) * 40; break;
      case 'sql': c = (n.shards || 1) * (1 + (n.replicas || 0)) * hwPrice(n); break;
      default: c = (n.count || 1) * hwPrice(n);
    }
    return Math.round(c * az * auto * regions * settingsNow.price);
  }

  function chaos(raw, brief, stage) {
    const design = normalize(raw);
    return CHAOS.filter(([id]) => (id !== 'primary' || design.nodes.some((n) => n.type === 'sql')) && (id !== 'cold' || design.nodes.some((n) => n.type === 'cache'))).map(([id, name, say, lab]) => {
      const r = evaluate(design, brief, stage, { [id]: true });
      const pass = r.checks.routes && r.succ >= settingsNow.floor;
      return { id, name, say, lab, pass, succ: r.succ, result: r };
    });
  }

  /* ----- Reference designs: a shape from the brief, sized by repeated stress testing ----- */
  function shapeDesign(brief, stage) {
    const sh = brief.shape, store = sh.store || 'sql', nodes = [], edges = [];
    const add = (id, type, x, y, cfg) => { nodes.push({ id, type, x, y, ...DEFAULTS[type], ...cfg }); return id; };
    add('users', 'users', 11, 242, { regions: sh.regions ? (stage ? sh.regions : 1) : 1 });
    add('lb', 'lb', 176, 242, { count: 2, multiAZ: true });
    let front = 'lb';
    edges.push(['users', 'lb']);
    if (sh.gateway) { add('gw', 'gateway', 341, 242, { count: 2, multiAZ: true }); edges.push(['lb', 'gw']); front = 'gw'; }
    if (brief.reads || brief.writes || brief.searches) {
      add('app', 'app', 506, 242, { count: 3, multiAZ: true, auto: true }); edges.push([front, 'app']);
      if (store === 'sql') add('db', 'sql', 847, 297, { shards: 1, replicas: 1, multiAZ: true, syncRep: !!brief.strong });
      else add('db', 'nosql', 847, 297, { count: 3, rf: 3, multiAZ: true });
      if (sh.cache) { add('cache', 'cache', 682, 143, { count: 2, memGB: 8, multiAZ: true, coalesce: true }); edges.push(['app', 'cache']); }
      edges.push(['app', 'db']);
      if (sh.queue) { add('q', 'queue', 506, 429, { count: 2, multiAZ: true }); add('w', 'worker', 682, 429, { count: 2, multiAZ: true, auto: true }); edges.push(['app', 'q'], ['q', 'w'], ['w', 'db']); }
      if (sh.search) { add('s', 'search', 682, 33, { count: 2, multiAZ: true }); edges.push(['app', 's']); }
    }
    if (sh.cdn) { add('cdn', 'cdn', 176, 55, {}); add('blob', 'blob', 341, 55, {}); edges.push(['users', 'cdn'], ['cdn', 'blob']); }
    if (sh.ws) { add('ws', 'ws', 341, 429, { count: 2, multiAZ: true }); edges.push(['lb', 'ws']); }
    return { nodes, edges };
  }
  function bump(n, r) {
    const u = r.nodes[n.id].load;
    switch (n.type) {
      case 'app': case 'worker': n.count = Math.ceil(n.count * 1.3) + 1; break;
      case 'sql': {
        const c = r.nodes[n.id].cap;
        if (u.write / c.w > u.read / c.r) n.shards += 1; else if (n.replicas < 4) n.replicas += 1; else { n.shards += 1; n.replicas = 1; }
        break;
      }
      case 'nosql': n.count = Math.ceil(n.count * 1.3); break;
      default: if (n.count) n.count += 1;
    }
  }
  function solve(brief, stage) {
    const design = shapeDesign(brief, stage), d = demand(brief, stage);
    let target = .65;
    design.nodes.forEach((n) => { if (n.type === 'cache') n.memGB = Math.ceil(d.hotGB * 1.2); });
    for (let i = 0; i < 400; i++) {
      const tests = [evaluate(design, brief, stage), ...chaos(design, brief, stage).map((c) => c.result)];
      let changed = false;
      tests.forEach((r, ti) => {
        design.nodes.forEach((n) => { if (n.type !== 'users' && r.nodes[n.id].util > (ti ? .9 : target)) { bump(n, r); changed = true; } });
      });
      const base = tests[0];
      design.nodes.forEach((n) => {
        if (n.type === 'sql' && base.d.storageTB > base.stored) { n.shards += Math.ceil((base.d.storageTB - base.stored) / n.disk); changed = true; }
        if (n.type === 'nosql' && base.d.storageTB > base.stored) { n.count += Math.ceil(((base.d.storageTB - base.stored) * (n.rf || 3)) / n.disk); changed = true; }
        if (n.type === 'cache') { const need = Math.ceil(n.memGB / 64); if (n.count < need) { n.count = need; changed = true; } }
      });
      if (!changed && !base.checks.latency) {
        const u = design.nodes.find((n) => n.type === 'users');
        if (u.regions < 3 && base.d.global) u.regions += 1; else if (target > .3) target -= .1; else break;
        changed = true;
      }
      if (!changed) break;
    }
    return design;
  }
  const budgets = {};
  function budget(brief, stage) {
    if (brief.stages[stage].budget) return brief.stages[stage].budget;
    const key = brief.id + ':' + stage + ':' + (brief.custom ? JSON.stringify(brief.stages) : '');
    if (budgets[key] == null) {
      const c = evaluate(solve(brief, stage), brief, stage).cost * 1.3;
      const mag = Math.pow(10, Math.floor(Math.log10(c)) - 1);
      budgets[key] = Math.ceil(c / mag) * mag;
    }
    return budgets[key];
  }

  /* ----- Review ----- */
  function review(raw, brief, stage, r) {
    const design = normalize(raw);
    const out = [], add = (sev, text, fix, lab) => out.push({ sev, text, fix, lab });
    const has = (t) => design.nodes.filter((n) => n.type === t);
    const d = r.d;
    Object.entries(r.classes).forEach(([k, c]) => {
      if (!c.routed) {
        const fix = { media: 'Connect Users → CDN → Object storage.', search: 'Connect App servers → Search index.', rt: 'Connect the load balancer → WebSocket servers.', read: 'Connect Users through to a database.', write: 'Connect Users through to a database.' }[k];
        add('critical', `${CLASSES[k]} have no path to anything that can serve them.`, fix, k === 'rt' ? 'realtime' : k === 'media' ? 'cdn' : 'lb');
      }
    });
    design.nodes.forEach((n) => {
      const x = r.nodes[n.id], name = TYPES[n.type].label, many = /s$/.test(name), verb = (one, more) => (many ? more : one);
      if (n.type === 'users') return;
      if (x.util > 1) add('critical', `${name} ${verb('is', 'are')} at ${Math.round(x.util * 100)}% of capacity, so ${Math.round((1 - 1 / x.util) * 100)}% of ${verb('its', 'their')} requests fail.`, n.type === 'sql' ? (x.load.write / x.cap.w > x.load.read / x.cap.r ? 'Writes are the limit, so add shards or a queue. Replicas cannot help writes.' : 'Reads are the limit, so add a cache or read replicas.') : 'Add instances or take load off this tier.', n.type === 'sql' ? 'sharding' : 'lb');
      else if (x.util > .75) add('warning', `${name} ${verb('runs', 'run')} at ${Math.round(x.util * 100)}%, which leaves little room for a spike or a lost zone.`, 'Leave headroom for spikes and failures.', 'lb');
      if (['app', 'lb', 'gateway', 'ws', 'cache', 'worker', 'search', 'queue'].includes(n.type) && (n.count || 1) < 2) add('warning', `${name} ${verb('has', 'have')} a single instance, so ${verb('it is', 'they are')} a single point of failure.`, 'Run at least two.', 'availability');
      if (n.type === 'sql' && !n.replicas) add('warning', 'The SQL database has no replica, so losing it means downtime and possibly data loss.', 'Add a replica and enable Multi-AZ.', 'replication');
      if (!n.multiAZ && !['cdn', 'blob'].includes(n.type)) add('info', `${name} ${verb('sits', 'sit')} in one zone, so one zone outage stops ${verb('it', 'them')}.`, 'Enable Multi-AZ.', 'availability');
      if (x.util < .1 && x.cost > 500 && Number.isFinite(x.util) && x.util > 0) add('info', `${name} ${verb('uses', 'use')} ${Math.round(x.util * 100)}% of ${verb('its', 'their')} capacity and ${verb('costs', 'cost')} $${x.cost.toLocaleString()} a month.`, 'Scale it down, unless it is headroom for failures.', 'availability');
      const hw = hwOf(n);
      if (x.util > .75 && hw.limit === 'ram') add('warning', `${name} ${verb('is', 'are')} short of memory. More processors would not help until RAM catches up.`, 'Raise RAM, or lower the CPU to match it.', 'studio');
      if (x.util > .75 && hw.limit === 'cpu') add('info', `${name} ${verb('has', 'have')} more RAM than ${verb('its', 'their')} processors can use.`, 'Raise the CPU, or save money on RAM.', 'studio');
      if (hw.hdd && x.util > .5) add('warning', `${name} ${verb('uses', 'use')} HDD storage, which handles far fewer operations than SSD.`, 'Switch this busy store to SSD.', 'index');
      if (n.type === 'cache' && n.memGB > n.count * CACHE_NODE_GB) add('warning', `${n.memGB} GB of cache on ${n.count} node${n.count > 1 ? 's' : ''} is more than the hardware can hold, so only ${n.count * CACHE_NODE_GB} GB counts.`, `Each node holds up to ${CACHE_NODE_GB} GB, so add nodes.`, 'eviction');
      if (n.type === 'nosql' && n.rf < 2) add('critical', 'Each record has one copy, so losing one node loses data.', 'Set the replication factor to at least 3.', 'replication');
      if (n.type === 'cache' && n.memGB < d.hotGB * .5) add('warning', `The cache holds ${n.memGB} GB, but the hot data set is about ${Math.ceil(d.hotGB)} GB, so hit rate suffers.`, 'Size memory near the hot data set.', 'eviction');
    });
    if (d.read > d.write * 5 && d.read > 200 && !has('cache').length) add('warning', `Traffic is ${Math.round(d.read / Math.max(1, d.write))}:1 read-heavy, and nothing caches it.`, 'Add a cache beside the app servers.', 'cacheflow');
    if (!r.checks.balanced) add('critical', 'Users connect straight to several app servers, and nothing shares the traffic between them.', 'Put a load balancer in front.', 'lb');
    if (d.fanout > 1 && !has('queue').length) add('critical', `One write fans out to about ${d.fanout} deliveries, and the app does that inside the request.`, 'Hand fan-out to a queue and workers.', 'tradeoffs');
    if (d.media > 0 && !has('cdn').length) add('warning', 'Media is served without a CDN, so distant users wait and origin egress grows.', 'Put a CDN in front of object storage.', 'cdn');
    if (!r.checks.storage) add('critical', `Data needs ${Math.ceil(d.storageTB)} TB, but the stores hold ${Math.floor(r.stored)} TB.`, 'Add shards or nodes.', 'sharding');
    if (!r.checks.strong) add('critical', 'This brief needs strong consistency, but writes land in an eventually consistent store.', 'Use SQL with synchronous replication for this data.', 'cap');
    if (r.backlog) add('warning', 'Workers cannot keep up, so the queue backlog grows without limit.', 'Add workers, or make them auto-scale.', 'kafka');
    design.edges.forEach(([a, b]) => {
      const A = design.nodes.find((n) => n.id === a), B = design.nodes.find((n) => n.id === b), busy = A.type === 'users' || Object.values(r.nodes[a].load).some((v) => v > 0 && typeof v === 'number');
      if (r.edges[a + '>' + b] || !busy) return;
      add('info', `The connection from ${TYPES[A.type].label} to ${TYPES[B.type].label} carries no traffic.`, { queue: 'Add workers behind the queue, and connect them to a store.', worker: 'Connect the workers to a store.', app: 'Connect the app servers to a store.', cache: 'Connect the cache to a store, or call it from the app servers.', search: 'Search requests reach the index from app servers. Workers can keep it updated.', blob: 'Only media reaches object storage.', ws: 'Only realtime messages reach WebSocket servers.', lb: 'Connect the load balancer to app servers.', gateway: 'Connect the gateway to app servers.', cdn: 'A CDN only serves media, so connect it to object storage.', sql: 'This brief sends nothing here.', nosql: 'This brief sends nothing here.' }[B.type], 'studio');
    });
    if (r.regions > 1 && has('sql').length && !has('queue').length) add('info', 'Writes still travel to the one region that holds the SQL primary.', 'Accept the delay, or acknowledge writes from a queue in each region.', 'replication');
    if (d.global && r.regions === 1 && stage > 0) add('info', 'Global users all travel to one region.', 'Add a region on the Users node, and accept the cost.', 'cdn');
    if (d.strong && has('sql').some((n) => n.replicas && !n.syncRep)) add('info', 'Async replication could lose acknowledged writes in a failover.', 'Enable synchronous replication for this data.', 'replication');
    const rank = { critical: 0, warning: 1, info: 2 };
    return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
  }

  function grade(design, brief, stage) {
    const r = evaluate(design, brief, stage), c = r.checks, tests = chaos(design, brief, stage), limit = budget(brief, stage);
    const costOk = r.cost <= limit;
    const passRate = tests.length ? tests.filter((t) => t.pass).length / tests.length : 0;
    const parts = [
      ['Handles the load', 30, c.routes && c.capacity && c.storage ? 1 : c.routes ? Math.max(0, r.succ - .5) : 0],
      ['Meets latency targets', 20, c.latency && c.routes ? 1 : 0],
      ['Meets availability target', 15, c.avail ? 1 : 0],
      ['Stays within budget', 15, costOk ? 1 : Math.max(0, 1 - (r.cost - limit) / limit)],
      ['Survives failures', 20, passRate],
    ];
    const score = Math.round(parts.reduce((t, [, w, v]) => t + w * v, 0));
    const passed = c.routes && c.capacity && c.storage && c.latency && c.avail && c.strong && c.balanced && costOk;
    return { r, tests, limit, costOk, parts, score, passed, letter: score >= 95 ? 'S' : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D', findings: review(design, brief, stage, r) };
  }

  /* Grow a design until it survives the given tests. Used by the game's reference solutions. */
  /* Scale a SQL database up before splitting it, the way teams do. With lock, never split it. */
  function bumpFit(n, r, lock) {
    if (n.type !== 'sql') return bump(n, r);
    const nx = normalize({ nodes: [n], edges: [] }).nodes[0], ceiling = lock ? 64 : 16;
    if (nx.cpu < ceiling) { n.cpu = nx.cpu * 2; n.ram = nx.ram * 2; n.disk = n.disk === undefined ? nx.disk : n.disk; return; }
    if (!lock) bump(n, r);
  }
  function fit(design, brief, stage, faultList, target, lock, faultTarget) {
    for (let i = 0; i < 400; i++) {
      const tests = [evaluate(design, brief, stage), ...faultList.map((f) => evaluate(design, brief, stage, f))];
      let changed = false;
      tests.forEach((r, ti) => design.nodes.forEach((n) => {
        if (n.type !== 'users' && r.nodes[n.id].util > (ti ? faultTarget || .93 : target || .7) && !(lock && n.type === 'sql' && n.cpu >= 64)) { bumpFit(n, r, lock); changed = true; }
      }));
      const b = tests[0];
      design.nodes.forEach((n) => {
        if (!lock && n.type === 'sql' && b.d.storageTB > b.stored) { n.shards += Math.ceil((b.d.storageTB - b.stored) / n.disk); changed = true; }
        if (!lock && n.type === 'nosql' && b.d.storageTB > b.stored) { n.count += Math.ceil(((b.d.storageTB - b.stored) * (n.rf || 3)) / n.disk); changed = true; }
        if (n.type === 'cache' && n.count < Math.ceil(n.memGB / 64)) { n.count = Math.ceil(n.memGB / 64); changed = true; }
      });
      if (!changed) break;
    }
    return design;
  }

  /* The next thing to build, derived from the brief's reference shape */
  function coach(design, brief, stage) {
    const sh = brief.shape, store = sh.store || 'sql', tpl = shapeDesign(brief, stage), steps = [];
    const list = (t) => design.nodes.filter((n) => n.type === t);
    const need = (type, from, text, why, lab) => steps.push({ type, from, text, why, lab, ok: list(type).some((n) => design.edges.some(([a, b]) => b === n.id && list(from).some((f) => f.id === a))) });
    const dynamic = brief.reads || brief.writes || brief.searches;
    need('lb', 'users', 'Add a load balancer and connect Users to it.', 'It gives traffic one entry point, and lets you add servers later.', 'lb');
    const front = sh.gateway ? 'gateway' : 'lb';
    if (sh.gateway) need('gateway', 'lb', 'Add an API gateway after the load balancer.', 'This brief has abusive or bursty traffic, so check and limit requests at the door.', 'gateway');
    if (dynamic) {
      need('app', front, 'Add app servers behind it.', 'Something has to run your code. These hold no data, so you can run many.', 'tradeoffs');
      need(store, 'app', `Add a ${TYPES[store].label} and connect the app servers to it.`, store === 'sql' ? 'This data needs transactions and strong consistency.' : 'This data is looked up by key at huge scale, so a horizontal store fits.', 'guide');
      if (sh.cache) need('cache', 'app', 'Add a cache beside the app servers.', 'Most reads ask for the same popular data, so memory can answer them.', 'cacheflow');
      if (sh.queue) {
        need('queue', 'app', 'Add a message queue after the app servers.', 'Slow or bursty work should not hold up the user.', 'kafka');
        need('worker', 'queue', 'Add workers to consume the queue.', 'A queue does nothing until something reads from it.', 'kafka');
        need(store, 'worker', `Connect the workers to the ${TYPES[store].label}.`, 'Queued work has to end up stored somewhere.', 'kafka');
      }
      if (sh.search) need('search', 'app', 'Add a search index.', 'Databases are poor at text search.', 'guide');
    }
    if (sh.cdn) { need('cdn', 'users', 'Add a CDN and connect Users to it.', 'Media should be served from near the user.', 'cdn'); need('blob', 'cdn', 'Add object storage behind the CDN.', 'The CDN needs an origin to fetch files from.', 'dfs'); }
    if (sh.ws) need('ws', 'lb', 'Add WebSocket servers.', 'Live messages need open connections.', 'realtime');
    const done = steps.filter((x) => x.ok).length, next = steps.find((x) => !x.ok);
    if (!next) return { done, total: steps.length, finished: true };
    return { done, total: steps.length, text: next.text, why: next.why, lab: next.lab, apply(d) {
      let n = d.nodes.find((x) => x.type === next.type);
      if (!n) { const t = tpl.nodes.find((x) => x.type === next.type); n = { ...DEFAULTS[next.type], id: next.type + Math.random().toString(36).slice(2, 7), type: next.type, x: t ? t.x : 187, y: t ? t.y : 33 }; d.nodes.push(n); }
      const f = d.nodes.find((x) => x.type === next.from);
      if (f && !d.edges.some(([a, b]) => a === f.id && b === n.id)) d.edges.push([f.id, n.id]);
    } };
  }

  function hwSpeed(n) {
    const hw = hwOf(n), base = { app: TYPES.app.cap, worker: TYPES.worker.cap, ws: TYPES.ws.cap, gateway: TYPES.gateway.cap, lb: TYPES.lb.cap, queue: TYPES.queue.cap, search: TYPES.search.cap }[n.type];
    if (n.type === 'sql') return `${Math.round(SQL.capR * hw.mul * hw.readMul).toLocaleString()} reads/s, ${Math.round(SQL.capW * hw.mul * hw.writeMul).toLocaleString()} writes/s`;
    if (n.type === 'nosql') return `${Math.round(NOSQL.capR * hw.mul * hw.readMul).toLocaleString()} reads/s, ${Math.round(NOSQL.capW * hw.mul * hw.writeMul).toLocaleString()} writes/s`;
    return `${Math.round(base * hw.mul).toLocaleString()} requests/s`;
  }
  const api = { AUTO_MAX, hwSpeed, setAssumptions, coach, fit, normalize, hwOf, hwPrice, HW, CPU_STEPS, RAM_STEPS, DISK_STEPS, TYPES, DEFAULTS, CLASSES, CHAOS, SQL, NOSQL, WHERE, LINKS, TIMEOUT_MS, CACHE_NODE_GB, sanitize, demand, evaluate, holds, breakPoint, stopper, chaos, solve, budget, review, grade };
  root.RTDesign = Object.assign(root.RTDesign || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
