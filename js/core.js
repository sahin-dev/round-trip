/* Round Trip core: DOM helpers, routing, progress, form controls, and the two
   drawing engines every lab shares: Net (topology) and Ladder (sequence diagram). */
window.RT = (function () {
  'use strict';
  const SVGNS = 'http://www.w3.org/2000/svg';

  function build(node, attrs, kids) {
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') node.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'value' && 'value' in node) node.value = v;
      else if (k === 'checked' || k === 'disabled') node[k] = !!v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }
  const h = (t, a, ...k) => {
    const el = build(document.createElement(t), a, k);
    if (t === 'div' && a && /\b(stage|scroll)\b/.test(a.class || '')) { el.tabIndex = 0; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Scrollable area'); }
    return el;
  };
  const s = (t, a, ...k) => build(document.createElementNS(SVGNS, t), a, k);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const osReduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const defaultAssume = () => ({ app: 1, db: 1, cache: 1, price: 1, floor: 98 });
  const settings = Object.assign({ theme: 'system', zoom: 1, speed: 1, motion: false, level: 'new', tips: true, path: 'full', rail: 'all', welcomed: false, seenTour: false, lang: 'en', openOn: 'auto', tab: {}, read: {}, depth: '', style: '', railOpen: {} }, (function () {
    try { return JSON.parse(localStorage.getItem('roundtrip.settings')) || {}; } catch { return {}; }
  })());
  settings.assume = Object.assign(defaultAssume(), settings.assume);
  settings.speed = [.25, .5, 1, 2, 4].includes(+settings.speed) ? +settings.speed : 1;
  const saveSettings = () => { try { localStorage.setItem('roundtrip.settings', JSON.stringify(settings)); } catch { /* settings last for this visit */ } };
  const isReduced = () => osReduced || settings.motion;

  /* FNV-1a, used wherever a lab needs a stable hash of a string. */
  function hash(str, seed) {
    let x = (0x811c9dc5 ^ (seed || 0)) >>> 0;
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995) >>> 0; x ^= x >>> 15;
    return x >>> 0;
  }
  function seeded(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const fmtMs = (ms) => (ms >= 10000 ? (ms / 1000).toFixed(1) + ' s' : ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms');

  /* ---------- progress ---------- */
  const store = {
    read() { try { return JSON.parse(localStorage.getItem('roundtrip.progress') || '{}'); } catch { return {}; } },
    write(v) { try { localStorage.setItem('roundtrip.progress', JSON.stringify(v)); } catch { /* the page works without storage */ } },
  };
  let progress = store.read();
  function ledClass(def) {
    const total = (def.missions || []).length, got = (progress[def.id] || []).length, read = settings.read && settings.read[def.id];
    if (!total) return read ? 'led full' : 'led';
    return !got && !read ? 'led' : got >= total ? 'led full' : 'led part';
  }

  /* ---------- registry ---------- */
  const labs = [], byId = {};
  /* The ten roadmap stages go after 'Game': learn-more.js adds them from STAGES, the one place that sets lesson order. */
  const TRACKS = [
    ['Start here', ['roadmap', 'map']],
    ['Game', ['game']],
    ['Practice', ['estimate', 'workbench', 'studio', 'trainer', 'review']],
    ['Interview', ['playbook', 'walkthroughs']],
    ['Reference', ['guide', 'glossary', 'cheatsheet', 'about']],
  ];
  function lab(def) { labs.push(def); byId[def.id] = def; }

  /* ---------- speed ---------- */
  let speed = settings.speed;
  /* Durations are in simulated milliseconds: the clock applies the speed, reduced motion shortens them. */
  const ms = (v) => v * (isReduced() ? .25 : 1);

  /* ---------- animation clocks ----------
     Every animation reads simulated time from a clock instead of the wall clock, so it can be paused,
     nudged forward and slowed down. Time runs at the chosen speed while playing and stands still while
     paused. One frame loop serves every clock, and sleeps only when nothing is scheduled. */
  const clocks = new Set();
  let driving = false;
  function drive() {
    if (driving) return;
    driving = true;
    const tick = () => {
      let busy = false;
      clocks.forEach((c) => { if (c.service()) busy = true; });
      if (busy) requestAnimationFrame(tick); else driving = false;
    };
    requestAnimationFrame(tick);
  }
  function Clock() {
    let base = 0, realBase = performance.now(), paused = false, stopAt = null, seq = 0;
    const timers = [], frames = new Set(), subs = new Set();
    const raw = () => (paused ? base : base + (performance.now() - realBase) * speed);
    const c = {
      now() { const t = raw(); return stopAt != null ? Math.min(t, stopAt) : t; },
      get paused() { return paused; },
      /* Run fn once, t simulated ms from now. Returns a cancel function. */
      after(t, fn) {
        const at = c.now() + Math.max(0, t), id = ++seq;
        let i = timers.length;
        while (i > 0 && timers[i - 1].at > at) i--;
        timers.splice(i, 0, { at, fn, id });
        drive();
        return () => { const k = timers.findIndex((x) => x.id === id); if (k >= 0) timers.splice(k, 1); };
      },
      /* fn(now, dt) runs every frame while time moves. Returns a stop function. */
      frame(fn) { const f = { fn, last: c.now() }; frames.add(f); drive(); return () => frames.delete(f); },
      service() {
        if (stopAt != null && raw() >= stopAt) { base = stopAt; paused = true; stopAt = null; c.emit(); }
        const now = c.now();
        while (timers.length && timers[0].at <= now) { const x = timers.shift(); try { x.fn(); } catch (e) { if (window.console) console.error(e); } }
        frames.forEach((f) => { const dt = now - f.last; if (dt <= 0 && f.ran) return; f.last = now; f.ran = true; try { f.fn(now, dt); } catch (e) { frames.delete(f); if (window.console) console.error(e); } });
        return !paused && !!(timers.length || frames.size);
      },
      rebase() { base = raw(); realBase = performance.now(); },
      pause() { if (paused) return; base = raw(); paused = true; stopAt = null; c.emit(); },
      play() { if (!paused && stopAt == null) return; if (paused) { realBase = performance.now(); paused = false; } stopAt = null; drive(); c.emit(); },
      toggle() { if (paused) c.play(); else c.pause(); },
      /* Move time forward by t simulated ms, smoothly, then stop again. */
      step(t) { const from = c.now(); if (!paused) c.pause(); base = from; realBase = performance.now(); paused = false; stopAt = from + (t || 250); drive(); c.emit(); },
      clear() { timers.length = 0; frames.clear(); },
      on(fn) { subs.add(fn); return () => subs.delete(fn); },
      emit() { subs.forEach((f) => f(c)); },
      dispose() { c.clear(); subs.clear(); clocks.delete(c); },
    };
    clocks.add(c);
    return c;
  }
  const clock = Clock();
  /* A hidden tab stops animating, and picks up where it was when it returns. */
  let hiddenPaused = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (!clock.paused) { clock.pause(); hiddenPaused = true; } }
    else if (hiddenPaused) { hiddenPaused = false; clock.play(); }
  });
  clock.on(() => document.documentElement.classList.toggle('rt-paused', clock.paused));

  /* ---------- lab runtime ---------- */
  function makeCtx(def, sideEls, clk) {
    let alive = true;
    const cl = clk || clock, cancels = new Set(), off = [];
    const later = (t, fn) => { const stop = cl.after(t, () => { cancels.delete(stop); if (alive) fn(); }); cancels.add(stop); return stop; };
    const ctx = {
      def,
      clock: cl,
      alive: () => alive,
      ms,
      now: () => cl.now(),
      /* A sleep that never resolves once the lab is left, so async flows just stop. */
      sleep(t) { return new Promise((res) => { if (alive) later(ms(t), res); }); },
      /* Repeats on simulated time, so pausing stops it and a faster speed runs it faster. */
      every(t, fn) {
        let on = true, stop = null;
        const run = () => { stop = later(t, () => { if (!on) return; fn(); run(); }); };
        run();
        return () => { on = false; if (stop) stop(); };
      },
      after(t, fn) { later(ms(t), fn); },
      /* fn(now, dt) every frame of simulated time; stops when the lab is left. */
      frame(fn) {
        const stop = cl.frame((now, dt) => { if (alive) fn(now, dt); });
        cancels.add(stop);
        return () => { stop(); cancels.delete(stop); };
      },
      loop(fn) {
        const stop = cl.frame((now, dt) => { if (alive) fn(Math.min(.05 * speed, dt / 1000), now); });
        cancels.add(stop);
        return () => { stop(); cancels.delete(stop); };
      },
      onDispose(fn) { off.push(fn); },
      mission(id) {
        const got = progress[def.id] || (progress[def.id] = []);
        if (got.includes(id) || !(def.missions || []).some((m) => m[0] === id)) return;
        got.push(id); store.write(progress);
        const m = def.missions.find((x) => x[0] === id);
        toast((settings.lang === 'bn' ? 'মিশন সম্পন্ন: ' : 'Mission done: ') + (RT.missionText ? RT.missionText(def, id, m[1]) : m[1]).replace(/[.।]$/, ''));
        sideEls.refresh(); refreshRail();
      },
      /* A cancellable group of sleeps, for labs that can restart mid-run. */
      scope() {
        let on = true;
        return {
          sleep: (t) => new Promise((res) => { ctx.sleep(t).then(() => { if (on) res(); }); }),
          live: () => on && alive,
          cancel() { on = false; },
        };
      },
      /* A lab that can stop between messages. It has no buttons of its own: the page's control dock shows
         a "One step at a time" switch for it, and its Next button releases each pause. */
      stepper() {
        let resolve = null;
        const st = {
          el: null,
          get stepping() { return !!settings.stepMode; },
          get waiting() { return !!resolve; },
          gate() { if (!settings.stepMode || !alive) return Promise.resolve(); return new Promise((r) => { resolve = r; dockPaint(); }); },
          release() { if (resolve) { const r = resolve; resolve = null; dockPaint(); r(); } },
        };
        ctx.stepperObj = st;
        return st;
      },
      /* Hand this page's control dock something to drive, such as a journey on the System Map. */
      useDock(target) { ctx.dockTarget = target || null; if (pageDock) pageDock.attach(target); },
      dispose() {
        if (!alive) return;
        alive = false;
        cancels.forEach((f) => f()); cancels.clear();
        off.forEach((f) => f());
      },
    };
    return ctx;
  }

  /* ---------- form controls ---------- */
  let uid = 0;
  const ui = {
    btn(label, fn, opts) {
      const o = opts || {};
      return h('button', { class: 'btn ' + (o.kind || ''), id: o.id, disabled: o.disabled, onclick: fn, title: o.title }, label);
    },
    seg(label, options, value, onChange) {
      const el = h('div', { class: 'seg', role: 'group', 'aria-label': label });
      const btns = options.map(([v, text]) => {
        const b = h('button', { 'aria-pressed': String(v === value), onclick() { set(v, true); } }, text);
        b.dataset.v = v; el.append(b); return b;
      });
      function set(v, fire) {
        el.value = v;
        btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
        if (fire && onChange) onChange(v);
      }
      el.value = value; el.set = set;
      return el;
    },
    field(label, control, cls) { return h('div', { class: 'field ' + (cls || '') }, h('span', { class: 'fieldlabel' }, label), control); },
    slider(o) {
      const id = o.id || 'r' + (++uid);
      const fmt = o.fmt || ((v) => v);
      const out = h('span', { class: 'mono' }, fmt(o.value));
      const input = h('input', { type: 'range', id, min: o.min, max: o.max, step: o.step || 1, value: o.value,
        oninput() { out.textContent = fmt(+input.value); if (o.onInput) o.onInput(+input.value); } });
      const el = h('div', { class: 'field' }, h('label', { for: id }, o.label + ': ', out), input);
      el.input = input;
      Object.defineProperty(el, 'value', { get: () => +input.value, set: (v) => { input.value = v; out.textContent = fmt(+v); } });
      return el;
    },
    toggle(o) {
      const id = o.id || 'c' + (++uid);
      const input = h('input', { type: 'checkbox', id, checked: o.checked, onchange() { if (o.onChange) o.onChange(input.checked); } });
      const el = h('label', { class: 'check', for: id }, input, o.label);
      el.input = input;
      Object.defineProperty(el, 'checked', { get: () => input.checked, set: (v) => { input.checked = v; } });
      return el;
    },
    select(o) {
      const id = o.id || 's' + (++uid);
      const sel = h('select', { id, onchange() { if (o.onChange) o.onChange(sel.value); } }, o.options.map(([v, t]) => h('option', { value: v }, t)));
      sel.value = o.value;
      const el = h('div', { class: 'field' }, h('label', { for: id }, o.label), sel);
      el.sel = sel;
      Object.defineProperty(el, 'value', { get: () => sel.value, set: (v) => { sel.value = v; } });
      return el;
    },
    stats(items) {
      const map = {};
      const el = h('div', { class: 'stats' }, items.map(([id, label, value]) => {
        const b = h('b', null, value == null ? '–' : value), wrap = h('div', { class: 'stat' }, b, h('span', null, label));
        map[id] = { b, wrap }; return wrap;
      }));
      el.set = (id, v, tone) => { map[id].b.textContent = v; map[id].wrap.className = 'stat ' + (tone || ''); };
      return el;
    },
    log(opts) {
      const el = h('div', { class: 'log', 'aria-live': 'polite' }), o = opts || {};
      if (o.max) el.style.maxHeight = o.max + 'px';
      return {
        el,
        add(text, kind, onClick) {
          const row = onClick
            ? h('button', { class: 'k-' + (kind || 'x'), onclick() { el.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel')); row.classList.add('sel'); onClick(); } }, text)
            : h('div', { class: 'k-' + (kind || 'x') }, text);
          el.append(row); el.scrollTop = el.scrollHeight; return row;
        },
        clear() { el.textContent = ''; },
      };
    },
    tabs(items, onChange) {
      const el = h('div', { class: 'tabs', role: 'tablist' });
      const btns = items.map(([v, t]) => { const b = h('button', { role: 'tab', 'aria-selected': 'false', onclick() { set(v); } }, t); b.dataset.v = v; el.append(b); return b; });
      function set(v) { btns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === v))); onChange(v); }
      el.set = set;
      return el;
    },
    card(title, ...kids) { return h('div', { class: 'card' }, title && h('h2', null, title), kids); },
    bar(cls) { const i = h('i'); const el = h('div', { class: 'bar ' + (cls || '') }, i); el.set = (p) => { i.style.width = clamp(p, 0, 100) + '%'; }; return el; },
  };

  /* ---------- Net: boxes, links, and packets that travel between them ---------- */
  function Net(ctx, opts) {
    const o = opts || {}, W = o.w || 900, H = o.h || 420;
    const svg = s('svg', { class: 'net', viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': o.label || 'Network diagram' });
    const gBack = s('g'), gL = s('g'), gN = s('g'), gP = s('g');
    svg.append(gBack, gL, gN, gP);
    const nodes = {}, links = {};
    const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    const api = {
      svg, nodes, W, H, back: gBack, front: gP,
      node(id, n) {
        const w = n.w || 112, ht = n.h || 50;
        const body = s('rect', { class: 'body', x: -w / 2, y: -ht / 2, width: w, height: ht, rx: 5 });
        const t = s('text', { class: 't', y: n.sub === undefined ? 4 : -3 }, n.label || id);
        const u = s('text', { class: 'u', y: 13 }, n.sub || '');
        const g = s('g', { class: 'node ' + (n.cls || '') + (n.onClick ? ' click' : ''), transform: `translate(${n.x},${n.y})`, tabindex: n.onClick ? 0 : null, role: n.onClick ? 'button' : null,
          'aria-label': n.onClick ? (n.label || id) : null, onclick: n.onClick, onkeydown: n.onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); n.onClick(); } } : null }, body, t, u);
        gN.append(g);
        nodes[id] = { ...n, id, w, h: ht, g, t, u, body };
        return api;
      },
      link(a, b, l) {
        const A = nodes[a], B = nodes[b];
        const line = s('line', { class: 'lnk ' + ((l && l.cls) || ''), x1: A.x, y1: A.y, x2: B.x, y2: B.y });
        gL.append(line); links[key(a, b)] = line;
        return api;
      },
      linkClass(a, b, cls) { const l = links[key(a, b)]; if (l) l.setAttribute('class', 'lnk ' + (cls || '')); },
      state(id, cls) {
        const n = nodes[id];
        n.g.setAttribute('class', 'node ' + (cls || '') + ' ' + (n.cls || '') + (n.onClick ? ' click' : ''));
      },
      label(id, t) { nodes[id].t.textContent = t; },
      sub(id, t) { nodes[id].u.textContent = t; },
      flash(id, cls, t) { api.state(id, cls); ctx.after(t || 450, () => api.state(id, '')); },
      /* A ring that spreads out from a node, to show that something arrived. */
      ripple(id, color) {
        const n = nodes[id];
        if (!n || isReduced()) return;
        const r = s('rect', { class: 'ripple c-' + (color || 'req'), x: n.x - n.w / 2, y: n.y - n.h / 2, width: n.w, height: n.h, rx: 7 });
        gBack.append(r);
        const t0 = clockOf(ctx).now();
        const stop = frameOf(ctx)((now) => {
          const t = clamp((now - t0) / 420, 0, 1), d = 2 + t * 10;
          r.setAttribute('x', n.x - n.w / 2 - d); r.setAttribute('y', n.y - n.h / 2 - d);
          r.setAttribute('width', n.w + d * 2); r.setAttribute('height', n.h + d * 2);
          r.setAttribute('opacity', (1 - t) * .4);
          if (t >= 1) { stop(); r.remove(); }
        });
      },
      /* Move a packet from a to b. Resolves true when it lands, false if it was clicked away.
         Packets glide at a steady pace with a short trail. On a drawn link, requests and replies keep to
         their own lane and the wire lights up in the packet's colour while it is in use. */
      send(a, b, p) {
        const A = nodes[a] || a, B = nodes[b] || b, opt = p || {};
        const label = opt.label || '', color = opt.color || 'req', fx = !isReduced();
        const wire = typeof a === 'string' && typeof b === 'string' ? links[key(a, b)] : null;
        const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        const lane = wire ? (a < b ? 4 : -4) : 0, ox = -uy * lane, oy = ux * lane;
        const g = s('g', { class: 'pkt c-' + color + (opt.onDrop ? ' drop' : '') });
        if (label) {
          const tw = label.length * 6.5 + 12;
          g.append(s('rect', { x: -tw / 2, y: -19, width: tw, height: 16, rx: 3 }), s('text', { y: -7 }, label));
        }
        g.append(s('circle', { r: opt.r || 6 }));
        const trail = fx ? s('line', { class: 'pkt-trail c-' + color }) : null;
        const flow = fx && wire ? s('line', { class: 'lnk-flow c-' + color, x1: A.x + ox, y1: A.y + oy, x2: B.x + ox, y2: B.y + oy }) : null;
        if (flow) gL.append(flow);
        if (trail) gP.append(trail);
        gP.append(g);
        const cl = clockOf(ctx), dur = Math.max(1, ms(opt.dur || 700));
        const tidy = () => { g.remove(); if (trail) trail.remove(); if (flow) flow.remove(); };
        return new Promise((res) => {
          let dropped = false, done = false;
          if (opt.onDrop) g.addEventListener('click', () => { dropped = true; if (cl.paused) { finish(false); tidy(); opt.onDrop(); } });
          const t0 = cl.now();
          const finish = (v) => { if (done) return; done = true; stop(); res(v); };
          const place = (e) => {
            const x = lerp(A.x, B.x, e) + ox, y = lerp(A.y, B.y, e) + oy;
            g.setAttribute('transform', `translate(${x},${y})`);
            if (trail) {
              const back = Math.min(26, e * len);
              trail.setAttribute('x1', x - ux * back); trail.setAttribute('y1', y - uy * back);
              trail.setAttribute('x2', x); trail.setAttribute('y2', y);
            }
          };
          place(0);
          const stop = frameOf(ctx)((now) => {
            if (done) return;
            const t = clamp((now - t0) / dur, 0, 1), e = opt.linear ? t : glide(t);
            place(e);
            if (dropped) { tidy(); if (opt.onDrop) opt.onDrop(); finish(false); return; }
            if (opt.dropAt != null && t >= opt.dropAt) {
              finish(false);
              g.setAttribute('class', 'pkt c-bad'); if (flow) flow.remove();
              if (trail) trail.remove();
              if (!fx) { ctx.after(260, () => g.remove()); return; }
              /* A lost packet tumbles off the wire and fades, so the loss is easy to spot. */
              const x0 = lerp(A.x, B.x, e) + ox, y0 = lerp(A.y, B.y, e) + oy, f0 = cl.now();
              const fall = frameOf(ctx)((n2) => {
                const k = clamp((n2 - f0) / 520, 0, 1);
                g.setAttribute('transform', `translate(${x0 + k * 6},${y0 + k * k * 26}) rotate(${k * 40})`);
                g.setAttribute('opacity', 1 - k);
                if (k >= 1) { fall(); g.remove(); }
              });
              return;
            }
            if (t >= 1) { tidy(); if (typeof b === 'string' && !opt.quiet) api.ripple(b, color); finish(true); }
          });
        });
      },
    };
    return api;
  }
  /* Neither too linear nor too bouncy: quick to leave, steady in the middle, gentle to land. */
  const glide = (t) => t - (Math.sin(2 * Math.PI * t) * .55) / (2 * Math.PI);
  const clockOf = (ctx) => (ctx && ctx.clock) || clock;
  const frameOf = (ctx) => (ctx && ctx.frame ? ctx.frame : (fn) => clock.frame(fn));

  /* ---------- Ladder: the classic protocol sequence diagram ---------- */
  function Ladder(ctx, opts) {
    const o = opts || {};
    const W = o.w || 760, asideW = o.aside ? (o.asideW || 210) : 0, rowH = o.rowH || 42, top = 52;
    const actors = o.actors;
    const pad = 72, usable = W - asideW - pad * 2;
    const xs = actors.map((a, i) => pad + (actors.length > 1 ? (usable * i) / (actors.length - 1) : usable / 2));
    const svg = s('svg', { class: 'lad', viewBox: `0 0 ${W} 120`, role: 'img', 'aria-label': o.label || 'Sequence diagram' });
    svg.style.minWidth = (o.minWidth || 640) + 'px';
    const gLife = s('g'), gRows = s('g'), gHead = s('g');
    svg.append(gLife, gRows, gHead);
    const lifes = xs.map((x) => { const l = s('line', { class: 'life', x1: x, x2: x, y1: top - 6, y2: 120 }); gLife.append(l); return l; });
    actors.forEach((a, i) => {
      gHead.append(s('text', { class: 'who', x: xs[i], y: 19 }, a.name), s('text', { class: 'who2', x: xs[i], y: 33 }, a.sub || ''));
    });
    if (o.aside) gHead.append(s('text', { class: 'who', x: W - asideW + 8, y: 19, style: 'text-anchor:start' }, o.aside), s('text', { class: 'who2', x: W - asideW + 8, y: 33, style: 'text-anchor:start' }, o.asideSub || ''));
    let y = top + 8, selected = null;
    const grow = () => {
      const H = y + 18;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      lifes.forEach((l) => l.setAttribute('y2', H));
      const box = svg.parentElement;
      if (box && box.scrollHeight > box.clientHeight) box.scrollTop = box.scrollHeight;
    };
    const api = {
      svg,
      reset() { gRows.textContent = ''; y = top + 8; selected = null; grow(); },
      band(text, color) {
        const g = s('g', { class: 'c-' + (color || 'mute') });
        g.append(s('rect', { class: 'band', x: 6, y, width: W - 12, height: 21, rx: 2 }), s('text', { class: 'bandt', x: (W - asideW) / 2, y: y + 15 }, text));
        gRows.append(g); y += 28; grow();
      },
      note(text) { gRows.append(s('text', { class: 'note', x: (W - asideW) / 2, y: y + 11 }, text)); y += 19; grow(); },
      /* Draw a message from actor i to actor j; resolves true if delivered. */
      msg(i, j, m) {
        const x1 = xs[i], x2 = xs[j], y1 = y + 6, y2 = y + rowH - 8, dir = x2 > x1 ? 1 : -1;
        const row = s('g', { class: 'row c-' + (m.color || 'req') });
        const hit = s('rect', { class: 'rowhit', x: 0, y: y - 1, width: W, height: rowH });
        const shaft = s('line', { class: 'arr', x1, y1, x2: x1, y2: y1 });
        const lblw = m.label.length * 6.9 + 10, mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const bg = s('rect', { class: 'lblbg', x: mx - lblw / 2, y: my - 9, width: lblw, height: 16, opacity: 0 });
        const lbl = s('text', { class: 'lbl', x: mx, y: my + 3, opacity: 0 }, m.label);
        const tip = s('polygon', { class: 'tip', points: `0,0 ${-9 * dir},-4 ${-9 * dir},4`, opacity: 0 });
        row.append(hit, shaft, bg, lbl, tip);
        if (o.aside) {
          const t = String(m.aside || '');
          row.append(s('text', { class: 'aside', x: W - asideW + 8, y: y + rowH / 2 + 3 }, t.length > asideW / 6.1 ? t.slice(0, Math.floor(asideW / 6.1) - 1) + '…' : t));
        }
        if (m.onSelect) {
          row.addEventListener('click', () => { if (selected) selected.classList.remove('sel'); selected = row; row.classList.add('sel'); m.onSelect(); });
        }
        gRows.append(row);
        const myRowY = y; y += rowH; grow();
        const dur = Math.max(1, ms(m.dur || 620)), cl = clockOf(ctx);
        /* A dot rides the front of the arrow, so the eye follows the message as it travels. */
        const head = isReduced() ? null : s('circle', { class: 'head', r: 4.5, cx: x1, cy: y1 });
        if (head) row.append(head);
        return new Promise((res) => {
          const t0 = cl.now();
          let done = false;
          const stopF = frameOf(ctx)((now) => {
            if (done) return;
            const t = clamp((now - t0) / dur, 0, 1), stop = m.lost ? .6 : 1, e = Math.min(glide(t), stop);
            const hx = lerp(x1, x2, e), hy = lerp(y1, y2, e);
            shaft.setAttribute('x2', hx); shaft.setAttribute('y2', hy);
            if (head) { head.setAttribute('cx', hx); head.setAttribute('cy', hy); }
            if (t > .3) { bg.setAttribute('opacity', 1); lbl.setAttribute('opacity', 1); }
            if (t >= stop || (m.lost && e >= stop)) {
              done = true; stopF();
              if (head) head.remove();
              if (m.lost) {
                const cx = lerp(x1, x2, stop), cy = lerp(y1, y2, stop);
                row.setAttribute('class', 'row c-bad');
                row.append(s('path', { class: 'arr', d: `M${cx - 6},${cy - 6}L${cx + 6},${cy + 6}M${cx + 6},${cy - 6}L${cx - 6},${cy + 6}` }));
                res(false); return;
              }
              tip.setAttribute('opacity', 1); tip.setAttribute('transform', `translate(${x2},${y2}) rotate(${(Math.atan2(y2 - y1, Math.abs(x2 - x1)) * 180 / Math.PI) * dir})`);
              res(true);
            }
          });
          void myRowY;
        });
      },
    };
    grow();
    return api;
  }

  /* ---------- SHA-256 and HMAC, in JS so they run in any context ---------- */
  const K256 = new Uint32Array(64);
  (function () {
    let n = 0, p = 2;
    const prime = (x) => { for (let i = 2; i * i <= x; i++) if (x % i === 0) return false; return true; };
    while (n < 64) { if (prime(p)) { const c = Math.cbrt(p); K256[n++] = Math.floor((c - Math.floor(c)) * 4294967296); } p++; }
  })();
  function sha256(bytes) {
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const l = bytes.length, total = ((l + 9 + 63) & ~63);
    const m = new Uint8Array(total); m.set(bytes); m[l] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor(l / 536870912)); dv.setUint32(total - 4, (l << 3) >>> 0);
    const w = new Uint32Array(64), rr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let i = 0; i < total; i += 64) {
      for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
      for (let t = 16; t < 64; t++) {
        const a = w[t - 15], b = w[t - 2];
        w[t] = (w[t - 16] + (rr(a, 7) ^ rr(a, 18) ^ (a >>> 3)) + w[t - 7] + (rr(b, 17) ^ rr(b, 19) ^ (b >>> 10))) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = H;
      for (let t = 0; t < 64; t++) {
        const t1 = (hh + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K256[t] + w[t]) | 0;
        const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += hh;
    }
    const out = new Uint8Array(32), od = new DataView(out.buffer);
    H.forEach((v, i) => od.setUint32(i * 4, v));
    return out;
  }
  function hmac(key, msg) {
    if (key.length > 64) key = sha256(key);
    const pad = (x) => { const b = new Uint8Array(64).fill(x); key.forEach((k, i) => { b[i] ^= k; }); return b; };
    const cat = (a, b) => { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
    return sha256(cat(pad(0x5c), sha256(cat(pad(0x36), msg))));
  }
  const utf8 = (t) => new TextEncoder().encode(t);

  /* ---------- rail, routing, shell ---------- */
  let mainEl, railEl, current = null, RT_quiz = null, started = false;
  function toast(text) {
    const old = document.querySelector('.toast'); if (old) old.remove();
    const t = h('div', { class: 'toast', role: 'status' }, text);
    document.body.append(t); setTimeout(() => t.remove(), 2600);
  }
  function refreshRail() {
    if (!railEl) return;
    const route = location.hash.slice(1);
    railEl.querySelectorAll('.port').forEach((p) => {
      const id = p.dataset.lab;
      if (id === (route || 'home')) p.setAttribute('aria-current', 'page'); else p.removeAttribute('aria-current');
      if (byId[id]) p.querySelector('.led').className = ledClass(byId[id]);
    });
    railEl.querySelectorAll('details.track').forEach((d) => {
      const leds = d.querySelectorAll('.led'), n = d.querySelector('.track-n');
      if (n) n.textContent = `${d.querySelectorAll('.led.full').length}/${leds.length}`;
      if (d.querySelector('[aria-current="page"]')) d.open = true;
    });
  }
  const name = (def) => (RT.labText ? RT.labText(def, 'short') : def.short || def.title);
  function setSpeed(v) {
    clocks.forEach((c) => c.rebase());
    speed = v; settings.speed = v; saveSettings();
    document.querySelectorAll('.dk-speed button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === v)));
    clocks.forEach((c) => c.emit());
  }
  function railGroups() {
    if (settings.rail === 'path' && RT.pathLabs) return [[RT.pathName(), RT.pathLabs()]];
    return TRACKS;
  }
  function applySettings() {
    const root = document.documentElement;
    if (settings.theme === 'system') { if (root.dataset.rtTheme) { root.removeAttribute('data-theme'); delete root.dataset.rtTheme; } }
    else { root.setAttribute('data-theme', settings.theme); root.dataset.rtTheme = '1'; }
    if (mainEl) mainEl.style.zoom = settings.zoom;
    root.setAttribute('lang', settings.lang || 'en');
  }
  function rebuildRail() {
    if (!railEl) return;
    const open = railEl.classList.contains('open'), old = railEl, fresh = buildRail();
    if (open) fresh.classList.add('open');
    old.replaceWith(fresh); refreshRail();
  }
  function buildRail() {
    const nav = h('nav', { 'aria-label': 'Labs' },
      h('a', { class: 'port', href: '#', 'data-lab': 'home' }, h('span', { class: 'led full', style: { background: '#fff', boxShadow: 'none' } }), 'Press Enter'),
      railGroups().map(([group, ids]) => {
        const open = settings.rail === 'path' || (group in settings.railOpen ? settings.railOpen[group] : group === 'Start here' || group === 'How the web works');
        return h('details', { class: 'track', open: open || null },
          h('summary', { onclick(e) { settings.railOpen[group] = !e.currentTarget.parentElement.open; saveSettings(); } }, h('h2', null, group), h('span', { class: 'track-n' })),
          ids.filter((i) => byId[i]).map((id) => h('a', { class: 'port', href: '#' + id, 'data-lab': id }, h('span', { class: ledClass(byId[id]) }), name(byId[id]))));
      }));
    railEl = h('aside', { class: 'rail', 'aria-label': 'Site navigation' },
      h('a', { class: 'brand', href: '#' }, 'Round Trip', h('small', null, 'System design you can poke')),
      h('button', { class: 'rail-toggle', 'aria-label': 'Show all labs', onclick() { railEl.classList.toggle('open'); } }, 'All labs'),
      h('div', { class: 'rail-tools' }, h('button', { id: 'open-search', onclick() { RT.openSearch(); } }, 'Search'), h('button', { id: 'open-settings', onclick() { RT.openSettings(); } }, 'Settings')),
      h('div', { class: 'lang-switch', role: 'group', 'aria-label': 'Language' }, h('button', { id: 'lang-en', 'aria-pressed': String(settings.lang !== 'bn'), onclick() { RT.setLang('en'); } }, 'English'), h('button', { id: 'lang-bn', 'aria-pressed': String(settings.lang === 'bn'), onclick() { RT.setLang('bn'); } }, 'বাংলা')),
      nav);
    return railEl;
  }
  RT_quiz = function (c) {
    const why = h('p', { class: 'small muted hide' }, c.why);
    const opts = c.options.map((text, i) => h('button', { onclick() {
      opts.forEach((b, j) => { b.disabled = true; if (j === c.answer) b.classList.add('right'); else if (j === i) b.classList.add('wrong'); });
      why.classList.remove('hide');
    } }, text));
    return ui.card('Check yourself', h('div', { class: 'quiz' }, h('p', null, c.q), opts, why));
  };
  /* ---------- playback controls ---------- */
  const ICONS = {
    play: 'M5 3.5v13l11-6.5z', pause: 'M5 3.5h3.6v13H5zM11.4 3.5H15v13h-3.6z', step: 'M4 3.5v13l9-6.5zM14 3.5h2.6v13H14z',
    back: 'M16 3.5v13L7 10zM4 3.5h2.6v13H4z', reset: 'M10 3a7 7 0 1 1-6.6 4.7l2 .7A4.9 4.9 0 1 0 10 5.1V8L5.6 4.3 10 .6z',
  };
  const icon = (k) => s('svg', { class: 'pb-ico', viewBox: '0 0 20 20', 'aria-hidden': 'true', focusable: 'false' }, s('path', { d: ICONS[k] }));
  const SPEEDS = [[.25, '¼×'], [.5, '½×'], [1, '1×'], [2, '2×'], [4, '4×']];
  const bnSay = (en, b) => (settings.lang === 'bn' ? b : en);
  /* ---------- the control dock ----------
     A page that animates gets exactly one control bar, and nothing else on the page plays, pauses or
     changes speed. The dock drives whatever is on screen: the walkthrough on a Theory tab, the lab on a
     Lab tab, the journey on the System Map. Each of those hands the dock a target saying what it can do:
       { name, playing(), toggle(), next(), reset(), status(),
         optional: back(), canBack(), canNext(), ended(), steps() → { n, idx }, jump(i), stepper(),
                   nextTitle(), backTitle, reveal(), suspend() → wasPlaying, resume(), on(fn) → off, ticks } */
  let pageDock = null;
  const dockPaint = () => { if (pageDock) pageDock.paint(); };
  function Dock() {
    let t = null, off = null;
    const reveal = () => { if (t && t.reveal) t.reveal(); };
    const btn = (k, id, en, b, fn) => h('button', { class: 'dk-btn', id, type: 'button', onclick() { if (t) { fn(); reveal(); paint(); } } }, icon(k), h('span', null, bnSay(en, b)));
    const back = btn('back', 'dk-back', 'Back', 'পেছনে', () => t.back());
    const play = h('button', { class: 'dk-btn dk-main', id: 'dk-play', type: 'button', onclick() { if (t) { t.toggle(); reveal(); paint(); } } });
    const next = btn('step', 'dk-next', 'Next', 'পরেরটি', () => t.next());
    const reset = btn('reset', 'dk-reset', 'Reset', 'রিসেট', () => t.reset());
    reset.title = bnSay('Start again from the beginning (R)', 'একদম শুরু থেকে আবার (R)');
    const lamp = h('span', { class: 'dk-lamp', 'aria-hidden': 'true' }), name = h('b', { class: 'dk-name' }), status = h('span', { class: 'dk-status', role: 'status' });
    const dots = h('div', { class: 'dk-steps', role: 'group', 'aria-label': bnSay('Jump to a step', 'একটি ধাপে যান') });
    const modeIn = h('input', { type: 'checkbox', id: 'dk-mode', onchange() {
      settings.stepMode = modeIn.checked; saveSettings();
      const st = t && t.stepper && t.stepper();
      if (st && !modeIn.checked) st.release();
      paint();
    } });
    const mode = h('label', { class: 'dk-mode', for: 'dk-mode', title: bnSay('Stop after every message and wait for Next', 'প্রতিটি বার্তার পরে থেমে পরেরটির অপেক্ষা') }, modeIn, bnSay('One step at a time', 'এক এক ধাপ করে'));
    const sp = h('div', { class: 'dk-speed', role: 'group', 'aria-label': bnSay('Speed', 'গতি') }, SPEEDS.map(([v, txt]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(v === speed), title: bnSay('Speed ', 'গতি ') + txt, onclick() { setSpeed(v); } }, txt);
      b.dataset.v = v; return b;
    }));
    /* Two steady rows: the controls, then what they are driving and where it has got to. */
    const el = h('div', { class: 'dock', role: 'toolbar', 'aria-label': bnSay('Animation controls', 'অ্যানিমেশন নিয়ন্ত্রণ'), hidden: true },
      h('div', { class: 'dk-row' },
        h('div', { class: 'dk-btns' }, back, play, next, reset), mode,
        h('div', { class: 'dk-speedwrap' }, h('span', { class: 'dk-lbl' }, bnSay('Speed', 'গতি')), sp)),
      h('div', { class: 'dk-row dk-what' }, lamp, name, status, dots,
        h('span', { class: 'dk-keys', 'aria-hidden': 'true' }, bnSay('Keys: Space plays · ← → step · R resets', 'কী: Space চালায় · ← → ধাপ · R রিসেট'))));
    function paint() {
      el.hidden = !t;
      if (!t) return;
      const playing = t.playing(), ended = !playing && !!(t.ended && t.ended());
      name.textContent = t.name;
      status.textContent = t.status();
      el.classList.toggle('is-paused', !playing);
      play.textContent = '';
      play.append(icon(playing ? 'pause' : ended ? 'reset' : 'play'), h('span', null, playing ? bnSay('Pause', 'থামান') : ended ? bnSay('Replay', 'আবার দেখুন') : bnSay('Play', 'চালান')));
      play.setAttribute('aria-pressed', String(playing));
      play.title = playing ? bnSay('Pause (Space)', 'থামান (Space)') : bnSay('Play (Space)', 'চালান (Space)');
      back.disabled = !(t.canBack && t.canBack());
      back.title = t.backTitle || bnSay('Previous step (←)', 'আগের ধাপ (←)');
      next.disabled = t.canNext ? !t.canNext() : false;
      next.title = t.nextTitle ? t.nextTitle() : bnSay('Next step (→)', 'পরের ধাপ (→)');
      const st = t.stepper && t.stepper();
      next.classList.toggle('dk-attn', !!(st && st.waiting));
      mode.hidden = !st; modeIn.checked = !!settings.stepMode;
      const s = t.steps && t.steps();
      dots.hidden = !s;
      if (s) {
        if (dots.children.length !== s.n) {
          dots.textContent = '';
          for (let i = 0; i < s.n; i++) dots.append(h('button', { class: 'dk-dot', type: 'button', 'aria-label': bnSay('Step ', 'ধাপ ') + (i + 1), onclick() { if (t && t.jump) { t.jump(i); reveal(); paint(); } } }));
        }
        [...dots.children].forEach((d, i) => { d.className = 'dk-dot' + (i < s.idx ? ' done' : i === s.idx ? ' now' : ''); if (i === s.idx) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current'); });
      }
    }
    /* A running lab's clock readout moves on its own; everything else repaints when it changes. */
    const iv = setInterval(() => { if (t && t.ticks && t.playing()) paint(); }, 250);
    return {
      el, paint,
      get target() { return t; },
      /* Switching what the dock drives pauses what you left, and resumes it if you come back. */
      attach(nt) {
        if (t === (nt || null)) { paint(); return; }
        if (t && t.suspend) t.held = t.suspend();
        if (off) { off(); off = null; }
        t = nt || null;
        if (t && t.held && t.resume) { t.held = false; t.resume(); }
        if (t && t.on) off = t.on(paint);
        paint();
      },
      dispose() { if (off) off(); off = null; clearInterval(iv); },
    };
  }
  /* Keys work anywhere on the page, except while typing: Space or K plays and pauses, the arrow keys
     (or comma and full stop) step back and forward, and R resets. */
  document.addEventListener('keydown', (e) => {
    const t = pageDock && pageDock.target;
    if (!t || e.ctrlKey || e.metaKey || e.altKey || !pageDock.el.isConnected) return;
    const el = e.target, tag = (el && el.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (el && el.isContentEditable) || (el && el.closest && el.closest('dialog'))) return;
    const k = e.key.toLowerCase();
    if (k === ' ' && /^(BUTTON|A|SUMMARY|LABEL)$/.test(tag)) return;
    const act = { ' ': 'toggle', k: 'toggle', arrowright: 'next', '.': 'next', arrowleft: 'back', ',': 'back', r: 'reset' }[k];
    if (!act || (act === 'back' && !(t.canBack && t.canBack())) || (act === 'next' && t.canNext && !t.canNext())) return;
    e.preventDefault();
    t[act]();
    if (t.reveal) t.reveal();
    pageDock.paint();
  });

  function renderLab(def) {
    const missionBox = h('div');
    const T = (k, fb) => (RT.labText ? RT.labText(def, k) : fb);
    const side = { refresh() {
      const got = progress[def.id] || [];
      missionBox.textContent = '';
      (def.missions || []).forEach(([id, text]) => missionBox.append(h('div', { class: 'mission ' + (got.includes(id) ? 'done' : '') }, h('span', { class: 'box' }), h('span', null, RT.missionText ? RT.missionText(def, id, text) : text))));
    } };
    const ctx = makeCtx(def, side);
    current = ctx;
    const D = pageDock = Dock();
    ctx.onDispose(() => { D.dispose(); if (pageDock === D) pageDock = null; });
    const stage = h('div', { class: 'labmain' });
    const sideEl = h('aside', { class: 'side' });
    const check = RT.checkFor ? RT.checkFor(def) : def.check;
    const theory = !def.plain && RT.hasTheory && RT.hasTheory(def);
    if (def.missions) sideEl.append(ui.card('Missions', missionBox));
    const notes = RT.notesFor ? RT.notesFor(def) : def.notes;
    sideEl.setAttribute('aria-label', 'Missions and key ideas');
    if (notes) sideEl.append(ui.card('Key ideas', h('div', { class: 'notes', html: notes })));
    if (check && !theory) sideEl.append(RT.quiz(check));
    mainEl.append(h('header', { class: 'labhead' },
      h('div', { class: 'eyebrow' }, T('chapter', def.chapter)),
      h('h1', null, T('title', def.title)), h('p', { class: 'lede' }, T('lede', def.lede))));
    const labPane = h('div', { class: 'labgrid ' + (def.wide ? 'wide' : '') }, stage, sideEl);
    side.refresh();
    let mounted = false, labCtx = null, labT0 = 0;
    const mount = () => {
      if (mounted) return;
      mounted = true;
      labCtx = makeCtx(def, side);
      labT0 = clock.now();
      if (RT.beforeLab) RT.beforeLab(stage, def, labCtx);
      try { def.render(stage, labCtx); } catch (e) { showCrash(stage, e); }
      if (RT.afterLab) RT.afterLab(stage, def, labCtx);
      D.paint();
    };
    ctx.onDispose(() => { if (labCtx) labCtx.dispose(); });
    /* Reset throws the lab away and builds it again from nothing. */
    const reset = () => {
      if (labCtx) labCtx.dispose();
      clock.clear(); clock.play();
      stage.textContent = '';
      mounted = false; mount();
      toast(bnSay('Lab reset: everything is back to the start', 'ল্যাব রিসেট: সবকিছু শুরুর অবস্থায়'));
    };
    const stepperOf = () => (labCtx && labCtx.stepperObj) || null;
    const waiting = () => { const st = stepperOf(); return !!(st && st.waiting); };
    /* What the dock does on a Lab tab. Labs only run forward, so Next nudges time on, or shows the next
       message when the lab is stopping after each one. */
    const labTarget = {
      name: bnSay('Lab', 'ল্যাব'), ticks: true,
      playing: () => !clock.paused && !waiting(),
      toggle() { if (waiting()) { clock.play(); stepperOf().release(); } else clock.toggle(); },
      next() { if (waiting()) { clock.play(); stepperOf().release(); } else clock.step(300); },
      reset,
      canBack: () => false,
      backTitle: bnSay('A lab only runs forward. Use Reset to start again.', 'ল্যাব শুধু সামনে চলে। আবার শুরু করতে রিসেট চাপুন।'),
      nextTitle: () => (waiting() ? bnSay('Show the next message (→)', 'পরের বার্তা দেখান (→)') : bnSay('Move forward a moment (→)', 'একটু এগিয়ে যান (→)')),
      stepper: stepperOf,
      status() {
        if (waiting()) return bnSay('Waiting for you: press Next', 'আপনার অপেক্ষায়: পরেরটি চাপুন');
        const sim = ((clock.now() - labT0) / 1000).toFixed(1);
        return (clock.paused ? bnSay('Paused', 'থেমে আছে') : bnSay('Running', 'চলছে')) + ' · ' + bnSay('sim time ', 'সিমুলেশন ') + sim + ' s';
      },
      suspend() { const was = !clock.paused; clock.pause(); return was; },
      resume() { clock.play(); },
      on: (fn) => clock.on(fn),
    };
    const sceneOf = (root) => { const sc = root && root.querySelector('.scene'); return (sc && sc.target) || null; };
    if (def.theoryOnly) { const art = RT.renderTheory(def, null, ctx); mainEl.append(D.el, art); D.attach(sceneOf(art)); return; }
    if (!theory) { mainEl.append(D.el, labPane); mount(); return; }
    /* A paused lab wakes up when you ask it to do something. */
    if (RT.SCENES && RT.SCENES[def.id]) stage.addEventListener('click', (e) => { if (clock.paused && e.target.closest('button, .chip, .node.click')) clock.play(); }, true);
    const pane = h('div', { class: 'theory-pane' });
    const topic = !!(RT.SCENES && RT.SCENES[def.id]);
    let sceneTarget = null;
    const tabs = ui.tabs([['theory', 'Theory'], ['lab', 'Lab']], (v) => {
      pane.classList.toggle('hide', v !== 'theory'); labPane.classList.toggle('hide', v !== 'lab');
      settings.tab[def.id] = v; saveSettings();
      if (v === 'lab') mount();
      /* Practice tools such as the Estimator and Studio have their own controls, so the dock is for topics. */
      D.attach(v === 'lab' ? (topic ? labTarget : (labCtx && labCtx.dockTarget) || null) : sceneTarget);
    });
    tabs.classList.add('topic-tabs');
    pane.append(RT.renderTheory(def, () => { tabs.set('lab'); window.scrollTo(0, 0); }, ctx));
    sceneTarget = sceneOf(pane);
    mainEl.append(tabs, D.el, pane, labPane);
    const first = settings.tab[def.id] || (settings.openOn === 'auto' ? (settings.level === 'pro' || (progress[def.id] || []).length ? 'lab' : 'theory') : settings.openOn);
    tabs.set(first);
  }
  /* A broken page shows a way out, and leaves the rest of the site working. */
  function showCrash(where, err) {
    if (window.console) console.error(err);
    const bn = settings.lang === 'bn';
    where.append(h('div', { class: 'banner bad', role: 'alert' }, bn ? 'এই অংশটি লোড করতে সমস্যা হয়েছে। পেজটি আবার লোড করুন, অথবা অন্য বিষয়ে যান। আপনার অগ্রগতি নিরাপদ আছে।' : 'This part of the page could not load. Reload the page, or go to another topic. Your progress is safe.', ' ', h('button', { class: 'btn', onclick() { location.reload(); } }, bn ? 'আবার লোড করুন' : 'Reload')));
  }
  function route() {
    if (current) { current.dispose(); current = null; }
    clock.clear(); clock.play();
    mainEl.textContent = '';
    const id = location.hash.slice(1);
    if (byId[id]) {
      const name = (RT.labText ? RT.labText(byId[id], 'title') : byId[id].title);
      document.title = name + ' · Round Trip';
      const meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute('content', RT.labText ? RT.labText(byId[id], 'lede') : byId[id].lede);
      try { renderLab(byId[id]); } catch (e) { showCrash(mainEl, e); }
    }
    else {
      document.title = 'Round Trip';
      const ctx = makeCtx({ id: 'home', missions: [] }, { refresh() {} });
      current = ctx;
      try { RT.home(mainEl, ctx); } catch (e) { showCrash(mainEl, e); }
      if (RT.afterHome) RT.afterHome();
    }
    refreshRail();
    if (railEl) railEl.classList.remove('open');
    window.scrollTo(0, 0);
    if (started) mainEl.focus({ preventScroll: true });
    started = true;
  }
  function start() {
    mainEl = h('main', { id: 'main', tabindex: -1 });
    applySettings();
    const app = document.getElementById('app');
    app.textContent = '';
    app.append(h('a', { class: 'skip', href: '#main', onclick(e) { e.preventDefault(); mainEl.focus(); } }, settings.lang === 'bn' ? 'মূল অংশে যান' : 'Skip to content'), h('div', { class: 'shell' }, buildRail(), mainEl));
    window.addEventListener('unhandledrejection', (e) => { if (window.console) console.error(e.reason); });
    window.addEventListener('hashchange', route);
    if (RT.afterStart) RT.afterStart();
    route();
  }

  return { h, s, ui, clamp, lerp, ease, glide, hash, seeded, hexOf, fmtMs, sha256, hmac, utf8, Net, Ladder, Clock, clock, now: () => clock.now(), icon, makeCtx, lab, labs, byId, TRACKS, start, toast, ledClass, settings, saveSettings, applySettings, setSpeed, rebuildRail, defaultAssume, reroute: route, get quiz() { return RT_quiz; }, get speed() { return speed; },
    get reduced() { return isReduced(); }, get progress() { return progress; }, home: null };
})();
