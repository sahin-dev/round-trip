/* Load balancer, API gateway, proxies, CDN. */
(function () {
  const { h, s, ui, Net, hash, fmtMs } = RT;

  /* ----- Load balancer ----- */
  RT.lab({
    id: 'lb', title: 'Load Balancer', short: 'Load balancer', chapter: 'Load Balancing',
    lede: 'Requests pour in, and five servers of different sizes take them. Change the algorithm, kill a server, and see who suffers.',
    missions: [
      ['rr', 'Run round robin with mixed server sizes and see the small server fall behind.'],
      ['lc', 'Switch to least connections and bring wait times down.'],
      ['hash', 'Use IP hash and see each client stick to one server.'],
      ['kill', 'Click a server to kill it, and watch the health check remove it.'],
      ['spof', 'Kill the load balancer itself. There is no standby yet.'],
      ['ha', 'Turn on a standby load balancer and survive the same failure.'],
    ],
    notes: `<ul>
      <li>A <b>static</b> algorithm such as round robin ignores what servers are doing. A <b>dynamic</b> one such as least connections reacts to it.</li>
      <li><b>Health checks</b> take a dead server out of rotation, but only after they notice. Requests fail in that gap.</li>
      <li><b>IP hash</b> gives stickiness, but load can skew, and removing a server moves its users.</li>
      <li>A single load balancer is itself a <b>single point of failure</b>. Use an active-passive pair.</li>
    </ul>`,
    check: { q: 'Some requests take 10 seconds and others take 10 ms. Which algorithm copes best?', options: ['Round robin', 'Random', 'Least connections', 'Weighted round robin with equal weights'], answer: 2, why: 'Counting open connections reflects how busy each server really is. Turn-taking ignores how long each request lasts.' },
    render(root, ctx) {
      const specs = [[3, 'big'], [3, 'big'], [2, 'mid'], [2, 'mid'], [1, 'small']];
      const net = Net(ctx, { w: 900, h: 400, label: 'Clients, load balancer and five servers' });
      const clients = ['C1', 'C2', 'C3', 'C4'];
      clients.forEach((c, i) => net.node(c, { x: 70, y: 70 + i * 86, label: c, sub: '10.0.0.' + (11 + i), w: 92, h: 44 }));
      net.node('lb', { x: 350, y: 200, label: 'Load balancer', sub: 'active', w: 130, h: 60, onClick: toggleLb });
      net.node('lb2', { x: 350, y: 300, label: 'Standby', sub: 'passive', w: 130, h: 44, cls: 'hide' });
      clients.forEach((c) => net.link(c, 'lb'));
      const srv = specs.map((sp, i) => {
        const id = 'S' + (i + 1);
        net.node(id, { x: 700, y: 50 + i * 75, label: id + ' · ' + sp[1], sub: 'idle', w: 196, h: 54, onClick: () => toggleServer(i) });
        net.link('lb', id);
        return { id, cap: sp[0], active: 0, queue: 0, served: 0, up: true, inRot: true, down: 0, lat: 100, sumW: 0 };
      });
      const algo = ui.select({ id: 'lb-algo', label: 'Algorithm', value: 'rr', onChange: changed, options: [['rr', 'Round robin'], ['wrr', 'Weighted round robin'], ['lc', 'Least connections'], ['wlc', 'Weighted least connections'], ['hash', 'IP hash'], ['lrt', 'Least response time'], ['rand', 'Random']] });
      const rate = ui.slider({ id: 'lb-rate', label: 'Traffic', min: 1, max: 14, value: 6, fmt: (v) => v + ' req/s' });
      const hc = ui.slider({ id: 'lb-hc', label: 'Health check every', min: 1, max: 8, value: 3, fmt: (v) => v + ' s' });
      const standby = ui.toggle({ id: 'lb-ha', label: 'Standby load balancer', onChange(v) { net.nodes.lb2.g.classList.toggle('hide', !v); } });
      const sticky = h('div', { class: 'small muted' });
      const stats = ui.stats([['served', 'Served', 0], ['failed', 'Failed', 0], ['wait', 'Average latency', '–'], ['skew', 'Busiest vs idlest', '–']]);
      const banner = h('div', { class: 'banner', role: 'status' }, 'Traffic is flowing. Click any server to kill or revive it, or click the load balancer.');
      root.append(h('div', { class: 'controls' }, algo, rate, hc, standby, ui.btn('Reset counters', () => { served = failed = latSum = 0; srv.forEach((x) => { x.served = 0; }); })), banner, h('div', { class: 'stage' }, net.svg), stats, sticky);
      let rr = 0, wrrI = 0, served = 0, failed = 0, latSum = 0, spawn = 0, hcT = 0, lbUp = true, lbT = 0, last = {}, algoT = 0;
      const wrr = srv.flatMap((x, i) => Array(x.cap).fill(i));
      function changed() { served = failed = latSum = 0; algoT = 0; srv.forEach((x) => { x.served = 0; }); }
      function toggleLb() {
        lbUp = !lbUp;
        net.state('lb', lbUp ? '' : 'dead'); net.sub('lb', lbUp ? 'active' : 'down');
        if (!lbUp) {
          if (standby.checked) {
            ctx.after(900, () => { lbUp = true; net.state('lb', ''); net.label('lb', 'Load balancer B'); net.sub('lb', 'took over'); banner.className = 'banner ok'; banner.textContent = 'The standby saw the missing heartbeat and took over the virtual IP. Clients barely noticed.'; ctx.mission('ha'); });
          } else { banner.className = 'banner bad'; banner.textContent = 'All traffic has stopped. The servers are healthy, but nothing can reach them. This is a single point of failure.'; ctx.mission('spof'); }
        } else { banner.className = 'banner'; banner.textContent = 'Load balancer restored.'; }
      }
      function toggleServer(i) {
        const x = srv[i]; x.up = !x.up;
        if (x.up) { x.inRot = false; x.queue = 0; x.active = 0; net.state(x.id, ''); banner.textContent = `${x.id} is back. The next health check returns it to rotation.`; }
        else { net.state(x.id, 'dead'); net.sub(x.id, 'down'); banner.className = 'banner warn'; banner.textContent = `${x.id} is down, but the load balancer doesn't know yet. Requests sent to it fail until the next health check.`; }
      }
      function pick(cl) {
        const up = srv.filter((x) => x.inRot);
        if (!up.length) return null;
        const load = (x) => x.active + x.queue;
        switch (algo.value) {
          case 'rr': { const x = up[rr++ % up.length]; return x; }
          case 'wrr': { for (let n = 0; n < wrr.length; n++) { const x = srv[wrr[wrrI++ % wrr.length]]; if (x.inRot) return x; } return up[0]; }
          case 'lc': return up.reduce((a, b) => (load(b) < load(a) ? b : a));
          case 'wlc': return up.reduce((a, b) => (load(b) / b.cap < load(a) / a.cap ? b : a));
          case 'hash': return up[hash(cl) % up.length];
          case 'lrt': return up.reduce((a, b) => (b.lat * (1 + load(b)) < a.lat * (1 + load(a)) ? b : a));
          default: return up[Math.floor(Math.random() * up.length)];
        }
      }
      function fire() {
        const cl = clients[Math.floor(Math.random() * 4)];
        if (!lbUp) { failed++; return; }
        net.send(cl, 'lb', { color: 'req', r: 4, dur: 260, linear: true }).then(() => {
          const x = pick(cl);
          if (!x) { failed++; return; }
          if (algo.value === 'hash') { last[cl] = last[cl] || new Set(); last[cl].add(x.id); }
          net.send('lb', x.id, { color: 'req', r: 4, dur: 300, linear: true }).then((ok) => {
            if (!ok) return;
            if (!x.up) { failed++; net.flash(x.id, 'err', 200); return; }
            x.queue++;
            work(x, performance.now());
          });
        });
      }
      function work(x, t0) {
        const tryStart = () => {
          if (!ctx.alive()) return;
          if (!x.up) { x.queue = 0; failed++; return; }
          if (x.active >= x.cap) { ctx.after(60, tryStart); return; }
          x.queue--; x.active++;
          ctx.after(1000 + Math.random() * 500, () => {
            x.active = Math.max(0, x.active - 1);
            if (!x.up) { failed++; return; }
            const l = (performance.now() - t0) * 1; x.lat = x.lat * .8 + l * .2;
            served++; x.served++; latSum += l;
            net.send(x.id, 'lb', { color: 'res', r: 3, dur: 240, linear: true });
          });
        };
        tryStart();
      }
      ctx.loop((dt) => {
        spawn += dt * rate.value;
        while (spawn >= 1) { spawn--; fire(); }
        hcT += dt; algoT += dt; lbT += dt;
        if (hcT >= hc.value) {
          hcT = 0;
          srv.forEach((x) => {
            net.send('lb', x.id, { color: 'cache', r: 2.5, dur: 200, linear: true });
            if (!x.up && x.inRot) { x.inRot = false; banner.className = 'banner ok'; banner.textContent = `Health check found ${x.id} dead and removed it. Failures stop here.`; ctx.mission('kill'); }
            if (x.up && !x.inRot) { x.inRot = true; }
          });
        }
        if (lbT > .25) {
          lbT = 0;
          srv.forEach((x) => { if (x.up) { net.sub(x.id, `${x.active}/${x.cap} busy, ${x.queue} queued, ${x.served} done`); net.state(x.id, x.queue > 6 ? 'miss' : ''); } });
          const up = srv.filter((x) => x.up && x.served), max = up.length ? Math.max(...up.map((x) => x.served)) : 0, min = up.length ? Math.min(...up.map((x) => x.served)) : 0;
          stats.set('served', served); stats.set('failed', failed, failed ? 'bad' : ''); stats.set('wait', served ? fmtMs(latSum / served) : '–', served && latSum / served > 3000 ? 'bad' : ''); stats.set('skew', up.length > 1 ? `${max} / ${min}` : '–');
          const small = srv[4];
          if (algo.value === 'rr' && small.queue >= 5 && rate.value >= 5) ctx.mission('rr');
          if ((algo.value === 'lc' || algo.value === 'wlc') && algoT > 8 && served > 20 && latSum / served < 2500 && rate.value >= 5) ctx.mission('lc');
          if (algo.value === 'hash') {
            const sets = Object.entries(last).filter(([, v]) => v.size === 1);
            sticky.textContent = 'Stickiness: ' + Object.entries(last).map(([c, v]) => `${c} → ${[...v].join(', ')}`).join('   ');
            if (sets.length >= 3 && algoT > 6) ctx.mission('hash');
          } else sticky.textContent = '';
        }
      });
    },
  });

  /* ----- API gateway ----- */
  RT.lab({
    id: 'gateway', title: 'API Gateway', short: 'API gateway', chapter: 'API Gateway',
    lede: 'One front door for many services. Send requests through the pipeline and see which stage answers, blocks or forwards each one.',
    missions: [['ok', 'Get a request through to a backend service.'], ['401', 'Get blocked at authentication.'], ['429', 'Trip the rate limiter with a burst.'], ['cache', 'Get a response from the gateway cache.'], ['agg', 'Call the dashboard route and watch one request fan out to three services.']],
    notes: `<ul><li>Clients learn one address, and the gateway handles routing.</li><li>Cross-cutting work lives in one place: auth, rate limits, caching, logging, transformation.</li><li><b>Aggregation</b> turns several backend calls into one client call.</li><li>A load balancer spreads traffic across copies of one service. A gateway routes by meaning across different services.</li><li>The cost is one more hop, and one more thing that must stay up.</li></ul>`,
    check: { q: 'What separates an API gateway from a load balancer?', options: ['A gateway only works over UDP', 'A gateway understands requests and handles API concerns such as auth and routing', 'A load balancer stores data', 'There is no difference'], answer: 1, why: 'A load balancer distributes traffic. A gateway works at the API level. Real systems usually use both.' },
    render(root, ctx) {
      const stages = [['tls', 'TLS'], ['auth', 'Auth'], ['rate', 'Rate limit'], ['cache', 'Cache'], ['route', 'Route']];
      const net = Net(ctx, { w: 900, h: 330, label: 'API gateway pipeline' });
      net.node('client', { x: 64, y: 165, label: 'Client', sub: 'mobile app', w: 92 });
      stages.forEach(([id, t], i) => net.node(id, { x: 178 + i * 100, y: 165, label: t, sub: '', w: 88, h: 46 }));
      const svcs = [['users', 'Users', 60], ['orders', 'Orders', 165], ['search', 'Search', 270]];
      svcs.forEach(([id, t, y]) => { net.node(id, { x: 800, y, label: t + ' service', sub: '', w: 136 }); net.link('route', id); });
      net.link('client', 'tls'); stages.slice(1).forEach(([id], i) => net.link(stages[i][0], id));
      const route = ui.select({ id: 'gw-route', label: 'Route', value: 'GET /users/7', options: [['GET /users/7', 'GET /users/7'], ['GET /orders', 'GET /orders'], ['GET /search?q=tcp', 'GET /search?q=tcp'], ['GET /dashboard', 'GET /dashboard (aggregate)']] });
      const token = ui.toggle({ id: 'gw-token', label: 'Valid token', checked: true });
      const capS = ui.slider({ id: 'gw-limit', label: 'Rate limit', min: 2, max: 10, value: 5, fmt: (v) => v + ' tokens' });
      const log = ui.log({ max: 170 }), banner = h('div', { class: 'banner', role: 'status' }, 'Send a request. Each stage can answer it, block it, or pass it along.');
      const bucket = ui.bar('res');
      let tokens = 5, cache = new Map();
      const stats = ui.stats([['ok', '2xx responses', 0], ['bad', 'Blocked', 0], ['hit', 'Cache hits', 0], ['t', 'Last latency', '–']]);
      let okN = 0, badN = 0, hitN = 0;
      root.append(h('div', { class: 'controls' }, route, token, capS, ui.btn('Send request', () => send(), { kind: 'primary', id: 'gw-send' }), ui.btn('Burst of 10', burst, { id: 'gw-burst' }), ui.btn('Clear cache', () => cache.clear())), banner, h('div', { class: 'stage' }, net.svg), ui.card('Rate-limit bucket', bucket), stats, ui.card('Gateway log', log.el));
      ctx.every(1000, () => { tokens = Math.min(capS.value, tokens + 1); bucket.set((tokens / capS.value) * 100); });
      bucket.set(100);
      async function burst() { for (let i = 0; i < 10; i++) { send(); await ctx.sleep(110); } }
      async function send() {
        const r = route.value; let ms = 0;
        const fin = (code, kind, msg) => { log.add(`${code}  ${r}  ${msg}`, kind); banner.className = 'banner ' + (kind === 'bad' ? 'bad' : kind === 'cache' ? 'cache' : 'ok'); banner.textContent = `${code}: ${msg}`; stats.set('t', ms + ' ms'); };
        const step = async (a, b) => { await net.send(a, b, { label: '', color: 'req', dur: 220, linear: true }); ms += 3; };
        await step('client', 'tls'); net.flash('tls', 'on', 120);
        await step('tls', 'auth');
        if (!token.checked) { net.flash('auth', 'err'); await net.send('auth', 'client', { label: '401', color: 'bad', dur: 420 }); badN++; stats.set('bad', badN, 'bad'); fin(401, 'bad', 'Unauthorized. Blocked before reaching any service.'); ctx.mission('401'); return; }
        net.flash('auth', 'hit', 120);
        await step('auth', 'rate');
        if (tokens < 1) { net.flash('rate', 'err'); await net.send('rate', 'client', { label: '429', color: 'bad', dur: 420 }); badN++; stats.set('bad', badN, 'bad'); fin(429, 'bad', 'Too many requests. The bucket is empty, so wait for it to refill.'); ctx.mission('429'); return; }
        tokens--; bucket.set((tokens / capS.value) * 100); net.flash('rate', 'hit', 120);
        await step('rate', 'cache');
        if (cache.has(r) && cache.get(r) > performance.now()) { net.flash('cache', 'hit'); await net.send('cache', 'client', { label: '200', color: 'res', dur: 420 }); hitN++; okN++; stats.set('hit', hitN, 'good'); stats.set('ok', okN); fin(200, 'cache', 'Served from the gateway cache. No backend was touched.'); ctx.mission('cache'); return; }
        await step('cache', 'route');
        const target = r.includes('users') ? ['users'] : r.includes('orders') ? ['orders'] : r.includes('search') ? ['search'] : ['users', 'orders', 'search'];
        await Promise.all(target.map(async (t) => { await net.send('route', t, { color: 'req', dur: 300 }); net.flash(t, 'on', 240); await ctx.sleep(180); await net.send(t, 'route', { color: 'res', dur: 300 }); }));
        ms += 40 + target.length * 5;
        await net.send('route', 'client', { label: '200', color: 'res', dur: 520 });
        cache.set(r, performance.now() + 15000); okN++; stats.set('ok', okN);
        fin(200, 'res', target.length > 1 ? 'Three services answered, and the gateway merged them into one response.' : `Routed to ${target[0]}. Cached for 15 s.`);
        ctx.mission(target.length > 1 ? 'agg' : 'ok'); ctx.mission('ok');
      }
    },
  });

  /* ----- Proxies ----- */
  RT.lab({
    id: 'proxy', title: 'Proxy vs VPN', short: 'Proxies & VPN', chapter: 'Proxies',
    lede: 'Who can see what? Send one request four ways and compare what the Wi-Fi, the middle hop and the website each learn about you.',
    missions: [['direct', 'Send a request directly.'], ['fwd', 'Send through a forward proxy.'], ['rev', 'Send through a reverse proxy.'], ['vpn', 'Send through a VPN.']],
    notes: `<ul><li>A <b>forward proxy</b> acts for clients, so the website sees the proxy.</li><li>A <b>reverse proxy</b> acts for servers, so clients never see the backends. It gives you caching, TLS termination and load balancing.</li><li>A <b>VPN</b> encrypts all device traffic in a tunnel, not just one app's requests.</li></ul>`,
    check: { q: 'Which one hides your backend servers from the internet?', options: ['Forward proxy', 'Reverse proxy', 'VPN client', 'DNS resolver'], answer: 1, why: 'A reverse proxy sits in front of servers. Clients only ever talk to it.' },
    render(root, ctx) {
      const MODES = {
        direct: { path: ['you', 'wifi', 'site'], mid: null, say: 'A direct HTTPS connection. The Wi-Fi can\'t read the content, but it can see which site you visit. The site sees your IP.',
          sees: { 'Wi-Fi': ['Your IP', 'Site name', 'Not the content'], Middle: ['Not involved'], Website: ['Your IP', 'The content'] } },
        fwd: { path: ['you', 'wifi', 'mid', 'site'], mid: 'Forward proxy', say: 'Your app sends requests to the proxy, which fetches on your behalf. The site sees the proxy\'s IP, and the proxy sees everything you ask for.',
          sees: { 'Wi-Fi': ['Your IP', 'That you use a proxy', 'Not the content (if TLS to proxy)'], Middle: ['Your IP', 'Every site you visit'], Website: ['The proxy\'s IP', 'The content'] } },
        rev: { path: ['you', 'wifi', 'mid', 'back'], mid: 'Reverse proxy', say: 'You think you are talking to the website. The reverse proxy terminates TLS, and it may cache or balance across hidden backends.',
          sees: { 'Wi-Fi': ['Your IP', 'Site name', 'Not the content'], Middle: ['Your IP', 'The decrypted content'], Website: ['The proxy\'s internal IP', 'Your IP, only if forwarded in a header'] } },
        vpn: { path: ['you', 'wifi', 'mid', 'site'], mid: 'VPN server', say: 'All your device\'s traffic enters an encrypted tunnel. The Wi-Fi sees only the tunnel, and the VPN provider takes on the trust your ISP had.',
          sees: { 'Wi-Fi': ['Your IP', 'That you use a VPN', 'Nothing else'], Middle: ['Your IP', 'Every destination'], Website: ['The VPN\'s IP', 'The content'] } },
      };
      const seg = ui.seg('Path', [['direct', 'Direct'], ['fwd', 'Forward proxy'], ['rev', 'Reverse proxy'], ['vpn', 'VPN']], 'direct', () => go());
      const banner = h('div', { class: 'banner', role: 'status' });
      const stage = h('div', { class: 'stage' }), cards = h('div', { class: 'threecol' });
      root.append(h('div', { class: 'controls' }, ui.field('How to reach the site', seg), ui.btn('Send request', () => go(), { kind: 'primary', id: 'px-send' })), banner, stage, cards);
      let run = 0;
      async function go() {
        const me = ++run, m = MODES[seg.value];
        const net = Net(ctx, { w: 900, h: 170, label: 'Request path' });
        net.node('you', { x: 80, y: 90, label: 'You', sub: '203.0.113.5', w: 110 }).node('wifi', { x: 280, y: 90, label: 'Wi-Fi', sub: 'café network', w: 110 });
        const hasMid = !!m.mid;
        if (hasMid) net.node('mid', { x: 500, y: 90, label: m.mid, sub: '198.51.100.9', w: 128, cls: 'alt' });
        net.node('site', { x: 800, y: seg.value === 'rev' ? 44 : 90, label: 'Website', sub: seg.value === 'rev' ? 'backend A' : 'example.com', w: 124, h: 44 });
        if (seg.value === 'rev') net.node('back', { x: 800, y: 130, label: 'Backend B', sub: 'hidden', w: 124, h: 44 });
        net.link('you', 'wifi');
        if (hasMid) { net.link('wifi', 'mid'); net.link('mid', 'site'); if (seg.value === 'rev') net.link('mid', 'back'); } else net.link('wifi', 'site');
        stage.textContent = ''; stage.append(net.svg);
        banner.textContent = m.say;
        cards.textContent = '';
        Object.entries(m.sees).forEach(([who, list]) => cards.append(ui.card(who + ' sees', h('ul', { class: 'small', style: { margin: 0, paddingLeft: '17px' } }, list.map((t) => h('li', null, t))))));
        const col = seg.value === 'vpn' ? 'cache' : 'req';
        for (let i = 0; i + 1 < m.path.length; i++) {
          const inTunnel = seg.value === 'vpn' && i < 2;
          await net.send(m.path[i], m.path[i + 1], { label: inTunnel ? 'tunnel' : 'GET /', color: inTunnel ? col : 'req', dur: 520 });
          if (me !== run) return;
        }
        for (let i = m.path.length - 1; i > 0; i--) { await net.send(m.path[i], m.path[i - 1], { label: '200', color: 'res', dur: 400 }); if (me !== run) return; }
        ctx.mission(seg.value);
      }
      go();
    },
  });

  /* ----- CDN world ----- */
  const CITIES = { 'New York': [40.7, -74], 'San Francisco': [37.8, -122.4], 'São Paulo': [-23.5, -46.6], London: [51.5, -.1], Frankfurt: [50.1, 8.7], Lagos: [6.5, 3.4], Dubai: [25.2, 55.3], Mumbai: [19.1, 72.9], Singapore: [1.35, 103.8], Tokyo: [35.7, 139.7], Sydney: [-33.9, 151.2], Johannesburg: [-26.2, 28] };
  const POPS = ['San Francisco', 'New York', 'São Paulo', 'London', 'Frankfurt', 'Mumbai', 'Singapore', 'Tokyo', 'Sydney'];
  const ORIGIN = 'New York';
  /* Display offsets only, so neighbouring cities stay readable. Distances use true coordinates. */
  const NUDGE = { London: [-62, -6], Frankfurt: [46, -14], Dubai: [-34, 6], Mumbai: [40, -26], Lagos: [-20, 0], Singapore: [14, 30] };
  const km = (a, b) => { const r = Math.PI / 180, [la1, lo1] = CITIES[a], [la2, lo2] = CITIES[b]; const x = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  /* Light in fibre covers about 200 km per ms; real routes are longer, hence the 1.5 factor. */
  const rttMs = (a, b) => Math.round((km(a, b) * 1.5 * 2) / 200) + 4;

  RT.lab({
    id: 'cdn', title: 'CDN Map', short: 'CDN & anycast', chapter: 'CDN · DNS Load Balancing',
    lede: 'Click a city to request a file from there. The latency comes from real distances, and you decide what the edge servers already hold.',
    missions: [['miss', 'Get a cache miss. The edge fetches from the origin.'], ['hit', 'Request again from nearby and get an edge hit.'], ['push', 'Push the file to every edge, then see a first request hit.'], ['kill', 'Kill the nearest edge and let anycast reroute you.'], ['ttl', 'Expire the cache and pay for one slow request.']],
    notes: `<ul><li>The speed of light is a hard limit. The only real fix is moving content closer.</li><li><b>Pull CDN</b>: edges fetch on the first miss. It's simple, but the first user pays.</li><li><b>Push CDN</b>: you upload ahead of time. No first-miss penalty, but you pay to store everything everywhere.</li><li><b>Anycast</b>: many servers share one IP, and routing delivers you to the closest healthy one.</li></ul>`,
    check: { q: 'You publish a popular file that changes once a year. Which fits better?', options: ['Pull with very short TTLs', 'Push to the edges ahead of launch', 'No CDN', 'Serve only from the origin'], answer: 1, why: 'Push avoids a burst of misses at launch, and rarely changing files make storing them everywhere worthwhile.' },
    render(root, ctx) {
      const W = 900, H = 430, X = (lo) => ((lo + 170) / 340) * (W - 40) + 20, Y = (la) => ((72 - la) / 130) * (H - 40) + 20;
      const net = Net(ctx, { w: W, h: H, label: 'World map of CDN edge servers' });
      for (let la = -60; la <= 75; la += 15) net.back.append(s('line', { class: 'lnk', x1: 20, x2: W - 20, y1: Y(la), y2: Y(la), style: 'opacity:.18' }));
      for (let lo = -165; lo <= 165; lo += 30) net.back.append(s('line', { class: 'lnk', y1: 20, y2: H - 20, x1: X(lo), x2: X(lo), style: 'opacity:.18' }));
      const stateP = {};
      Object.entries(CITIES).forEach(([c, [la, lo]]) => {
        const isPop = POPS.includes(c);
        const short = c === 'San Francisco' ? 'S. Francisco' : c === 'Johannesburg' ? 'Joburg' : c;
        const [nx, ny] = NUDGE[c] || [0, 0];
        net.node(c, { x: X(lo) + nx, y: Y(la) + ny, label: short, sub: isPop ? 'edge: empty' : 'users only', w: 104, h: 40, onClick: () => clickCity(c) });
        if (isPop) stateP[c] = { up: true, has: false, exp: 0 };
      });
      const mode = ui.seg('Mode', [['pull', 'Pull'], ['push', 'Push']], 'pull');
      const off = ui.toggle({ id: 'cdn-off', label: 'Bypass CDN' });
      const ttl = ui.slider({ id: 'cdn-ttl', label: 'Edge TTL', min: 10, max: 120, step: 10, value: 60, fmt: (v) => v + ' s' });
      const pick = ui.select({ id: 'cdn-kill', label: 'Edge to toggle', value: 'London', options: POPS.map((p) => [p, p]) });
      const banner = h('div', { class: 'banner', role: 'status' }, `Origin server: ${ORIGIN}. Click any city on the map to request a file from there.`);
      const stats = ui.stats([['lat', 'This request', '–'], ['nocdn', 'Without a CDN', '–'], ['hits', 'Hit ratio', '–'], ['store', 'Edges storing the file', 0]]);
      root.append(h('div', { class: 'controls' }, ui.field('Mode', mode), ttl, off, ui.btn('Push to all edges', pushAll, { id: 'cdn-push' }), ui.btn('Expire everything', expire), pick, ui.btn('Kill / revive edge', toggleEdge, { kind: 'danger' })), banner, h('div', { class: 'stage' }, net.svg), stats);
      net.state(ORIGIN, 'alt');
      let hits = 0, reqs = 0, busy = false;
      const paint = () => {
        const n = performance.now(); let st = 0;
        POPS.forEach((p) => { const x = stateP[p], live = x.has && x.exp > n; if (live) st++; if (p !== ORIGIN || x.up) net.sub(p, !x.up ? 'edge: DOWN' : live ? `edge: cached ${Math.ceil((x.exp - n) / 1000)}s` : 'edge: empty'); net.state(p, !x.up ? 'dead' : live ? 'hit' : p === ORIGIN ? 'alt' : ''); });
        stats.set('store', st);
      };
      ctx.every(1000, paint);
      function pushAll() {
        if (mode.value !== 'push') mode.set('push');
        POPS.forEach((p) => { if (stateP[p].up) { stateP[p].has = true; stateP[p].exp = performance.now() + 3600000; net.send(ORIGIN, p, { color: 'cache', dur: 800 }); } });
        banner.className = 'banner cache'; banner.textContent = 'File pushed to every edge. Storage cost is now 9 copies, and no user pays a first-miss penalty.'; paint();
      }
      function expire() { POPS.forEach((p) => { if (stateP[p].has) stateP[p].exp = 0; }); paint(); armed = true; }
      let armed = false;
      function toggleEdge() { const x = stateP[pick.value]; x.up = !x.up; paint(); }
      async function clickCity(c) {
        if (busy) return; busy = true;
        const direct = rttMs(c, ORIGIN) + rttMs(c, ORIGIN);
        stats.set('nocdn', direct + ' ms');
        reqs++;
        if (off.checked) {
          await net.send(c, ORIGIN, { label: 'GET', color: 'bad', dur: 900 }); await net.send(ORIGIN, c, { label: 'file', color: 'bad', dur: 900 });
          stats.set('lat', direct + ' ms', 'bad'); banner.className = 'banner'; banner.textContent = `No CDN: two round trips to ${ORIGIN} add up to ${direct} ms.`; busy = false; return;
        }
        const live = POPS.filter((p) => stateP[p].up).sort((a, b) => rttMs(c, a) - rttMs(c, b));
        if (!live.length) { banner.className = 'banner bad'; banner.textContent = 'Every edge is down.'; busy = false; return; }
        const pop = live[0], nearest = POPS.slice().sort((a, b) => rttMs(c, a) - rttMs(c, b))[0], x = stateP[pop], now = performance.now();
        if (pop !== nearest) ctx.mission('kill');
        await net.send(c, pop, { label: 'anycast', color: 'req', dur: 600 });
        let lat = rttMs(c, pop) * 2;
        if (x.has && x.exp > now) {
          net.state(pop, 'hit'); hits++;
          await net.send(pop, c, { label: 'HIT', color: 'res', dur: 500 });
          stats.set('lat', lat + ' ms', 'good'); banner.className = 'banner ok';
          banner.textContent = `Edge hit in ${pop}: ${lat} ms, versus ${direct} ms from the origin. ${pop !== nearest ? `The nearest edge, ${nearest}, is down, so anycast moved you here without changing the IP.` : ''}`;
          ctx.mission(mode.value === 'push' && reqs >= 1 && !x.pulled ? 'push' : 'hit');
        } else {
          net.state(pop, 'miss');
          if (pop !== ORIGIN) { await net.send(pop, ORIGIN, { label: 'MISS', color: 'ref', dur: 700 }); await net.send(ORIGIN, pop, { label: 'file', color: 'ref', dur: 700 }); }
          lat += rttMs(pop, ORIGIN) * 2;
          x.has = true; x.pulled = true; x.exp = performance.now() + ttl.value * 1000;
          await net.send(pop, c, { label: 'file', color: 'res', dur: 500 });
          stats.set('lat', lat + ' ms', 'warn'); banner.className = 'banner warn';
          banner.textContent = `Edge miss in ${pop}: it fetched from ${ORIGIN} first, so this took ${lat} ms. The next user near here gets a hit.`;
          ctx.mission('miss'); if (armed) ctx.mission('ttl');
        }
        stats.set('hits', Math.round((hits / reqs) * 100) + '%'); paint(); busy = false;
      }
      paint();
    },
  });
})();
