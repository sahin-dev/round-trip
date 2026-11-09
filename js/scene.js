/* Guided walkthroughs. Each topic has a short animated story that plays one step at a time, with a
   caption for every step, and the extra lesson sections that round a topic off: when to use it, what it
   costs, what to say in an interview, where it shows up, and one more question.

   Topic files call RT.enrich({ id: { scene, en, bn } }). A scene is plain data:

     scene: {
       h: 240,                                        // drawing height; the width is always 720
       n: { c: ['Client|ক্লায়েন্ট', 90, 120, 'sub|উপ'] },  // id: [label, x, y, sub label, width]
       l: 'c-lb lb-s1',                               // wires, as a-b pairs
       i: '!s2 ghost',                                // optional: how things look before step 1
       s: [['English caption', 'বাংলা ক্যাপশন', 'actions'], ...],
     }

   Text that differs by language is written 'English|বাংলা'. Actions run in order, separated by ';'.
   Actions joined with '&' run at the same time.
     a>b label         send a packet; add :res :ref :bad :cache :mute for colour, :lost to drop it,
                       :fast or :slow for pace (a>b:res:slow 200 OK)
     !a cls  /  !a     set or clear a node's look: on, hit, miss, err, dead, alt, ghost (a,b,c for several)
     @a text  /  @a    set or clear the small line under a node's name
     =a text           rename a node
     ~a-b cls  /  ~a-b set or clear a wire's look: hot, cut, ghost
     *a                ring a node, to draw the eye
     +500              wait 500 ms                                                                  */
