/* TLS Handshake lab. The key exchange, key derivation and encryption are real
   (ECDH P-256, HKDF-SHA256, AES-256-GCM via WebCrypto). The message flow follows
   RFC 8446 and RFC 5246; the key schedule is shortened and says so on the page. */
(function () {
  const { h, ui, Ladder, Net, hexOf, hmac, utf8, fmtMs } = RT;
  const subtle = window.crypto && crypto.subtle;
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const short = (hex, n) => (hex.length > (n || 24) ? hex.slice(0, n || 24) + '…' : hex);
  const SUITES = ['TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256'];

  async function makeKeys() {
    if (!subtle) {
      const shared = rand(32);
      return { real: false, cPub: rand(65), sPub: rand(65), shared, cRand: rand(32), sRand: rand(32) };
    }
    const alg = { name: 'ECDH', namedCurve: 'P-256' };
    const c = await subtle.generateKey(alg, false, ['deriveBits']), srv = await subtle.generateKey(alg, false, ['deriveBits']);
    const cPub = new Uint8Array(await subtle.exportKey('raw', c.publicKey)), sPub = new Uint8Array(await subtle.exportKey('raw', srv.publicKey));
    const a = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: srv.publicKey }, c.privateKey, 256));
    const b = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: c.publicKey }, srv.privateKey, 256));
    return { real: true, cPub, sPub, shared: a, sharedCheck: b, cRand: rand(32), sRand: rand(32) };
  }
  function deriveAll(k) {
    const salt = new Uint8Array([...k.cRand, ...k.sRand]);
    const prk = hmac(salt, k.shared);
    const expand = (label) => hmac(prk, new Uint8Array([...utf8('tls13 ' + label), 1]));
    return { prk, hs: expand('hs traffic'), app: expand('ap traffic') };
  }
  async function seal(keyBytes, text) {
    const key = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const iv = rand(12);
    return { iv, ct: new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(text))) };
  }
  async function open(keyBytes, iv, ct) {
    const key = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    return new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  }

  RT.lab({
    id: 'tls', title: 'TLS Handshake', short: 'TLS handshake', chapter: 'Network Essentials · Security',
    lede: 'Two strangers on a public network agree on a secret that nobody listening can work out. This page runs the real cryptography in your browser, one message at a time.',
    missions: [
      ['t13', 'Complete a TLS 1.3 handshake.'],
      ['t12', 'Complete a TLS 1.2 handshake and compare round trips.'],
      ['zero', 'Resume a session with 0-RTT.'],
      ['badcert', 'Watch the browser reject an expired or mismatched certificate.'],
      ['mitm', 'Try a man-in-the-middle attack and see it fail.'],
      ['plain', 'Send a secret over plain HTTP and read it as the eavesdropper.'],
      ['cipher', 'Send the same secret over HTTPS.'],
      ['tamper', 'Flip one byte of ciphertext and see decryption fail.'],
    ],
    notes: `<ul>
      <li><b>Asymmetric</b> crypto is slow, so it's only used to set up the session and prove identity.</li>
      <li><b>Symmetric</b> crypto is fast, so it encrypts all the actual data.</li>
      <li>The <b>certificate</b> proves who you're talking to. The <b>key exchange</b> creates the secret. They do different jobs.</li>
      <li>Fresh keys per session give <b>forward secrecy</b>: stealing the server's key later can't unlock recorded traffic.</li>
      <li>TLS 1.3 saves a round trip by sending the key share in the first message.</li>
    </ul>`,
    check: { q: 'An attacker on the café Wi-Fi intercepts the handshake and swaps in their own public key. Why does the connection fail?',
      options: ['Public keys are secret, so they cannot be swapped', 'The attacker cannot produce a certificate for that hostname signed by a trusted CA', 'TCP detects the change', 'The router blocks it'], answer: 1,
      why: 'The certificate ties a public key to a hostname, and a trusted CA signs that link. Without the CA\'s signature, the browser rejects the attacker\'s certificate.' },

    render(root, ctx) {
      let busy = false, keys = null, derived = null, lad, scenarioRan = null;
      const host = h('input', { type: 'text', id: 'tls-host', value: 'shop.example.com', 'aria-label': 'Hostname', spellcheck: 'false' });
      const ver = ui.seg('TLS version', [['1.3', 'TLS 1.3'], ['1.2', 'TLS 1.2'], ['0rtt', 'TLS 1.3 resume (0-RTT)']], '1.3');
      const scen = ui.select({ id: 'tls-scen', label: 'Scenario', value: 'ok', options: [['ok', 'Healthy site'], ['expired', 'Expired certificate'], ['host', 'Certificate for the wrong hostname'], ['mitm', 'Man in the middle on the Wi-Fi'], ['nocipher', 'No cipher suite in common']] });
      const rtt = ui.slider({ id: 'tls-rtt', label: 'Network RTT', min: 10, max: 300, step: 10, value: 80, fmt: (v) => v + ' ms', onInput: updateTiming });
      const stepper = ctx.stepper();
      const run = ui.btn('Start handshake', go, { kind: 'primary', id: 'tls-go' });
      const banner = h('div', { class: 'banner', role: 'status' }, subtle ? 'Press Start handshake. The keys are generated in this browser tab and thrown away when you leave.'
        : 'WebCrypto is blocked in this context, so key values are random stand-ins. Open the page over https or from a file for real cryptography.');
      const stage = h('div', { class: 'stage tall' });
      const stats = ui.stats([['rtts', 'Round trips before data', '–'], ['ttfb', 'First response at', '–'], ['eve', 'Readable by eavesdropper', '–'], ['state', 'Connection', 'Not started']]);
      const detail = h('div', { class: 'small' }, h('p', { class: 'muted' }, 'Each message appears here as it is sent. Click a row in the diagram to read it again.'));
      const keyBox = h('div');
      const certBox = h('div', { style: { display: 'grid', gap: '4px' } });
      const mix = h('div');

      root.append(h('div', { class: 'controls' }, ui.field('Hostname', host, 'grow'), ui.field('Version', ver), scen, rtt, run, stepper.el), banner, stage, stats,
        h('div', { class: 'twocol' }, ui.card('Selected message', detail), ui.card('Key material (computed in your browser)', keyBox)),
        h('div', { class: 'twocol' }, ui.card('Certificate check', certBox), ui.card('Key exchange in paint', mix)));
      const secret = secretPanel(); root.append(secret.el);

      const row = (k, v) => h('div', { class: 'keyrow' }, h('span', null, k), h('span', null, v));
      function showMsg(m) {
        detail.textContent = '';
        detail.append(h('p', { style: { fontWeight: 600 } }, m.title), h('p', { style: { margin: '2px 0 6px' } }, m.why));
        (m.fields || []).forEach(([k, v]) => detail.append(row(k, v)));
        if (m.eve) detail.append(h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Eavesdropper sees: ' + m.eve));
      }
      function drawKeys(level) {
        keyBox.textContent = '';
        if (!keys) { keyBox.append(h('p', { class: 'muted small' }, 'Empty. Nothing has been exchanged yet.')); return; }
        keyBox.append(row('Client random', short(hexOf(keys.cRand))));
        if (level >= 1) keyBox.append(row('Client public', short(hexOf(keys.cPub))));
        if (level >= 2) keyBox.append(row('Server random', short(hexOf(keys.sRand))), row('Server public', short(hexOf(keys.sPub))));
        if (level >= 3) {
          const same = keys.real && hexOf(keys.shared) === hexOf(keys.sharedCheck);
          keyBox.append(row('Shared secret', short(hexOf(keys.shared))),
            h('p', { class: 'small ' + (same ? 'good' : ''), style: { margin: '3px 0' } }, keys.real ? (same ? 'Each side computed this on its own and got the same 32 bytes. It was never sent.' : '') : 'Stand-in value.'),
            row('Handshake key', short(hexOf(derived.hs))));
        }
        if (level >= 4) keyBox.append(row('Traffic key', short(hexOf(derived.app))));
        keyBox.append(h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '6px' } }, 'ECDH on P-256 with HKDF-SHA256. The derivation is simplified from the full TLS 1.3 key schedule.'));
      }
      function drawMix(level) {
        mix.textContent = '';
        if (!keys) { mix.append(h('p', { class: 'muted small' }, 'A visual analogy appears here during the handshake.')); return; }
        const c = (b) => [60 + b[1] % 170, 60 + b[2] % 170, 60 + b[3] % 170];
        const base = [235, 190, 60], a = c(keys.cPub), b = c(keys.sPub);
        const css = (x) => `rgb(${x.map(Math.round).join(',')})`;
        const m2 = (p, q) => p.map((v, i) => (v + q[i]) / 2), m3 = (p, q, r) => p.map((v, i) => (v + q[i] + r[i]) / 3);
        const sw = (col, t) => h('div', { style: { display: 'grid', justifyItems: 'center', gap: '2px', width: '74px', fontSize: '11.5px', textAlign: 'center', lineHeight: '1.2' } }, h('div', { class: 'swatch', style: { background: css(col) } }), t);
        mix.append(h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'flex-start' } },
          sw(base, 'Public base'), sw(a, 'Browser secret'), sw(b, 'Server secret'),
          level >= 1 && sw(m2(base, a), 'Browser sends'), level >= 2 && sw(m2(base, b), 'Server sends'), level >= 3 && sw(m3(base, a, b), 'Both end here')));
        mix.append(h('p', { class: 'muted small', style: { marginTop: '6px' } }, level >= 3
          ? 'Each side adds its own secret to the other\'s mix and lands on the same colour. An eavesdropper saw only the two mixes and cannot separate them. Elliptic-curve maths plays the part of the paint.'
          : 'Mixing paint is easy, and un-mixing it is practically impossible. Key exchange relies on the same kind of one-way step.'));
      }
      function drawCert(rows) {
        certBox.textContent = '';
        if (!rows) { certBox.append(h('p', { class: 'muted small' }, 'The browser checks the certificate as soon as it arrives.')); return; }
        rows.forEach(([t, st, sub]) => certBox.append(h('div', { class: 'small', style: { display: 'grid', gridTemplateColumns: '18px 1fr', gap: '6px' } },
          h('span', { class: 'mono ' + (st === 'ok' ? 'good' : st === 'bad' ? 'badtxt' : 'muted') }, st === 'ok' ? '✓' : st === 'bad' ? '✗' : '·'),
          h('span', null, t, sub && h('span', { class: 'muted' }, '  ' + sub)))));
      }
      function updateTiming() {
        if (scenarioRan == null) return;
        const r = rtt.value;
        const v = scenarioRan;
        stats.set('rtts', v === '1.3' ? '2' : v === '1.2' ? '3' : '1');
        stats.set('ttfb', fmtMs(r * (v === '1.3' ? 3 : v === '1.2' ? 4 : 2)));
      }
      drawKeys(0); drawMix(0); drawCert(null);

      lad = Ladder(ctx, { actors: [{ name: 'Browser', sub: 'client' }, { name: 'Server', sub: 'port 443' }], aside: 'Eavesdropper sees', asideSub: 'anyone on the path', w: 800, asideW: 236, label: 'TLS handshake sequence' });
      stage.append(lad.svg);

      function certChecks(hostname, sc) {
        const today = new Date(), day = 864e5, iso = (d) => d.toISOString().slice(0, 10);
        const ok = sc !== 'expired';
        const from = iso(new Date(+today - (ok ? 30 : 460) * day)), to = iso(new Date(+today + (ok ? 60 : -95) * day));
        const san = sc === 'host' ? 'other-site.example.net' : hostname;
        const issuer = sc === 'mitm' ? 'Totally Legit Wi-Fi CA' : 'Example Trust R3';
        const cert = { subject: san, issuer, from, to };
        const steps = [
          ['Signature chain', sc === 'mitm' ? 'bad' : 'ok', `${san} ← ${issuer}${sc === 'mitm' ? '' : ' ← Example Root CA'}`],
          ['Chains to a trusted root', sc === 'mitm' ? 'bad' : 'ok', sc === 'mitm' ? 'This CA is not in the browser\'s trust store' : 'Root is in the browser\'s trust store'],
          ['Inside its validity dates', sc === 'expired' ? 'bad' : 'ok', `${from} to ${to}`],
          ['Name matches the site', sc === 'host' ? 'bad' : 'ok', `Certificate covers ${san}`],
        ];
        return { cert, steps, fail: steps.find((x) => x[1] === 'bad') };
      }

      async function go() {
        if (busy) return;
        const hostname = (host.value.trim().toLowerCase() || 'shop.example.com').replace(/^https?:\/\//, '').split('/')[0];
        busy = true; run.disabled = true; lad.reset(); scenarioRan = null;
        stats.set('state', 'Handshaking'); stats.set('rtts', '–'); stats.set('ttfb', '–'); stats.set('eve', '–');
        banner.className = 'banner'; banner.textContent = 'Opening a TCP connection first. TLS runs on top of it.';
        keys = await makeKeys(); derived = deriveAll(keys);
        drawKeys(-1); drawMix(0); drawCert(null); secret.setKeys(null);
        const v = ver.value, sc = scen.value;
        const certRes = certChecks(hostname, sc);
        const pause = () => stepper.gate();
        const send = async (a, b, m) => {
          const done = lad.msg(a, b, { ...m, onSelect: () => showMsg(m) }); showMsg(m); await done; await pause();
        };
        const C = 0, S = 1;

        lad.band('TCP handshake · 1 round trip', 'mute');
        await send(C, S, { label: 'SYN', color: 'cache', title: 'SYN', why: 'TLS needs a reliable byte stream, so TCP goes first.', aside: 'IP addresses, ports', eve: 'your IP, the server IP, port 443' });
        await send(S, C, { label: 'SYN-ACK', color: 'cache', title: 'SYN-ACK', why: 'The server agrees to open the connection.', aside: 'IP addresses, ports', eve: 'the same' });
        await send(C, S, { label: 'ACK', color: 'cache', title: 'ACK', why: 'The connection is open. Nothing is encrypted yet.', aside: 'IP addresses, ports', eve: 'the same' });

        const zero = v === '0rtt';
        lad.band(v === '1.2' ? 'TLS 1.2 handshake · 2 round trips' : zero ? 'TLS 1.3 resumption · 0 round trips for first data' : 'TLS 1.3 handshake · 1 round trip', 'req');
        const chFields = [['Random', short(hexOf(keys.cRand))], ['Server name', hostname], ['Cipher suites', v === '1.2' ? 'ECDHE-RSA-AES128-GCM-SHA256, …' : SUITES[0] + ', …']];
        if (v !== '1.2') chFields.push(['Key share', short(hexOf(keys.cPub))]);
        if (zero) chFields.push(['Pre-shared key', 'ticket from a previous visit'], ['Early data', 'GET / (encrypted)']);
        await send(C, S, { label: zero ? 'ClientHello + 🔒early GET' : 'ClientHello', color: 'req', title: 'ClientHello', fields: chFields,
          why: v === '1.2' ? 'The browser lists what it supports. TLS 1.2 waits until later to exchange keys.' : zero ? 'The browser reuses a key from an earlier visit, so it can send a request right away. Early data can be replayed, so it should only carry safe, repeatable requests.' : 'The browser guesses the key-exchange method and sends its public key share immediately. That is how TLS 1.3 saves a round trip.',
          aside: v === '1.2' ? 'SNI, cipher list' : 'SNI, cipher list, public key', eve: `the hostname ${hostname} (SNI), the cipher list and the public key share. The hostname is visible unless Encrypted Client Hello is in use.` });
        drawKeys(1); drawMix(1);

        if (sc === 'nocipher') {
          await send(S, C, { label: 'Alert: handshake_failure', color: 'bad', title: 'Alert: handshake_failure', why: 'The server supports none of the offered ciphers, so it refuses. Nothing secure can be agreed.', aside: 'alert in the clear', eve: 'that the handshake failed' });
          banner.className = 'banner bad'; banner.textContent = 'Connection refused: no cipher suite in common. The usual cause is a very old client or a server with a misconfigured list.';
          stats.set('state', 'Failed', 'bad'); stats.set('eve', 'Metadata only');
          ctx.mission('badcert'); busy = false; run.disabled = false; return;
        }

        const shFields = [['Random', short(hexOf(keys.sRand))], ['Chosen suite', v === '1.2' ? 'ECDHE-RSA-AES128-GCM-SHA256' : SUITES[1]]];
        const fail = async (who) => {
          banner.className = 'banner bad';
          const what = sc === 'expired' ? 'certificate_expired' : sc === 'host' ? 'bad_certificate (name mismatch)' : 'unknown_ca';
          await send(C, S, { label: 'Alert: ' + what.split(' ')[0], color: 'bad', title: 'Alert: ' + what, why: 'The browser aborts and shows a full-page warning. No request is ever sent, so nothing sensitive leaves your machine.', aside: who, eve: 'that the handshake stopped' });
          banner.textContent = sc === 'mitm'
            ? 'Attack blocked. The attacker can intercept and even complete a key exchange, but cannot get a trusted CA to sign a certificate for this hostname.'
            : sc === 'expired' ? 'Connection rejected: the certificate has expired. Encryption would still work, but trust in the identity has lapsed.'
            : 'Connection rejected: the certificate is valid, but for a different site. Without this check, any site with any certificate could impersonate this one.';
          stats.set('state', sc === 'mitm' ? 'Attack blocked' : 'Rejected', 'bad'); stats.set('eve', 'No app data');
          ctx.mission(sc === 'mitm' ? 'mitm' : 'badcert'); busy = false; run.disabled = false;
        };
        const verify = async () => {
          const shown = [];
          for (const st of certRes.steps) { shown.push(st); drawCert(shown); await ctx.sleep(st[1] === 'bad' ? 500 : 260); if (st[1] === 'bad') break; }
          return !certRes.fail;
        };
        const c = certRes.cert, certFields = [['Subject', c.subject], ['Issuer', c.issuer], ['Valid', c.from + ' to ' + c.to], ['Public key', 'ECDSA P-256'], ['Signature', 'CA\'s signature over all of the above']];

        if (v === '1.2') {
          await send(S, C, { label: 'ServerHello', color: 'res', title: 'ServerHello', fields: shFields, why: 'The server picks one cipher suite from the list.', aside: 'chosen cipher', eve: 'the chosen cipher' });
          await send(S, C, { label: 'Certificate', color: 'res', title: 'Certificate', fields: certFields, why: 'The server proves its identity. In TLS 1.2 this travels unencrypted.', aside: 'FULL certificate, in the clear', eve: 'the whole certificate, including every hostname it covers' });
          await send(S, C, { label: 'ServerKeyExchange', color: 'res', title: 'ServerKeyExchange', fields: [['Key share', short(hexOf(keys.sPub))], ['Signature', 'Signed with the certificate\'s private key']], why: 'The server sends its public key share, signed so the browser knows nobody swapped it.', aside: 'server public key', eve: 'the public key share' });
          await send(S, C, { label: 'ServerHelloDone', color: 'res', title: 'ServerHelloDone', why: 'The server has finished this flight and waits for the browser.', aside: '(empty marker)', eve: 'the marker' });
          drawKeys(2); drawMix(2);
          if (!(await verify())) return fail('alert in the clear');
          await send(C, S, { label: 'ClientKeyExchange', color: 'req', title: 'ClientKeyExchange', fields: [['Key share', short(hexOf(keys.cPub))]], why: 'Now the browser sends its share. Each side can compute the same secret.', aside: 'client public key', eve: 'the public key share' });
          drawKeys(3); drawMix(3);
          await send(C, S, { label: 'ChangeCipherSpec', color: 'req', title: 'ChangeCipherSpec', why: 'Everything from here on is encrypted.', aside: 'marker', eve: 'the switch to encryption' });
          await send(C, S, { label: '🔒 Finished', color: 'req', title: 'Finished', why: 'A hash of the whole conversation so far, encrypted. If anyone altered a message, this fails.', aside: 'ciphertext', eve: 'random-looking bytes' });
          await send(S, C, { label: 'ChangeCipherSpec', color: 'res', title: 'ChangeCipherSpec', why: 'The server switches to encryption too.', aside: 'marker', eve: 'the switch' });
          await send(S, C, { label: '🔒 Finished', color: 'res', title: 'Finished', why: 'The server proves it derived the same keys.', aside: 'ciphertext', eve: 'random-looking bytes' });
        } else {
          shFields.push(['Key share', short(hexOf(keys.sPub))]);
          await send(S, C, { label: 'ServerHello', color: 'res', title: 'ServerHello', fields: shFields, why: 'The server sends its public key share. Both sides can now compute the shared secret, so everything after this message is encrypted.', aside: 'chosen cipher, public key', eve: 'the cipher and the public key share, but not the secret' });
          drawKeys(3); drawMix(3);
          lad.band('Both sides computed the same secret. Encrypted from here on.', 'res');
          banner.textContent = 'Both sides derived the secret without ever sending it. Look at the key panel below.';
          if (!zero) {
            await send(S, C, { label: '🔒 EncryptedExtensions', color: 'res', title: 'EncryptedExtensions', why: 'Extra settings, now hidden from the network.', aside: 'ciphertext', eve: 'random-looking bytes' });
            await send(S, C, { label: '🔒 Certificate', color: 'res', title: 'Certificate', fields: certFields, why: 'In TLS 1.3 even the certificate is encrypted.', aside: 'ciphertext', eve: 'random-looking bytes. The certificate stays hidden' });
            await send(S, C, { label: '🔒 CertificateVerify', color: 'res', title: 'CertificateVerify', why: 'The server signs the handshake with its private key, proving it really owns the certificate.', aside: 'ciphertext', eve: 'random-looking bytes' });
          }
          await send(S, C, { label: '🔒 Finished', color: 'res', title: 'Finished', why: 'A keyed hash of the conversation. It would not match if anything had been altered in transit.', aside: 'ciphertext', eve: 'random-looking bytes' });
          if (!zero && !(await verify())) return fail('ciphertext');
          if (zero) { drawCert([['Skipped', 'ok', 'Identity was proven on the earlier visit that issued the ticket']]); }
          await send(C, S, { label: '🔒 Finished', color: 'req', title: 'Finished', why: 'The browser confirms its side. The handshake is complete.', aside: 'ciphertext', eve: 'random-looking bytes' });
        }
        drawKeys(4);
        lad.band('Secure channel open', 'res');
        const rq = await seal(derived.app, `GET / HTTP/1.1\r\nHost: ${hostname}`).catch(() => null);
        const ctHex = rq ? hexOf(rq.ct) : hexOf(rand(40));
        if (!zero) await send(C, S, { label: '🔒 GET /', color: 'req', title: 'Application data', fields: [['Plaintext', `GET / HTTP/1.1  Host: ${hostname}`], ['Ciphertext', short(ctHex, 48)]], why: 'Really encrypted with AES-256-GCM using the traffic key shown beside this panel.', aside: short(ctHex, 22), eve: 'this ciphertext and its length, but not the contents' });
        await send(S, C, { label: '🔒 200 OK', color: 'res', title: 'Application data', why: 'The response comes back the same way, encrypted with the server\'s traffic key.', aside: 'ciphertext', eve: 'random-looking bytes' });

        scenarioRan = v; updateTiming();
        stats.set('state', 'Secure', 'good'); stats.set('eve', 'Metadata only', 'good');
        banner.className = 'banner ok';
        banner.textContent = v === '1.3' ? 'Secure in 1 round trip on top of TCP. Now try TLS 1.2 and compare.' : v === '1.2' ? 'Secure, but TLS 1.2 needed 2 round trips, and it sent the certificate in the clear.' : 'The request left with the very first TLS message, so a returning visitor loses no round trip to TLS at all.';
        ctx.mission(v === '1.3' ? 't13' : v === '1.2' ? 't12' : 'zero');
        secret.setKeys(derived.app);
        busy = false; run.disabled = false;
      }

      function secretPanel() {
        let key = null, last = null;
        const input = h('input', { type: 'text', id: 'tls-secret', value: 'card=4242 4242 4242 4242&cvv=123', 'aria-label': 'Sample secret to send' });
        const seg = ui.seg('Protocol', [['http', 'HTTP (port 80)'], ['https', 'HTTPS (port 443)']], 'http');
        const sendB = ui.btn('Send', sendIt, { kind: 'primary', id: 'tls-send' });
        const tamper = ui.btn('Attacker flips one byte', flip, { kind: 'danger', id: 'tls-flip', disabled: true });
        const net = Net(ctx, { w: 760, h: 110, label: 'Browser to server through a Wi-Fi eavesdropper' });
        net.node('b', { x: 80, y: 60, label: 'Browser', sub: '', w: 110 }).node('e', { x: 380, y: 60, label: 'Café Wi-Fi', sub: 'eavesdropper', w: 122 }).node('s', { x: 680, y: 60, label: 'Server', sub: '', w: 110 }).link('b', 'e').link('e', 's');
        const wire = h('div', { class: 'hexbox' }, 'Captured packets appear here.');
        const got = h('div', { class: 'small' }, 'The server\'s result appears here.');
        const el = ui.card('HTTP vs HTTPS: what does the Wi-Fi see?',
          h('div', { class: 'controls flat', style: { marginBottom: '8px' } }, ui.field('Sample secret (never leaves this tab)', input, 'grow'), ui.field('Protocol', seg), sendB, tamper),
          h('div', { class: 'stage' }, net.svg),
          h('div', { class: 'twocol', style: { marginTop: '8px' } }, h('div', null, h('p', { class: 'fieldlabel' }, 'Eavesdropper captured'), wire), h('div', null, h('p', { class: 'fieldlabel' }, 'Server received'), got)));
        async function sendIt() {
          const text = input.value || ' ';
          sendB.disabled = true; tamper.disabled = true; last = null;
          if (seg.value === 'https') {
            if (!key) { wire.textContent = 'Complete a handshake above first, so there is a key to encrypt with.'; sendB.disabled = false; return; }
            if (!subtle) { wire.textContent = 'WebCrypto is unavailable here, so real encryption cannot run.'; sendB.disabled = false; return; }
            last = await seal(key, text);
            await net.send('b', 'e', { label: 'ciphertext', color: 'res' });
            wire.textContent = hexOf(last.ct);
            await net.send('e', 's', { label: 'ciphertext', color: 'res' });
            got.textContent = ''; got.append(h('span', { class: 'good' }, 'Decrypted and verified: '), await open(key, last.iv, last.ct));
            ctx.mission('cipher'); tamper.disabled = false;
          } else {
            await net.send('b', 'e', { label: 'plain text', color: 'bad' });
            wire.textContent = ''; wire.append(h('span', { class: 'badtxt' }, `POST /pay HTTP/1.1  ${text}`));
            await net.send('e', 's', { label: 'plain text', color: 'bad' });
            got.textContent = text;
            ctx.mission('plain');
          }
          sendB.disabled = false;
        }
        async function flip() {
          if (!last) return;
          const ct = last.ct.slice(); ct[Math.floor(ct.length / 2)] ^= 1;
          tamper.disabled = true; net.state('e', 'err');
          await net.send('e', 's', { label: 'altered', color: 'bad' });
          wire.textContent = ''; wire.append(hexOf(ct));
          try { await open(key, last.iv, ct); got.textContent = 'Unexpectedly accepted.'; }
          catch { got.textContent = ''; got.append(h('span', { class: 'badtxt' }, 'Rejected. AES-GCM authentication failed, so the record was dropped.'), ' One flipped bit changes the tag check. This is the integrity HTTPS adds on top of secrecy.'); ctx.mission('tamper'); }
          net.state('e', '');
        }
        return { el, setKeys(k) { key = k; } };
      }
    },
  });
})();
