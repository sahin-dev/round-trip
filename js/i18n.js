/* Language support. Long content has its own Bengali text. Everything else on screen,
   including live simulator messages, passes through a translator that also handles
   strings containing changing numbers, by matching them against templates. */
(function () {
  const { h, ui } = RT;
  const S = RT.settings;
  const bn = () => S.lang === 'bn';
  const L = () => window.RTLearn;
  const TH = () => window.RTTheory || {};
  const X = () => window.RTLabsBn || {};

  RT.labText = (def, key) => {
    const v = bn() && X()[def.id] && X()[def.id][key];
    if (v) return v;
    return key === 'short' ? def.short || def.title : def[key];
  };
  RT.missionText = (def, id, text) => { const m = bn() && X()[def.id] && X()[def.id].missions; return (m && m[id]) || text; };
  RT.checkFor = (def) => { const c = bn() && X()[def.id] && X()[def.id].check; return def.check ? (c ? { ...def.check, ...c } : def.check) : null; };
  const labelled = (t) => t.replace(/[A-Z][A-Za-z0-9+:&]*(?:[ -][A-Za-z0-9+:&"]+)*/g, (m) => {
    for (let words = m.split(' '); words.length; words = words.slice(0, -1)) {
      const k = words.join(' '), v = exact(k);
      if (v != null) return v + m.slice(k.length);
    }
    return m;
  });
  RT.explainFor = (def) => {
    const e = bn() && X()[def.id] && X()[def.id].explain;
    return e ? { ...e, start: e.start.map(labelled) } : L().EXPLAIN[def.id];
  };
  RT.hasTheory = (def) => !!TH()[def.id];
  RT.notesFor = (def) => {
    const t = TH()[def.id];
    if (t) { const x = t[S.lang] || t.en; return '<ul>' + x.take.map((v) => `<li>${v}</li>`).join('') + '</ul>'; }
    return (bn() && X()[def.id] && X()[def.id].notes) || def.notes;
  };
  /* One topic, at the depth and in the form that suits the reader. */
  RT.renderTheory = (def, goLab, ctx) => {
    const t = TH()[def.id], x = t[S.lang] || t.en, ex = RT.explainFor(def), extra = (window.RTExtra || {})[def.id], ext = extra && (extra[S.lang] || extra.en);
    const say = (en, b) => (bn() ? b : en);
    const name = (id) => RT.labText(RT.byId[id], 'short');
    const art = h('article', { class: 'theory' });
    const words = x.s.flatMap((v) => v[1]).join(' ').split(/\s+/).length;
    const body = h('div', { class: 'theory-body' });
    const depth = S.depth || (S.level === 'new' ? 'simple' : S.level === 'pro' ? 'deep' : 'standard');
    const seg = ui.seg(say('Depth', 'গভীরতা'), [['simple', say('Simple', 'সহজ')], ['standard', say('Standard', 'সাধারণ')], ['deep', say('Deep', 'গভীর')]], depth, (v) => { S.depth = v; RT.saveSettings(); draw(v); });
    const pic = extra && h('figure', { class: 'flow', 'aria-label': say('Picture of the idea', 'ধারণার ছবি') }, (extra.pic[S.lang] || extra.pic.en).map((v, i) => [i ? h('span', { class: 'flow-arrow', 'aria-hidden': 'true' }, '→') : null, h('span', { class: 'flow-box' }, v)]));
    const para = (p, sec, st) => {
      if (p.startsWith('- ')) { if (!st.list) { st.list = h('ul'); sec.append(st.list); } st.list.append(h('li', null, p.slice(2))); }
      else { st.list = null; sec.append(h('p', null, p)); }
    };
    const box = (title, cls, items) => h('section', { class: 'th-box ' + cls }, h('h2', null, title), items.length > 1 ? h('ul', null, items.map((v) => h('li', null, v))) : h('p', null, items[0]));
    function draw(level) {
      body.textContent = '';
      if (ex) body.append(h('p', { class: 'th-lead' }, ex.what), h('div', { class: 'th-pair' }, h('div', null, h('b', null, say('Think of it like', 'ভাবুন এভাবে')), ex.like), h('div', null, h('b', null, say('Why it matters', 'কেন গুরুত্বপূর্ণ')), ex.why)));
      if (pic) body.append(pic);
      if (ext) body.append(box(say('A real example', 'একটি বাস্তব উদাহরণ'), 'ex', [ext.example]));
      if (level !== 'simple') x.s.forEach(([head, paras]) => { const sec = h('section', null, h('h2', null, head)), st = { list: null }; paras.forEach((p) => para(p, sec, st)); body.append(sec); });
      if (ext && level !== 'simple') body.append(box(say('Common mistakes', 'সাধারণ ভুল'), 'warn', ext.mistakes));
      if (ext && level === 'deep') body.append(box(say('Going deeper', 'আরও গভীরে'), 'deep', ext.deep));
      if (level === 'simple') body.append(h('p', { class: 'small muted' }, say('Want more detail? Choose Standard above.', 'আরও জানতে ওপরে সাধারণ বাছুন।')));
      body.append(h('div', { class: 'th-take' }, h('b', null, say('Remember', 'মনে রাখুন')), h('ul', null, x.take.map((v) => h('li', null, v)))));
    }
    let speaking = false;
    const stopTalk = () => { speaking = false; if (window.speechSynthesis) speechSynthesis.cancel(); };
    if (ctx) ctx.onDispose(stopTalk);
    const talk = window.speechSynthesis && ui.btn(say('Read aloud', 'জোরে পড়ুন'), (e) => {
      if (speaking) { stopTalk(); e.target.textContent = say('Read aloud', 'জোরে পড়ুন'); return; }
      const u = new SpeechSynthesisUtterance(body.innerText);
      const want = bn() ? 'bn' : 'en', voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(want));
      if (!voice && bn()) { RT.toast('এই ডিভাইসে বাংলা কণ্ঠ নেই। ডিভাইসের সেটিংসে যোগ করতে পারেন।'); return; }
      if (voice) u.voice = voice;
      u.lang = bn() ? 'bn-BD' : 'en-US'; u.rate = S.speed < 1 ? .85 : 1;
      u.onend = () => { speaking = false; e.target.textContent = say('Read aloud', 'জোরে পড়ুন'); };
      speaking = true; e.target.textContent = say('Stop reading', 'পড়া থামান'); speechSynthesis.speak(u);
    }, { id: 'th-talk' });
    const pre = (RT.PRE && RT.PRE[def.id] || []).filter((i) => RT.byId[i]);
    art.append(h('div', { class: 'th-tools' }, ui.field(say('How deep?', 'কতটা গভীরে?'), seg), talk, h('span', { class: 'small muted' }, say(`About ${Math.max(1, Math.round(words / 200))} min read`, `প্রায় ${Math.max(1, Math.round(words / 150))} মিনিট`))));
    const lv = RT.levelOf ? RT.levelOf(def.id) : 0;
    if (lv) art.append(h('p', { class: 'small th-pre' }, h('span', { class: 'lv lv' + lv }, RT.levelName(lv)), say(' Part of the ', ' অংশ: '), h('a', { href: '#roadmap' }, say('roadmap', 'রোডম্যাপ'))));
    if (pre.length) art.append(h('p', { class: 'small th-pre' }, say('It helps to know first: ', 'আগে জানলে ভালো: '), pre.map((i, k) => [k ? ', ' : '', h('a', { href: '#' + i }, name(i))])));
    art.append(body);
    draw(depth);
    const c = RT.checkFor(def);
    if (c) art.append(RT.quiz(c));
    const meta = window.RTTopicMeta && window.RTTopicMeta[def.id];
    const done = ui.btn(S.read[def.id] ? say('Understood ✓', 'বুঝেছি ✓') : say('I understand this', 'আমি বুঝেছি'), (e) => { S.read[def.id] = !S.read[def.id]; RT.saveSettings(); e.target.textContent = S.read[def.id] ? say('Understood ✓', 'বুঝেছি ✓') : say('I understand this', 'আমি বুঝেছি'); RT.rebuildRail(); }, { id: 'th-done' });
    art.append(h('div', { class: 'th-end' }, goLab && ui.btn(say('Try it in the lab →', 'ল্যাবে চেষ্টা করুন →'), goLab, { kind: 'primary', id: 'go-lab' }), done));
    if (meta && meta.try) art.append(h('div', { class: 'th-take' }, h('b', null, say('Try these next', 'এরপর এগুলো চেষ্টা করুন')), h('ul', null, meta.try.filter((i) => RT.byId[i]).map((i) => h('li', null, h('a', { href: '#' + i }, RT.labText(RT.byId[i], 'title')))))));
    const leads = Object.keys(RT.PRE || {}).filter((i) => RT.byId[i] && RT.PRE[i].includes(def.id));
    if (leads.length) art.append(h('p', { class: 'small th-pre' }, say('This unlocks: ', 'এটি জানলে পড়তে পারেন: '), leads.map((i, k) => [k ? ', ' : '', h('a', { href: '#' + i }, name(i))])));
    if (RT.theoryNav) art.append(RT.theoryNav(def));
    return art;
  };

  /* ---------- the translator ---------- */
  const strings = () => window.RTStrings || {};
  const NUM = /\d[\d,]*(?:\.\d+)?/g;
  const seen = new WeakMap();
  const miss = new Set();
  /* Keys holding {n} match any value there, such as a server's name or a number. */
  let tpls = null;
  function templates() {
    if (tpls) return tpls;
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    tpls = Object.keys(strings()).filter((k) => k.includes('{n}') && k.replace(/\{n\}/g, '').trim().length > 2)
      .sort((x, y) => y.length - x.length)
      .map((k) => ({ k, rx: new RegExp('^' + k.split('{n}').map(esc).join('(.+?)') + '$', 's') }));
    return tpls;
  }
  const cache = new Map();
  function exact(t) {
    if (cache.has(t)) return cache.get(t);
    const d = strings();
    let out = null;
    if (Object.prototype.hasOwnProperty.call(d, t)) out = d[t];
    else {
      const nums = [], key = t.replace(NUM, (m) => { nums.push(m); return '{n}'; });
      if (nums.length && Object.prototype.hasOwnProperty.call(d, key)) { let i = 0; out = d[key].replace(/\{n\}/g, () => nums[i++]); }
      else {
        for (const { k, rx } of templates()) {
          const m = t.match(rx);
          if (m) { let i = 1; out = d[k].replace(/\{n\}/g, () => { const v = m[i++]; return exact(v.trim()) || v; }); break; }
        }
      }
    }
    if (cache.size > 4000) cache.clear();
    cache.set(t, out);
    return out;
  }
  function translate(t) {
    if (/[\u0980-\u09FF]/.test(t)) return null;
    const hit = exact(t);
    if (hit != null) return hit;
    /* Labels often carry a colon or an arrow around the words */
    const wrap = t.match(/^(← |■ |· )?(.+?)( →|:)?$/s);
    if (wrap && (wrap[1] || wrap[3])) { const inner = exact(wrap[2]); if (inner != null) return (wrap[1] || '') + inner + (wrap[3] || ''); }
    const parts = t.split(/(?<=[.?!:])\s+/);
    if (parts.length > 1) {
      const out = parts.map((p) => exact(p));
      if (out.some((p) => p != null)) { if (out.some((p) => p == null)) parts.forEach((p, i) => { if (out[i] == null) miss.add(p); }); return out.map((p, i) => (p == null ? parts[i] : p)).join(' '); }
    }
    if (/[A-Za-z]{3}/.test(t)) miss.add(t);
    return null;
  }
  const SKIP = 'script,style,code,pre,textarea,.hexbox,.theory-body,.flow,.mono-raw';
  function doNode(n) {
    const v = n.nodeValue;
    if (!v || !/[A-Za-z]/.test(v)) return;
    const was = seen.get(n);
    if (was && was.out === v) return;
    const p = n.parentElement;
    if (!p || p.closest(SKIP)) return;
    const t = v.trim(), out = t && translate(t);
    if (out) { const res = v.replace(t, out); seen.set(n, { out: res }); n.nodeValue = res; }
  }
  function doAttrs(el) {
    ['placeholder', 'aria-label', 'title'].forEach((a) => {
      const v = el.getAttribute && el.getAttribute(a);
      if (!v || !/[A-Za-z]/.test(v)) return;
      const out = exact(v.trim());
      if (out) el.setAttribute(a, out);
    });
  }
  function walk(root) {
    if (root.nodeType === 3) { doNode(root); return; }
    if (root.nodeType !== 1) return;
    doAttrs(root);
    root.querySelectorAll && root.querySelectorAll('[placeholder],[aria-label],[title]').forEach(doAttrs);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) doNode(w.currentNode);
  }
  let obs = null;
  function watch() {
    if (obs) { obs.disconnect(); obs = null; }
    if (!bn()) return;
    obs = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') doNode(m.target);
        else m.addedNodes.forEach(walk);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    walk(document.body);
  }
  RT.setLang = (v) => {
    S.lang = v; RT.saveSettings(); RT.applySettings();
    document.querySelectorAll('dialog').forEach((d) => { if (d.open) d.close(); });
    watch(); RT.rebuildRail(); RT.reroute();
  };
  RT.i18nMisses = () => [...miss];
  RT.i18nClear = () => miss.clear();
  RT.i18nWatch = watch;
})();