(function () {
  const { h, s, ui } = RT;
  const S = RT.settings;
  const bn = () => S.lang === 'bn';
  const say = (en, b) => (bn() ? b : en);
  const pick = (v) => { const [e, b] = String(v == null ? '' : v).split('|'); return bn() && b != null ? b : e; };
  RT.SCENES = {};
  RT.MORE = {};
  RT.enrich = (list) => Object.entries(list).forEach(([id, t]) => {
    if (t.scene) RT.SCENES[id] = t.scene;
    if (t.en) RT.MORE[id] = { en: t.en, bn: t.bn };
  });

  const W = 720, PACE = { fast: 560, slow: 1600 }, COLORS = ['req', 'res', 'ref', 'bad', 'cache', 'mute'];
  const SEND = /^(\w+)>(\w+)((?::\w+)*)(?:\s+(.*))?$/;
  /* Turn one step's action text into beats: a list of lists of parallel actions. */
  function parse(text) {
    return String(text || '').split(';').map((b) => b.trim()).filter(Boolean).map((b) => b.split('&').map((a) => a.trim()).filter(Boolean));
  }
  /* Problems with a scene, for the tests. An empty list means it will play. */
  RT.checkScene = (sc) => {
    const out = [], has = (id) => Object.prototype.hasOwnProperty.call(sc.n || {}, id);
    String(sc.l || '').split(/\s+/).filter(Boolean).forEach((l) => { const [a, b] = l.split('-'); if (!has(a) || !has(b)) out.push('wire ' + l); });
    [['', '', sc.i], ...(sc.s || [])].forEach((st, i) => {
      if (i && (!st[0] || !/[ঀ-৿]/.test(st[1] || ''))) out.push('step ' + i + ' caption');
      parse(st[2]).flat().forEach((a) => {
        let m;
        if ((m = a.match(SEND))) { if (!has(m[1]) || !has(m[2])) out.push('step ' + i + ' send ' + a); m[3].split(':').filter(Boolean).forEach((o) => { if (!COLORS.includes(o) && !PACE[o] && o !== 'lost') out.push('step ' + i + ' option ' + o); }); }
        else if (/^[!@=*]/.test(a)) a.slice(1).split(/\s+/)[0].split(',').forEach((id) => { if (!has(id)) out.push('step ' + i + ' node ' + a); });
        else if (a[0] === '~') { const [x, y] = a.slice(1).split(/\s+/)[0].split('-'); if (!has(x) || !has(y)) out.push('step ' + i + ' wire ' + a); }
        else if (!/^\+\d+$/.test(a)) out.push('step ' + i + ' unknown ' + a);
      });
    });
    if ((sc.s || []).length < 3) out.push('too few steps');
    return out;
  };

  /* The player. It draws the diagram, the caption and the list of steps; the page's control dock drives it
     through root.target. Back and Next play one step; Play runs to the end, pausing so each caption can be read. */
  RT.renderScene = (id, pageCtx) => {
    const sc = RT.SCENES[id];
    if (!sc) return null;
    const steps = sc.s.map(([en, b, act]) => ({ text: bn() ? b : en, beats: parse(act) }));
    /* The width, in pixels, of every line a node will ever show, so it is drawn big enough from the start. */
    const texts = {};
    [...parse(sc.i).flat(), ...steps.flatMap((st) => st.beats.flat())].filter((a) => a[0] === '@' || a[0] === '=').forEach((a) => {
      const [head, ...rest] = a.slice(1).split(/\s+/), t = pick(rest.join(' '));
      head.split(',').forEach((id) => { (texts[id] = texts[id] || []).push(t.length * (a[0] === '=' ? 7.8 : 6.4)); });
    });
    const subbed = new Set(steps.flatMap((st) => st.beats.flat()).filter((a) => a[0] === '@').flatMap((a) => a.slice(1).split(/\s+/)[0].split(',')));
    const clock = RT.Clock();
    let ctx = null, net = null, idx = -1, auto = false, run = 0, busy = false;
    const stage = h('div', { class: 'stage scn-stage' });
    const cap = h('p', { class: 'scn-text' });
    const num = h('span', { class: 'scn-num' });
    const capBox = h('div', { class: 'scn-cap', 'aria-live': 'polite' }, num, cap);
    const list = h('ol', { class: 'scn-list' }, steps.map((st) => h('li', null, st.text)));
    const root = h('section', { class: 'scene', 'aria-label': say('Animated walkthrough', 'অ্যানিমেটেড ব্যাখ্যা') },
      h('div', { class: 'scn-head' }, h('h2', null, say('Watch it work', 'দেখুন কীভাবে কাজ করে')), h('span', { class: 'small muted' }, say(`${steps.length} steps · use the controls at the top`, `${steps.length}টি ধাপ · ওপরের নিয়ন্ত্রণ ব্যবহার করুন`))),
      stage, capBox,
      h('details', { class: 'scn-all', open: true }, h('summary', null, say('Every step in words', 'প্রতিটি ধাপ লেখায়')), list));
    const listeners = new Set();
    /* A fresh drawing and context for every jump, so whatever was moving simply stops. */
    function fresh() {
      if (ctx) ctx.dispose();
      clock.clear();
      ctx = RT.makeCtx({ id: 'scene-' + id }, { refresh() {} }, clock);
      net = RT.Net(ctx, { w: W, h: sc.h || 240, label: say('Walkthrough diagram', 'ধাপে ধাপে ছবি') });
      Object.entries(sc.n).forEach(([k, v]) => {
        /* A node that ever shows a second line is drawn tall from the start, so nothing jumps. */
        const label = pick(v[0]), tall = v[3] != null || subbed.has(k), sub = v[3] != null ? pick(v[3]) : tall ? '' : undefined;
        const longest = Math.max(label.length * 7.8, String(sub || '').length * 6.4, ...(texts[k] || []));
        const w = v[4] || Math.max(96, Math.min(230, 2 * Math.min(v[1], W - v[1]) - 12, longest + 20));
        net.node(k, { x: v[1], y: v[2], label, sub, w, h: tall ? 48 : 40 });
        fit(k);
      });
      String(sc.l || '').split(/\s+/).filter(Boolean).forEach((l) => { const [a, b] = l.split('-'); net.link(a, b); });
      parse(sc.i).flat().forEach((a) => act(a, true));
      stage.textContent = ''; stage.append(net.svg);
    }
    const nodeIds = (t) => t.split(',').filter((x) => net.nodes[x]);
    /* Text too long for its box is squeezed to fit rather than spilling over the edge. Bengali letters
       carry marks that take no width of their own, so they count for less. */
    function fit(id) {
      const n = net.nodes[id];
      [[n.t, 7.8], [n.u, 6.4]].forEach(([el, px]) => {
        const text = el.textContent, room = n.w - 12, need = text.length * px * (/[ঀ-৿]/.test(text) ? .78 : 1);
        if (need > room) { el.setAttribute('textLength', room); el.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
        else { el.removeAttribute('textLength'); el.removeAttribute('lengthAdjust'); }
      });
    }
    function act(a, instant) {
      let m;
      if ((m = a.match(SEND))) {
        if (instant) return null;
        const opts = m[3].split(':').filter(Boolean), color = opts.find((o) => COLORS.includes(o)) || 'req';
        const pace = opts.map((o) => PACE[o]).find(Boolean) || 950;
        return net.send(m[1], m[2], { label: pick(m[4] || ''), color: opts.includes('lost') ? 'bad' : color, dur: pace, dropAt: opts.includes('lost') ? .55 : null });
      }
      const [head, ...rest] = a.slice(1).split(/\s+/), arg = rest.join(' ');
      if (a[0] === '!') nodeIds(head).forEach((n) => net.state(n, arg));
      else if (a[0] === '@') nodeIds(head).forEach((n) => { net.sub(n, pick(arg)); fit(n); });
      else if (a[0] === '=') nodeIds(head).forEach((n) => { net.label(n, pick(arg)); fit(n); });
      else if (a[0] === '~') { const [x, y] = head.split('-'); net.linkClass(x, y, arg); }
      else if (a[0] === '*') { if (!instant) nodeIds(head).forEach((n) => net.ripple(n, 'ref')); }
      else if (a[0] === '+') return instant ? null : ctx.sleep(+a.slice(1));
      return null;
    }
    const settle = (i) => steps[i].beats.flat().forEach((a) => act(a, true));
    function paint() {
      root.classList.toggle('is-paused', clock.paused);
      [...list.children].forEach((li, i) => li.classList.toggle('now', i === idx));
      if (idx < 0) { num.textContent = '▶'; cap.textContent = say(`Press Play at the top to watch ${steps.length} short steps, or Next to go one at a time.`, `${steps.length}টি ছোট ধাপ দেখতে ওপরে চালান চাপুন, অথবা এক এক করে দেখতে পরেরটি চাপুন।`); }
      else { num.textContent = (idx + 1) + '/' + steps.length; cap.textContent = steps[idx].text; }
      listeners.forEach((f) => f());
    }
    /* Show step i: everything before it in place at once, then step i itself animated. */
    async function jump(i, keepAuto) {
      if (i < 0 || i >= steps.length) return;
      const my = ++run;
      if (!keepAuto) auto = false;
      clock.play();
      fresh();
      for (let k = 0; k < i; k++) settle(k);
      idx = i; busy = true; paint();
      for (const beat of steps[i].beats) {
        await Promise.all(beat.map((a) => act(a, false)));
        if (my !== run) return;
      }
      if (auto && i < steps.length - 1) {
        await ctx.sleep(Math.min(3800, 900 + steps[i].text.length * 22));
        if (my !== run) return;
        busy = false;
        jump(i + 1, true);
        return;
      }
      busy = false; auto = false; paint();
    }
    function toggle() {
      if (auto && !clock.paused) { clock.pause(); paint(); return; }
      if (auto && clock.paused) { clock.play(); paint(); return; }
      auto = true;
      if (busy) { clock.play(); paint(); return; }
      jump(idx >= steps.length - 1 ? 0 : idx + 1, true);
    }
    function restart() { run++; auto = false; busy = false; idx = -1; clock.play(); fresh(); paint(); }
    clock.on(paint);
    restart();
    if (pageCtx) pageCtx.onDispose(() => { run++; listeners.clear(); if (ctx) ctx.dispose(); clock.dispose(); });
    /* What the control dock does on a Theory tab. */
    root.target = {
      name: say('Walkthrough', 'ধাপে ধাপে'),
      playing: () => auto && !clock.paused,
      ended: () => idx >= steps.length - 1 && !busy,
      toggle, reset: restart,
      next: () => jump(idx + 1), back: () => jump(idx - 1), jump: (i) => jump(i),
      canBack: () => idx > 0, canNext: () => idx < steps.length - 1,
      steps: () => ({ n: steps.length, idx }),
      status: () => (idx < 0 ? say(`${steps.length} steps, ready`, `${steps.length}টি ধাপ, প্রস্তুত`) : say(`Step ${idx + 1} of ${steps.length}`, `ধাপ ${idx + 1} / ${steps.length}`)),
      /* Bring the diagram into view when it is driven from the dock, without moving if it is already visible. */
      reveal() {
        const r = stage.getBoundingClientRect();
        if (r.height && (r.top < 60 || r.bottom > innerHeight)) stage.scrollIntoView({ block: 'center', behavior: RT.reduced ? 'auto' : 'smooth' });
      },
      suspend() { const was = auto && !clock.paused; if (was) clock.pause(); return was; },
      resume() { clock.play(); },
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
    return root;
  };

  /* The rounding-off sections, at the depth the reader chose. */
  RT.moreFor = (id) => { const m = RT.MORE[id]; if (!m) return null; const x = (bn() && m.bn) || m.en; return Object.assign({}, x, { q: x.q && m.en.q ? Object.assign({}, m.en.q, x.q, { answer: m.en.q.answer }) : null }); };
  RT.renderMore = (id, level) => {
    const m = RT.moreFor(id);
    if (!m) return [];
    const list = (items) => h('ul', null, items.map((v) => h('li', null, v)));
    const duo = (cls, a, b) => h('div', { class: 'th-duo ' + cls }, h('section', { class: 'th-box ok' }, h('h2', null, a[0]), list(a[1])), h('section', { class: 'th-box warn' }, h('h2', null, b[0]), list(b[1])));
    const out = [];
    if (level === 'simple') return out;
    if (m.use) out.push(duo('when', [say('Reach for it when', 'কখন ব্যবহার করবেন'), m.use], [say('Think twice when', 'কখন দুবার ভাববেন'), m.avoid]));
    if (m.gain) out.push(duo('trade', [say('What you gain', 'কী পাবেন'), m.gain], [say('What it costs', 'কী দিতে হয়'), m.cost]));
    if (m.say) out.push(h('section', { class: 'th-box talk' }, h('h2', null, say('Say this in an interview', 'ইন্টারভিউতে এভাবে বলুন')), list(m.say)));
    if (level === 'deep' && m.real) out.push(h('section', { class: 'th-box real' }, h('h2', null, say('Where you will meet it', 'কোথায় দেখবেন')), h('p', null, m.real)));
    return out;
  };
  RT.moreQuiz = (id) => { const m = RT.moreFor(id); return m && m.q ? m.q : null; };
  /* Words for the search box and the reading-time estimate. */
  RT.moreText = (id, lang) => {
    const m = RT.MORE[id], x = m && (m[lang] || m.en);
    if (!x) return [];
    const say2 = (en, b) => (lang === 'bn' ? b : en);
    const sc = RT.SCENES[id];
    return [[say2('When to use it', 'কখন ব্যবহার করবেন'), [...(x.use || []), ...(x.avoid || [])].join(' ')], [say2('Trade-offs', 'লাভ-ক্ষতি'), [...(x.gain || []), ...(x.cost || [])].join(' ')],
      [say2('In an interview', 'ইন্টারভিউতে'), (x.say || []).join(' ')], [say2('Where you will meet it', 'কোথায় দেখবেন'), x.real || ''],
      [say2('Watch it work', 'দেখুন কীভাবে কাজ করে'), sc ? sc.s.map((st) => (lang === 'bn' ? st[1] : st[0])).join(' ') : '']].filter((v) => v[1]);
  };
  void ui;
  void s;
})();
