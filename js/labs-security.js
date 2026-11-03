/* JWT and auth, DDoS. */
(function () {
  const { h, s, ui, Ladder, hmac, utf8 } = RT;
  const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const b64uText = (t) => b64u(utf8(t));
  const unb64 = (t) => { const raw = atob(t.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))); };

  function jwtTab(root, ctx) {
    const secret = h('input', { type: 'text', id: 'jw-secret', value: 'server-only-secret', 'aria-label': 'Server secret', oninput: sign });
    const payload = h('textarea', { id: 'jw-pay', rows: 5, 'aria-label': 'Payload', oninput: sign });
    const now = Math.floor(Date.now() / 1000);
    payload.value = JSON.stringify({ sub: 'user-42', name: 'Ana', role: 'viewer', exp: now + 3600 }, null, 2);
    const tokenBox = h('div', { class: 'mono', style: { overflowWrap: 'anywhere', fontSize: '13.5px', lineHeight: 1.5 } });
    const edit = h('textarea', { id: 'jw-token', rows: 4, 'aria-label': 'Token sent to the server', spellcheck: 'false' });
    const route = ui.select({ id: 'jw-route', label: 'Endpoint', value: 'read', options: [['read', 'GET /articles (viewer)'], ['admin', 'DELETE /users/7 (admin only)']] });
    const out = h('div', { class: 'banner', role: 'status' }, 'Send the token to the server. Then change "viewer" to "admin" inside the token and try again.');
    root.append(h('div', { class: 'twocol' },
      ui.card('Issue a token', ui.field('Payload (claims)', payload), h('div', { style: { height: '8px' } }), ui.field('Server secret', secret), h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'Signed with real HMAC-SHA256.')),
      ui.card('The JWT', tokenBox, h('div', { style: { height: '8px' } }), h('p', { class: 'small muted' }, h('span', { style: { color: 'var(--bad)' } }, 'header'), ' . ', h('span', { style: { color: 'var(--cache)' } }, 'payload'), ' . ', h('span', { style: { color: 'var(--req)' } }, 'signature'), '. The first two parts are only encoded, so anyone can read them.'))),
      ui.card('Request', ui.field('Token as sent by the client (edit it to tamper)', edit), h('div', { class: 'controls flat', style: { marginTop: '8px' } }, route, ui.btn('Send', verify, { kind: 'primary', id: 'jw-send' }), ui.btn('Tamper: make me admin', tamper, { kind: 'danger', id: 'jw-tamper' }), ui.btn('Use a fresh token', () => { edit.value = current; }))), out);
    let current = '';
    function signPart(data) { return b64u(hmac(utf8(secret.value), utf8(data))); }
    function sign() {
      const head = b64uText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      let body; try { body = JSON.stringify(JSON.parse(payload.value)); } catch { tokenBox.textContent = 'The payload is not valid JSON.'; return; }
      const b = b64uText(body), sig = signPart(head + '.' + b);
      current = `${head}.${b}.${sig}`; edit.value = current; tokenBox.textContent = '';
      tokenBox.append(h('span', { style: { color: 'var(--bad)' } }, head), '.', h('span', { style: { color: 'var(--cache)' } }, b), '.', h('span', { style: { color: 'var(--req)' } }, sig));
    }
    function tamper() {
      const [a, b, c] = edit.value.split('.');
      const claims = JSON.parse(unb64(b)); claims.role = 'admin';
      edit.value = `${a}.${b64uText(JSON.stringify(claims))}.${c}`;
      out.className = 'banner warn'; out.textContent = 'The payload now says admin. The client can edit it freely. Press Send to see what the server thinks.';
    }
    function verify() {
      const parts = edit.value.trim().split('.');
      const fail = (code, msg) => { out.className = 'banner bad'; out.textContent = `${code}: ${msg}`; };
      if (parts.length !== 3) return fail(401, 'That is not a three-part token.');
      if (signPart(parts[0] + '.' + parts[1]) !== parts[2]) { ctx.mission('forge'); return fail(401, 'Signature mismatch. The token changed after signing, and without the secret, nobody can produce a valid signature.'); }
      let c; try { c = JSON.parse(unb64(parts[1])); } catch { return fail(401, 'The payload cannot be decoded.'); }
      if (c.exp && c.exp < Date.now() / 1000) { ctx.mission('exp'); return fail(401, 'Token expired. Authentication failed, so the client must log in again.'); }
      if (route.value === 'admin' && c.role !== 'admin') { ctx.mission('z'); return fail(403, `Forbidden. The server knows you are ${c.name || c.sub} (authentication passed), but role "${c.role}" may not do this (authorization failed).`); }
      out.className = 'banner ok'; out.textContent = `200: signature valid, so the server trusts these claims without any session lookup. Welcome, ${c.name || c.sub}.`; ctx.mission('ok');
    }
    sign();
  }

  function oauthTab(root, ctx) {
    const box = h('div', { class: 'stage tall' }), info = h('div', { class: 'banner', role: 'status' }, 'A photo app wants your contacts from a mail provider, without ever seeing your password.');
    const stepper = ctx.stepper();
    const go = ui.btn('Run the flow', run, { kind: 'primary', id: 'oa-go' });
    root.append(h('div', { class: 'controls' }, go, stepper.el), info, box);
    const lad = Ladder(ctx, { w: 800, rowH: 40, actors: [{ name: 'You', sub: 'browser' }, { name: 'Photo app', sub: 'client' }, { name: 'Auth server', sub: 'mail provider' }, { name: 'Contacts API', sub: 'resource' }], label: 'OAuth authorization code flow' });
    box.append(lad.svg);
    async function run() {
      go.disabled = true; lad.reset();
      const M = async (a, b, label, color, say) => { info.textContent = say; await lad.msg(a, b, { label, color }); await stepper.gate(); };
      await M(0, 1, 'Import contacts', 'req', 'You ask the app to import contacts.');
      await M(1, 0, 'Redirect to login', 'ref', 'The app sends you to the provider. It never sees your password.');
      await M(0, 2, 'Log in + approve', 'req', 'You log in on the provider\'s own page and approve "read contacts".');
      await M(2, 0, 'Redirect + code', 'res', 'The provider sends you back with a short-lived code.');
      await M(0, 1, 'code', 'res', 'The browser hands the code to the app.');
      await M(1, 2, 'code + client secret', 'req', 'The app swaps the code for a token, server to server.');
      await M(2, 1, 'Access token', 'res', 'The token is scoped to read contacts only. It is often a JWT.');
      await M(1, 3, 'GET /contacts + token', 'req', 'The app calls the API with the token.');
      await M(3, 1, '200 contacts', 'res', 'Done. You can revoke the app at any time, and your password stayed private.');
      ctx.mission('oauth'); go.disabled = false;
    }
  }

  RT.lab({
    id: 'auth', title: 'JWT & OAuth', short: 'JWT & OAuth', chapter: 'Security',
    lede: 'Forge a token and see why it fails. Then see the difference between "who are you?" and "what may you do?", and walk through a full OAuth flow.',
    missions: [['ok', 'Call an API with a valid token.'], ['z', 'Get a 403: authenticated, but not authorized.'], ['forge', 'Tamper with the token and fail the signature check.'], ['exp', 'Set exp in the past and get rejected.'], ['oauth', 'Run the OAuth flow from start to finish.']],
    notes: `<ul><li><b>Authentication</b>: who are you? Failing gives 401.</li><li><b>Authorization</b>: what may you do? Failing gives 403.</li><li>A <b>JWT</b> is signed, not encrypted. Anyone can read it, so keep secrets out of it.</li><li>JWTs are stateless, which means they are hard to revoke before they expire.</li><li><b>OAuth</b> is a delegation protocol. JWT is a token format. They often work together.</li></ul>`,
    check: { q: 'Why can\'t a user just change their role in a JWT?', options: ['JWTs are encrypted', 'The signature would no longer match', 'Browsers forbid it', 'It can be done, freely'], answer: 1, why: 'The signature covers the header and payload. Producing a new one needs the server\'s secret.' },
    render(root, ctx) {
      const a = h('div', { class: 'labmain' }), b = h('div', { class: 'labmain hide' }); let made = false;
      const tabs = ui.tabs([['j', 'Forge a JWT'], ['o', 'OAuth flow']], (v) => { a.classList.toggle('hide', v !== 'j'); b.classList.toggle('hide', v !== 'o'); if (v === 'o' && !made) { made = true; oauthTab(b, ctx); } });
      root.append(tabs, a, b); jwtTab(a, ctx); tabs.set('j');
    },
  });

  RT.lab({
    id: 'ddos', title: 'DDoS Defence', short: 'DDoS defence', chapter: 'Security',
    lede: 'A botnet floods your site, and real users get caught in it. Choose your defences and watch what happens to legitimate traffic.',
    missions: [['down', 'Let the attack take legitimate success below 20%.'], ['rate', 'Stop an application-layer flood with rate limiting and a WAF.'], ['scrub', 'Survive a volumetric flood using a scrubbing network.']],
    notes: `<ul><li><b>Volumetric</b> attacks fill your bandwidth. You need upstream capacity, not a better server.</li><li><b>Protocol</b> attacks, such as SYN floods, exhaust connection state.</li><li><b>Application-layer</b> attacks look like real requests and target expensive pages.</li><li>Each defence covers particular attack types, so real setups layer them.</li></ul>`,
    check: { q: 'A 300 Gbps flood hits your 10 Gbps link. Will a per-IP rate limit on your server help?', options: ['Yes', 'No, the link is full before traffic reaches your server', 'Only with HTTPS', 'Only with UDP'], answer: 1, why: 'Filtering at the server is too late. The traffic has to be absorbed upstream, by a scrubbing network or CDN.' },
    render(root, ctx) {
      const kind = ui.seg('Attack', [['none', 'No attack'], ['app', 'HTTP flood (app layer)'], ['vol', 'Volumetric flood']], 'none');
      const rl = ui.toggle({ id: 'dd-rl', label: 'Rate limit per IP' }), waf = ui.toggle({ id: 'dd-waf', label: 'WAF / bot challenge' }), scrub = ui.toggle({ id: 'dd-sc', label: 'Scrubbing network / CDN' }), scale = ui.toggle({ id: 'dd-as', label: 'Auto-scaling' });
      const W = 760, H = 210, x0 = 8, N = 120;
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Traffic over time' });
      svg.style.cssText = 'width:100%;min-width:560px;display:block';
      const lineA = s('polyline', { fill: 'none', stroke: 'var(--bad)', 'stroke-width': 1.8 }), lineL = s('polyline', { fill: 'none', stroke: 'var(--res)', 'stroke-width': 2.2 });
      svg.append(s('text', { class: 'dim', x: 14, y: 16 }, 'Legitimate requests served (%) in green, attack traffic reaching the server in red'), lineA, lineL);
      const stats = ui.stats([['ok', 'Legitimate success', '100%'], ['atk', 'Attack traffic reaching app', '0'], ['load', 'Server load', '20%'], ['cost', 'Defence cost', '$']]);
      const say = h('div', { class: 'banner', role: 'status' }, 'Normal day. Start an attack.');
      root.append(h('div', { class: 'controls' }, ui.field('Attack', kind), rl, waf, scrub, scale), say, h('div', { class: 'stage' }, svg), stats);
      const hist = []; let tick = 0, smooth = 100, held = 0, heldV = 0;
      ctx.loop((dt) => {
        tick += dt; if (tick < .18) return; tick = 0;
        const k = kind.value, legit = 100;
        let attack = k === 'app' ? 900 : k === 'vol' ? 60000 : 0, link = 10000, cap = scale.checked ? 400 : 150;
        if (scrub.checked) attack *= k === 'vol' ? .005 : .35;
        const linkFull = !scrub.checked && attack > link;
        if (k === 'app') { if (rl.checked) attack *= .25; if (waf.checked) attack *= .12; }
        const pass = linkFull ? (legit / (legit + attack)) * 100 : 100;
        const atServer = linkFull ? link : attack, load = (legit + atServer) / cap * 100;
        const served = linkFull ? pass : load > 100 ? (100 / load) * 100 : 100;
        smooth += (served - smooth) * .35;
        hist.push([smooth, Math.min(100, (atServer / 1000) * 100)]); if (hist.length > N) hist.shift();
        const X = (i) => x0 + (i * (W - 2 * x0)) / (N - 1), Y = (v) => H - 8 - (v / 100) * (H - 34);
        lineL.setAttribute('points', hist.map((p, i) => `${X(i)},${Y(p[0])}`).join(' ')); lineA.setAttribute('points', hist.map((p, i) => `${X(i)},${Y(p[1])}`).join(' '));
        stats.set('ok', Math.round(smooth) + '%', smooth > 90 ? 'good' : smooth < 30 ? 'bad' : 'warn');
        stats.set('atk', Math.round(atServer).toLocaleString() + ' /s'); stats.set('load', Math.min(999, Math.round(load)) + '%', load > 100 ? 'bad' : '');
        stats.set('cost', '$'.repeat(1 + [rl.checked, waf.checked].filter(Boolean).length + (scrub.checked ? 2 : 0) + (scale.checked ? 2 : 0)));
        heldV = k + rl.checked + waf.checked + scrub.checked; held = heldV === held.v ? held : { v: heldV, t: 0 }; held.t = (held.t || 0) + 1;
        if (held.t < 14) return;
        if (k !== 'none' && smooth < 20) ctx.mission('down');
        if (k === 'app' && smooth > 90 && (rl.checked || waf.checked)) ctx.mission('rate');
        if (k === 'vol' && smooth > 90 && scrub.checked) ctx.mission('scrub');
        say.className = 'banner ' + (smooth > 90 ? 'ok' : smooth < 30 ? 'bad' : 'warn');
        say.textContent = k === 'none' ? 'Normal traffic.' : linkFull ? 'The link is saturated before traffic reaches your servers. Nothing on the server can help, so the fix has to be upstream.'
          : smooth > 90 ? 'Attack contained. Real users are getting through.' : k === 'app' ? 'Requests look real, so the bandwidth is fine, but the app is melting. Filter by behaviour.' : 'Some of the flood still reaches you. Add more layers.';
      });
    },
  });
})();
