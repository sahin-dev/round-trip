/* The Designer: palette, canvas and component inspector, shared by the Design Studio and the game. */
(function () {
  const { h, s, ui, clamp } = RT;
  const D = window.RTDesign, { TYPES, DEFAULTS } = D;
  const W = 1000, H = 560, NW = 140, NH = 64;
  const OUT = D.LINKS;
  const money = (n) => (n >= 1e6 ? '$' + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : n >= 1e4 ? '$' + Math.round(n / 1000) + 'k' : '$' + Math.round(n).toLocaleString());
  function summary(n0) {
    const n = D.normalize({ nodes: [n0], edges: [] }).nodes[0];
    switch (n.type) {
      case 'users': return n.regions + (n.regions > 1 ? ' regions' : ' region');
      case 'app': case 'worker': return `${n.count} × ${n.cpu} CPU · ${n.ram} GB${n.auto ? ' · auto' : ''}`;
      case 'sql': return `${n.shards} × ${n.cpu} CPU · ${n.disk} TB${n.replicas ? ' · ' + n.replicas + ' repl' : ''}`;
      case 'nosql': return `${n.count} × ${n.cpu} CPU · ${n.disk} TB`;
      case 'cache': return `${n.memGB} GB · ${n.count} node${n.count > 1 ? 's' : ''}`;
      case 'cdn': case 'blob': return 'managed service';
      default: return `${n.count} × ${n.cpu} CPU · ${n.ram} GB`;
    }
  }

  /* o: get/set the design, result(), last(), refresh(), persist(), idle(box, api); optional allowed and defaults */
  RT.Designer = function (ctx, o) {
    const st = { get design() { return o.get(); }, set design(v) { o.set(v); } };
    let selected = null, selEdge = null, history = [];
    const palette = h('div', { class: 'palette', 'aria-label': 'Components' });
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'net studio-canvas', role: 'group', 'aria-label': 'Design canvas' });
      const gGrid = s('g'), gE = s('g'), gF = s('g'), gN = s('g'), temp = s('path', { class: 'lnk hot', fill: 'none', 'stroke-dasharray': '5 4', style: 'pointer-events:none' });
      svg.append(s('defs', null, s('marker', { id: 'st-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 9, markerHeight: 9, markerUnits: 'userSpaceOnUse', orient: 'auto' }, s('path', { d: 'M0,0L8,4L0,8z', fill: 'var(--wire)' }))), gGrid, gE, gF, gN, temp);
      const inspector = h('div', { class: 'card inspector' });
      /* ---------- palette ---------- */
      Object.keys(TYPES).filter((t) => t !== 'users' && (!o.allowed || o.allowed.includes(t))).forEach((t) => {
        const b = h('button', { class: 'pal', title: TYPES[t].short }, h('b', null, TYPES[t].label), h('span', null, TYPES[t].short));
        let startX, startY, ghost = null;
        const move = (e) => {
          if (!ghost && Math.hypot(e.clientX - startX, e.clientY - startY) > 6) { ghost = h('div', { class: 'pal-ghost' }, TYPES[t].label); document.body.append(ghost); }
          if (ghost) { ghost.style.left = e.clientX + 8 + 'px'; ghost.style.top = e.clientY + 8 + 'px'; }
        };
        const up = (e) => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
          if (ghost) {
            ghost.remove(); ghost = null;
            const hit = document.elementFromPoint(e.clientX, e.clientY);
            if (hit && hit.closest && hit.closest('.studio-canvas')) { const p = toSvg(e); addNode(t, p.x - NW / 2, p.y - NH / 2); }
            b.dataset.dragged = '1';
          }
        };
        b.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; startX = e.clientX; startY = e.clientY; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); });
        b.addEventListener('click', () => { if (b.dataset.dragged) { delete b.dataset.dragged; return; } addNode(t); });
        palette.append(b);
      });
      ctx.onDispose(() => { document.querySelectorAll('.pal-ghost').forEach((g) => g.remove()); });

      function toSvg(e) { const m = svg.getScreenCTM().inverse(), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m); return p; }
      const snap = (v) => Math.round(v / 11) * 11;
      const nodeById = (id) => st.design.nodes.find((n) => n.id === id);
      function freeSpot() {
        for (let x = 187; x < W - NW; x += 165) for (let y = 33; y < H - NH; y += 99) {
          if (!st.design.nodes.some((n) => Math.abs(n.x - x) < NW && Math.abs(n.y - y) < NH + 8)) return { x, y };
        }
        return { x: 187, y: 33 };
      }
      function addNode(type, x, y) {
        const spot = x == null ? freeSpot() : { x: clamp(snap(x), 0, W - NW), y: clamp(snap(y), 0, H - NH) };
        const id = type + Math.random().toString(36).slice(2, 7);
        change(() => { st.design.nodes.push({ id, type, ...spot, ...DEFAULTS[type], ...((o.defaults || {})[type]) }); selected = id; selEdge = null; });
        collapseCard();
      }
      function collapseCard() { const c = document.querySelector('.explain'); if (c && c.open) c.open = false; }
      function connect(a, b) {
        if (a === b) return;
        const A = nodeById(a), B = nodeById(b);
        if (!OUT[A.type].includes(B.type)) {
          const hint = { users: 'Users are the source of traffic, so nothing connects into them.', sql: 'Data stores only answer. Connect from the service that calls them.', nosql: 'Data stores only answer. Connect from the service that calls them.', blob: 'Object storage only answers.', search: 'A search index only answers.' }[A.type];
          RT.toast(hint || `${TYPES[A.type].label} can't call ${TYPES[B.type].label} directly. ${TYPES[A.type].label} connects to: ${OUT[A.type].map((t) => TYPES[t].label).join(', ')}.`);
          return;
        }
        if (st.design.edges.some(([x, y]) => x === a && y === b)) return;
        change(() => { st.design.edges.push([a, b]); });
      }
      function removeSelected() {
        if (selected && nodeById(selected)?.type !== 'users') { const id = selected; change(() => { st.design.nodes = st.design.nodes.filter((n) => n.id !== id); st.design.edges = st.design.edges.filter((e) => !e.includes(id)); selected = null; }); }
        else if (selEdge) { const [a, b] = selEdge; change(() => { st.design.edges = st.design.edges.filter(([x, y]) => !(x === a && y === b)); selEdge = null; }); }
      }
      function change(fn) { history.push(JSON.stringify(st.design)); if (history.length > 60) history.shift(); fn(); o.persist(); o.refresh(); }
      function undo() { if (!history.length) return; st.design = JSON.parse(history.pop()); selected = null; selEdge = null; o.persist(); o.refresh(); }

      /* ---------- canvas ---------- */
      const paths = [];
      function edgePath(a, b) {
        const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, dx = Math.max(40, Math.abs(x2 - x1) / 2);
        return `M${x1},${y1}C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
      }
      function drawCanvas() {
        gE.textContent = ''; gN.textContent = ''; gF.textContent = ''; paths.length = 0;
        const r = o.result();
        st.design.edges.forEach(([a, b]) => {
          const A = nodeById(a), B = nodeById(b);
          if (!A || !B) return;
          const d = edgePath(A, B), rate = r ? r.edges[a + '>' + b] || 0 : 0, sel = selEdge && selEdge[0] === a && selEdge[1] === b;
          const hit = s('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 13, style: 'cursor:pointer', onclick(e) { e.stopPropagation(); selEdge = [a, b]; selected = null; o.refresh(); } });
          const line = s('path', { d, class: 'lnk ' + (sel ? 'hot' : ''), 'marker-end': 'url(#st-arrow)', style: rate ? 'stroke-width:' + clamp(1.4 + Math.log10(rate + 1) * .45, 1.6, 4) : 'stroke-dasharray:4 5' });
          gE.append(line, hit);
          if (rate > 0) { const bad = r.nodes[b] && r.nodes[b].util > 1; for (let i = 0; i < clamp(Math.ceil(Math.log10(rate + 1)), 1, 4); i++) { const dot = s('circle', { r: 3, fill: bad ? 'var(--bad)' : 'var(--accent)', style: 'pointer-events:none' }); gF.append(dot); paths.push({ line, dot, off: i / 4 }); } }
        });
        st.design.nodes.forEach((n) => {
          const x = r ? r.nodes[n.id] : null, u = x ? x.util : 0, down = x && x.down;
          const body = s('rect', { class: 'body', width: NW, height: NH, rx: 5 });
          const g = s('g', { class: 'node click ' + (down ? 'dead' : u > 1 ? 'err' : u > .75 ? 'miss' : n.id === selected ? 'on' : ''), transform: `translate(${n.x},${n.y})`, tabindex: 0, role: 'button', 'aria-label': `${TYPES[n.type].label}, ${summary(n)}, ${Math.round(u * 100)} percent utilised`, 'data-id': n.id },
            body, s('text', { class: 't', x: NW / 2, y: 20 }, TYPES[n.type].label), s('text', { class: 'u', x: NW / 2, y: 35 }, summary(n)));
          if (n.type !== 'users') {
            const fin = Number.isFinite(u) ? u : 0, ww = NW - 50;
            g.append(s('rect', { x: 10, y: 45, width: ww, height: 8, rx: 2, fill: 'var(--panel-2)' }), s('rect', { x: 10, y: 45, width: ww * Math.min(1, fin), height: 8, rx: 2, fill: fin > 1 ? 'var(--bad)' : fin > .75 ? 'var(--ref)' : 'var(--res)' }),
              s('text', { class: 'u', x: NW - 22, y: 53 }, n.type === 'cdn' || n.type === 'blob' ? '∞' : Math.round(fin * 100) + '%'));
          }
          if (n.id === selected) g.append(s('rect', { x: -3, y: -3, width: NW + 6, height: NH + 6, rx: 7, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2 }));
          if (OUT[n.type].length) {
            const port = s('circle', { class: 'port', cx: NW, cy: NH / 2, r: 8 });
            port.addEventListener('pointerdown', (e) => startWire(e, n));
            g.append(port);
          }
          g.addEventListener('pointerdown', (e) => startDrag(e, n));
          g.addEventListener('keydown', (e) => {
            const k = { ArrowLeft: [-11, 0], ArrowRight: [11, 0], ArrowUp: [0, -11], ArrowDown: [0, 11] }[e.key];
            if (k) { e.preventDefault(); n.x = clamp(n.x + k[0], 0, W - NW); n.y = clamp(n.y + k[1], 0, H - NH); drawCanvas(); o.persist(); gN.querySelector(`[data-id="${n.id}"]`).focus(); }
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected = n.id; selEdge = null; o.refresh(); }
          });
          gN.append(g);
        });
      }
      function startDrag(e, n) {
        if (e.target.classList.contains('port')) return;
        e.preventDefault(); selected = n.id; selEdge = null;
        const p0 = toSvg(e), ox = n.x, oy = n.y, before = JSON.stringify(st.design);
        let moved = false;
        const move = (ev) => { const p = toSvg(ev); n.x = clamp(snap(ox + p.x - p0.x), 0, W - NW); n.y = clamp(snap(oy + p.y - p0.y), 0, H - NH); moved = true; drawCanvas(); };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (moved) { history.push(before); o.persist(); } o.refresh(); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      }
      function startWire(e, n) {
        e.preventDefault(); e.stopPropagation();
        const x1 = n.x + NW, y1 = n.y + NH / 2;
        gN.querySelectorAll('[data-id]').forEach((g) => { const t = nodeById(g.dataset.id); g.classList.toggle('can-link', !!t && t.id !== n.id && OUT[n.type].includes(t.type)); });
        const move = (ev) => { const p = toSvg(ev); temp.setAttribute('d', `M${x1},${y1}L${p.x},${p.y}`); };
        const up = (ev) => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); temp.setAttribute('d', '');
          gN.querySelectorAll('.can-link').forEach((g) => g.classList.remove('can-link'));
          const el = document.elementFromPoint(ev.clientX, ev.clientY), g = el && el.closest && el.closest('[data-id]');
          if (g) connect(n.id, g.dataset.id);
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      }
      svg.addEventListener('pointerdown', (e) => { if (e.target === svg || e.target === gGrid) { selected = null; selEdge = null; o.refresh(); } });
      const onKey = (e) => {
        if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { if (selected || selEdge) { e.preventDefault(); removeSelected(); } }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      };
      window.addEventListener('keydown', onKey); ctx.onDispose(() => window.removeEventListener('keydown', onKey));
      let phase = 0;
      ctx.loop((dt) => {
        if (RT.reduced) return;
        phase = (phase + dt * .45) % 1;
        paths.forEach((p) => { const len = p.line.getTotalLength(), pt = p.line.getPointAtLength(((phase + p.off) % 1) * len); p.dot.setAttribute('cx', pt.x); p.dot.setAttribute('cy', pt.y); });
      });

      /* ---------- inspector ---------- */
      function field(label, input) { return h('label', { class: 'insp' }, h('span', null, label), input); }
      function numInput(n, key, label, min, max) {
        const i = h('input', { type: 'number', id: 'in-' + key, min, max, value: n[key], onchange() { const v = clamp(Math.round(+i.value) || min, min, max); i.value = v; change(() => { nodeById(n.id)[key] = v; }); } });
        return field(label, i);
      }
      function check(n, key, label) {
        const i = h('input', { type: 'checkbox', id: 'in-' + key, checked: n[key], onchange() { const v = i.checked; change(() => { nodeById(n.id)[key] = v; }); } });
        return h('label', { class: 'check' }, i, label);
      }
      /* Processor, memory and storage for one instance */
      function hwFields(n0) {
        if (!D.HW[n0.type]) return [];
        const n = D.normalize({ nodes: [n0], edges: [] }).nodes[0], live = () => nodeById(n0.id);
        const pick = (key, label, steps, fmt) => {
          const sel = h('select', { id: 'in-' + key, onchange() { const v = isNaN(+sel.value) ? sel.value : +sel.value; change(() => { live()[key] = v; }); } }, steps.map((v) => h('option', { value: v }, fmt(v))));
          sel.value = n[key];
          return field(label, sel);
        };
        const out = [h('p', { class: 'insp-head' }, 'Hardware for one instance'),
          pick('cpu', 'Processor', D.CPU_STEPS, (v) => v + ' vCPU'), pick('ram', 'Memory (RAM)', D.RAM_STEPS, (v) => v + ' GB')];
        if (D.HW[n.type].disk) out.push(pick('disk', 'Storage', D.DISK_STEPS, (v) => (v < 1 ? v * 1000 + ' GB' : v + ' TB')), pick('diskType', 'Storage type', ['ssd', 'hdd'], (v) => (v === 'ssd' ? 'SSD: fast' : 'HDD: cheap, slow')));
        const hw = D.hwOf(n), label = hw.limit === 'ram' ? 'Limited by RAM' : hw.limit === 'cpu' ? 'Limited by processor' : 'CPU and RAM are balanced';
        out.push(h('p', { class: 'small ' + (hw.limit === 'balanced' ? 'good' : 'muted') }, `${label}. ${D.hwSpeed(n)} · $${Math.round(D.hwPrice(n))}/mo each`));
        return out;
      }
      function drawInspector() {
        inspector.textContent = '';
        if (selEdge && !(nodeById(selEdge[0]) && nodeById(selEdge[1]))) selEdge = null;
        if (selEdge) {
          const [a, b] = selEdge;
          inspector.append(h('h2', null, 'Connection'), h('p', { class: 'small' }, `${TYPES[nodeById(a).type].label} → ${TYPES[nodeById(b).type].label}`), ui.btn('Remove connection', removeSelected, { kind: 'danger', id: 'st-del-edge' }));
          return;
        }
        const n = selected && nodeById(selected);
        if (!n) { o.idle(inspector, api); return; }
        const T = TYPES[n.type], x = ((o.result() || o.last() || { nodes: {} }).nodes[n.id]) || {};
        inspector.append(h('h2', null, T.label), h('p', { class: 'small muted', style: { marginBottom: '6px' } }, T.short));
        const box = h('div', { class: 'inspgrid' });
        switch (n.type) {
          case 'users': { const sel = h('select', { id: 'in-regions', onchange() { const v = +sel.value; change(() => { nodeById(n.id).regions = v; }); } }, [1, 2, 3].map((v) => h('option', { value: v }, v))); sel.value = n.regions; box.append(field('Regions', sel), h('p', { class: 'small muted' }, 'More regions cut distance and add failover, but they multiply compute cost.')); break; }
          case 'app': case 'worker': box.append(numInput(n, 'count', 'Instances', 1, 8000), ...hwFields(n), check(n, 'auto', 'Auto-scale (+10% cost, doubles in a spike)'), check(n, 'multiAZ', 'Spread across zones')); break;
          case 'cache': box.append(numInput(n, 'memGB', 'Total RAM (GB)', 1, 100000), numInput(n, 'count', 'Nodes', 1, 500), check(n, 'coalesce', 'Coalesce misses (locks)'), check(n, 'multiAZ', 'Spread across zones')); break;
          case 'sql': box.append(numInput(n, 'shards', 'Shards', 1, 500), numInput(n, 'replicas', 'Read replicas per shard', 0, 5), ...hwFields(n), check(n, 'syncRep', 'Synchronous replication'), check(n, 'multiAZ', 'Spread across zones')); break;
          case 'nosql': box.append(numInput(n, 'count', 'Nodes', 3, 5000), numInput(n, 'rf', 'Replication factor', 1, 5), ...hwFields(n), check(n, 'multiAZ', 'Spread across zones')); break;
          case 'cdn': case 'blob': box.append(h('p', { class: 'small muted' }, 'Fully managed. It scales by itself, and you pay for usage.')); break;
          default: box.append(numInput(n, 'count', 'Instances', 1, 500), ...hwFields(n), check(n, 'multiAZ', 'Spread across zones'));
        }
        inspector.append(box);
        if (n.type !== 'users') {
          inspector.append(h('div', { class: 'small', style: { margin: '8px 0 6px' } }, `Load: ${Math.round((x.util || 0) * 100)}% · Cost: ${money(x.cost || 0)}/mo`));
          const opts = st.design.nodes.filter((o) => OUT[n.type].includes(o.type) && !st.design.edges.some(([p, q]) => p === n.id && q === o.id));
          if (opts.length) {
            const sel = h('select', { id: 'in-connect', 'aria-label': 'Connect to' }, opts.map((o) => h('option', { value: o.id }, TYPES[o.type].label)));
            inspector.append(field('Connect to', sel), ui.btn('Connect', () => connect(n.id, sel.value), { id: 'st-connect' }));
          }
          inspector.append(h('div', { style: { height: '6px' } }), ui.btn('Remove component', removeSelected, { kind: 'danger', id: 'st-del' }));
        } else {
          const opts = st.design.nodes.filter((o) => OUT.users.includes(o.type) && !st.design.edges.some(([p, q]) => p === n.id && q === o.id));
          if (opts.length) { const sel = h('select', { id: 'in-connect', 'aria-label': 'Connect to' }, opts.map((o) => h('option', { value: o.id }, TYPES[o.type].label))); inspector.append(field('Connect to', sel), ui.btn('Connect', () => connect(n.id, sel.value), { id: 'st-connect' })); }
        }
      }
      for (let x = 0; x <= W; x += 110) gGrid.append(s('line', { x1: x, x2: x, y1: 0, y2: H, stroke: 'var(--grid)' }));
      const api = { collapseCard, change, undo, removeSelected, connect, addNode,
        el: h('div', { class: 'studio' }, palette, h('div', { class: 'stage', style: { position: 'relative' } }, svg), inspector),
        draw() { drawCanvas(); drawInspector(); },
        reset() { selected = null; selEdge = null; history = []; } };
      return api;
  };
  RT.Designer.summary = summary; RT.Designer.money = money;
})();
