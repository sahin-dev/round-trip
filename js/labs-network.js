/* HTTP versions and URL anatomy. */
(function () {
  const { h, ui, seeded, fmtMs } = RT;
  const FILES = [['index.html', 40], ['app.css', 60], ['app.js', 220], ['hero.jpg', 340], ['logo.svg', 12], ['font.woff2', 80], ['chart.js', 150], ['photo1.jpg', 180], ['photo2.jpg', 180], ['analytics.js', 45], ['icons.svg', 24], ['data.json', 30]];
  const BW = 3; /* KB per ms */

  function simulate(ver, rtt, lossPct, tls, seed) {
    const rnd = seeded(seed), loss = lossPct / 100, secure = tls || ver === 'h3';
    const setup = ver === 'h3' ? rtt : rtt * (secure ? 2 : 1);
    const lostIn = (kb) => { let n = 0; for (let p = 0; p < Math.ceil(kb / 15); p++) if (rnd() < loss) n++; return n; };
    const out = [];
    const html = FILES[0], hl = lostIn(html[1]), hRec = hl * rtt * 1.5;
    const hEnd = setup + rtt + html[1] / BW + hRec;
    out.push({ name: html[0], conn: setup, wait: rtt, dl: html[1] / BW + hRec, start: 0, lane: 0, lost: hl });
    const assets = FILES.slice(1);
    if (ver === 'h1.0' || ver === 'h1.1') {
      const slots = Array.from({ length: 6 }, (_, i) => ({ free: i === 0 ? hEnd : hEnd, used: i === 0 }));
      assets.forEach((f) => {
        const sl = slots.reduce((a, b) => (b.free < a.free ? b : a));
        const conn = ver === 'h1.0' || !sl.used ? setup : 0, l = lostIn(f[1]), dl = f[1] / BW + l * rtt * 1.5;
        out.push({ name: f[0], conn, wait: rtt, dl, start: sl.free, lane: slots.indexOf(sl), lost: l });
        sl.free += conn + rtt + dl; sl.used = true;
      });
    } else {
      /* One connection. Streams share the bandwidth fairly. */
      const start = hEnd, sizes = assets.map((f) => f[1] / BW), lostN = assets.map((f) => lostIn(f[1]));
      const order = sizes.map((v, i) => i).sort((a, b) => sizes[a] - sizes[b]);
      let t = 0, prev = 0; const ends = [];
      order.forEach((i, k) => { t += (sizes[i] - prev) * (order.length - k); prev = sizes[i]; ends[i] = t; });
      if (ver === 'h2') {
        /* Each loss stalls every stream: TCP cannot hand over later bytes until the gap is filled. */
        const stalls = []; lostN.forEach((n, i) => { for (let j = 0; j < n; j++) stalls.push(rnd() * ends[i]); });
        assets.forEach((f, i) => { const hits = stalls.filter((x) => x < ends[i]).length; out.push({ name: f[0], conn: 0, wait: rtt, dl: ends[i] + hits * rtt * 1.5, start, lane: 0, lost: lostN[i], stall: hits }); });
      } else {
        assets.forEach((f, i) => out.push({ name: f[0], conn: 0, wait: rtt, dl: ends[i] + lostN[i] * rtt * 1.5, start, lane: 0, lost: lostN[i] }));
      }
    }
    const total = Math.max(...out.map((r) => r.start + r.conn + r.wait + r.dl));
    const conns = ver === 'h1.0' ? FILES.length : ver === 'h1.1' ? 6 : 1;
    return { rows: out, total, conns, handshakes: conns };
  }

  RT.lab({
    id: 'http', title: 'HTTP Versions', short: 'HTTP 1 to 3', chapter: 'Network Essentials',
    lede: 'Load the same page over HTTP/1.0, 1.1, 2 and 3. Then add packet loss and see which version holds up.',
    missions: [
      ['all', 'Compare a waterfall from each of the four versions.'],
      ['loss', 'Raise loss to 3% or more and see HTTP/2 lose its lead over HTTP/3.'],
      ['rtt', 'Set RTT to 200 ms and see how much connection setup costs.'],
    ],
    notes: `<ul>
      <li><b>1.0</b>: a new connection for every file.</li>
      <li><b>1.1</b>: connections stay open, but each carries one response at a time, so browsers open about 6.</li>
      <li><b>2</b>: many streams share one connection, with binary framing and header compression.</li>
      <li><b>3</b>: runs on QUIC over UDP. TLS 1.3 is built in, and a lost packet stalls only its own stream.</li>
      <li>HTTP/2 fixes head-of-line blocking at the HTTP layer, but TCP still has it. A lost packet stalls every stream on the connection. That is the gap HTTP/3 closes.</li>
    </ul>`,
    check: { q: 'On a flaky mobile network, why can HTTP/3 beat HTTP/2?',
      options: ['UDP has no packet loss', 'A lost packet stalls one stream, not the whole connection', 'It sends smaller images', 'It uses more connections'], answer: 1,
      why: 'QUIC tracks loss per stream. HTTP/2 multiplexes over one TCP stream, so a single gap blocks everything behind it.' },
    render(root, ctx) {
      const seen = new Set();
      let seed = 7;
      const ver = ui.seg('Version', [['h1.0', 'HTTP/1.0'], ['h1.1', 'HTTP/1.1'], ['h2', 'HTTP/2'], ['h3', 'HTTP/3']], 'h1.1', draw);
      const rtt = ui.slider({ id: 'http-rtt', label: 'RTT', min: 10, max: 300, step: 10, value: 60, fmt: (v) => v + ' ms', onInput: draw });
      const loss = ui.slider({ id: 'http-loss', label: 'Packet loss', min: 0, max: 8, step: .5, value: 0, fmt: (v) => v + '%', onInput: draw });
      const tls = ui.toggle({ id: 'http-tls', label: 'HTTPS (adds TLS setup)', checked: true, onChange: draw });
      const stats = ui.stats([['h1.0', 'HTTP/1.0'], ['h1.1', 'HTTP/1.1'], ['h2', 'HTTP/2'], ['h3', 'HTTP/3']]);
      const wf = h('div', { class: 'wf' });
      const legend = h('p', { class: 'small muted' }, h('span', { style: { color: 'var(--cache)' } }, '■ connect + TLS  '), h('span', { style: { color: 'var(--ref)' } }, '■ waiting  '), h('span', { style: { color: 'var(--req)' } }, '■ downloading'));
      const say = h('div', { class: 'banner' });
      root.append(h('div', { class: 'controls' }, ui.field('Show waterfall for', ver), rtt, loss, tls, ui.btn('New random losses', () => { seed++; draw(); })), stats, say, ui.card('Waterfall', wf, legend));
      function draw() {
        const results = {};
        ['h1.0', 'h1.1', 'h2', 'h3'].forEach((v) => { results[v] = simulate(v, rtt.value, loss.value, tls.checked, seed); });
        const best = Math.min(...Object.values(results).map((r) => r.total));
        Object.entries(results).forEach(([v, r]) => stats.set(v, fmtMs(r.total), r.total === best ? 'good' : ''));
        const r = results[ver.value], max = r.total;
        seen.add(ver.value); if (seen.size === 4) ctx.mission('all');
        if (loss.value >= 3 && results.h3.total < results.h2.total) ctx.mission('loss');
        if (rtt.value >= 200) ctx.mission('rtt');
        say.textContent = `${ver.value.toUpperCase().replace('H', 'HTTP/')} used ${r.conns} connection${r.conns > 1 ? 's' : ''}, so ${r.handshakes} handshake${r.handshakes > 1 ? 's' : ''}. ${r.rows.reduce((t, x) => t + x.lost, 0)} packets were lost.`;
        wf.textContent = '';
        r.rows.forEach((x) => {
          const pct = (v) => (v / max) * 100 + '%';
          const seg = (left, w, c) => w > 0 && h('i', { class: 'c-' + c, style: { left: pct(left), width: pct(w) } });
          wf.append(h('div', { class: 'wfrow' }, h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, x.name), h('div', { class: 'wftrack' }, seg(x.start, x.conn, 'cache'), seg(x.start + x.conn, x.wait, 'ref'), seg(x.start + x.conn + x.wait, x.dl, x.stall ? 'bad' : 'req')), h('span', { class: 'ms' }, fmtMs(x.start + x.conn + x.wait + x.dl))));
        });
        if (ver.value === 'h2' && r.rows.some((x) => x.stall)) wf.append(h('p', { class: 'small muted' }, 'Red bars were stalled by a loss in another stream.'));
      }
      draw();
    },
  });

  /* ----- URL anatomy ----- */
  const EX = ['https://ana@shop.example.com:8443/cart/items?id=42&ref=mail#reviews', 'http://example.com', 'urn:isbn:0451450523', 'mailto:help@example.com', 'ftp://files.example.org/report.pdf', '/docs/page.html', 'urn:uuid:6e8bc430-9c3a-11d9-9669-0800200c9a66'];
  RT.lab({
    id: 'url', title: 'URL, URI, URN', short: 'URL anatomy', chapter: 'Network Essentials',
    lede: 'Paste any address and see it split into parts. Then find out whether it says where something is, what it is called, or both.',
    missions: [['url', 'Dissect a URL with a port and a query string.'], ['urn', 'Try a URN, which names a thing without saying where it is.'], ['bad', 'Enter something that is not a valid absolute URI.']],
    notes: `<ul><li><b>URI</b>: any string that identifies a resource. The umbrella term.</li><li><b>URL</b>: a URI that says <i>where</i> a resource is and how to reach it.</li><li><b>URN</b>: a URI that gives a stable <i>name</i>, whatever its location.</li><li>Every URL is a URI, but not every URI is a URL.</li></ul>`,
    check: { q: 'urn:isbn:0451450523 identifies a book. What is it?', options: ['A URL only', 'A URN, and therefore a URI', 'Neither', 'A domain name'], answer: 1, why: 'It names the book without saying where to find a copy.' },
    render(root, ctx) {
      const input = h('input', { type: 'text', id: 'url-in', value: EX[0], 'aria-label': 'Address', spellcheck: 'false', oninput: draw });
      const chips = h('div', { class: 'chips' }, EX.map((e) => h('button', { class: 'chip', onclick() { input.value = e; draw(); } }, e.length > 38 ? e.slice(0, 37) + '…' : e)));
      const show = h('div', { class: 'mono', style: { fontSize: '17px', overflowWrap: 'anywhere', lineHeight: 1.9 } });
      const verdict = h('div', { class: 'banner' });
      const table = h('div', { class: 'scroll' });
      root.append(h('div', { class: 'controls' }, ui.field('Address', input, 'grow')), chips, ui.card('Parts', show), verdict, ui.card('What each part does', table));
      function draw() {
        const v = input.value.trim(); show.textContent = ''; table.textContent = '';
        let u = null;
        try { u = new URL(v); } catch { /* relative or invalid */ }
        if (!u) { verdict.className = 'banner warn'; verdict.textContent = 'This is not an absolute URI, because it has no scheme. It may still work as a relative reference inside a page.'; show.textContent = v; ctx.mission('bad'); return; }
        const paint = (t, c) => t && show.append(h('span', { style: { background: `var(--${c}-soft)`, padding: '2px 1px', borderRadius: '2px' }, title: c }, t));
        const parts = [];
        const add = (name, val, why, c) => { if (val) { paint(val, c); parts.push([name, val, why]); } };
        const hier = u.protocol !== 'urn:' && u.protocol !== 'mailto:';
        add('Scheme', u.protocol, 'How to interpret the rest', 'req');
        if (hier) {
          show.append('//');
          if (u.username) { add('User info', u.username + '@', 'Optional login name. Rarely used today', 'bad'); }
          add('Host', u.hostname, 'Which machine. DNS turns this into an IP address', 'ok');
          if (u.port) add('Port', ':' + u.port, 'Which service. Defaults: 80 for http, 443 for https', 'ref');
          add('Path', u.pathname, 'Which resource on that host', 'cache');
          add('Query', u.search, 'Parameters for the server', 'ref');
          add('Fragment', u.hash, 'A spot inside the page. Browsers never send this to the server', 'bad');
        } else add('Name', u.pathname, u.protocol === 'urn:' ? 'A name inside a namespace, with no location' : 'The address for this scheme', 'ok');
        const urn = u.protocol === 'urn:';
        verdict.className = 'banner ok';
        verdict.textContent = urn ? `URN and URI. It names something in the "${u.pathname.split(':')[0]}" namespace, and it tells you nothing about where to find it.`
          : hier ? 'URL and URI. It tells you how to reach the resource and where it is.' : 'URI. This scheme identifies a resource without using host-and-path form.';
        if (urn) ctx.mission('urn');
        if (hier && u.search && u.port) ctx.mission('url');
        table.append(h('table', { class: 'table' }, h('tr', null, h('th', null, 'Part'), h('th', null, 'Value'), h('th', null, 'Purpose')), parts.map((p) => h('tr', null, h('td', null, p[0]), h('td', null, p[1]), h('td', { style: { fontFamily: 'var(--body)' } }, p[2])))));
      }
      draw();
    },
  });
})();
