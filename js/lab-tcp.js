/* TCP/IP lab: encapsulation with real header bytes, a reliable-delivery simulator
   whose packets can be clicked out of the air, and a TCP vs UDP stream race. */
(function () {
  const { h, s, ui, Net, seeded, utf8, fmtMs } = RT;

  /* ----- byte builders ----- */
  const u16 = (v) => [(v >> 8) & 255, v & 255];
  const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const ip4 = (t) => t.split('.').map(Number);
  function ipSum(bytes) {
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 2) sum += (bytes[i] << 8) + (bytes[i + 1] || 0);
    while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
    return ~sum & 0xffff;
  }
  const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  function crc32(bytes) { let c = -1; for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
  const mac = (t) => t.split(':').map((x) => parseInt(x, 16));

  function buildFrame(o) {
    const pay = Array.from(utf8(o.message));
    const proto = o.proto === 'TCP' ? 6 : 17;
    let trans;
    const pseudo = (len) => [...ip4(o.src), ...ip4(o.dst), 0, proto, ...u16(len)];
    if (o.proto === 'TCP') {
      trans = [...u16(o.sport), ...u16(o.dport), ...u32(o.seq), ...u32(o.ack), 0x50, 0x18, ...u16(64240), 0, 0, 0, 0];
      const c = ipSum([...pseudo(trans.length + pay.length), ...trans, ...pay]);
      trans[16] = c >> 8; trans[17] = c & 255;
    } else {
      trans = [...u16(o.sport), ...u16(o.dport), ...u16(8 + pay.length), 0, 0];
      const c = ipSum([...pseudo(8 + pay.length), ...trans, ...pay]) || 0xffff;
      trans[6] = c >> 8; trans[7] = c & 255;
    }
    const total = 20 + trans.length + pay.length;
    const iph = [0x45, 0, ...u16(total), ...u16(0x1c46), 0x40, 0, o.ttl, proto, 0, 0, ...ip4(o.src), ...ip4(o.dst)];
    const ck = ipSum(iph); iph[10] = ck >> 8; iph[11] = ck & 255;
    const eth = [...mac(o.dmac), ...mac(o.smac), 0x08, 0x00];
    const body = [...eth, ...iph, ...trans, ...pay];
    const fcs = u32(crc32(body));
    return { eth, iph, trans, pay, fcs, ipck: ck, tck: o.proto === 'TCP' ? (trans[16] << 8) | trans[17] : (trans[6] << 8) | trans[7], fcsv: crc32(body) };
  }
  const hx = (a) => a.map((b) => b.toString(16).padStart(2, '0')).join(' ');

  const HOPS = [
    { id: 'laptop', label: 'Your laptop', sub: '10.0.0.12' },
    { id: 'home', label: 'Home router', sub: 'NAT' },
    { id: 'isp', label: 'ISP router', sub: 'backbone' },
    { id: 'server', label: 'Web server', sub: '203.0.113.10' },
  ];
  const MACS = ['3c:22:fb:a1:09:7e', 'f4:92:bf:10:44:02', '00:1b:21:6c:aa:53', '52:54:00:8d:3e:c1'];

  function layersTab(root, ctx) {
    let proto = 'TCP', hop = 0, built = 0, busy = false;
    const msg = h('input', { type: 'text', id: 'tcp-msg', value: 'GET / HTTP/1.1\r\nHost: example.com\r\n\r\n'.replace(/\r\n/g, ' '), 'aria-label': 'Message to send' });
    const pseg = ui.seg('Transport', [['TCP', 'TCP'], ['UDP', 'UDP']], 'TCP', (v) => { proto = v; reset(); if (v === 'UDP') ctx.mission('udp'); });
    const stepper = ctx.stepper();
    const send = ui.btn('Send it', go, { kind: 'primary', id: 'tcp-send' });
    const layersEl = h('div', { class: 'layers' });
    const fields = h('div', { class: 'scroll' }, h('p', { class: 'muted small' }, 'Press Send, then click any header to read its fields.'));
    const hexEl = h('div', { class: 'hexbox' });
    const pathBox = h('div', { class: 'stage' });
    const banner = h('div', { class: 'banner' }, 'Each layer adds its own header around the data from the layer above. Routers only read the outer layers.');
    const net = Net(ctx, { w: 900, h: 130, label: 'Network path from laptop to server' });
    HOPS.forEach((n, i) => { net.node(n.id, { x: 100 + i * 233, y: 72, label: n.label, sub: n.sub, w: 134 }); if (i) net.link(HOPS[i - 1].id, n.id); });
    pathBox.append(net.svg);
    root.append(h('div', { class: 'controls' }, ui.field('Application data', msg, 'grow'), ui.field('Transport', pseg), send, stepper.el), banner, ui.card('Encapsulation', layersEl), pathBox,
      h('div', { class: 'twocol' }, ui.card('Header fields', fields), ui.card('The frame on the wire (real bytes, hex)', hexEl)));

    function state() {
      const home = hop >= 1;
      return { proto, message: msg.value || ' ', src: home ? '198.51.100.7' : '10.0.0.12', dst: '203.0.113.10', sport: home ? 40112 : 51514, dport: proto === 'TCP' ? 80 : 53,
        seq: 2841, ack: 77123, ttl: 64 - hop, smac: MACS[hop], dmac: MACS[hop + 1] || MACS[3] };
    }
    function colors(i) { return [['var(--res)', 'var(--ok-soft)'], ['var(--req)', 'var(--req-soft)'], ['var(--ref)', 'var(--ref-soft)'], ['var(--cache)', 'var(--cache-soft)']][i]; }
    function fieldTable(title, rows) {
      fields.textContent = '';
      fields.append(h('p', { class: 'small', style: { fontWeight: 600, marginBottom: '4px' } }, title), h('table', { class: 'table' }, h('tr', null, h('th', null, 'Field'), h('th', null, 'Value'), h('th', null, 'What it does')),
        rows.map((r) => h('tr', null, h('td', null, r[0]), h('td', null, r[1]), h('td', { style: { fontFamily: 'var(--body)' } }, r[2])))));
    }
    function draw() {
      const o = state(), f = buildFrame(o);
      const hdr = (name, size, i, onClick) => h('button', { class: 'hdr', style: { '--c-soft': colors(i)[1], background: colors(i)[1], borderColor: colors(i)[0] }, onclick: onClick }, h('b', null, name), size + ' B');
      const tcpH = () => fieldTable(o.proto + ' header', o.proto === 'TCP'
        ? [['Source port', o.sport, 'Which process on the sender'], ['Dest port', o.dport, 'Which service on the receiver'], ['Sequence', o.seq, 'Position of this data in the byte stream'], ['Ack', o.ack, 'Next byte expected from the other side'], ['Flags', 'PSH, ACK', 'Control bits. SYN, ACK and FIN live here'], ['Window', 64240, 'How many more bytes the receiver will accept'], ['Checksum', '0x' + f.tck.toString(16).padStart(4, '0'), 'Detects corruption. Computed from this exact packet']]
        : [['Source port', o.sport, 'Which process on the sender'], ['Dest port', o.dport, 'Which service on the receiver'], ['Length', 8 + f.pay.length, 'Header plus data, in bytes'], ['Checksum', '0x' + f.tck.toString(16).padStart(4, '0'), 'Detects corruption. There are no sequence numbers and no acks']]);
      const ipH = () => fieldTable('IPv4 header', [['Source', o.src, hop ? 'Rewritten by NAT at the home router' : 'Private address, valid only at home'], ['Destination', o.dst, 'Stays the same end to end'], ['TTL', o.ttl, 'Each router subtracts 1. At 0 the packet is dropped'], ['Protocol', o.proto === 'TCP' ? '6 (TCP)' : '17 (UDP)', 'Which transport to hand the data to'], ['Checksum', '0x' + f.ipck.toString(16).padStart(4, '0'), 'Recomputed at every hop because TTL changes']]);
      const ethH = () => fieldTable('Ethernet frame', [['Source MAC', o.smac, 'This hop\'s sender'], ['Dest MAC', o.dmac, 'This hop\'s receiver. Replaced at every router'], ['EtherType', '0x0800', 'Carrying IPv4'], ['FCS', '0x' + f.fcsv.toString(16).padStart(8, '0'), 'CRC-32 of the whole frame']]);
      const rows = [
        ['Application', 'HTTP, DNS, TLS', [h('div', { class: 'hdr pay' }, o.message)]],
        ['Transport', o.proto + ': ports', [hdr(o.proto, f.trans.length, 1, tcpH), h('div', { class: 'hdr pay' }, 'data')]],
        ['Internet', 'IP: addresses', [hdr('IP', 20, 2, ipH), hdr(o.proto, f.trans.length, 1, tcpH), h('div', { class: 'hdr pay' }, 'data')]],
        ['Link', 'Ethernet: next hop', [hdr('ETH', 14, 3, ethH), hdr('IP', 20, 2, ipH), hdr(o.proto, f.trans.length, 1, tcpH), h('div', { class: 'hdr pay' }, 'data'), hdr('FCS', 4, 3, ethH)]],
      ];
      layersEl.textContent = '';
      rows.slice(0, built).forEach(([n, sub, parts]) => layersEl.append(h('div', { class: 'layer' }, h('div', { class: 'nm' }, n, h('small', null, sub)), h('div', { class: 'frame' }, parts))));
      if (!built) layersEl.append(h('p', { class: 'muted small' }, 'Nothing wrapped yet.'));
      hexEl.textContent = '';
      if (built >= 4) {
        const part = (a, c) => h('span', { style: { color: c } }, hx(a) + ' ');
        hexEl.append(part(f.eth, 'var(--cache)'), part(f.iph, 'var(--ref)'), part(f.trans, 'var(--req)'), part(f.pay, 'var(--muted)'), part(f.fcs, 'var(--cache)'));
        hexEl.append(h('div', { class: 'muted', style: { marginTop: '4px' } }, `${f.eth.length + f.iph.length + f.trans.length + f.pay.length + 4} bytes in total, of which ${f.pay.length} are your data. Hop ${hop + 1}: TTL ${o.ttl}, source ${o.src}.`));
      } else hexEl.append(h('span', { class: 'muted' }, 'The finished frame appears here once all four layers are wrapped.'));
    }
    function reset() { hop = 0; built = 0; draw(); HOPS.forEach((n) => net.state(n.id, '')); }
    async function go() {
      if (busy) return;
      busy = true; send.disabled = true; hop = 0; built = 0; HOPS.forEach((n) => net.state(n.id, '')); draw();
      const says = ['The application hands its data to the transport layer.', `${proto} adds ports${proto === 'TCP' ? ', sequence numbers and acks' : ' and a checksum, and nothing else'}.`, 'IP adds source and destination addresses so routers can forward it.', 'Ethernet adds MAC addresses for just the next hop, plus a CRC.'];
      for (let i = 0; i < 4; i++) { built = i + 1; draw(); banner.textContent = says[i]; net.state('laptop', 'on'); await stepper.gate(); await ctx.sleep(620); }
      for (let i = 0; i < 3; i++) {
        await net.send(HOPS[i].id, HOPS[i + 1].id, { label: `TTL ${64 - i}`, color: 'req', dur: 800 });
        net.state(HOPS[i].id, ''); net.state(HOPS[i + 1].id, 'on');
        hop = i + 1;
        if (i < 2) {
          draw();
          banner.textContent = i === 0
            ? 'Home router: strips the Ethernet frame, swaps your private address for its public one (NAT), lowers TTL, recomputes the checksum, adds a new frame.'
            : 'ISP router: reads only the IP destination, lowers TTL, adds a new Ethernet frame. The TCP data stays untouched.';
          await stepper.gate(); await ctx.sleep(900);
        }
      }
      hop = 2;
      banner.className = 'banner ok';
      for (let i = 3; i > 0; i--) { built = i; draw(); banner.textContent = 'Server: unwraps one layer at a time, ' + ['', 'and hands the data to the application on port ' + (proto === 'TCP' ? 80 : 53) + '.', 'then reads the ports to find the right process,', 'first checking the frame\'s CRC,'][i]; await stepper.gate(); await ctx.sleep(620); }
      net.state('server', 'hit'); ctx.mission('wrap'); busy = false; send.disabled = false; built = 4; hop = 2; draw();
    }
    draw();
  }

  /* ----- reliable delivery simulator ----- */
  function reliableTab(root, ctx) {
    const W = 900, H = 200, LX = 118, RX = 782, TOP = 66, BOT = 136, N = 30, MSS = 1000;
    const rttS = ui.slider({ label: 'Round-trip time', min: 800, max: 3000, step: 100, value: 1600, fmt: (v) => v + ' ms*', id: 'tcp-rtt' });
    const lossS = ui.slider({ label: 'Random loss', min: 0, max: 30, value: 0, fmt: (v) => v + '%', id: 'tcp-loss' });
    const rwndS = ui.slider({ label: 'Receiver window', min: 1, max: 16, value: 8, fmt: (v) => v + ' seg', id: 'tcp-rwnd' });
    const cc = ui.toggle({ label: 'Congestion control', checked: true, id: 'tcp-cc' });
    const startB = ui.btn('Open connection', start, { kind: 'primary', id: 'tcp-open' });
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'net', role: 'img', 'aria-label': 'Client and server exchanging packets. Click a packet to drop it.' });
    const stage = h('div', { class: 'stage' }, svg);
    const gP = s('g');
    const lblC = s('text', { class: 'lab', x: LX, y: 186, 'text-anchor': 'middle' }, 'CLOSED'), lblS = s('text', { class: 'lab', x: RX, y: 186, 'text-anchor': 'middle' }, 'LISTEN');
    svg.append(s('line', { class: 'lnk', x1: LX, y1: TOP, x2: RX, y2: TOP }), s('line', { class: 'lnk', x1: LX, y1: BOT, x2: RX, y2: BOT }),
      s('text', { class: 'dim', x: W / 2, y: TOP - 40, 'text-anchor': 'middle' }, 'data →'), s('text', { class: 'dim', x: W / 2, y: BOT + 34, 'text-anchor': 'middle' }, '← acks'));
    const box = (x, t) => s('g', { class: 'node', transform: `translate(${x},${(TOP + BOT) / 2})` }, s('rect', { class: 'body', x: -48, y: -66, width: 96, height: 132, rx: 5 }), s('text', { class: 't', y: 4 }, t));
    svg.append(box(LX - 56, 'Client'), box(RX + 56, 'Server'), lblC, lblS, gP);
    lblC.setAttribute('x', 62); lblS.setAttribute('x', 838);

    const stats = ui.stats([['cwnd', 'Congestion window', '–'], ['flight', 'In flight', 0], ['delivered', 'Delivered', '0/' + N], ['rtx', 'Retransmissions', 0], ['dup', 'Duplicate acks', 0]]);
    const sndG = h('div', { class: 'seq-grid' }), rcvG = h('div', { class: 'seq-grid' });
    const chart = s('svg', { viewBox: '0 0 420 96', role: 'img', 'aria-label': 'Congestion window over time' });
    chart.style.cssText = 'width:100%;height:auto;display:block';
    const poly = s('polyline', { fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.8 });
    chart.append(s('line', { class: 'lnk', x1: 26, y1: 82, x2: 416, y2: 82 }), s('line', { class: 'lnk', x1: 26, y1: 6, x2: 26, y2: 82 }), s('text', { class: 'dim', x: 2, y: 12 }, '32'), s('text', { class: 'dim', x: 12, y: 86 }, '0'), poly);
    const log = ui.log({ max: 210 });
    const banner = h('div', { class: 'banner' }, 'Open a connection. Once packets are moving, click any packet in flight to destroy it and watch TCP recover.');
    root.append(h('div', { class: 'controls' }, startB, rttS, lossS, rwndS, cc), banner, stage, stats,
      h('div', { class: 'twocol' }, ui.card('Sender buffer', sndG, h('p', { class: 'muted small', style: { marginTop: '6px' } }, 'Blue: sent, awaiting ack. Green: acked.')), ui.card('Receiver buffer', rcvG, h('p', { class: 'muted small', style: { marginTop: '6px' } }, 'Amber: arrived out of order, held back. Green: delivered to the app.'))),
      h('div', { class: 'twocol' }, ui.card('Congestion window over time', chart), ui.card('Packet log', log.el)),
      h('p', { class: 'muted small' }, '*Slowed down so you can see it. Real round trips are closer to 10–200 ms. One square is one 1000-byte segment.'));

    let st = null;
    const fresh = () => ({ phase: 'idle', pk: [], base: 0, next: 0, rcvNext: 0, buf: new Set(), cwnd: 1, ss: 16, dup: 0, dupTotal: 0, rtx: 0, timer: 0, rtoMul: 1, gap: 0, t: 0, ctrl: 0, ctrlT: 0, isnC: 1000 + Math.floor(Math.random() * 8000), isnS: 1000 + Math.floor(Math.random() * 8000), pts: [], rnd: seeded(Date.now() % 100000), ever: new Set() });
    st = fresh();
    const seqOf = (i) => st.isnC + 1 + i * MSS;
    const ow = () => rttS.value / 2000;
    const rto = () => (rttS.value / 1000 + .4) * st.rtoMul;

    function grids() {
      sndG.textContent = ''; rcvG.textContent = '';
      for (let i = 0; i < N; i++) {
        sndG.append(h('span', { class: 'sq ' + (i < st.base ? 'ack' : i < st.next ? 'sent' : '') }, i + 1));
        rcvG.append(h('span', { class: 'sq ' + (i < st.rcvNext ? 'ack' : st.buf.has(i) ? 'wait' : '') }, i + 1));
      }
      stats.set('cwnd', st.phase === 'idle' ? '–' : st.cwnd.toFixed(1));
      stats.set('flight', st.pk.filter((p) => p.kind === 'data').length);
      stats.set('delivered', st.rcvNext + '/' + N, st.rcvNext === N ? 'good' : '');
      stats.set('rtx', st.rtx, st.rtx ? 'warn' : ''); stats.set('dup', st.dupTotal);
    }
    function spawn(kind, dir, label, seq, color) {
      const y = dir > 0 ? TOP : BOT;
      const c = s('circle', { r: 7 }), hit = s('circle', { r: 16, fill: 'transparent' });
      const tw = label.length * 6.5 + 10;
      const g = s('g', { class: 'pkt drop c-' + color }, s('rect', { x: -tw / 2, y: -24, width: tw, height: 16, rx: 3 }), s('text', { y: -12 }, label), c, hit);
      const p = { kind, dir, seq, g, x: 0, y, doom: st.rnd() * 100 < lossS.value ? .3 + st.rnd() * .5 : null, label };
      g.addEventListener('pointerdown', (e) => { e.preventDefault(); if (p.doom == null || p.doom > p.x) { p.doom = p.x; p.byHand = true; } });
      gP.append(g); st.pk.push(p); return p;
    }
    const sendData = (i, re) => {
      spawn('data', 1, 'seq ' + (i + 1), i, re ? 'ref' : 'req');
      if (re) { st.rtx++; log.add(`Retransmit segment ${i + 1} (seq=${seqOf(i)})`, 'ref'); }
      else log.add(`DATA seq=${seqOf(i)} len=${MSS}`, 'req');
    };
    const CTRL_OPEN = [[1, 'SYN', () => `SYN seq=${st.isnC}`], [-1, 'SYN-ACK', () => `SYN-ACK seq=${st.isnS} ack=${st.isnC + 1}`], [1, 'ACK', () => `ACK ack=${st.isnS + 1}`]];
    const CTRL_CLOSE = [[1, 'FIN', () => `FIN seq=${seqOf(N)}`], [-1, 'ACK', () => `ACK ack=${seqOf(N) + 1}`], [-1, 'FIN', () => `FIN seq=${st.isnS + 1}`], [1, 'ACK', () => `ACK ack=${st.isnS + 2}`]];
    const sendCtrl = () => {
      const list = st.phase === 'open' ? CTRL_OPEN : CTRL_CLOSE, c = list[st.ctrl];
      spawn('ctrl', c[0], c[1], st.ctrl, 'cache'); log.add(c[2](), 'cache'); st.ctrlT = rttS.value / 1000 + .5;
    };
    function start() {
      gP.textContent = ''; st = fresh(); log.clear(); st.phase = 'open'; startB.textContent = 'Restart'; poly.setAttribute('points', '');
      banner.className = 'banner'; banner.textContent = 'Three-way handshake: both sides agree on starting sequence numbers before any data moves.';
      lblC.textContent = 'SYN-SENT'; sendCtrl(); grids();
    }
    function onArrive(p) {
      if (p.kind === 'ctrl') {
        if (st.phase === 'open') {
          if (p.seq !== st.ctrl) return;
          if (st.ctrl === 0) lblS.textContent = 'SYN-RCVD';
          if (st.ctrl === 1) lblC.textContent = 'ESTABLISHED';
          st.ctrl++;
          if (st.ctrl === 3) {
            lblS.textContent = 'ESTABLISHED'; st.phase = 'data'; st.timer = 0; ctx.mission('hand');
            banner.textContent = 'Connected after one round trip. Now the sender may have min(cwnd, receiver window) segments in flight. Try clicking one.';
          } else sendCtrl();
        } else {
          if (p.seq !== st.ctrl) return;
          if (st.ctrl === 0) lblS.textContent = 'CLOSE-WAIT';
          if (st.ctrl === 1) lblC.textContent = 'FIN-WAIT-2';
          if (st.ctrl === 2) lblC.textContent = 'TIME-WAIT';
          st.ctrl++;
          if (st.ctrl === 4) {
            lblS.textContent = 'CLOSED'; st.phase = 'done'; ctx.mission('close');
            banner.className = 'banner ok'; banner.textContent = `All ${N} segments arrived in order, with ${st.rtx} retransmissions. Four-way teardown complete. The client lingers in TIME-WAIT in case the last ACK was lost.`;
          } else sendCtrl();
        }
        return;
      }
      if (p.kind === 'data') {
        const i = p.seq;
        if (i === st.rcvNext) { st.rcvNext++; while (st.buf.has(st.rcvNext)) { st.buf.delete(st.rcvNext); st.rcvNext++; } }
        else if (i > st.rcvNext) st.buf.add(i);
        const a = spawn('ack', -1, 'ack ' + (st.rcvNext + 1), st.rcvNext, i === st.rcvNext - 1 || i < st.rcvNext ? 'res' : 'ref');
        void a;
      } else {
        const a = p.seq;
        if (a > st.base) {
          const was = st.base;
          st.base = a; st.dup = 0; st.timer = 0; st.rtoMul = 1;
          if (cc.checked) for (let i = was; i < a; i++) st.cwnd += st.cwnd < st.ss ? 1 : 1 / st.cwnd;
          log.add(`ACK ack=${seqOf(a)}`, 'res');
          if (st.base === N) {
            st.phase = 'close'; st.ctrl = 0; lblC.textContent = 'FIN-WAIT-1'; sendCtrl();
          }
        } else if (st.phase === 'data' && a === st.base && st.next > st.base) {
          st.dup++; st.dupTotal++;
          log.add(`Duplicate ACK #${st.dup} for seq=${seqOf(a)}`, 'ref');
          if (st.dup === 3) {
            if (cc.checked) { st.ss = Math.max(2, st.cwnd / 2); st.cwnd = st.ss; }
            sendData(st.base, true); st.timer = 0; ctx.mission('fast');
            banner.className = 'banner warn'; banner.textContent = 'Three duplicate acks: the receiver is stuck on a gap, so the sender resends at once, without waiting for a timeout. Fast retransmit.';
          }
        }
      }
    }
    ctx.loop((dt) => {
      if (st.phase === 'idle' || st.phase === 'done') { if (st.pk.length === 0) return; }
      st.t += dt;
      for (const p of st.pk.slice()) {
        p.x += dt / ow();
        const px = LX + (RX - LX) * (p.dir > 0 ? p.x : 1 - p.x);
        p.g.setAttribute('transform', `translate(${px},${p.y})`);
        if (p.doom != null && p.x >= p.doom) {
          p.g.setAttribute('class', 'pkt c-bad'); st.pk.splice(st.pk.indexOf(p), 1);
          const g = p.g; ctx.after(320, () => g.remove());
          log.add(`${p.label} lost in the network`, 'bad');
          if (p.byHand) ctx.mission('drop');
          continue;
        }
        if (p.x >= 1) { p.g.remove(); st.pk.splice(st.pk.indexOf(p), 1); onArrive(p); }
      }
      if (st.phase === 'open' || st.phase === 'close') {
        st.ctrlT -= dt;
        if (st.ctrlT <= 0 && st.ctrl < (st.phase === 'open' ? 3 : 4)) { log.add('Timer expired, resending control packet', 'bad'); sendCtrl(); }
      }
      if (st.phase === 'data') {
        const win = Math.floor(cc.checked ? Math.min(st.cwnd, rwndS.value) : rwndS.value);
        st.gap -= dt;
        if (st.gap <= 0 && st.next < N && st.next - st.base < Math.max(1, win)) { sendData(st.next); st.next++; st.gap = .13; if (rwndS.value <= 2 && st.next > 6) ctx.mission('flow'); }
        if (st.base < st.next) {
          st.timer += dt;
          if (st.timer > rto()) {
            if (cc.checked) { st.ss = Math.max(2, st.cwnd / 2); st.cwnd = 1; }
            st.rtoMul = Math.min(3, st.rtoMul * 1.5); st.timer = 0; st.dup = 0; sendData(st.base, true); ctx.mission('rto');
            banner.className = 'banner bad'; banner.textContent = 'Retransmission timeout: no ack came back in time. TCP reads this as serious congestion, resends, and cuts cwnd to 1.';
          }
        }
      }
      if (st.phase !== 'idle') {
        st.ptT = (st.ptT || 0) + dt;
        if (st.ptT > .2) {
          st.ptT = 0;
          st.pts.push(Math.min(32, st.cwnd));
          const n = st.pts.length, dx = Math.min(4, 390 / n);
          poly.setAttribute('points', st.pts.slice(-390 / dx | 0).map((v, i) => `${26 + i * dx},${82 - v * 2.3}`).join(' '));
          grids();
        }
      }
    });
    grids();
  }

  /* ----- TCP vs UDP stream race ----- */
  function raceTab(root, ctx) {
    const COLS = 24, ROWS = 14, TOTAL = COLS * ROWS;
    const lossS = ui.slider({ label: 'Packet loss', min: 0, max: 25, value: 6, fmt: (v) => v + '%', id: 'race-loss' });
    const rttS = ui.slider({ label: 'Round-trip time', min: 40, max: 300, step: 10, value: 120, fmt: (v) => v + ' ms', id: 'race-rtt' });
    const go = ui.btn('Start the stream', run, { kind: 'primary', id: 'race-go' });
    const tiles = () => h('div', { class: 'tiles', style: { gridTemplateColumns: `repeat(${COLS}, 1fr)` } }, Array.from({ length: TOTAL }, () => h('i')));
    const tTcp = tiles(), tUdp = tiles();
    const sT = ui.stats([['t', 'Finished at', '–'], ['stall', 'Longest freeze', '–'], ['miss', 'Missing tiles', 0]]);
    const sU = ui.stats([['t', 'Finished at', '–'], ['stall', 'Longest freeze', '–'], ['miss', 'Missing tiles', 0]]);
    const verdict = h('div', { class: 'banner' }, 'Both protocols stream the same picture through the same lossy link. Each tile is one packet, sent every 8 ms of stream time.');
    root.append(h('div', { class: 'controls' }, go, lossS, rttS), verdict, h('div', { class: 'twocol' }, ui.card('TCP: complete, in order', tTcp, h('div', { style: { height: '8px' } }), sT), ui.card('UDP: fast, may have holes', tUdp, h('div', { style: { height: '8px' } }), sU)));
    const paint = (i) => {
      const x = i % COLS, y = Math.floor(i / COLS), sky = y < 8;
      const sun = Math.hypot(x - 17, y - 4) < 3.2, hill = y > 8 + 2.2 * Math.sin(x / 3.2);
      return sun ? 'hsl(42 95% 58%)' : hill ? `hsl(${150 + x} 45% ${30 + (y - 8) * 2}%)` : sky ? `hsl(${208 - y * 3} 70% ${70 - y * 2}%)` : `hsl(${28 + y} 70% 62%)`;
    };
    let scope = null;
    function run() {
      if (scope) scope.stop();
      [tTcp, tUdp].forEach((g) => [...g.children].forEach((c) => { c.style.background = ''; }));
      const rnd = seeded(Math.floor(Math.random() * 1e6)), loss = lossS.value / 100, rtt = rttS.value;
      const tick = 8;
      const udpLost = Array.from({ length: TOTAL }, () => rnd() < loss);
      const arrivals = [];
      const lost = Array.from({ length: TOTAL }, () => rnd() < loss);
      for (let i = 0; i < TOTAL; i++) arrivals[i] = rtt / 2 + i * tick + (lost[i] ? rtt * 1.5 + (rnd() < loss ? rtt * 3 : 0) : 0);
      const startTcp = rtt; /* handshake */
      const ready = []; let hi = 0;
      for (let i = 0; i < TOTAL; i++) { hi = Math.max(hi, startTcp + arrivals[i]); ready[i] = hi; }
      let longest = 0; for (let i = 1; i < TOTAL; i++) longest = Math.max(longest, ready[i] - ready[i - 1]);
      const udpAt = (i) => rtt / 2 + i * tick;
      const uEnd = udpAt(TOTAL - 1), tEnd = ready[TOTAL - 1], end = Math.max(uEnd, tEnd);
      let simT = 0, ti = 0, ui_ = 0;
      const missing = udpLost.filter(Boolean).length;
      sT.set('t', '…'); sU.set('t', '…'); sT.set('stall', '…'); sU.set('stall', tick + ' ms'); sT.set('miss', 0, 'good'); sU.set('miss', 0);
      verdict.className = 'banner'; verdict.textContent = 'Streaming…';
      const stop = ctx.loop((dt) => {
        simT += dt * 700; /* slowed to about 1/1.4 real time to stay watchable */
        while (ui_ < TOTAL && udpAt(ui_) <= simT) { if (!udpLost[ui_]) tUdp.children[ui_].style.background = paint(ui_); else { sU.set('miss', tUdpMissing(ui_)); } ui_++; }
        while (ti < TOTAL && ready[ti] <= simT) { tTcp.children[ti].style.background = paint(ti); ti++; }
        if (ui_ >= TOTAL) sU.set('t', fmtMs(uEnd), 'good');
        if (ti >= TOTAL) sT.set('t', fmtMs(tEnd));
        if (simT > end) {
          stop(); sT.set('stall', fmtMs(longest), longest > 100 ? 'bad' : ''); sU.set('miss', missing, missing ? 'bad' : 'good');
          verdict.className = 'banner ok';
          verdict.textContent = `TCP finished ${fmtMs(tEnd - uEnd)} later and froze for up to ${fmtMs(longest)}, because one lost packet holds back everything behind it. UDP never froze, but ${missing} of ${TOTAL} tiles are gone for good.`;
          ctx.mission('race'); if (lossS.value >= 15) ctx.mission('lossy');
        }
      });
      function tUdpMissing(n) { return udpLost.slice(0, n + 1).filter(Boolean).length; }
      scope = { stop };
    }
  }

  RT.lab({
    id: 'tcp', title: 'TCP/IP Stack', short: 'TCP/IP', chapter: 'Network Essentials',
    lede: 'See how your data is wrapped in headers, how routers pass it along, and how TCP turns an unreliable network into a dependable stream of bytes.',
    missions: [
      ['wrap', 'Send a message down the stack and across the network.'],
      ['udp', 'Switch to UDP and compare the size of the header.'],
      ['hand', 'Complete a three-way handshake.'],
      ['drop', 'Click a packet in flight to destroy it.'],
      ['fast', 'Trigger a fast retransmit (needs 3 duplicate acks).'],
      ['rto', 'Trigger a retransmission timeout.'],
      ['flow', 'Throttle the sender with a receiver window of 2 or less.'],
      ['close', 'Finish a transfer and the four-way teardown.'],
      ['race', 'Run the TCP vs UDP stream race.'],
      ['lossy', 'Run the race again with 15% loss or more.'],
    ],
    notes: `<ul>
      <li><b>IP</b> delivers packets host to host, with no promises. Packets can vanish or reorder.</li>
      <li><b>TCP</b> adds a connection, ordering, acks and retransmission, so the app sees a clean byte stream.</li>
      <li><b>UDP</b> adds only ports and a checksum. It's fast and light, and loss is the app's problem.</li>
      <li><b>Flow control</b> protects the receiver. <b>Congestion control</b> protects the network.</li>
      <li>MAC addresses change at every hop. IP addresses stay the same, apart from NAT.</li>
    </ul>`,
    check: { q: 'A video call uses UDP, and a packet is lost. What happens?',
      options: ['The call freezes until the packet is resent', 'The app carries on, with a brief glitch', 'The connection must be re-established', 'The router resends it automatically'], answer: 1,
      why: 'UDP does not retransmit. For live media, a late packet is useless anyway, so the app accepts a small glitch to keep latency low.' },
    render(root, ctx) {
      const panes = { layers: h('div', { class: 'labmain' }), reliable: h('div', { class: 'labmain hide' }), race: h('div', { class: 'labmain hide' }) };
      const made = {};
      const tabs = ui.tabs([['layers', 'Layers & headers'], ['reliable', 'Handshake & retransmits'], ['race', 'TCP vs UDP race']], (v) => {
        Object.entries(panes).forEach(([k, p]) => p.classList.toggle('hide', k !== v));
        if (!made[v]) { made[v] = true; ({ layers: layersTab, reliable: reliableTab, race: raceTab })[v](panes[v], ctx); }
      });
      root.append(tabs, ...Object.values(panes));
      tabs.set('layers');
    },
  });
})();
