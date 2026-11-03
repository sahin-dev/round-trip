/* The roadmap, spaced review, cheat sheets, interview playbook and worked designs. */
(function () {
  const { h, ui } = RT;
  const S = RT.settings;
  const say = (en, bn) => (S.lang === 'bn' ? bn : en);
  const name = (id) => (RT.byId[id] ? RT.labText(RT.byId[id], 'short') : id);
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* works without storage */ } };

  /* ---------- levels ---------- */
  const BASE = { concurrency: 2, observability: 2, heartbeat: 2, quorum: 2, stampede: 2, bloom: 2, dfs: 2, tradeoffs: 2 };
  const NOT_TOPICS = new Set(['roadmap', 'map', 'guide', 'glossary', 'cheatsheet', 'about', 'game', 'studio', 'workbench', 'estimate', 'trainer', 'review', 'playbook', 'walkthroughs']);
  RT.levelOf = (id) => (NOT_TOPICS.has(id) ? 0 : RT.LEVEL[id] || BASE[id] || 1);
  RT.levelName = (v) => [null, say('Core', 'মূল'), say('Intermediate', 'মধ্যবর্তী'), say('Advanced', 'উন্নত')][v];
  const isDone = (id) => (RT.progress[id] || []).length > 0 || !!S.read[id];

  /* ---------- roadmap ---------- */
  /* The one lesson order. Core stages come first, then Intermediate, then Advanced, and a topic never comes before
     its prerequisites; tests/topics.js checks both. `practise` lists the tools to use once a stage is finished. */
  const STAGES = [
    { en: 'How the web works', bn: 'ওয়েব কীভাবে চলে', say: ['Follow one request from keypress to page.', 'কী চাপা থেকে পেজ পর্যন্ত একটি অনুরোধ অনুসরণ করুন।'], ids: ['basics', 'url', 'dns', 'tcp', 'http', 'tls', 'servers', 'netmetrics'], practise: ['review'] },
    { en: 'Handling more load', bn: 'বেশি চাপ সামলানো', say: ['Why systems slow down, and the tools that spread the work.', 'সিস্টেম কেন ধীর হয়, আর কাজ ছড়ানোর হাতিয়ার।'], ids: ['scalability', 'lb', 'proxy', 'gateway', 'eviction', 'cacheflow', 'cdn'], practise: ['estimate'] },
    { en: 'Storing data', bn: 'ডেটা রাখা', say: ['Tables, indexes, copies and splits.', 'টেবিল, ইনডেক্স, কপি ও ভাগ।'], ids: ['databases', 'acid', 'index', 'replication', 'sharding', 'cap', 'checksum'], practise: ['workbench'] },
    { en: 'Completing the picture', bn: 'পুরো ছবি', say: ['Staying up, splitting services, messaging and security.', 'সচল থাকা, সার্ভিস ভাগ, মেসেজিং ও নিরাপত্তা।'], ids: ['availability', 'microservices', 'kafka', 'realtime', 'auth', 'ddos'], practise: ['game', 'studio'] },
    { en: 'Building real APIs', bn: 'আসল এপিআই বানানো', say: ['The details that separate a demo from a product.', 'যে খুঁটিনাটি ডেমো ও পণ্যকে আলাদা করে।'], ids: ['apistyles', 'pagination', 'ratelimit', 'idempotency', 'sessions', 'lbdeep', 'httpcache', 'stampede', 'freshness'] },
    { en: 'Data at scale', bn: 'বড় পরিসরে ডেটা', say: ['Concurrency, shard keys, IDs, schema changes and big files.', 'কনকারেন্সি, শার্ড কী, আইডি, স্কিমা বদল ও বড় ফাইল।'], ids: ['concurrency', 'quorum', 'bloom', 'sharddesign', 'ids', 'schema', 'searchgeo', 'dfs', 'objectstore'] },
    { en: 'Services and platforms', bn: 'সার্ভিস ও প্ল্যাটফর্ম', say: ['How many services fit together, talk and run in the cloud.', 'অনেক সার্ভিস কীভাবে মেলে, কথা বলে ও ক্লাউডে চলে।'], ids: ['tradeoffs', 'boundaries', 'styles', 'delivery', 'outbox', 'mtls', 'containers', 'cloudnet', 'gslb', 'frontend'] },
    { en: 'Surviving failure', bn: 'ব্যর্থতায় টিকে থাকা', say: ['Assume things break, then stay useful anyway.', 'ধরে নিন সব ভাঙে, তবু কাজের থাকুন।'], ids: ['queueing', 'heartbeat', 'resilience', 'degrade', 'dr', 'observability', 'slo', 'tracing', 'deploys'], practise: ['trainer', 'playbook'] },
    { en: 'Under the hood', bn: 'ভেতরের কলকবজা', say: ['Storage engines, consensus and where the guarantees really come from.', 'স্টোরেজ ইঞ্জিন, কনসেনসাস ও নিশ্চয়তাগুলো আসলে কোথা থেকে আসে।'], ids: ['storage', 'isolation', 'clocks', 'repair', 'consensus', 'dlock', 'dtx', 'streaming', 'cqrs'] },
    { en: 'Real systems', bn: 'আসল সিস্টেম', say: ['Famous designs, read as the patterns you now know.', 'বিখ্যাত নকশা, এখন জানা প্যাটার্নে পড়া।'], ids: ['cs-dynamo', 'cs-cassandra', 'cs-kafka', 'cs-chubby', 'cs-gfs', 'cs-bigtable'], practise: ['walkthroughs'] },
  ];
  RT.STAGES = STAGES;
  RT.TRACKS.splice(2, 0, ...STAGES.map((st) => [st.en, st.ids]));
  STAGES.forEach((st) => { window.RTStrings[st.en] = st.bn; });
  /* The Everything path: lessons with practice between stages, then the pages no stage names. */
  RT.journey = () => [...new Set([...RT.TRACKS[0][1], ...STAGES.flatMap((st) => st.ids.concat(st.practise || [])), ...RT.TRACKS.flatMap(([, ids]) => ids)])];
  const allStaged = () => STAGES.flatMap((t) => t.ids).filter((i) => RT.byId[i]);
  const ready = (id) => (RT.PRE[id] || []).every((p) => !RT.byId[p] || isDone(p));

  function stageCard(st, i) {
    const ids = st.ids.filter((x) => RT.byId[x]), done = ids.filter(isDone).length, bar = ui.bar('res');
    bar.set((done / ids.length) * 100);
    return h('section', { class: 'card stage-card' + (done === ids.length ? ' all' : '') },
      h('div', { class: 'stage-head' }, h('span', { class: 'stage-n' }, i + 1), h('div', null, h('h2', null, say(st.en, st.bn)), h('p', { class: 'small muted' }, st.say[S.lang === 'bn' ? 1 : 0])), h('span', { class: 'small muted' }, `${done}/${ids.length}`)),
      bar,
      h('ol', { class: 'stage-list' }, ids.map((id) => {
        const lv = RT.levelOf(id), state = isDone(id) ? 'done' : ready(id) ? 'ready' : 'later';
        return h('li', { class: state }, h('a', { href: '#' + id }, name(id)), lv > 1 && h('span', { class: 'lv lv' + lv }, RT.levelName(lv)));
      })),
      st.practise && h('p', { class: 'small muted' }, say('Then practise: ', 'এরপর অনুশীলন: '), st.practise.flatMap((id, n) => [n ? ', ' : '', h('a', { href: '#' + id }, name(id))])));
  }

  RT.lab({
    id: 'roadmap', title: 'Learning Roadmap', short: 'Roadmap', chapter: 'Start here', plain: true, wide: true,
    lede: 'Every topic in a sensible order, in ten stages. Green means done, and bold means you know enough to start it.',
    render(root) {
      const ids = allStaged(), done = ids.filter(isDone).length, nx = ids.find((i) => !isDone(i) && ready(i)) || ids.find((i) => !isDone(i)), bar = ui.bar('res');
      bar.set((done / ids.length) * 100);
      const stats = ui.stats([['done', say('Topics done', 'শেষ বিষয়')], ['lv1', RT.levelName(1)], ['lv2', RT.levelName(2)], ['lv3', RT.levelName(3)]]);
      const count = (v) => { const t = ids.filter((i) => RT.levelOf(i) === v); return `${t.filter(isDone).length}/${t.length}`; };
      stats.set('done', `${done}/${ids.length}`, 'good'); [1, 2, 3].forEach((v) => stats.set('lv' + v, count(v)));
      root.append(stats, bar, nx && h('div', { class: 'banner ok' }, say('Best next step: ', 'পরের ভালো ধাপ: '), h('a', { href: '#' + nx }, RT.labText(RT.byId[nx], 'title'))), h('div', { class: 'stage-grid' }, STAGES.map(stageCard)),
        h('p', { class: 'small muted' }, say('Ready to practise? Work through the Interview section, and use Review to keep what you have learned.', 'অনুশীলনে প্রস্তুত? ইন্টারভিউ অংশ করুন, আর শেখা ধরে রাখতে রিভিউ ব্যবহার করুন।')));
    },
  });

  /* ---------- spaced review ---------- */
  const GAPS = [1, 3, 7, 16, 35];
  const today = () => Math.floor(Date.now() / 86400000);
  RT.lab({
    id: 'review', title: 'Spaced Review', short: 'Review', chapter: 'Practice', plain: true, wide: true,
    lede: 'Questions come back just as you are about to forget them. Ten a day keeps everything you have learned.',
    render(root) {
      const pool = RT.labs.filter((l) => l.check), box = h('div', { class: 'labmain' });
      const scope = ui.seg(say('Questions from', 'প্রশ্ন আসবে'), [['mine', say('Topics I have started', 'শুরু করা বিষয়')], ['all', say('Every topic', 'সব বিষয়')]], 'mine', start);
      const stats = ui.stats([['due', say('Due now', 'এখন বাকি')], ['known', say('Well known', 'ভালো জানা')], ['seen', say('Seen so far', 'এ পর্যন্ত দেখা')], ['all', say('In the deck', 'ডেকে মোট')]]);
      root.append(h('div', { class: 'controls' }, ui.field(say('Questions from', 'প্রশ্ন আসবে'), scope)), stats, box);
      let cards = load('roundtrip.review', {}), queue = [], right = 0, asked = 0;
      const due = (l) => { const c = cards[l.id]; return !c || c.due <= today(); };
      const list = () => pool.filter((l) => (scope.value === 'all' || isDone(l.id) || cards[l.id]) && due(l));
      function paint() { stats.set('due', list().length, list().length ? 'warn' : 'good'); stats.set('known', Object.values(cards).filter((c) => c.box >= 3).length, 'good'); stats.set('seen', Object.keys(cards).length); stats.set('all', pool.length); }
      function start() {
        queue = list().sort(() => Math.random() - .5).slice(0, 10); right = asked = 0; paint(); next();
      }
      function finish() {
        box.textContent = '';
        const empty = !asked, pick = pool.some((l) => isDone(l.id));
        box.append(ui.card(empty ? say('Nothing is due', 'এখন কিছু বাকি নেই') : say('Session finished', 'সেশন শেষ'), h('p', null, empty ? (pick ? say('You are up to date. Come back tomorrow, or choose Every topic.', 'সব হালনাগাদ। কাল আসুন, অথবা সব বিষয় বাছুন।') : say('Start a topic first, or choose Every topic above.', 'আগে একটি বিষয় শুরু করুন, অথবা ওপরে সব বিষয় বাছুন।')) : say(`${right} of ${asked} right. Questions you missed return tomorrow.`, `${asked}টির মধ্যে ${right}টি ঠিক। ভুলগুলো কাল ফিরবে।`)),
          h('div', { class: 'controls flat', style: { marginTop: '8px' } }, ui.btn(say('Check again', 'আবার দেখুন'), start, { kind: 'primary', id: 'rv-again' }), h('a', { class: 'btn', href: '#roadmap' }, say('Open the roadmap', 'রোডম্যাপ খুলুন')))));
      }
      function next() {
        const l = queue.shift();
        if (!l) { finish(); return; }
        const c = RT.checkFor(l), why = h('p', { class: 'small muted hide' }, c.why, ' ', h('a', { href: '#' + l.id }, say('Read the topic', 'বিষয়টি পড়ুন')));
        const go = ui.btn(queue.length ? say('Next question', 'পরের প্রশ্ন') : say('Finish', 'শেষ'), next, { kind: 'primary', id: 'rv-next' });
        go.classList.add('hide');
        const opts = c.options.map((text, i) => h('button', { onclick() {
          opts.forEach((b, j) => { b.disabled = true; if (j === c.answer) b.classList.add('right'); else if (j === i) b.classList.add('wrong'); });
          const was = cards[l.id] || { box: 0 }, good = i === c.answer, nb = good ? Math.min(GAPS.length - 1, was.box + (cards[l.id] ? 1 : 0)) : 0;
          cards[l.id] = { box: nb, due: today() + (good ? GAPS[nb] : 1) };
          save('roundtrip.review', cards); asked++; if (good) right++;
          why.classList.remove('hide'); go.classList.remove('hide'); paint();
        } }, text));
        box.textContent = '';
        box.append(ui.card(RT.labText(l, 'short'), h('div', { class: 'quiz' }, h('p', null, c.q), opts, why), h('div', { style: { marginTop: '8px' } }, go)));
      }
      start();
    },
  });

  /* ---------- cheat sheets ---------- */
  const table = (head, rows) => h('div', { class: 'scroll' }, h('table', { class: 'table cheat' }, h('tr', null, head.map((t) => h('th', null, t))), rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))));
  const N = (en, bn) => say(en, bn);
  RT.lab({
    id: 'cheatsheet', title: 'Cheat Sheets', short: 'Cheat sheets', chapter: 'Start here', plain: true, wide: true,
    lede: 'The numbers and decisions worth knowing by heart. These are rough orders of magnitude for reasoning, not measurements.',
    render(root) {
      root.append(h('div', { class: 'controls' }, ui.btn(say('Print these', 'প্রিন্ট করুন'), () => window.print(), { id: 'cs-print' }), h('span', { class: 'small muted' }, say('Real values vary with hardware. Learn the ratios, not the digits.', 'আসল মান হার্ডওয়্যারে বদলায়। অঙ্ক নয়, অনুপাত শিখুন।'))),
        h('div', { class: 'cheat-grid' },
          ui.card(N('How long things take', 'কিসে কত সময় লাগে'), table([N('Operation', 'কাজ'), N('About', 'প্রায়')], [
            [N('CPU cache hit', 'সিপিইউ ক্যাশ হিট'), '1 ns'], [N('Main memory read', 'মেইন মেমোরি রিড'), '100 ns'], [N('Read 1 MB from memory', 'মেমোরি থেকে ১ MB'), '3 µs'], [N('SSD random read', 'এসএসডি এলোমেলো রিড'), '20–100 µs'], [N('Read 1 MB from SSD', 'এসএসডি থেকে ১ MB'), '50 µs'],
            [N('Round trip inside a data centre', 'ডেটা সেন্টারের ভেতরে রাউন্ড ট্রিপ'), '0.5 ms'], [N('Hard disk seek', 'হার্ড ডিস্ক সিক'), '5–10 ms'], [N('Round trip across a continent', 'মহাদেশ জুড়ে রাউন্ড ট্রিপ'), '50–80 ms'], [N('Round trip between continents', 'মহাদেশের মধ্যে রাউন্ড ট্রিপ'), '150–250 ms'],
          ])),
          ui.card(N('Traffic in your head', 'মনে মনে ট্রাফিক'), table([N('Per day', 'দিনে'), N('Per second', 'সেকেন্ডে')], [
            ['1 million', '≈ 12'], ['10 million', '≈ 120'], ['100 million', '≈ 1,200'], ['1 billion', '≈ 12,000'], [N('Seconds in a day', 'দিনে সেকেন্ড'), '86,400 ≈ 100k'], [N('Seconds in a month', 'মাসে সেকেন্ড'), '≈ 2.5 million'], [N('Peak vs average', 'পিক বনাম গড়'), N('2 to 5 times', '২ থেকে ৫ গুণ')],
          ])),
          ui.card(N('Sizes', 'আকার'), table([N('Thing', 'জিনিস'), N('About', 'প্রায়')], [
            ['2¹⁰ / 2²⁰ / 2³⁰ / 2⁴⁰', 'KB / MB / GB / TB'], ['UUID', N('16 bytes', '১৬ বাইট')], [N('Snowflake id', 'Snowflake আইডি'), N('8 bytes', '৮ বাইট')], [N('Short text row', 'ছোট লেখার সারি'), '1 KB'], [N('Compressed photo', 'সংকুচিত ছবি'), '200 KB–2 MB'], [N('One minute of HD video', 'এক মিনিট এইচডি ভিডিও'), '50–100 MB'],
          ])),
          ui.card(N('Nines of availability', 'অ্যাভেইলেবিলিটির নাইন'), table([N('Target', 'লক্ষ্য'), N('Down per year', 'বছরে বন্ধ'), N('Per month', 'মাসে')], [
            ['99%', '3.65 d', '7.3 h'], ['99.9%', '8.8 h', '43 min'], ['99.95%', '4.4 h', '22 min'], ['99.99%', '53 min', '4.3 min'], ['99.999%', '5.3 min', '26 s'],
          ])),
          ui.card(N('Rough capacity, one machine', 'আনুমানিক ক্ষমতা, এক মেশিন'), table([N('Component', 'কম্পোনেন্ট'), N('Order of magnitude', 'মাত্রা')], [
            [N('Web app server', 'ওয়েব অ্যাপ সার্ভার'), N('1k requests/s', '১ হাজার অনুরোধ/সে')], [N('Reverse proxy', 'রিভার্স প্রক্সি'), N('10k+ requests/s', '১০ হাজার+ অনুরোধ/সে')], [N('SQL database', 'SQL ডেটাবেস'), N('1k–10k writes/s', '১–১০ হাজার রাইট/সে')], [N('In-memory cache', 'ইন-মেমোরি ক্যাশ'), N('100k ops/s', '১ লাখ কাজ/সে')], [N('Kafka broker', 'Kafka ব্রোকার'), N('100s of MB/s', 'শত শত MB/সে')],
          ])),
          ui.card(N('Formulas', 'সূত্র'), table([N('Name', 'নাম'), N('Formula', 'সূত্র')], [
            [h('a', { href: '#queueing' }, N('Little\'s Law', 'লিটলের সূত্র')), 'L = λ × W'], [N('Simple queue delay', 'সরল কিউয়ের দেরি'), 'T = S ÷ (1 − ρ)'], [h('a', { href: '#quorum' }, N('Strong quorum', 'শক্ত কোরাম')), 'R + W > N'], [h('a', { href: '#availability' }, N('Parts in series', 'সিরিজে অংশ')), 'A = A₁ × A₂'], [N('Parts in parallel', 'সমান্তরালে অংশ'), 'A = 1 − (1 − A₁)(1 − A₂)'], [h('a', { href: '#slo' }, N('Error budget', 'এরর বাজেট')), N('1 − SLO', '১ − SLO')],
          ]))),
        ui.card(N('Which tool for which job', 'কোন কাজে কোন হাতিয়ার'), table([N('If you need', 'যদি লাগে'), N('Start with', 'শুরু করুন'), N('Watch out for', 'সাবধান')], [
          [N('Reads much greater than writes', 'রাইটের চেয়ে অনেক বেশি রিড'), N('Cache and read replicas', 'ক্যাশ ও রিড রেপ্লিকা'), N('Stale data, replication lag', 'পুরনো ডেটা, রেপ্লিকেশন ল্যাগ')],
          [N('Writes beyond one machine', 'এক মেশিনের বেশি রাইট'), N('Sharding, or an LSM store', 'শার্ডিং, বা LSM স্টোর'), N('Hot keys, cross-shard queries', 'হট কী, শার্ডজোড়া কোয়েরি')],
          [N('Slow work behind a request', 'অনুরোধের পেছনে ধীর কাজ'), N('A queue and workers', 'কিউ ও ওয়ার্কার'), N('Repeats, so make handlers idempotent', 'পুনরাবৃত্তি, তাই হ্যান্ডলার আইডেমপোটেন্ট রাখুন')],
          [N('One event, many consumers', 'এক ইভেন্ট, অনেক কনজিউমার'), N('A log such as Kafka', 'Kafka-র মতো লগ'), N('Order holds per partition only', 'ক্রম শুধু পার্টিশনে')],
          [N('Money or stock counts', 'টাকা বা স্টকের হিসাব'), N('SQL transactions', 'SQL ট্রানজ্যাকশন'), N('Isolation level, double spends', 'আইসোলেশন লেভেল, দুবার খরচ')],
          [N('Files and media', 'ফাইল ও মিডিয়া'), N('Object storage and a CDN', 'অবজেক্ট স্টোরেজ ও সিডিএন'), N('Invalidation, egress cost', 'ইনভ্যালিডেশন, বাইরের ট্রাফিকের খরচ')],
          [N('Live updates to users', 'ব্যবহারকারীকে লাইভ আপডেট'), N('SSE one way, WebSocket two way', 'একমুখী SSE, দ্বিমুখী ওয়েবসকেট'), N('Connection state, reconnects', 'সংযোগের অবস্থা, পুনঃসংযোগ')],
          [N('Text or nearby search', 'লেখা বা কাছের সার্চ'), N('Inverted index or geohash', 'ইনভার্টেড ইনডেক্স বা জিওহ্যাশ'), N('It is a copy, so keep it in step', 'এটি কপি, তাই মিলিয়ে রাখুন')],
          [N('Unique ids across machines', 'মেশিন জুড়ে অনন্য আইডি'), N('Snowflake or UUID v7', 'Snowflake বা UUID v7'), N('Clock drift', 'ঘড়ির সরে যাওয়া')],
          [N('A safe retry', 'নিরাপদ রিট্রাই'), N('Idempotency key', 'আইডেমপোটেন্সি কী'), N('Retry storms, so use backoff and a budget', 'রিট্রাই ঝড়, তাই ব্যাকঅফ ও বাজেট')],
        ])));
    },
  });

  /* ---------- interview playbook ---------- */
  const STEPS = [
    { min: 5, en: ['Clarify requirements', 'List what the system must do, then how well: scale, latency, availability, consistency. Agree what is out of scope.', 'Who uses this, and what are the top three features? How many users? Is stale data acceptable?', 'Designing before you know the problem.'], bn: ['চাহিদা পরিষ্কার করুন', 'সিস্টেম কী করবে, তারপর কতটা ভালো: পরিসর, ল্যাটেন্সি, অ্যাভেইলেবিলিটি, কনসিস্টেন্সি। কী বাইরে রাখছেন ঠিক করুন।', 'কে ব্যবহার করবে, প্রধান তিনটি ফিচার কী? কত ব্যবহারকারী? পুরনো ডেটা চলবে?', 'সমস্যা না জেনেই ডিজাইন শুরু।'], link: 'basics' },
    { min: 5, en: ['Estimate the scale', 'Work out reads and writes per second, storage and bandwidth, with round numbers. Say what each result means for the design.', 'That is 12k reads a second and 40 writes, so caching matters more than sharding.', 'Calculating for ten minutes and then ignoring the result.'], bn: ['পরিসর আন্দাজ করুন', 'গোল সংখ্যায় সেকেন্ডে রিড ও রাইট, স্টোরেজ ও ব্যান্ডউইথ বের করুন। প্রতিটি ফল ডিজাইনে কী বোঝায় বলুন।', 'সেকেন্ডে ১২ হাজার রিড, ৪০ রাইট, তাই শার্ডিংয়ের চেয়ে ক্যাশিং জরুরি।', 'দশ মিনিট হিসাব করে ফল উপেক্ষা করা।'], link: 'estimate' },
    { min: 3, en: ['Define the API', 'Write the two to five main calls, with their inputs and outputs. This confirms you agree on the behaviour.', 'POST /urls returns a short code. GET /{code} redirects.', 'Listing every endpoint, rather than the ones that shape the design.'], bn: ['এপিআই ঠিক করুন', 'প্রধান দুই থেকে পাঁচটি কল ইনপুট ও আউটপুটসহ লিখুন। এতে আচরণে একমত হওয়া নিশ্চিত হয়।', 'POST /urls ছোট কোড দেয়। GET /{code} রিডাইরেক্ট করে।', 'ডিজাইন গড়া কলগুলোর বদলে সব এন্ডপয়েন্ট লেখা।'], link: 'apistyles' },
    { min: 5, en: ['Sketch the data model', 'Name the main entities and how they relate, then choose a store for each, based on access patterns.', 'We only ever look up by short code, so a key-value store fits.', 'Choosing a database by fashion rather than by query.'], bn: ['ডেটা মডেল আঁকুন', 'প্রধান এন্টিটি ও সম্পর্ক বলুন, অ্যাকসেস প্যাটার্ন দেখে প্রতিটির স্টোর বাছুন।', 'আমরা শুধু ছোট কোডে খুঁজি, তাই কী-ভ্যালু স্টোর মানায়।', 'কোয়েরি নয়, ফ্যাশন দেখে ডেটাবেস বাছা।'], link: 'databases' },
    { min: 10, en: ['Draw the high-level design', 'Draw five or six boxes that solve the problem end to end, then walk one read and one write through them.', 'A request reaches the load balancer, then a stateless app server, which checks the cache before the database.', 'Starting with Kafka and Kubernetes before anything needs them.'], bn: ['উচ্চ-স্তরের ডিজাইন আঁকুন', 'শুরু থেকে শেষ পর্যন্ত সমস্যা মেটানো পাঁচ-ছয়টি বক্স আঁকুন, একটি রিড ও রাইট হাঁটান।', 'অনুরোধ লোড ব্যালান্সারে, তারপর স্টেটলেস অ্যাপ সার্ভারে, যা ডেটাবেসের আগে ক্যাশ দেখে।', 'দরকারের আগেই Kafka ও কুবারনেটিস দিয়ে শুরু।'], link: 'map' },
    { min: 12, en: ['Go deep on the hard parts', 'Pick the two or three hardest problems, or let the interviewer guide you. Give options, compare them and choose one.', 'We could fan out on write or on read. Writes are costly for celebrities, so I would use a hybrid.', 'Describing a single answer with no alternatives.'], bn: ['কঠিন অংশে গভীরে যান', 'সবচেয়ে কঠিন দুই-তিনটি সমস্যা বাছুন, অথবা ইন্টারভিউয়ারকে পথ দেখাতে দিন। বিকল্প দিন, তুলনা করুন, বাছুন।', 'রাইটে বা রিডে ফ্যান-আউট করা যায়। তারকাদের রাইট দামি, তাই হাইব্রিড নেব।', 'বিকল্প ছাড়া একটি উত্তর বলা।'], link: 'tradeoffs' },
    { min: 5, en: ['Find bottlenecks and failures', 'Look for single points of failure, hot spots, and what breaks at ten times the load. Say how you would monitor it.', 'If this cache dies, the database takes all the traffic, so I would add replicas and a request limit.', 'Finishing without mentioning failure at all.'], bn: ['বটলনেক ও ব্যর্থতা খুঁজুন', 'একক ব্যর্থতার বিন্দু, হট স্পট, আর দশগুণ চাপে কী ভাঙে খুঁজুন। কীভাবে মনিটর করবেন বলুন।', 'এই ক্যাশ মরলে সব ট্রাফিক ডেটাবেসে, তাই রেপ্লিকা ও অনুরোধের সীমা দেব।', 'ব্যর্থতার কথা না বলেই শেষ করা।'], link: 'resilience' },
  ];
  const SCORE = [['Do you structure an open problem?', 'খোলা সমস্যা কি সাজাতে পারেন?'], ['Do you ask before you assume?', 'ধরে নেওয়ার আগে কি জিজ্ঞেস করেন?'], ['Do your numbers change your design?', 'আপনার সংখ্যা কি ডিজাইন বদলায়?'], ['Can you compare two options fairly?', 'দুটি বিকল্প কি ন্যায্যভাবে তুলনা করতে পারেন?'], ['Do you think about failure?', 'ব্যর্থতা নিয়ে কি ভাবেন?'], ['Do you respond well to hints?', 'ইঙ্গিতে কি ভালো সাড়া দেন?']];
  const PHRASES = [['The trade-off here is…', 'এখানে লেনদেনটি হলো…'], ['This depends on the read to write ratio, so let me check that.', 'এটি রিড-রাইট অনুপাতে নির্ভর করে, যাচাই করে নিই।'], ['I would start simple, and add this when the numbers require it.', 'সরল দিয়ে শুরু করব, সংখ্যা চাইলে এটি যোগ করব।'], ['If this fails, users would see…', 'এটি ব্যর্থ হলে ব্যবহারকারী দেখবেন…'], ['I am assuming that…, so please stop me if that is wrong.', 'আমি ধরছি যে…, ভুল হলে থামান।']];
  RT.lab({
    id: 'playbook', title: 'Interview Playbook', short: 'Playbook', chapter: 'Interview', plain: true, wide: true,
    lede: 'A seven-step method for a 45-minute design interview, with what to say and what to avoid at each step.',
    render(root) {
      root.append(h('ol', { class: 'play' }, STEPS.map((t, i) => {
        const x = t[S.lang === 'bn' ? 'bn' : 'en'];
        return h('li', { class: 'card' }, h('div', { class: 'play-head' }, h('span', { class: 'stage-n' }, i + 1), h('h2', null, x[0]), h('span', { class: 'small muted' }, say(`about ${t.min} min`, `প্রায় ${t.min} মিনিট`))), h('p', null, x[1]), h('p', { class: 'small' }, h('b', null, say('Say: ', 'বলুন: ')), '"' + x[2] + '"'), h('p', { class: 'small' }, h('b', null, say('Avoid: ', 'এড়ান: ')), x[3]), h('a', { class: 'small', href: '#' + t.link }, say('Practise this: ', 'অনুশীলন: ') + RT.labText(RT.byId[t.link], 'title')));
      })),
      h('div', { class: 'twocol' }, ui.card(say('What interviewers look for', 'ইন্টারভিউয়ার যা দেখেন'), h('ul', null, SCORE.map((v) => h('li', null, v[S.lang === 'bn' ? 1 : 0])))), ui.card(say('Useful phrases', 'কাজের বাক্য'), h('ul', null, PHRASES.map((v) => h('li', null, v[S.lang === 'bn' ? 1 : 0]))))),
      h('div', { class: 'controls flat' }, h('a', { class: 'btn primary', href: '#walkthroughs' }, say('Work through a design', 'একটি ডিজাইন করে দেখুন')), h('a', { class: 'btn', href: '#studio' }, say('Timed practice in the Studio', 'স্টুডিওতে সময় ধরে অনুশীলন'))));
    },
  });

  /* ---------- worked designs ---------- */
  const W = window.RTWalks = [
    { id: 'url', brief: 'url', topics: ['ids', 'cacheflow', 'sharding'], en: ['URL Shortener', 'Turn long links into short ones, and redirect billions of clicks.', ['Custom aliases? Do links expire? Are analytics needed?', '100M new links a month is about 40 writes/s. At 100:1 reads, about 4k reads/s. 500 bytes × 6B links over 5 years is 3 TB.', 'POST /urls → code. GET /{code} → redirect.', 'Key-value: code → url, owner, expiry. Only ever looked up by code.', 'Stateless app servers behind a load balancer, a Redis cache for hot codes, and a key-value store.', 'Making unique codes. Hash and truncate risks collisions. Base62 of a counter or Snowflake id avoids them, and 7 characters give 3.5 trillion codes. A 302 redirect keeps analytics; a 301 lets browsers skip you.']], bn: ['ইউআরএল ছোট করা', 'লম্বা লিংক ছোট করা, আর কোটি কোটি ক্লিক রিডাইরেক্ট করা।', ['নিজের নাম? লিংকের মেয়াদ? বিশ্লেষণ লাগবে?', 'মাসে ১০ কোটি নতুন লিংক মানে প্রায় ৪০ রাইট/সে। ১০০:১ রিডে প্রায় ৪ হাজার রিড/সে। ৫ বছরে ৫০০ বাইট × ৬০০ কোটি = ৩ TB।', 'POST /urls → কোড। GET /{code} → রিডাইরেক্ট।', 'কী-ভ্যালু: কোড → ইউআরএল, মালিক, মেয়াদ। শুধু কোডে খোঁজা হয়।', 'লোড ব্যালান্সারের পেছনে স্টেটলেস অ্যাপ সার্ভার, হট কোডে Redis ক্যাশ, আর কী-ভ্যালু স্টোর।', 'অনন্য কোড বানানো। হ্যাশ কেটে নিলে সংঘর্ষের ঝুঁকি। কাউন্টার বা Snowflake-এর Base62 তা এড়ায়, ৭ অক্ষরে ৩.৫ লাখ কোটি কোড। 302 রিডাইরেক্টে বিশ্লেষণ থাকে; 301-এ ব্রাউজার আপনাকে এড়ায়।']] },
    { id: 'feed', brief: 'feed', topics: ['kafka', 'cacheflow', 'objectstore'], en: ['Photo Feed', 'Users post photos and read a feed of the people they follow.', ['Feed order: by time or ranked? How large can a follower list get?', '100M daily users. 50M photos a day × 2 MB is 100 TB a day. 1B feed reads a day is about 12k/s, and peaks are higher.', 'POST /photos. GET /feed?cursor=.', 'Users and follows in SQL or a graph store. Photo metadata by id. Feeds as cached lists of ids.', 'Upload to object storage through pre-signed URLs, then serve from a CDN. A feed service reads precomputed lists from Redis.', 'Fan-out. On write is quick to read and impossible for a celebrity with 50M followers. On read is the reverse. Use a hybrid: pre-build for most users, and merge celebrity posts when reading.']], bn: ['ফটো ফিড', 'ব্যবহারকারী ছবি পোস্ট করেন, অনুসরণ করা মানুষের ফিড পড়েন।', ['ফিডের ক্রম: সময়ে না র‍্যাঙ্কিংয়ে? অনুসারী কত বড় হতে পারে?', 'দৈনিক ১০ কোটি ব্যবহারকারী। দিনে ৫ কোটি ছবি × ২ MB = দিনে ১০০ TB। দিনে ১০০ কোটি ফিড রিড মানে প্রায় ১২ হাজার/সে, পিকে বেশি।', 'POST /photos। GET /feed?cursor=।', 'ব্যবহারকারী ও অনুসরণ SQL বা গ্রাফ স্টোরে। ছবির মেটাডেটা আইডিতে। ফিড আইডির ক্যাশড তালিকা।', 'প্রি-সাইনড ইউআরএলে অবজেক্ট স্টোরেজে আপলোড, সিডিএন থেকে দেওয়া। ফিড সার্ভিস Redis থেকে আগে বানানো তালিকা পড়ে।', 'ফ্যান-আউট। রাইটে করলে পড়া দ্রুত, ৫ কোটি অনুসারীর তারকার জন্য অসম্ভব। রিডে করলে উল্টো। হাইব্রিড নিন: বেশিরভাগের জন্য আগে বানান, তারকার পোস্ট পড়ার সময় মেশান।']] },
    { id: 'drive', brief: null, topics: ['objectstore', 'checksum', 'realtime'], en: ['Cloud Drive', 'Keep files in step across a person\'s devices.', ['Maximum file size? Offline edits? Sharing?', '50M users × 10 GB is 500 PB. Most files change little, and many are duplicates.', 'Upload and download chunks. GET /changes?since=.', 'Strongly consistent metadata in SQL: files, versions and chunk lists. Chunks in object storage, keyed by hash.', 'A client splits files into 4 MB chunks, uploads only changed ones, then updates metadata. A notification channel tells other devices.', 'Saving bandwidth and handling conflicts. Hash-addressed chunks give deduplication, so an edit resends only one chunk. Two offline edits to one file create a "conflicted copy", because guessing would lose work.']], bn: ['ক্লাউড ড্রাইভ', 'একজনের সব ডিভাইসে ফাইল মিলিয়ে রাখা।', ['সর্বোচ্চ ফাইলের আকার? অফলাইন সম্পাদনা? শেয়ারিং?', '৫ কোটি ব্যবহারকারী × ১০ GB = ৫০০ PB। বেশিরভাগ ফাইল কমই বদলায়, অনেকগুলো নকল।', 'চাঙ্ক আপলোড ও ডাউনলোড। GET /changes?since=।', 'SQL-এ শক্ত কনসিস্টেন্ট মেটাডেটা: ফাইল, সংস্করণ, চাঙ্ক তালিকা। চাঙ্ক অবজেক্ট স্টোরেজে, হ্যাশ কী দিয়ে।', 'ক্লায়েন্ট ফাইলকে ৪ MB চাঙ্কে ভাগ করে, শুধু বদলানোগুলো আপলোড করে, মেটাডেটা হালনাগাদ করে। নোটিফিকেশন অন্য ডিভাইসকে জানায়।', 'ব্যান্ডউইথ বাঁচানো ও দ্বন্দ্ব। হ্যাশ-ঠিকানার চাঙ্কে ডিডুপ হয়, সম্পাদনায় একটি চাঙ্কই যায়। এক ফাইলে দুই অফলাইন সম্পাদনায় "দ্বন্দ্বপূর্ণ কপি" হয়, কারণ অনুমান করলে কাজ হারায়।']] },
    { id: 'chat', brief: 'chat', topics: ['realtime', 'delivery', 'cs-cassandra'], en: ['Chat App', 'One-to-one and group messages, delivered at once, with history.', ['Group size limit? Are read receipts needed? Is end-to-end encryption required?', '500M daily users × 40 messages is 20B a day, about 230k/s. 100 bytes each is 2 TB a day.', 'WebSocket: send, ack, deliver. GET /messages?before=.', 'Wide-column store keyed by conversation, sorted by message id.', 'Clients hold WebSockets to gateway servers. A registry maps each user to a gateway. Messages are saved first, then routed.', 'Delivery and order. Save before acking, retry until the receiver acks, and dedupe by client message id. Sequence per conversation, not globally. Offline users get a push, and sync on return. Large groups use fan-out on read.']], bn: ['চ্যাট অ্যাপ', 'একের সঙ্গে এক ও গ্রুপ বার্তা, তাৎক্ষণিক, ইতিহাসসহ।', ['গ্রুপের সীমা? রিড রিসিপ্ট? এন্ড-টু-এন্ড এনক্রিপশন?', '৫০ কোটি ব্যবহারকারী × ৪০ বার্তা = দিনে ২,০০০ কোটি, প্রায় ২.৩ লাখ/সে। ১০০ বাইটে দিনে ২ TB।', 'ওয়েবসকেট: পাঠানো, অ্যাক, পৌঁছানো। GET /messages?before=।', 'কনভারসেশন কী-তে ওয়াইড-কলাম স্টোর, বার্তা আইডিতে সাজানো।', 'ক্লায়েন্ট গেটওয়ে সার্ভারে ওয়েবসকেট রাখে। রেজিস্ট্রি ব্যবহারকারীকে গেটওয়ের সঙ্গে মেলায়। বার্তা আগে রাখা, পরে পাঠানো।', 'ডেলিভারি ও ক্রম। অ্যাকের আগে রাখুন, প্রাপক অ্যাক না করা পর্যন্ত রিট্রাই, ক্লায়েন্ট বার্তা আইডিতে ডিডুপ। ক্রম কনভারসেশনে, বৈশ্বিক নয়। অফলাইনে পুশ, ফিরলে সিঙ্ক। বড় গ্রুপে রিডে ফ্যান-আউট।']] },
    { id: 'video', brief: 'video', topics: ['cdn', 'objectstore', 'kafka'], en: ['Video Streaming', 'Upload once, and stream to millions on any connection.', ['Live or on demand? Which devices? Is there a resolution limit?', '1B views a day is about 12k/s. At a peak of 1M concurrent streams × 5 Mbps, that is 5 Tbps, so a CDN is essential.', 'POST /uploads. GET /videos/{id}/manifest.', 'Metadata in SQL. Video segments in object storage.', 'Upload to storage, then a queue feeds transcoding workers, which make several resolutions cut into short segments. The CDN serves them.', 'Delivery cost and quality. Adaptive bitrate lets the player switch quality per segment. Transcoding runs as parallel tasks on small pieces. Popular videos stay at the edge, and rarely watched ones move to cheaper storage.']], bn: ['ভিডিও স্ট্রিমিং', 'একবার আপলোড, যেকোনো সংযোগে লাখো মানুষকে স্ট্রিম।', ['লাইভ না অন-ডিমান্ড? কোন ডিভাইস? রেজোলিউশনের সীমা?', 'দিনে ১০০ কোটি ভিউ মানে প্রায় ১২ হাজার/সে। পিকে ১০ লাখ সমকালীন স্ট্রিম × ৫ Mbps = ৫ Tbps, তাই সিডিএন অপরিহার্য।', 'POST /uploads। GET /videos/{id}/manifest।', 'মেটাডেটা SQL-এ। ভিডিও অংশ অবজেক্ট স্টোরেজে।', 'স্টোরেজে আপলোড, কিউ ট্রান্সকোডিং ওয়ার্কারকে খাওয়ায়, যারা কয়েক রেজোলিউশনে ছোট অংশ বানায়। সিডিএন দেয়।', 'ডেলিভারির খরচ ও মান। অ্যাডাপটিভ বিটরেটে প্লেয়ার প্রতি অংশে মান বদলায়। ট্রান্সকোডিং ছোট টুকরোয় সমান্তরালে চলে। জনপ্রিয় ভিডিও এজে, কম দেখা সস্তা স্টোরেজে।']] },
    { id: 'typeahead', brief: 'search', topics: ['searchgeo', 'cacheflow', 'sharding'], en: ['Search Autocomplete', 'Suggest completions within 100 ms, as someone types.', ['How many suggestions? Personalised? How fresh must they be?', '5B searches a day is about 60k/s, and several requests per search. Reads dominate heavily.', 'GET /suggest?q=pre.', 'A trie, with the top suggestions stored at each node.', 'A batch job builds tries from query logs, then in-memory servers answer, shard by prefix. Browsers and CDNs cache common prefixes.', 'Latency. Walking down from a prefix and sorting would be too slow, so precompute the top results at each node. Rebuild in batches, because suggestions need not be perfectly fresh. Debounce keystrokes on the client.']], bn: ['সার্চ অটোকমপ্লিট', 'টাইপের সময় ১০০ মিলিসেকেন্ডে পরামর্শ দেওয়া।', ['কত পরামর্শ? ব্যক্তিগত? কত তাজা?', 'দিনে ৫০০ কোটি সার্চ মানে প্রায় ৬০ হাজার/সে, প্রতি সার্চে কয়েকটি অনুরোধ। রিড অনেক বেশি।', 'GET /suggest?q=pre।', 'ট্রাই, প্রতিটি নোডে সেরা পরামর্শসহ।', 'ব্যাচ কাজ কোয়েরি লগ থেকে ট্রাই বানায়, ইন-মেমোরি সার্ভার উত্তর দেয়, উপসর্গে শার্ড। ব্রাউজার ও সিডিএন প্রচলিত উপসর্গ ক্যাশ করে।', 'ল্যাটেন্সি। উপসর্গ থেকে হেঁটে সাজানো খুব ধীর, তাই প্রতি নোডে সেরা ফল আগে থেকে রাখুন। ব্যাচে আবার বানান, পরামর্শ নিখুঁত তাজা না হলেও চলে। ক্লায়েন্টে কী চাপ ডিবাউন্স করুন।']] },
    { id: 'limiter', brief: null, topics: ['ratelimit', 'gateway', 'consensus'], en: ['API Rate Limiter', 'Enforce per-client limits across a fleet of servers.', ['Per user, IP or key? Hard or soft limit? What if the limiter fails?', '1M requests/s through the gateway. 100M clients × about 100 bytes is 10 GB in memory.', 'Middleware: allow or return 429 with Retry-After.', 'Counters or tokens in Redis, with a TTL.', 'Gateways call a shared Redis cluster, shard by client key, and use an atomic script.', 'Accuracy against speed. Read-then-write races, so use an atomic operation. A network hop per request adds delay, so keep a small local allowance and sync it. Decide on failing open or closed ahead of time.']], bn: ['এপিআই রেট লিমিটার', 'সার্ভারের বহর জুড়ে ক্লায়েন্টপ্রতি সীমা মানানো।', ['ব্যবহারকারী, আইপি না কী? কড়া না নরম সীমা? লিমিটার ব্যর্থ হলে?', 'গেটওয়েতে ১০ লাখ অনুরোধ/সে। ১০ কোটি ক্লায়েন্ট × প্রায় ১০০ বাইট = মেমোরিতে ১০ GB।', 'মিডলওয়্যার: অনুমতি, অথবা Retry-After-সহ 429।', 'Redis-এ কাউন্টার বা টোকেন, টিটিএলসহ।', 'গেটওয়ে যৌথ Redis ক্লাস্টার ডাকে, ক্লায়েন্ট কী-তে শার্ড, অ্যাটমিক স্ক্রিপ্টে।', 'নির্ভুলতা বনাম গতি। পড়ে-তারপর-লেখা রেস করে, তাই অ্যাটমিক কাজ। প্রতি অনুরোধে নেটওয়ার্ক হপে দেরি, তাই ছোট স্থানীয় ছাড় রেখে সিঙ্ক করুন। ফেইল ওপেন না ক্লোজড আগেই ঠিক করুন।']] },
    { id: 'crawler', brief: null, topics: ['bloom', 'kafka', 'checksum'], en: ['Web Crawler', 'Fetch and store billions of pages, politely.', ['Which content types? How fresh? Is it for search?', '1B pages a month is about 400 pages/s. 500 KB each is 500 TB a month.', 'Internal only: seed URLs in, stored pages out.', 'URL frontier in queues, seen URLs in a Bloom filter, and pages in object storage.', 'Workers take URLs from the frontier, check robots.txt, fetch, extract links and enqueue new ones.', 'Politeness and duplicates. One queue per host, with a delay, so no site is overloaded. A Bloom filter skips seen URLs, and a content checksum skips duplicate pages. Limit depth to escape spider traps. Cache DNS, which is often the hidden bottleneck.']], bn: ['ওয়েব ক্রলার', 'ভদ্রভাবে কোটি কোটি পেজ এনে রাখা।', ['কোন ধরনের বিষয়? কত তাজা? সার্চের জন্য?', 'মাসে ১০০ কোটি পেজ মানে প্রায় ৪০০ পেজ/সে। ৫০০ KB-তে মাসে ৫০০ TB।', 'শুধু ভেতরে: বীজ ইউআরএল ঢোকে, রাখা পেজ বের হয়।', 'ইউআরএল ফ্রন্টিয়ার কিউতে, দেখা ইউআরএল ব্লুম ফিল্টারে, পেজ অবজেক্ট স্টোরেজে।', 'ওয়ার্কার ফ্রন্টিয়ার থেকে ইউআরএল নেয়, robots.txt দেখে, আনে, লিংক বের করে নতুনগুলো লাইনে দেয়।', 'ভদ্রতা ও নকল। প্রতি হোস্টে একটি কিউ, দেরিসহ, যাতে কোনো সাইট না ডোবে। ব্লুম ফিল্টার দেখা ইউআরএল বাদ দেয়, কনটেন্ট চেকসাম নকল পেজ। স্পাইডার ফাঁদ এড়াতে গভীরতা সীমিত। ডিএনএস ক্যাশ করুন, প্রায়ই লুকানো বটলনেক।']] },
    { id: 'nearby', brief: null, topics: ['searchgeo', 'replication', 'cacheflow'], en: ['Nearby Search', 'Find places close to a person, ranked and filtered.', ['Search radius? Do places change often? Are ratings included?', '100M places × 1 KB is 100 GB, which fits in memory. 100k searches/s, mostly reads.', 'GET /nearby?lat=&lon=&radius=.', 'Places in SQL. A spatial index maps geohash cell → place ids.', 'Read replicas of the spatial index behind a load balancer, plus a cache of popular cells.', 'Finding neighbours quickly. Look up your cell and its eight neighbours, then filter by true distance. A quadtree handles dense cities better than fixed cells. Places change slowly, so batch updates are fine.']], bn: ['কাছের সার্চ', 'কাছের জায়গা খোঁজা, সাজানো ও ছাঁকা।', ['সার্চের ব্যাসার্ধ? জায়গা কি ঘন ঘন বদলায়? রেটিং আছে?', '১০ কোটি জায়গা × ১ KB = ১০০ GB, মেমোরিতে ধরে। ১ লাখ সার্চ/সে, মূলত রিড।', 'GET /nearby?lat=&lon=&radius=।', 'জায়গা SQL-এ। স্প্যাশিয়াল ইনডেক্সে জিওহ্যাশ ঘর → জায়গার আইডি।', 'লোড ব্যালান্সারের পেছনে স্প্যাশিয়াল ইনডেক্সের রিড রেপ্লিকা, আর জনপ্রিয় ঘরের ক্যাশ।', 'দ্রুত প্রতিবেশী খোঁজা। নিজের ঘর ও আটটি প্রতিবেশী দেখে সঠিক দূরত্বে ছাঁকুন। ঘন শহরে কোয়াডট্রি নির্দিষ্ট ঘরের চেয়ে ভালো। জায়গা ধীরে বদলায়, তাই ব্যাচ হালনাগাদই যথেষ্ট।']] },
    { id: 'rides', brief: null, topics: ['searchgeo', 'dlock', 'realtime'], en: ['Ride Hailing', 'Match riders with nearby drivers in real time.', ['ETA or distance matching? Surge pricing? Which regions?', '1M active drivers, each reporting every 4 s, is 250k location updates/s.', 'WebSocket for locations. POST /trips. Trip state updates pushed to both sides.', 'Live locations in memory by cell, and not stored per update. Trips in SQL.', 'Location service with a geo index, a matching service and a trip service. Riders and drivers hold open connections.', 'Write volume and double booking. Do not write each ping to a database; keep the latest in memory, and sample to storage. Offer a ride to one driver at a time, and use a conditional update, so that one driver cannot take two trips.']], bn: ['রাইড শেয়ারিং', 'রিয়েল টাইমে যাত্রীকে কাছের চালকের সঙ্গে মেলানো।', ['ইটিএ না দূরত্বে মেলানো? সার্জ প্রাইসিং? কোন অঞ্চল?', '১০ লাখ সক্রিয় চালক, প্রতি ৪ সেকেন্ডে জানালে ২.৫ লাখ অবস্থান/সে।', 'অবস্থানে ওয়েবসকেট। POST /trips। ট্রিপের অবস্থা দুই পক্ষে পুশ।', 'লাইভ অবস্থান মেমোরিতে ঘর ধরে, প্রতি হালনাগাদে রাখা হয় না। ট্রিপ SQL-এ।', 'জিও ইনডেক্সসহ অবস্থান সেবা, মেলানোর সেবা ও ট্রিপ সেবা। যাত্রী ও চালক খোলা সংযোগ রাখেন।', 'রাইটের পরিমাণ ও ডাবল বুকিং। প্রতিটি পিং ডেটাবেসে নয়; সর্বশেষটি মেমোরিতে, স্টোরেজে নমুনা। এক সময়ে একজন চালককে অফার করুন, শর্তসাপেক্ষ আপডেটে, যাতে একজন দুটি ট্রিপ না নেন।']] },
    { id: 'tickets', brief: 'shop', topics: ['isolation', 'freshness', 'idempotency'], en: ['Ticket Booking', 'Sell limited seats during a huge rush, with no double booking.', ['Choose a seat or best available? How long is a hold? Are bots a concern?', '10M people arrive for 50k seats in minutes. Reads vastly exceed successful writes.', 'GET /events/{id}/seats. POST /holds. POST /orders with an idempotency key.', 'SQL: seats with a state and hold expiry. Strong consistency for this one table.', 'A waiting room admits users at a safe rate. Seat maps come from a cache. Holds and payments go to the database.', 'No double booking. Use a conditional update: set held WHERE state = free. Holds expire after ten minutes, so abandoned seats return. Payment uses an idempotency key. A queue at the front protects everything behind it.']], bn: ['টিকিট বুকিং', 'বিশাল ভিড়ে সীমিত আসন বিক্রি, ডাবল বুকিং ছাড়া।', ['আসন বাছা না সেরা উপলব্ধ? হোল্ড কতক্ষণ? বট কি সমস্যা?', '৫০ হাজার আসনে কয়েক মিনিটে ১ কোটি মানুষ। সফল রাইটের চেয়ে রিড অনেক বেশি।', 'GET /events/{id}/seats। POST /holds। আইডেমপোটেন্সি কী-সহ POST /orders।', 'SQL: অবস্থা ও হোল্ডের মেয়াদসহ আসন। এই এক টেবিলে শক্ত কনসিস্টেন্সি।', 'ওয়েটিং রুম নিরাপদ হারে ঢোকায়। আসনের ম্যাপ ক্যাশ থেকে। হোল্ড ও পেমেন্ট ডেটাবেসে।', 'ডাবল বুকিং নয়। শর্তসাপেক্ষ আপডেট: state = free হলে তবেই held। দশ মিনিটে হোল্ড শেষ, ফেলে যাওয়া আসন ফেরে। পেমেন্টে আইডেমপোটেন্সি কী। সামনের কিউ পেছনের সব বাঁচায়।']] },
  ];
  const PARTS = [['Clarify', 'পরিষ্কার করুন'], ['Estimate', 'আন্দাজ'], ['API', 'এপিআই'], ['Data model', 'ডেটা মডেল'], ['High-level design', 'উচ্চ-স্তরের ডিজাইন'], ['The hard part', 'কঠিন অংশ']];
  RT.lab({
    id: 'walkthroughs', title: 'Worked Designs', short: 'Worked designs', chapter: 'Interview', plain: true, wide: true,
    lede: 'Eleven classic design problems, one step at a time. Try each step yourself before you open it.',
    render(root) {
      const seen = load('roundtrip.walks', {}), bn = S.lang === 'bn' ? 1 : 0;
      root.append(h('div', { class: 'banner' }, say('Spend a few minutes on each step, on paper, before opening it. Recalling beats rereading.', 'প্রতিটি ধাপ খোলার আগে কাগজে কয়েক মিনিট ভাবুন। পড়ার চেয়ে মনে করা ভালো।')),
        h('div', { class: 'walks' }, W.map((w) => {
          const x = w[bn ? 'bn' : 'en'];
          return h('details', { class: 'card walk', id: 'w-' + w.id, ontoggle(e) { if (e.target.open) { seen[w.id] = 1; save('roundtrip.walks', seen); } } },
            h('summary', null, h('b', null, x[0]), h('span', { class: 'small muted' }, x[1]), seen[w.id] ? h('span', { class: 'small', style: { color: 'var(--res)' } }, '✓') : null),
            h('div', { class: 'walk-in' }, PARTS.map((p, i) => h('details', { class: 'walk-step' }, h('summary', null, `${i + 1}. ${p[bn]}`), h('p', null, x[2][i]))),
              h('p', { class: 'small' }, say('Topics to review: ', 'যে বিষয় দেখবেন: '), w.topics.map((t, i) => [i ? ', ' : '', h('a', { href: '#' + t }, name(t))])),
              w.brief && h('a', { class: 'btn', href: '#studio' }, say('Build this in the Studio', 'স্টুডিওতে বানান'))));
        })));
    },
  });

  /* ---------- Bengali names for these pages ---------- */
  Object.assign(window.RTLabsBn, {
    roadmap: { title: 'শেখার রোডম্যাপ', short: 'রোডম্যাপ', chapter: 'এখান থেকে শুরু', lede: 'প্রতিটি বিষয় যুক্তিসঙ্গত ক্রমে, দশটি ধাপে। সবুজ মানে শেষ, মোটা মানে শুরু করার মতো জানেন।' },
    review: { title: 'স্পেসড রিভিউ', short: 'রিভিউ', chapter: 'অনুশীলন', lede: 'ভুলে যাওয়ার ঠিক আগে প্রশ্ন ফিরে আসে। দিনে দশটিতেই সব শেখা ধরে থাকে।' },
    cheatsheet: { title: 'চিট শিট', short: 'চিট শিট', chapter: 'এখান থেকে শুরু', lede: 'মনে রাখার মতো সংখ্যা ও সিদ্ধান্ত। এগুলো ভাবার জন্য মোটামুটি মাত্রা, মাপ নয়।' },
    playbook: { title: 'ইন্টারভিউ প্লেবুক', short: 'প্লেবুক', chapter: 'ইন্টারভিউ', lede: '৪৫ মিনিটের ডিজাইন ইন্টারভিউয়ের সাত ধাপের পদ্ধতি, প্রতি ধাপে কী বলবেন ও কী এড়াবেন।' },
    walkthroughs: { title: 'সমাধান করা ডিজাইন', short: 'সমাধান করা ডিজাইন', chapter: 'ইন্টারভিউ', lede: 'এগারোটি ক্লাসিক ডিজাইন সমস্যা, ধাপে ধাপে। খোলার আগে নিজে চেষ্টা করুন।' },
  });

  /* ---------- home: the roadmap at a glance and a level filter ---------- */
  RT.homeRoadmap = () => {
    const stages = STAGES.map((st) => { const ids = st.ids.filter((x) => RT.byId[x]); return { st, ids, done: ids.filter(isDone).length }; }), cur = stages.find((x) => x.done < x.ids.length) || stages[0];
    return h('section', { class: 'home-road' }, h('div', { class: 'path-head' }, h('div', null, h('h2', null, say('The roadmap', 'রোডম্যাপ')), h('p', { class: 'small muted' }, say(`Ten stages, from your first request to real systems. You are on: ${cur.st.en}.`, `দশটি ধাপ, প্রথম অনুরোধ থেকে আসল সিস্টেম পর্যন্ত। আপনি এখন: ${cur.st.bn}।`))), h('a', { class: 'btn', href: '#roadmap', id: 'home-roadmap' }, say('Open the roadmap', 'রোডম্যাপ খুলুন'))),
      h('div', { class: 'road-mini', 'aria-hidden': 'true' }, stages.map((x) => h('i', { style: { '--p': Math.round((x.done / x.ids.length) * 100) + '%' }, title: say(x.st.en, x.st.bn) }))));
  };
  RT.levelFilter = (root) => {
    const seg = ui.seg(say('Show', 'দেখান'), [['0', say('All levels', 'সব স্তর')], ['1', RT.levelName(1)], ['2', RT.levelName(2)], ['3', RT.levelName(3)]], String(S.homeLevel || 0), (v) => { S.homeLevel = +v; RT.saveSettings(); apply(); });
    function apply() {
      const want = S.homeLevel || 0;
      root.querySelectorAll('.hometrack').forEach((t) => {
        let any = false;
        t.querySelectorAll('.labcard').forEach((c) => { const on = !want || +c.dataset.lv === want; c.classList.toggle('hide', !on); any = any || on; });
        t.classList.toggle('hide', !any);
      });
    }
    return { el: h('div', { class: 'controls' }, ui.field(say('Show', 'দেখান'), seg)), apply };
  };
})();
