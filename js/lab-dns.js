/* DNS Resolver lab. Walks the real delegation chain through Google Public DNS when
   the network allows it, and falls back to a labelled simulation when it does not. */
(function () {
  const { h, ui, Net, hash, fmtMs } = RT;
  const ROOTS = 'abcdefghijklm'.split('').map((c) => c + '.root-servers.net');
  const TLDS = new Set('com net org io dev app ai co edu gov mil info biz me tv us uk de fr jp in au ca br nl ru cn it es se no ch eu xyz online site tech'.split(' '));
  const PUBLIC_2LD = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'co.jp', 'co.in', 'com.br', 'co.nz']);
  const TYPE_NAME = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 15: 'MX', 16: 'TXT', 28: 'AAAA' };
  const strip = (n) => n.replace(/\.$/, '').toLowerCase();
  const dotted = (n) => (n === '.' ? '.' : n + '.');

  function parseName(raw) {
    let t = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0].replace(/\.$/, '');
    if (!t) return { err: 'Type a domain name first, such as www.example.com.' };
    if (t.length > 253) return { err: 'That name is longer than the 253 characters DNS allows.' };
    if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/.test(t)) return { err: 'Use letters, digits and hyphens, with at least one dot, such as example.com.' };
    return { name: t };
  }

  /* ----- live data via DNS-over-HTTPS ----- */
  async function doh(name, type) {
    const c = new AbortController(), tm = setTimeout(() => c.abort(), 5000);
    try {
      const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { signal: c.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(tm); }
  }
  async function liveZones(name, memo) {
    const labels = name.split('.'), sfx = [];
    for (let i = labels.length - 1; i >= 0; i--) sfx.push(labels.slice(i).join('.'));
    const res = await Promise.all(sfx.map((q) => memo[q] || (memo[q] = doh(q, 'NS').catch(() => null))));
    const zones = [{ zone: '.', ns: ROOTS[hash(name) % 13], count: 13, ttl: 518400 }];
    for (let i = 0; i < sfx.length; i++) {
      const r = res[i];
      if (!r) continue;
      if (r.Status === 3) break;
      const ans = r.Answer || [], ns = ans.filter((a) => a.type === 2 && strip(a.name) === sfx[i]);
      if (ns.length) zones.push({ zone: sfx[i], ns: strip(ns[0].data), count: ns.length, ttl: ns[0].TTL });
      if (ans.some((a) => a.type === 5)) break;
    }
    return zones;
  }
  async function liveLookup(name, type) {
    const main = await doh(name, type);
    if (main.Status !== 0 && main.Status !== 3) throw new Error('DNS status ' + main.Status);
    const all = (main.Answer || []).map((a) => ({ name: strip(a.name), type: TYPE_NAME[a.type] || 'TYPE' + a.type, ttl: a.TTL, data: a.type === 16 ? a.data : a.data.replace(/\.$/, '') }));
    const memo = {}, segments = [];
    let cur = name;
    for (let i = 0; i < 3; i++) {
      const rrs = all.filter((r) => r.name === cur), cn = rrs.find((r) => r.type === 'CNAME');
      segments.push({ name: cur, zones: await liveZones(cur, memo), rrs, cname: cn && cn.data });
      if (!cn) break;
      cur = cn.data;
    }
    const last = segments[segments.length - 1];
    const shown = new Set(segments.flatMap((sg) => sg.rrs));
    last.rrs = last.rrs.concat(all.filter((r) => !shown.has(r)));
    const soa = (main.Authority || []).find((a) => a.type === 6);
    return { source: 'live', status: main.Status === 3 ? 'NXDOMAIN' : all.some((r) => r.type === type) ? 'NOERROR' : 'NODATA', segments, answers: all, negTtl: soa ? soa.TTL : 300 };
  }

  /* ----- simulated data: documentation-range addresses, never presented as real ----- */
  function simZones(name) {
    const labels = name.split('.'), tld = labels[labels.length - 1];
    const zones = [{ zone: '.', ns: ROOTS[hash(name) % 13], count: 13, ttl: 518400 }];
    if (!TLDS.has(tld)) return zones;
    zones.push({ zone: tld, ns: tld === 'com' || tld === 'net' ? 'a.gtld-servers.net' : 'a.nic.' + tld, count: 6, ttl: 172800 });
    const two = labels.slice(-2).join('.');
    const reg = PUBLIC_2LD.has(two) ? labels.slice(-3).join('.') : two;
    if (labels.length >= reg.split('.').length) zones.push({ zone: reg, ns: 'ns1.' + reg, count: 2, ttl: 86400 });
    return zones;
  }
  function simLookup(name, type) {
    const zones = simZones(name), tld = name.split('.').pop();
    if (!TLDS.has(tld) || /nosuch|doesnotexist|nxdomain|invalid/.test(name)) {
      return { source: 'sim', status: 'NXDOMAIN', segments: [{ name, zones, rrs: [] }], answers: [], negTtl: 900 };
    }
    const reg = zones[zones.length - 1].zone, x = hash(name), ttl = [60, 300, 600, 3600][x % 4];
    const ip = (seed) => (seed % 2 ? '198.51.100.' : '203.0.113.') + (1 + seed % 254);
    const make = (owner) => {
      const y = hash(owner);
      if (type === 'A') return [{ name: owner, type, ttl, data: ip(y) }, { name: owner, type, ttl, data: ip(y >>> 8) }];
      if (type === 'AAAA') return [{ name: owner, type, ttl, data: '2001:db8::' + (y % 65535).toString(16) }];
      if (type === 'MX') return [{ name: owner, type, ttl, data: '10 mail.' + reg }];
      if (type === 'TXT') return [{ name: owner, type, ttl, data: '"v=spf1 -all"' }];
      return [{ name: owner, type, ttl, data: 'ns1.' + reg }, { name: owner, type, ttl, data: 'ns2.' + reg }];
    };
    if (name.startsWith('www.') && type !== 'NS') {
      const target = name.slice(4), cn = { name, type: 'CNAME', ttl: 3600, data: target }, rrs = make(target);
      return { source: 'sim', status: 'NOERROR', answers: [cn, ...rrs], negTtl: 900,
        segments: [{ name, zones, rrs: [cn], cname: target }, { name: target, zones: simZones(target), rrs }] };
    }
    const rrs = make(name);
    return { source: 'sim', status: 'NOERROR', answers: rrs, negTtl: 900, segments: [{ name, zones, rrs }] };
  }

  RT.lab({
    id: 'dns', title: 'DNS Resolver', short: 'DNS resolver', chapter: 'Domain Name System',
    lede: 'Type any domain and watch the question travel from your browser through the caches, then down from the root to the server that actually knows the answer.',
    missions: [
      ['cold', 'Resolve a name from cold and see every hop.'],
      ['cache', 'Resolve the same name again and get a cache hit.'],
      ['skip', 'Resolve a different domain in a zone you already visited, and skip the root.'],
      ['nx', 'Look up a name that does not exist.'],
      ['neg', 'Repeat that lookup and get a negative-cache hit.'],
      ['iter', 'Switch to iterative mode, so your device does the walking.'],
      ['expire', 'Skip ahead until a TTL runs out.'],
    ],
    notes: `<ul>
      <li><b>Recursive</b>: "get me the final answer." The resolver takes on all the work.</li>
      <li><b>Iterative</b>: "tell me the best you know." Each server answers or refers you onward.</li>
      <li>Root servers don't know IP addresses. They only know who runs each TLD. There are 13 named root identities, served by many anycast machines.</li>
      <li>Every record carries a <b>TTL</b>. It sets how long caches may reuse it, so it trades freshness against load.</li>
      <li>"No such name" gets cached too. That's <b>negative caching</b>.</li>
    </ul>`,
    check: { q: 'You change a site\'s A record, but some users still reach the old server an hour later. What is the likely cause?',
      options: ['The root servers have not updated yet', 'Resolvers cached the old record and its TTL has not run out', 'The TLD server is still holding the IP address', 'The browser is using iterative queries'], answer: 1,
      why: 'Resolvers may reuse a record until its TTL expires. Lowering the TTL before a migration shortens this window. Root and TLD servers only hold delegations, not your site\'s address.' },

    render(root, ctx) {
      let busy = false, offset = 0, net = null, lastNx = null;
      const t0 = RT.now();
      const now = () => (RT.now() - t0) / 1000 + offset;
      const caches = { browser: new Map(), os: new Map(), resolver: new Map(), resDeleg: new Map(), osDeleg: new Map() };

      const input = h('input', { type: 'text', id: 'dns-name', value: 'www.example.com', 'aria-label': 'Domain name', spellcheck: 'false', autocapitalize: 'off',
        onkeydown(e) { if (e.key === 'Enter') go(); } });
      const typeSeg = ui.seg('Record type', ['A', 'AAAA', 'MX', 'NS', 'TXT'].map((t) => [t, t]), 'A');
      const modeSeg = ui.seg('Query style', [['recursive', 'Recursive'], ['iterative', 'Iterative']], 'recursive');
      const srcSeg = ui.seg('Data source', [['live', 'Live DNS'], ['sim', 'Simulated']], 'live');
      const stepper = ctx.stepper();
      const run = ui.btn('Resolve', go, { kind: 'primary', id: 'dns-go' });
      const chips = h('div', { class: 'chips' }, ['www.example.com', 'github.com', 'www.wikipedia.org', 'bbc.co.uk', 'mail.google.com', 'nosuchname-qwxz.com', 'hello.notarealtld'].map((d) =>
        h('button', { class: 'chip', onclick() { input.value = d; go(); } }, d)));

      const nameBar = h('div', { class: 'mono', style: { fontSize: '19px', fontWeight: 600, overflowWrap: 'anywhere' } });
      const banner = h('div', { class: 'banner', role: 'status' }, 'Pick a name above and press Resolve. The first lookup starts with every cache empty.');
      const stage = h('div', { class: 'stage' });
      const stats = ui.stats([['hops', 'Servers contacted', 0], ['time', 'Lookup time (modelled)', '0 ms'], ['saved', 'Time saved by caches', '0 ms'], ['ttl', 'Answer TTL', '–']]);
      const log = ui.log({ max: 230 });
      const dig = h('pre', { class: 'dig' }, 'Run a lookup, then click any line in the trace to read the DNS message it carried.');
      const cacheBox = h('div', { class: 'scroll' });

      root.append(
        h('div', { class: 'controls' },
          ui.field('Domain name', input, 'grow'), run,
          ui.field('Record type', typeSeg), ui.field('Who does the walking', modeSeg), ui.field('Data', srcSeg), stepper.el),
        chips, nameBar, banner, stage, stats,
        h('div', { class: 'twocol' }, ui.card('Trace', log.el), ui.card('DNS message', dig)),
        ui.card('Caches (live TTL countdown)', cacheBox,
          h('div', { class: 'controls flat', style: { marginTop: '8px' } },
            ui.btn('Skip 5 minutes', () => skip(300)), ui.btn('Skip 1 hour', () => skip(3600)), ui.btn('Skip 2 days', () => skip(172800)),
            ui.btn('Clear all caches', () => { Object.values(caches).forEach((m) => m.clear()); drawCaches(); }, { kind: 'danger' }))),
      );

      function skip(sec) {
        const before = allEntries().filter((e) => e.left > 0).length;
        offset += sec;
        const after = allEntries().filter((e) => e.left > 0).length;
        if (after < before) { ctx.mission('expire'); RT.toast((before - after) + ' cached records expired'); }
        drawCaches();
      }
      function allEntries() {
        const rows = [], n = now();
        for (const [layer, m] of [['Browser', caches.browser], ['OS stub', caches.os], ['Resolver', caches.resolver]]) {
          m.forEach((e, k) => rows.push({ layer, name: k.split('|')[0], type: k.split('|')[1], data: e.neg ? 'NXDOMAIN (negative)' : e.rrs.map((r) => r.data).slice(0, 2).join(', '), left: e.exp - n, ttl: e.ttl, neg: e.neg }));
        }
        for (const [layer, m] of [['Resolver', caches.resDeleg], ['OS stub', caches.osDeleg]]) {
          m.forEach((e, k) => rows.push({ layer, name: k, type: 'NS', data: e.ns, left: e.exp - n, ttl: e.ttl }));
        }
        return rows;
      }
      function drawCaches() {
        const rows = allEntries().filter((e) => e.left > 0).sort((a, b) => a.layer.localeCompare(b.layer));
        cacheBox.textContent = '';
        if (!rows.length) { cacheBox.append(h('p', { class: 'muted small' }, 'All caches are empty. Lookups will walk the full chain.')); return; }
        const fmt = (s) => (s > 86400 ? (s / 86400).toFixed(1) + ' d' : s > 3600 ? (s / 3600).toFixed(1) + ' h' : Math.ceil(s) + ' s');
        cacheBox.append(h('table', { class: 'table' }, h('tr', null, ['Layer', 'Name', 'Type', 'Value', 'TTL left'].map((t) => h('th', null, t))),
          rows.map((r) => {
            const b = ui.bar(r.neg ? 'bad' : 'res'); b.set((r.left / r.ttl) * 100); b.style.height = '5px'; b.style.marginTop = '2px';
            return h('tr', null, h('td', null, r.layer), h('td', null, r.name), h('td', null, r.type), h('td', null, r.data), h('td', { style: { minWidth: '76px' } }, fmt(r.left), b));
          })));
      }
      drawCaches();
      ctx.every(1000, drawCaches);

      function paintName(name, active) {
        const labels = name.split('.');
        nameBar.textContent = '';
        labels.forEach((l, i) => {
          const sfx = labels.slice(i).join('.');
          nameBar.append(h('span', { style: active === sfx ? { background: 'var(--ref-soft)', color: 'var(--ref)', borderRadius: '2px' } : null }, l), '.');
        });
        nameBar.append(h('span', { style: active === '.' ? { background: 'var(--ref-soft)', color: 'var(--ref)', borderRadius: '2px' } : { color: 'var(--muted)' } }, ' (root)'));
      }

      function drawNet(zones, iterative) {
        const H = Math.max(320, zones.length * 78 + 34);
        net = Net(ctx, { w: 900, h: H, label: 'DNS resolution path' });
        const cy = H / 2;
        net.node('browser', { x: 78, y: cy, label: 'Browser', sub: 'cache: 60 s max', w: 122 })
          .node('os', { x: 256, y: cy, label: 'OS stub', sub: 'resolver client', w: 122 })
          .node('resolver', { x: 454, y: cy, label: 'Recursive resolver', sub: 'such as 8.8.8.8', w: 158, cls: iterative ? 'skip' : '' });
        net.link('browser', 'os').link('os', 'resolver');
        zones.forEach((z, i) => {
          const id = 'z' + i, y = (H * (i + .5)) / zones.length;
          const kind = z.zone === '.' ? 'Root' : i === zones.length - 1 ? 'Authoritative' : 'TLD / zone';
          net.node(id, { x: 768, y, label: (z.zone === '.' ? 'Root  .' : '.' + z.zone).slice(0, 26), sub: z.ns.slice(0, 28), w: 216, h: 54 });
          net.link(iterative ? 'os' : 'resolver', id);
          void kind;
        });
        stage.textContent = ''; stage.append(net.svg);
      }

      const fmtRR = (r) => `${dotted(r.name).padEnd(20)} ${String(r.ttl).padStart(6)} IN ${r.type.padEnd(5)} ${r.data}`;
      const showDig = (html) => { dig.innerHTML = html; };
      const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const digQ = (name, type, to, rd) => `<span class="c">;; QUERY to ${esc(to)}</span>\n<span class="c">;; flags: ${rd ? 'rd (recursion desired)' : 'none, so this is an iterative question'}</span>\n\n<span class="c">;; QUESTION SECTION</span>\n${esc(dotted(name))}   IN  ${type}`;

      function cacheGet(m, key) {
        const e = m.get(key);
        if (!e) return null;
        if (e.exp <= now()) { m.delete(key); return null; }
        return e;
      }
      function cachePut(m, key, data, cap) {
        const neg = data.status === 'NXDOMAIN';
        const raw = neg ? data.negTtl : Math.min(...(data.answers.length ? data.answers.map((a) => a.ttl) : [data.negTtl]));
        const ttl = Math.max(1, Math.min(cap || Infinity, raw));
        m.set(key, { rrs: data.answers, neg, ttl, exp: now() + ttl, status: data.status });
      }

      async function go() {
        if (busy) return;
        const p = parseName(input.value);
        if (p.err) { banner.className = 'banner bad'; banner.textContent = p.err; return; }
        const name = p.name, type = typeSeg.value, iterative = modeSeg.value === 'iterative', key = name + '|' + type;
        input.value = name; busy = true; run.disabled = true; log.clear(); paintName(name);
        stats.set('hops', 0); stats.set('time', '0 ms'); stats.set('saved', '0 ms'); stats.set('ttl', '–');
        banner.className = 'banner'; banner.textContent = 'Fetching the records for this name…';

        let data, srcNote = '';
        if (srcSeg.value === 'live') {
          try { data = await liveLookup(name, type); srcNote = 'Live records from Google Public DNS. Hop times are modelled.'; }
          catch {
            srcSeg.set('sim');
            data = simLookup(name, type);
            srcNote = 'Live DNS is blocked here, so this page switched to simulated data. Its addresses come from the reserved documentation ranges and are not real.';
          }
        } else { data = simLookup(name, type); srcNote = 'Simulated data. Addresses come from the reserved documentation ranges and are not real.'; }
        if (!ctx.alive()) return;

        const zoneMap = new Map();
        data.segments.forEach((sg) => sg.zones.forEach((z) => { if (!zoneMap.has(z.zone)) zoneMap.set(z.zone, z); }));
        const zones = [...zoneMap.values()];
        drawNet(zones, iterative);
        const nodeOf = (z) => 'z' + zones.findIndex((x) => x.zone === z.zone);

        let hops = 0, time = 0;
        const tally = (ms) => { time += ms; stats.set('time', fmtMs(time)); };
        const fullCost = zones.reduce((t, z, i) => t + 22 + (hash(z.zone) % 30) + i * 4, 18);
        const step = async (text, kind, msg) => { log.add(text, kind, msg ? () => showDig(msg) : null); if (msg) showDig(msg); await stepper.gate(); };
        const hopMs = (z) => 22 + (hash(z.zone) % 30);

        const finish = async (where, hitKind) => {
          const e = { browser: 'Browser', os: 'OS stub', resolver: 'Resolver' }[where];
          const neg = data.status === 'NXDOMAIN';
          const ans = data.answers.filter((a) => a.type === type).map((a) => a.data);
          const min = data.answers.length ? Math.min(...data.answers.map((a) => a.ttl)) : data.negTtl;
          stats.set('ttl', min + ' s');
          stats.set('saved', fmtMs(Math.max(0, fullCost - time)), time < fullCost * .6 ? 'good' : '');
          banner.className = 'banner ' + (hitKind === 'hit' ? 'cache' : neg ? 'bad' : 'ok');
          const lead = neg ? `${name} does not exist (NXDOMAIN).`
            : data.status === 'NODATA' ? `${name} exists but has no ${type} record.`
            : `${name} → ${ans.slice(0, 3).join(', ')}${ans.length > 3 ? ` and ${ans.length - 3} more` : ''}.`;
          banner.textContent = [lead, hitKind === 'hit' && `Answered from the ${e} cache.`, srcNote].filter(Boolean).join(' ');
          busy = false; run.disabled = false; drawCaches();
        };

        /* Browser cache */
        net.state('browser', 'on'); await ctx.sleep(380);
        const bHit = cacheGet(caches.browser, key);
        if (bHit) {
          net.state('browser', 'hit');
          await step(`Browser cache HIT for ${name}. No network traffic at all.`, 'cache');
          ctx.mission(bHit.neg ? 'neg' : 'cache'); if (bHit.neg && lastNx === name) ctx.mission('neg');
          return finish('browser', 'hit');
        }
        await step('Browser cache: miss. Asking the operating system.', 'req');
        net.state('browser', '');
        await net.send('browser', 'os', { label: 'getaddrinfo', color: 'req', dur: 420 });

        /* OS cache */
        net.state('os', 'on'); await ctx.sleep(300);
        const oHit = cacheGet(caches.os, key);
        if (oHit) {
          net.state('os', 'hit');
          await step(`OS stub cache HIT for ${name}.`, 'cache');
          await net.send('os', 'browser', { label: 'answer', color: 'res', dur: 420 });
          cachePut(caches.browser, key, data, 60);
          ctx.mission(oHit.neg ? 'neg' : 'cache');
          return finish('os', 'hit');
        }
        await step('OS cache: miss.', 'req');
        net.state('os', '');

        const walker = iterative ? 'os' : 'resolver';
        const deleg = iterative ? caches.osDeleg : caches.resDeleg;
        let cachedAtResolver = false;

        if (!iterative) {
          const m = digQ(name, type, 'your recursive resolver', true);
          await step('Stub → resolver: recursive query (RD=1). "Find me the final answer."', 'req', m);
          await net.send('os', 'resolver', { label: type + '? ' + name.slice(0, 18), color: 'req' }); tally(9); hops++; stats.set('hops', hops);
          net.state('resolver', 'on'); await ctx.sleep(320);
          const rHit = cacheGet(caches.resolver, key);
          if (rHit) { net.state('resolver', 'hit'); cachedAtResolver = true; await step(`Resolver cache HIT for ${name}.`, 'cache'); ctx.mission(rHit.neg ? 'neg' : 'cache'); }
          else await step('Resolver cache: miss. It will have to walk the hierarchy.', 'ref');
        } else {
          ctx.mission('iter');
          net.state('resolver', 'dead'); net.label('resolver', 'Resolver unused'); net.sub('resolver', 'your device walks');
          await step('Iterative mode: your device talks to each server itself.', 'ref');
        }

        if (!cachedAtResolver) {
          let skipped = false, walked = false;
          for (let si = 0; si < data.segments.length; si++) {
            const sg = data.segments[si];
            paintName(sg.name);
            if (si > 0) await step(`The answer was a CNAME alias. Restarting the lookup for ${sg.name}.`, 'ref');
            let start = 0;
            for (let i = sg.zones.length - 1; i > 0; i--) if (cacheGet(deleg, sg.zones[i].zone)) { start = i; break; }
            if (start > 0) {
              skipped = true;
              await step(`Delegation for ${sg.zones[start].zone} is already cached. Skipping everything above it.`, 'cache');
            }
            for (let i = start; i < sg.zones.length; i++) {
              const z = sg.zones[i], node = nodeOf(z), last = i === sg.zones.length - 1;
              walked = true;
              paintName(sg.name, z.zone);
              const qmsg = digQ(sg.name, type, `${z.ns} (${z.zone === '.' ? 'root' : z.zone} zone)`, false);
              await step(`${iterative ? 'Device' : 'Resolver'} → ${z.ns}: who knows ${sg.name}?`, 'req', qmsg);
              await net.send(walker, node, { label: type + '?', color: 'req' });
              hops++; stats.set('hops', hops); tally(hopMs(z));
              net.state(node, 'on'); await ctx.sleep(240);
              if (!last) {
                const nx = sg.zones[i + 1];
                const rmsg = `<span class="c">;; RESPONSE from ${esc(z.ns)}</span>\n<span class="c">;; status: NOERROR  flags: qr  (a referral, not an answer)</span>\n\n<span class="c">;; AUTHORITY SECTION: ask these servers next</span>\n${esc(fmtRR({ name: nx.zone, ttl: nx.ttl, type: 'NS', data: nx.ns }))}${nx.count > 1 ? `\n<span class="c">;; and ${nx.count - 1} more NS records</span>` : ''}`;
                net.state(node, 'miss');
                await net.send(node, walker, { label: 'ask ' + (nx.zone.length > 16 ? nx.zone.slice(0, 15) + '…' : '.' + nx.zone), color: 'ref' });
                deleg.set(nx.zone, { ns: nx.ns, ttl: nx.ttl, exp: now() + nx.ttl });
                await step(`Referral from ${z.zone === '.' ? 'root' : z.zone}: ask ${nx.ns}.`, 'ref', rmsg);
                net.state(node, '');
              } else {
                const nxd = data.status === 'NXDOMAIN', body = sg.rrs.length
                  ? `<span class="c">;; ANSWER SECTION</span>\n<span class="g">${sg.rrs.map((r) => esc(fmtRR(r))).join('\n')}</span>`
                  : `<span class="c">;; AUTHORITY SECTION</span>\n${esc(dotted(z.zone))} ${data.negTtl} IN SOA ${esc(z.ns)}`;
                const rmsg = `<span class="c">;; RESPONSE from ${esc(z.ns)}</span>\n<span class="${nxd ? 'b' : 'c'}">;; status: ${data.status === 'NODATA' ? 'NOERROR, no records of this type' : data.status}  flags: qr aa (authoritative)</span>\n\n${body}`;
                net.state(node, nxd ? 'err' : 'hit');
                await net.send(node, walker, { label: nxd ? 'NXDOMAIN' : sg.cname ? 'CNAME' : 'answer', color: nxd ? 'bad' : 'res' });
                await step(nxd ? `${z.ns} says this name does not exist.` : sg.cname ? `${z.ns} says ${sg.name} is an alias of ${sg.cname}.` : `${z.ns} gives the authoritative answer.`, nxd ? 'bad' : 'res', rmsg);
              }
            }
          }
          if (walked) ctx.mission('cold');
          if (skipped) ctx.mission('skip');
        }

        if (!iterative) {
          if (!cachedAtResolver) cachePut(caches.resolver, key, data);
          await net.send('resolver', 'os', { label: data.status === 'NXDOMAIN' ? 'NXDOMAIN' : 'answer', color: data.status === 'NXDOMAIN' ? 'bad' : 'res' });
          tally(9);
        }
        net.state('resolver', iterative ? 'dead' : '');
        cachePut(caches.os, key, data);
        await net.send('os', 'browser', { label: data.status === 'NXDOMAIN' ? 'not found' : 'answer', color: data.status === 'NXDOMAIN' ? 'bad' : 'res', dur: 420 });
        cachePut(caches.browser, key, data, 60);
        net.state('browser', data.status === 'NXDOMAIN' ? 'err' : 'hit');
        if (data.status === 'NXDOMAIN') { ctx.mission('nx'); lastNx = name; }
        await finish(cachedAtResolver ? 'resolver' : 'x', cachedAtResolver ? 'hit' : 'miss');
      }

      paintName('www.example.com');
      drawNet([{ zone: '.', ns: 'a.root-servers.net' }, { zone: 'com', ns: 'a.gtld-servers.net' }, { zone: 'example.com', ns: 'a.iana-servers.net' }], false);
    },
  });
})();
