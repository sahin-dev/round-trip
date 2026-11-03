/* Scale Quest: the episode map, the build screen, and the live run with obstacles. */
(function () {
  const { h, ui } = RT;
  const G = window.RTGame, D = window.RTDesign;
  const tx = (o) => (o ? o[RT.settings.lang] || o.en : '');
  const say = (en, bn) => (RT.settings.lang === 'bn' ? bn : en);
  const money = RT.Designer.money;
  const num = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : n >= 1e3 ? Math.round(n / 1000) + 'k' : Math.round(n));
  const KEY = 'roundtrip.game';
  const read = () => { try { return Object.assign({ done: {}, tries: {}, xp: 0, badges: [], designs: {} }, JSON.parse(localStorage.getItem(KEY))); } catch { return { done: {}, tries: {}, xp: 0, badges: [], designs: {} }; } };
  const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* the game still plays for this visit */ } };

  const GATE = {
    routes: { en: 'Some traffic has no path to anything that can answer it.', bn: 'কিছু ট্রাফিকের উত্তর দেওয়ার মতো কারও কাছে পৌঁছানোর পথ নেই।' },
    capacity: { en: 'A component is overloaded even before any trouble starts.', bn: 'কোনো সমস্যা শুরুর আগেই একটি কম্পোনেন্টে অতিরিক্ত চাপ।' },
    storage: { en: 'Your databases cannot hold all the data.', bn: 'আপনার ডেটাবেসে সব ডেটা ধরছে না।' },
    latency: { en: 'Pages are too slow for the target.', bn: 'পেজগুলো লক্ষ্যের তুলনায় ধীর।' },
    avail: { en: 'Your platform is not reliable enough for the target.', bn: 'প্ল্যাটফর্ম লক্ষ্য অনুযায়ী যথেষ্ট নির্ভরযোগ্য নয়।' },
    budget: { en: 'This design costs more than the company can pay.', bn: 'এই ডিজাইনের খরচ কোম্পানির সামর্থ্যের বেশি।' },
    balanced: { en: 'You have several app servers, but nothing shares traffic between them. Add a load balancer.', bn: 'একাধিক অ্যাপ সার্ভার আছে, কিন্তু ট্রাফিক ভাগ করার কেউ নেই। লোড ব্যালান্সার যোগ করুন।' },
    disk: { en: 'No machine may have more than 8 TB in this episode.', bn: 'এই পর্বে কোনো মেশিনে ৮ টিবির বেশি রাখা যাবে না।' },
  };
  const LABEL = { routes: { en: 'All traffic has a path', bn: 'সব ট্রাফিকের পথ আছে' }, capacity: { en: 'Nothing is overloaded', bn: 'কোথাও অতিরিক্ত চাপ নেই' }, storage: { en: 'All data fits', bn: 'সব ডেটা ধরছে' }, latency: { en: 'Pages are fast enough', bn: 'পেজ যথেষ্ট দ্রুত' }, avail: { en: 'Reliable enough', bn: 'যথেষ্ট নির্ভরযোগ্য' }, budget: { en: 'Within budget', bn: 'বাজেটের মধ্যে' }, balanced: { en: 'Traffic is shared', bn: 'ট্রাফিক ভাগ হচ্ছে' }, disk: { en: 'Machines are within limits', bn: 'মেশিন সীমার মধ্যে' }, lesson: { en: 'Episode goal done', bn: 'পর্বের লক্ষ্য পূরণ' } };

  RT.lab({
    id: 'game', title: 'Scale Quest', short: 'Scale Quest', chapter: 'Game', wide: true, plain: true,
    lede: 'Build one platform through ten episodes, from 300 customers to 25 million. Each episode breaks what you built, and you must fix it to continue.',
    missions: [['start', 'Finish Episode 1.'], ['half', 'Reach Episode 6.'], ['done', 'Beat the Final Boss.'], ['stars', 'Earn three stars on five episodes.']],
    render(root, ctx) {
      let state = read(), scope = null;
      const area = h('div', { class: 'labmain' });
      root.append(area);
      const unlockedTo = () => { let i = 0; while (i < G.EPISODES.length - 1 && state.done[G.EPISODES[i].id]) i++; return i; };

      function hud() {
        const totalStars = Object.values(state.done).reduce((a, b) => a + (b.stars || 0), 0), rk = G.rankOf(state.xp), bar = ui.bar('res');
        if (rk.next) bar.set(((state.xp - G.RANKS[rk.i][0]) / (rk.next[0] - G.RANKS[rk.i][0])) * 100); else bar.set(100);
        return h('div', { class: 'hud' }, h('div', { class: 'hud-rank' }, h('b', null, tx(rk.name)), h('span', null, `${state.xp} XP`), bar, rk.next && h('span', { class: 'small muted' }, say(`${rk.next[0] - state.xp} XP to ${rk.next[1].en}`, `${tx(rk.next[1])} হতে আরও ${rk.next[0] - state.xp} XP`))),
          h('div', { class: 'hud-stat' }, h('b', null, `${totalStars}/30`), h('span', null, say('Stars', 'তারা'))), h('div', { class: 'hud-stat' }, h('b', null, `${Object.keys(state.done).length}/10`), h('span', null, say('Episodes', 'পর্ব'))),
          state.badges.length ? h('div', { class: 'hud-badges' }, state.badges.map((b) => h('span', { class: 'badge' }, tx(G.BADGES[b])))) : null);
      }
      function map() {
        if (scope) { scope.cancel(); scope = null; }
        area.textContent = '';
        const top = unlockedTo();
        area.append(hud(), h('ol', { class: 'quest' }, G.EPISODES.map((ep, i) => {
          const d = state.done[ep.id], locked = i > top;
          return h('li', { class: 'ep ' + (d ? 'won ' : '') + (locked ? 'locked ' : '') + (i === top && !d ? 'now ' : '') + (ep.final ? 'boss' : '') }, h('button', { disabled: locked, id: 'ep-' + (i + 1), onclick() { episode(i); } },
            h('span', { class: 'ep-n' }, i + 1), h('b', null, tx(ep.title)), h('span', { class: 'ep-users' }, say(`${num(ep.dau)} users`, `${num(ep.dau)} ব্যবহারকারী`)), h('span', { class: 'small muted' }, locked ? say('Locked', 'বন্ধ') : tx(ep.tagline)),
            h('span', { class: 'ep-stars', 'aria-label': `${d ? d.stars : 0} of 3 stars` }, '★★★'.slice(0, d ? d.stars : 0), h('i', null, '★★★'.slice(d ? d.stars : 0)))));
        })), h('div', { class: 'controls flat' }, ui.btn(say('Restart the whole game', 'পুরো গেম আবার শুরু করুন'), resetAll, { kind: 'danger', id: 'gm-reset' })));
      }
      let armed = false;
      function resetAll(e) {
        if (!armed) { armed = true; e.target.textContent = say('Press again to erase your progress', 'অগ্রগতি মুছতে আবার চাপুন'); return; }
        armed = false; state = { done: {}, tries: {}, xp: 0, badges: [], designs: {} }; write(state); map();
      }

      function episode(i) {
        const ep = G.EPISODES[i], brief = G.briefOf(ep), limit = G.budgetOf(ep), prevId = i ? G.EPISODES[i - 1].id : null;
        let design = state.designs[ep.id] || (prevId && state.designs[prevId]) || G.blank();
        design = JSON.parse(JSON.stringify(design));
        let res = null, fault = null, running = false;
        scope = ctx.scope();
        const D0 = D.demand(brief, 0);
        area.textContent = '';
        const panel = h('div', { class: 'gate-list' }), stats = h('div', { class: 'reqs' }), banner = h('div', { class: 'banner', role: 'status' }, tx(ep.goal));
        const goB = ui.btn(say('Go live', 'লাইভ করুন'), goLive, { kind: 'primary', id: 'gm-go' });
        const run = h('div', { class: 'run hide' }), result = h('div');
        const dz = RT.Designer(ctx, {
          get: () => design, set: (v) => { design = v; }, allowed: ep.allowed, defaults: G.tiny,
          result: () => (fault || (res && res.r)), last: () => (res && res.r), refresh, persist() { state.designs[ep.id] = design; write(state); }, idle,
        });
        function idle(box) {
          box.append(h('h2', null, say('What next?', 'এরপর কী?')));
          const top = res && (res.failedGate ? (res.failedGate === 'lesson' ? tx(ep.goal) : tx(GATE[res.failedGate])) : res.failedStep ? tx(res.failedStep.o.hint) : '');
          box.append(h('p', { class: 'small' }, top || say('Your platform looks ready. Press Go live.', 'প্ল্যাটফর্ম প্রস্তুত মনে হচ্ছে। লাইভ করুন চাপুন।')), h('p', { class: 'small muted', style: { marginTop: '6px' } }, say('Select a box to set its processor, memory and storage.', 'প্রসেসর, মেমোরি ও স্টোরেজ ঠিক করতে একটি বক্স সিলেক্ট করুন।')));
        }
        function refresh() {
          res = G.play(ep, design);
          stats.textContent = '';
          const chip = (v, k, good) => h('span', { class: 'req ' + (good === false ? 'req-bad' : '') }, h('b', null, v), k);
          const rd = res.r.classes.read;
          stats.append(chip(num(ep.dau), say('users', 'ব্যবহারকারী')), chip(Math.round(D0.read).toLocaleString(), say('reads/s', 'রিড/সেকেন্ড')), chip(Math.round(D0.write).toLocaleString(), say('writes/s', 'রাইট/সেকেন্ড')),
            chip(rd && rd.routed ? Math.round(rd.p95) + ' ms' : '–', say(`p95 (target ${ep.slo.read} ms)`, `p95 (লক্ষ্য ${ep.slo.read} ms)`), !!(rd && rd.routed && rd.p95 <= ep.slo.read)), chip(money(res.r.cost), say(`of ${money(limit)} budget`, `${money(limit)} বাজেটের মধ্যে`), res.r.cost <= limit));
          panel.textContent = '';
          res.gates.forEach(([k, v]) => { if (k === 'balanced' || k === 'disk') { if (v) return; } panel.append(h('span', { class: 'gate ' + (v ? 'ok' : '') }, h('i', null, v ? '✓' : '·'), tx(LABEL[k]))); });
          dz.draw();
        }
        const tries = () => state.tries[ep.id] || 0;
        function setRun(html) { run.textContent = ''; run.append(...html); run.classList.remove('hide'); }
        async function goLive() {
          if (running) return;
          running = true; goB.disabled = true; result.textContent = '';
          res = G.play(ep, design);
          state.tries[ep.id] = tries() + 1; write(state);
          const hp = ui.bar('res'); hp.set(100);
          const line = h('p', { class: 'run-say' }), list = h('ol', { class: 'run-steps' }, ep.obstacles.map((o) => h('li', null, tx(o.name))));
          setRun([h('b', null, say('Live now', 'এখন লাইভ')), hp, line, list]);
          run.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          line.textContent = say('Doors open. Traffic is arriving…', 'দরজা খুলল। ট্রাফিক আসছে…');
          await scope.sleep(1300);
          if (res.failedGate) return finish(false, res.failedGate === 'lesson' ? tx(ep.goal) : tx(GATE[res.failedGate]), null);
          for (let k = 0; k < res.steps.length; k++) {
            const st = res.steps[k];
            fault = st.r; dz.draw();
            list.children[k].className = 'active';
            line.textContent = `${tx(st.o.name)}: ${tx(st.o.say)}`;
            await scope.sleep(800);
            hp.set(Math.round(st.r.succ * 100));
            await scope.sleep(1100);
            list.children[k].className = st.pass ? 'passed' : 'failed';
            if (!st.pass) { const bad = st.o; return finish(false, say(`${tx(bad.name)}: only ${(st.r.succ * 100).toFixed(1)}% of requests worked.`, `${tx(bad.name)}: মাত্র ${(st.r.succ * 100).toFixed(1)}% অনুরোধ সফল হয়েছে।`), bad); }
            hp.set(100); fault = null; dz.draw();
          }
          finish(true);
        }
        function finish(won, why, obstacle) {
          running = false; goB.disabled = false; fault = null; res = G.play(ep, design); dz.draw(); result.textContent = '';
          if (!won) {
            const n = tries(), cause = res.findings.find((f) => f.sev === 'critical') || res.findings[0];
            result.append(h('div', { class: 'card lose' }, h('h2', null, say('The platform went down', 'প্ল্যাটফর্ম বন্ধ হয়ে গেছে')), h('p', null, why), obstacle && h('p', { class: 'small' }, h('b', null, say('Hint: ', 'ইঙ্গিত: ')), tx(obstacle.hint)), cause && h('p', { class: 'small muted' }, cause.text, ' ', cause.fix),
              h('div', { class: 'controls flat', style: { marginTop: '8px' } }, ui.btn(say('Fix it', 'ঠিক করুন'), () => { result.textContent = ''; run.classList.add('hide'); }, { kind: 'primary', id: 'gm-fix' }), n >= 3 && ui.btn(say('Show a working design', 'একটি কার্যকর ডিজাইন দেখান'), () => { dz.change(() => { design = G.solution(i); }); result.textContent = ''; run.classList.add('hide'); }, { id: 'gm-show' }))));
            refresh(); return;
          }
          const first = !state.done[ep.id], stars = G.stars(ep, res, tries()), old = state.done[ep.id], gained = first ? 100 + i * 40 + stars * 30 : Math.max(0, (stars - old.stars) * 30);
          state.done[ep.id] = { stars: Math.max(stars, old ? old.stars : 0) }; state.xp += gained; state.designs[ep.id] = design;
          const award = (b) => { if (!state.badges.includes(b)) state.badges.push(b); };
          if (tries() <= 1) award('firstTry'); if (res.r.cost <= res.limit * .6) award('thrifty'); if (ep.obstacles.length >= 2) award('survivor');
          if (ep.final) award('champion');
          if (Object.keys(state.done).length === 10 && G.EPISODES.every((e) => (state.tries[e.id] || 0) <= 1)) award('ironman');
          write(state);
          ctx.mission('start'); if (i >= 4) ctx.mission('half'); if (ep.final) ctx.mission('done');
          if (Object.values(state.done).filter((d) => d.stars === 3).length >= 5) ctx.mission('stars');
          const nextEp = G.EPISODES[i + 1];
          result.append(h('div', { class: 'card win ' + (ep.final ? 'final' : '') }, h('div', { class: 'win-stars', 'aria-label': `${stars} of 3 stars` }, Array.from({ length: 3 }, (_, k) => h('span', { class: k < stars ? 'on' : '', style: { animationDelay: k * .18 + 's' } }, '★'))),
            h('h2', null, ep.final ? say('You built a platform for millions', 'আপনি কোটি মানুষের প্ল্যাটফর্ম বানিয়েছেন') : say(`Episode ${i + 1} complete`, `পর্ব ${i + 1} সম্পন্ন`)), gained > 0 && h('p', { class: 'mono small' }, `+${gained} XP`), h('p', null, tx(ep.learn)),
            h('p', { class: 'small muted' }, say(`One star for passing. One for spending under ${money(res.limit * .8)}. One for passing on the first try.`, `পাস করলে এক তারা। ${money(res.limit * .8)}-এর কম খরচে এক তারা। প্রথম চেষ্টায় পাস করলে এক তারা।`)),
            h('div', { class: 'controls flat', style: { marginTop: '8px' } }, nextEp ? ui.btn(say(`Next: ${nextEp.title.en}`, `পরের পর্ব: ${tx(nextEp.title)}`), () => episode(i + 1), { kind: 'primary', id: 'gm-next' }) : ui.btn(say('Back to the map', 'মানচিত্রে ফিরুন'), map, { kind: 'primary', id: 'gm-next' }), RT.byId[ep.topic] && h('a', { class: 'btn', href: '#' + ep.topic }, say('Read the theory', 'তত্ত্ব পড়ুন')), ui.btn(say('Stay here', 'এখানেই থাকুন'), () => { result.textContent = ''; run.classList.add('hide'); }, {}))));
          result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          refresh();
        }
        area.append(h('div', { class: 'ep-head' }, ui.btn(say('← Map', '← মানচিত্র'), map, { id: 'gm-map' }), h('span', { class: 'eyebrow' }, say(`Episode ${i + 1} of 10`, `পর্ব ${i + 1} / ১০`))),
          h('section', { class: 'story' }, h('div', { class: 'avatar', 'aria-hidden': 'true' }, say('R', 'রু')), h('div', null, h('h2', null, tx(ep.title)), h('p', null, tx(ep.story)))),
          banner, h('div', { class: 'card' }, stats, panel),
          dz.el,
          h('div', { class: 'controls' }, goB, ui.btn(say('Undo', 'পূর্বাবস্থা'), () => dz.undo(), { id: 'gm-undo' }), ui.btn(say('Start from the last episode', 'আগের পর্ব থেকে শুরু'), () => dz.change(() => { design = JSON.parse(JSON.stringify((prevId && state.designs[prevId]) || G.blank())); }), { id: 'gm-revert' }), ep.topic && RT.byId[ep.topic] && h('a', { class: 'small', href: '#' + ep.topic }, say('Stuck? Read the theory', 'আটকে গেছেন? তত্ত্ব পড়ুন'))),
          run, result);
        refresh();
        window.scrollTo(0, 0);
      }
      map();
    },
  });
})();
