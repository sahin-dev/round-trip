/* Home: the "press Enter" waterfall and the index of topics. */
(function () {
  const { h, ui, fmtMs, hash } = RT;
  const say = (en, bn) => (RT.settings.lang === 'bn' ? bn : en);
  const FLAGSHIP = new Set(['roadmap', 'map', 'studio', 'playbook', 'dns', 'tcp', 'tls']);

  RT.home = function (main, ctx) {
    const url = h('input', { type: 'text', id: 'home-url', value: 'https://www.example.com/', 'aria-label': 'Address to visit', spellcheck: 'false', autocapitalize: 'off', onkeydown(e) { if (e.key === 'Enter') go(); } });
    const rtt = ui.slider({ id: 'home-rtt', label: 'Round-trip time', min: 10, max: 300, step: 10, value: 80, fmt: (v) => v + ' ms', onInput: go });
    const proto = ui.seg('HTTP version', [['h1', 'HTTP/1.1'], ['h2', 'HTTP/2'], ['h3', 'HTTP/3']], 'h2', go);
    const tlsV = ui.seg('TLS version', [['13', 'TLS 1.3'], ['12', 'TLS 1.2']], '13', go);
    const dnsC = ui.toggle({ id: 'home-dns', label: 'DNS cached', onChange: go });
    const cdn = ui.toggle({ id: 'home-cdn', label: 'Served by a nearby CDN edge', onChange: go });
    const wf = h('div', { class: 'wf' }), total = h('p', { class: 'small', role: 'status' });
    const PHASES = [['dns', 'DNS lookup', 'dns', 'ref'], ['tcp', 'TCP handshake', 'tcp', 'cache'], ['tls', 'TLS handshake', 'tls', 'req'], ['req', 'Request sent', 'http', 'ref'], ['srv', 'Server thinking', 'lb', 'mute'], ['dl', 'Response arrives', 'http', 'res']];
    function go() {
      let host = 'example.com', https = true, err = '';
      try {
        const raw = url.value.trim(), u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw);
        host = u.hostname; https = u.protocol === 'https:';
      } catch { err = 'That does not look like an address. Try example.com.'; }
      const edge = cdn.checked, r = edge ? Math.max(8, rtt.value * .15) : rtt.value, quic = proto.value === 'h3';
      const dnsT = dnsC.checked ? 0 : 25 + (hash(host) % 70);
      const tcpT = quic ? 0 : r;
      const tlsT = !https && !quic ? 0 : quic ? r : tlsV.value === '12' ? r * 2 : r;
      const srv = edge ? 4 : 60, dl = Math.max(12, 110 - (edge ? 40 : 0));
      const seq = { dns: dnsT, tcp: tcpT, tls: tlsT, req: r / 2, srv, dl: r / 2 + dl };
      const sum = Object.values(seq).reduce((a, b) => a + b, 0);
      wf.textContent = '';
      let at = 0;
      const rows = PHASES.map(([id, name, link, color]) => {
        const v = seq[id], bar = h('i', { class: 'c-' + color, style: { left: (at / sum) * 100 + '%', width: '0' } }), target = (v / sum) * 100;
        const label = id === 'tls' && quic ? 'QUIC + TLS' : name;
        at += v;
        wf.append(h('div', { class: 'wfrow' }, h('a', { href: '#' + link }, label), h('div', { class: 'wftrack' }, bar), h('span', { class: 'ms' }, v ? fmtMs(v) : 'skipped')));
        return [bar, target];
      });
      requestAnimationFrame(() => rows.forEach(([b, t], i) => { setTimeout(() => { b.style.width = t + '%'; }, i * 90); }));
      const notes = [];
      if (!https && !quic) notes.push('Plain HTTP: anyone on the path can read this.');
      if (quic) notes.push('QUIC folds the transport and TLS handshakes into one round trip.');
      if (edge) notes.push('The edge is close by, so every round trip shrinks.');
      total.textContent = err || `First byte of ${host} after ${fmtMs(sum - seq.dl + r / 2)}, full response after ${fmtMs(sum)}. These timings are modelled from your settings. ${notes.join(' ')}`;
    }

    const filter = RT.levelFilter(main);
    main.append(
      h('section', { class: 'hero' },
        h('h1', null, 'Press Enter'),
        h('p', { class: 'lede' }, 'A dozen systems work together between your keypress and the page. Run the whole trip below, take any stage apart in the labs, then design your own system in the Studio.'),
        h('div', { class: 'urlbar' }, url, ui.btn('Press Enter', go, { kind: 'primary', id: 'home-go' }))),
      RT.homeCard(),
      RT.homeRoadmap(),
      h('div', { class: 'facts', role: 'list' }, [[String(RT.labs.filter((l) => RT.hasTheory && RT.hasTheory(l)).length), say('topics with theory', 'তত্ত্বসহ বিষয়')], [String(RT.labs.filter((l) => !l.plain && !l.theoryOnly && RT.hasTheory && RT.hasTheory(l)).length), say('hands-on labs', 'হাতে-কলমে ল্যাব')], [String((window.RTWalks || []).length), say('worked designs', 'সমাধান করা ডিজাইন')], ['8', say('design briefs', 'ডিজাইন ব্রিফ')], ['10', say('game episodes', 'গেমের পর্ব')], [String(RT.labs.filter((l) => l.check).length), say('review questions', 'রিভিউ প্রশ্ন')], [String(window.RTLearn.GLOSSARY.length), say('terms explained', 'ব্যাখ্যা করা শব্দ')]].map(([n, l]) => h('div', { role: 'listitem' }, h('b', null, n), l))),
      h('div', { class: 'labmain' },
        h('div', { class: 'controls' }, rtt, ui.field('HTTP', proto), ui.field('TLS', tlsV), dnsC, cdn),
        ui.card('One page load', wf, h('div', { style: { height: '6px' } }), total)),
      filter.el,
      ...RT.TRACKS.map(([name, ids]) => h('section', { class: 'hometrack' }, h('h2', null, name), h('div', { class: 'panelgrid' }, ids.filter((i) => RT.byId[i]).map((id) => {
        const l = RT.byId[id];
        const lv = RT.levelOf(id);
        return h('a', { class: 'labcard ' + (FLAGSHIP.has(id) ? 'flag' : ''), href: '#' + id, 'data-lv': lv }, h('b', null, h('i', { class: RT.ledClass(l) }), RT.labText(l, 'short')), lv > 1 && h('span', { class: 'lv lv' + lv }, RT.levelName(lv)), h('span', null, (RT.explainFor(l) || {}).what || RT.labText(l, 'lede').split(/(?<=[.?!।])\s/)[0]));
      })))),
    );
    filter.apply();
    go();
  };
})();
