/* Live incidents: plays a design through a stretch of real time, one simulated minute per step.
   The engine answers "what happens at this load, with this fault". This file adds what changes from
   minute to minute: the daily traffic curve, incidents that start and end, an autoscaler whose servers
   take minutes to arrive, queues that back up and drain, a cache that warms again, clients that retry,
   alerts that need a breach to last, an error budget, and a runbook whose fixes take time to work.
   It has no DOM, so tests/ops.test.js runs it directly. Text is written 'English|বাংলা'. */
(function (root) {
  'use strict';
  const D = root.RTDesign;
  /* Minutes in a 30-day month, server boot time, cache warm-up time constant, DNS failover time,
     restore time, and how much an overloaded tier wastes on requests that time out. */
  const MONTH_MIN = 43200, BOOT = 3, WARM = 4, DNS = 3, RESTORE = 15, COLLAPSE = .5;
  /* Autoscaler: add servers above 75%, aiming for 60%; remove them after 10 minutes under 35%. */
  const UP = .75, TARGET = .6, DOWN = .35, QUIET = 10;
  /* A minute over a latency target counts as a quarter of a minute of errors against the budget. */
  const SLOW_COST = .25;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pick = (s, lang) => { if (typeof s !== 'string') return ''; const i = s.indexOf('|'); return i < 0 ? s : lang === 'bn' ? s.slice(i + 1) : s.slice(0, i); };
  const E = (s) => pick(s, 'en'), B = (s) => pick(s, 'bn');
  const both = (en, bn) => en + '|' + bn;
  const hhmm = (m) => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
  const pct = (v) => (v >= .995 || v === 0 ? Math.round(v * 100) : v >= .1 ? Math.round(v * 100) : (v * 100).toFixed(v < .01 ? 2 : 1)) + '%';
  const num = (n) => (!n ? '0' : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1000) + 'k' : n >= 100 ? String(Math.round(n)) : n >= 1 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2));
  const money = (n) => (n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? '$' + Math.round(n / 1000) + 'k' : '$' + Math.round(n).toLocaleString('en-US'));
  const NAME = { users: 'Users|ব্যবহারকারী', cdn: 'CDN|CDN', lb: 'Load balancer|লোড ব্যালান্সার', gateway: 'API gateway|এপিআই গেটওয়ে', app: 'App servers|অ্যাপ সার্ভার', ws: 'WebSocket servers|ওয়েবসকেট সার্ভার', cache: 'Cache|ক্যাশ', sql: 'SQL database|SQL ডেটাবেস', nosql: 'NoSQL store|NoSQL স্টোর', queue: 'Message queue|মেসেজ কিউ', worker: 'Workers|ওয়ার্কার', blob: 'Object storage|অবজেক্ট স্টোরেজ', search: 'Search index|সার্চ ইনডেক্স' };
  const CLS = { read: 'Reads|রিড', write: 'Writes|রাইট', media: 'Media|মিডিয়া', search: 'Search|সার্চ', rt: 'Realtime|রিয়েলটাইম' };
  const nm = (type) => NAME[type] || type + '|' + type;
  const list = (items, lang) => items.map((x) => pick(x, lang)).join(', ');

  /* What clients do when a request fails. Most apps ship the first one. */
  const POLICIES = [
    ['naive', 'Retry 3 times at once|সঙ্গে সঙ্গে ৩ বার রিট্রাই', 'Clients retry a failed request three times straight away, and app servers retry the database once. This is what most apps do.|ক্লায়েন্ট ব্যর্থ অনুরোধ সঙ্গে সঙ্গে তিনবার আবার পাঠায়, আর অ্যাপ সার্ভার ডেটাবেসে একবার আবার চেষ্টা করে। বেশিরভাগ অ্যাপ এটাই করে।'],
    ['backoff', 'Backoff, jitter and a retry budget|ব্যাকঅফ, জিটার ও রিট্রাই বাজেট', 'Clients wait longer after each failure, at random, and retries may add at most 10% to the traffic.|প্রতিটি ব্যর্থতার পর ক্লায়েন্ট এলোমেলোভাবে আরও বেশি অপেক্ষা করে, আর রিট্রাই ট্রাফিকে সর্বোচ্চ ১০% যোগ করতে পারে।'],
    ['none', 'Never retry|কখনও রিট্রাই নয়', 'A failed request is simply lost. Kind to servers, hard on users.|ব্যর্থ অনুরোধ হারিয়েই যায়। সার্ভারের প্রতি সদয়, ব্যবহারকারীর জন্য কঠিন।'],
  ];

  /* Each scenario is a stretch of an evening. Events: at and until are minutes from the start. */
  const SCENARIOS = [
    { id: 'evening', level: 'Warm-up|প্রস্তুতি', start: 18 * 60, len: 180, lab: 'availability',
      title: 'Friday evening peak|শুক্রবার সন্ধ্যার পিক',
      story: 'It is 18:00 on a Friday. Traffic climbs to the evening peak, and tonight it runs 15% above the forecast. Nothing is broken. Can the design ride the curve without anyone being paged?|শুক্রবার সন্ধ্যা ৬টা। ট্রাফিক সন্ধ্যার পিকের দিকে উঠছে, আর আজ তা পূর্বাভাসের চেয়ে ১৫% বেশি। কিছুই ভাঙেনি। কাউকে পেজ না করে ডিজাইনটি কি এই ঢেউ সামলাতে পারবে?',
      watch: 'Utilisation as traffic climbs, and whether auto-scaling keeps ahead of it.|ট্রাফিক বাড়ার সঙ্গে ব্যবহারের হার, আর অটো-স্কেলিং তার আগে থাকতে পারে কি না।',
      lesson: 'Real peaks overshoot forecasts. Headroom and auto-scaling absorb the difference, and a tier with neither is where the pager goes off.|আসল পিক পূর্বাভাস ছাড়িয়ে যায়। বাড়তি জায়গা আর অটো-স্কেলিং সেই পার্থক্য সামলায়; যে টিয়ারে দুটোর কোনোটিই নেই, পেজার সেখানেই বাজে।',
      events: [{ kind: 'overshoot', x: 1.15 }] },
    { id: 'push', level: 'Core|মূল', start: 19 * 60 + 30, len: 75, lab: 'workbench',
      title: 'Push notification surge|পুশ নোটিফিকেশনের ঢেউ',
      story: 'At 19:45 marketing sends a push notification to every user. Within three minutes traffic is three times the peak, then it fades over half an hour. New servers take 3 minutes to boot.|সন্ধ্যা ৭:৪৫-এ মার্কেটিং সব ব্যবহারকারীকে পুশ নোটিফিকেশন পাঠায়। তিন মিনিটের মধ্যে ট্রাফিক পিকের তিন গুণ হয়, তারপর আধ ঘণ্টায় কমে আসে। নতুন সার্ভার চালু হতে ৩ মিনিট লাগে।',
      watch: 'The minutes before new servers arrive, and whether a queue absorbs the writes.|নতুন সার্ভার আসার আগের মিনিটগুলো, আর কোনো কিউ রাইট ধরে রাখতে পারে কি না।',
      lesson: 'Auto-scaling reacts in minutes, but a surge arrives in seconds. Headroom, a queue for writes and load shedding cover the gap. Next time, ask marketing to send in batches.|অটো-স্কেলিং মিনিটে সাড়া দেয়, কিন্তু ঢেউ আসে সেকেন্ডে। বাড়তি জায়গা, রাইটের জন্য কিউ আর লোড শেডিং এই ফাঁক ঢাকে। পরের বার মার্কেটিংকে ধাপে ধাপে পাঠাতে বলুন।',
      events: [{ kind: 'surge', at: 15, peak: 3, rise: 3, decay: 12, on: 'The push notification goes out. Traffic is climbing fast.|পুশ নোটিফিকেশন গেছে। ট্রাফিক দ্রুত বাড়ছে।' }] },
    { id: 'zone', level: 'Core|মূল', start: 19 * 60 + 45, len: 75, lab: 'availability',
      title: 'Availability zone outage|অ্যাভেইলেবিলিটি জোন বিভ্রাট',
      story: 'At 20:00 one availability zone in your region loses power. Everything running only there stops. The cloud provider restores it after 40 minutes.|রাত ৮টায় আপনার রিজিয়নের একটি অ্যাভেইলেবিলিটি জোনে বিদ্যুৎ চলে যায়। শুধু সেখানে চলা সবকিছু থেমে যায়। ক্লাউড প্রদানকারী ৪০ মিনিট পরে তা ফিরিয়ে আনে।',
      watch: 'Which tiers lose all their servers, and whether the servers left can carry the full load.|কোন টিয়ার সব সার্ভার হারায়, আর বাকি সার্ভার পুরো চাপ বইতে পারে কি না।',
      lesson: 'Spreading across zones only helps if the servers left can take the whole load. Keep each zone under half full, or let auto-scaling refill it.|জোনে ছড়িয়ে রাখা তখনই কাজে আসে, যখন বাকি সার্ভার পুরো চাপ নিতে পারে। প্রতিটি জোন অর্ধেকের কম ভরা রাখুন, বা অটো-স্কেলিংকে ভরাট করতে দিন।',
      events: [{ kind: 'zone', at: 15, until: 55, on: 'Zone B loses power. Its servers are gone.|জোন B-তে বিদ্যুৎ নেই। এর সার্ভারগুলো বন্ধ।', off: 'Zone B is back.|জোন B ফিরে এসেছে।' }] },
    { id: 'primary', level: 'Core|মূল', start: 19 * 60 + 45, len: 70, lab: 'replication',
      title: 'Database primary crashes|ডেটাবেস প্রাইমারি ক্র্যাশ',
      story: 'At 20:00 the machine running your primary database dies. A replica can be promoted, if there is one. If not, the only way back is last night\'s backup.|রাত ৮টায় প্রাইমারি ডেটাবেস চালানো মেশিনটি বন্ধ হয়ে যায়। রেপ্লিকা থাকলে সেটিকে প্রাইমারি করা যায়। না থাকলে ফেরার একমাত্র উপায় গত রাতের ব্যাকআপ।',
      watch: 'How long writes fail, and whether a queue hides it from users.|কতক্ষণ রাইট ব্যর্থ হয়, আর কোনো কিউ তা ব্যবহারকারীদের থেকে লুকাতে পারে কি না।',
      lesson: 'A replica in another zone turns a crash into a minute of failed writes. Without one, the outage lasts as long as a restore, and recent writes are lost.|অন্য জোনে একটি রেপ্লিকা থাকলে ক্র্যাশ মানে এক মিনিটের ব্যর্থ রাইট। না থাকলে বিভ্রাট চলে রিস্টোরের পুরো সময়, আর সাম্প্রতিক রাইট হারিয়ে যায়।',
      events: [{ kind: 'primary', at: 15, on: 'The primary database stops answering.|প্রাইমারি ডেটাবেস সাড়া দিচ্ছে না।' }] },
    { id: 'cache', level: 'Core|মূল', start: 19 * 60 + 45, len: 60, lab: 'stampede',
      title: 'Cache cluster restart|ক্যাশ ক্লাস্টার রিস্টার্ট',
      story: 'At 20:00 an engineer restarts the cache cluster during an upgrade. It comes back empty, at peak traffic, and every read goes to the database until it fills again.|রাত ৮টায় আপগ্রেডের সময় একজন ইঞ্জিনিয়ার ক্যাশ ক্লাস্টার রিস্টার্ট করেন। এটি খালি অবস্থায় ফেরে, পিক ট্রাফিকের মধ্যে, আর আবার ভরা পর্যন্ত প্রতিটি রিড ডেটাবেসে যায়।',
      watch: 'The cache hit rate, and the database while the cache warms.|ক্যাশ হিট রেট, আর ক্যাশ গরম হওয়ার সময় ডেটাবেস।',
      lesson: 'A cache that hides 90% of reads also hides how small the database really is. Coalesce misses, warm caches before they take traffic, and never restart them at peak.|যে ক্যাশ ৯০% রিড আড়াল করে, সে এটাও আড়াল করে যে ডেটাবেস আসলে কত ছোট। মিস একত্র করুন, ট্রাফিক নেওয়ার আগে ক্যাশ গরম করুন, আর পিকের সময় কখনও রিস্টার্ট করবেন না।',
      events: [{ kind: 'cold', at: 15, on: 'The cache cluster restarts empty.|ক্যাশ ক্লাস্টার খালি অবস্থায় রিস্টার্ট হয়েছে।' }] },
    { id: 'deploy', level: 'Core|মূল', start: 19 * 60 + 40, len: 70, lab: 'tradeoffs',
      title: 'Bad deploy|খারাপ ডেপ্লয়',
      story: 'At 19:52 a new release starts rolling out to the app servers. One code path is three times slower than before. The rollout reaches every server within 6 minutes.|সন্ধ্যা ৭:৫২-এ অ্যাপ সার্ভারে নতুন রিলিজ ছড়াতে শুরু করে। একটি কোড পথ আগের চেয়ে তিন গুণ ধীর। ৬ মিনিটের মধ্যে রিলিজ সব সার্ভারে পৌঁছে যায়।',
      watch: 'App server load and latency as the release spreads, and how fast you roll back.|রিলিজ ছড়ানোর সঙ্গে অ্যাপ সার্ভারের চাপ ও ল্যাটেন্সি, আর কত দ্রুত আপনি রোলব্যাক করেন।',
      lesson: 'Most incidents start with a change. Roll back first and debug later. Auto-scaling can hide a slow release, but you pay for it.|বেশিরভাগ ঘটনা শুরু হয় কোনো পরিবর্তন থেকে। আগে রোলব্যাক, পরে ডিবাগ। অটো-স্কেলিং ধীর রিলিজ লুকাতে পারে, কিন্তু তার দাম দিতে হয়।',
      events: [{ kind: 'deploy', at: 12, over: 6, cap: .4, lat: 3, on: 'Release 4.12 starts rolling out to the app servers.|অ্যাপ সার্ভারে রিলিজ ৪.১২ ছড়াতে শুরু করেছে।' }] },
    { id: 'slowdb', level: 'Core|মূল', start: 19 * 60 + 45, len: 70, lab: 'index',
      title: 'Slow query after a migration|মাইগ্রেশনের পর ধীর কোয়েরি',
      story: 'At 20:00 a migration drops an index by mistake. A common query now scans the whole table, so the database does a third of its usual work and each query takes six times longer. Without help, someone finds and fixes it at 20:45.|রাত ৮টায় একটি মাইগ্রেশন ভুল করে একটি ইনডেক্স মুছে ফেলে। একটি সাধারণ কোয়েরি এখন পুরো টেবিল খোঁজে, তাই ডেটাবেস স্বাভাবিকের এক-তৃতীয়াংশ কাজ করে আর প্রতিটি কোয়েরিতে ছয় গুণ সময় লাগে। সাহায্য ছাড়া কেউ এটি রাত ৮:৪৫-এ খুঁজে ঠিক করে।',
      watch: 'Database latency, and how the slowness travels back to users.|ডেটাবেসের ল্যাটেন্সি, আর সেই ধীরগতি কীভাবে ব্যবহারকারীর কাছে ফেরে।',
      lesson: 'A slow dependency is worse than a dead one: requests pile up waiting for it. A cache in front, timeouts and load shedding contain it.|ধীর নির্ভরতা মৃত নির্ভরতার চেয়েও খারাপ: অনুরোধ তার অপেক্ষায় জমতে থাকে। সামনে ক্যাশ, টাইমআউট আর লোড শেডিং একে আটকে রাখে।',
      events: [{ kind: 'slow', at: 15, until: 60, cap: .35, lat: 6, on: 'A migration has dropped an index. Queries are slowing down.|একটি মাইগ্রেশন একটি ইনডেক্স মুছে ফেলেছে। কোয়েরি ধীর হচ্ছে।', off: 'A database engineer finds the missing index and rebuilds it.|একজন ডেটাবেস ইঞ্জিনিয়ার হারানো ইনডেক্স খুঁজে আবার বানিয়েছেন।' }] },
    { id: 'hotkey', level: 'Core|মূল', start: 19 * 60 + 45, len: 70, lab: 'sharding',
      title: 'Celebrity post|সেলিব্রিটির পোস্ট',
      story: 'At 20:00 a celebrity shares one item. For 40 minutes, a third of all reads ask for that one key, and reads rise by half. One key lives on one cache node and one shard, however many you have.|রাত ৮টায় একজন সেলিব্রিটি একটি জিনিস শেয়ার করেন। ৪০ মিনিট ধরে সব রিডের এক-তৃতীয়াংশ ওই একটি কী চায়, আর রিড দেড় গুণ হয়। একটি কী থাকে একটি ক্যাশ নোড ও একটি শার্ডে, আপনার যতগুলোই থাকুক।',
      watch: 'The cache node that holds the key. Adding more nodes does not help it.|যে ক্যাশ নোডে কী-টি আছে। আরও নোড যোগ করলে তার লাভ হয় না।',
      lesson: 'Hot keys defeat sharding. Cache them inside each app server, or copy them to several nodes.|হট কী শার্ডিংকে হারিয়ে দেয়। প্রতিটি অ্যাপ সার্ভারের ভেতরে এগুলো ক্যাশ করুন, অথবা কয়েকটি নোডে কপি রাখুন।',
      events: [{ kind: 'hot', at: 15, until: 55, share: .35, readX: 1.5, on: 'A celebrity post goes viral. One key is taking a third of all reads.|একটি সেলিব্রিটি পোস্ট ভাইরাল। একটি কী সব রিডের এক-তৃতীয়াংশ নিচ্ছে।', off: 'Interest in the post fades.|পোস্টটির প্রতি আগ্রহ কমে এসেছে।' }] },
    { id: 'retry', level: 'Advanced|উন্নত', start: 19 * 60 + 45, len: 75, lab: 'availability', retry: 'naive',
      title: 'Retry storm|রিট্রাই ঝড়',
      story: 'At 20:00 a network fault cuts the app servers off from the cache and the database for two minutes. Clients retry everything that fails. When the network heals at 20:02, does the system recover on its own? Try each retry policy.|রাত ৮টায় একটি নেটওয়ার্ক ত্রুটি দুই মিনিটের জন্য অ্যাপ সার্ভারকে ক্যাশ ও ডেটাবেস থেকে বিচ্ছিন্ন করে। ক্লায়েন্ট ব্যর্থ সবকিছু আবার পাঠায়। রাত ৮:০২-এ নেটওয়ার্ক ঠিক হলে কি সিস্টেম নিজে থেকেই সেরে ওঠে? প্রতিটি রিট্রাই নীতি চেষ্টা করুন।',
      watch: 'Requests per second against real user traffic, and the errors after 20:02.|আসল ব্যবহারকারীর ট্রাফিকের তুলনায় প্রতি সেকেন্ডে অনুরোধ, আর রাত ৮:০২-এর পরের ত্রুটি।',
      lesson: 'Retries can keep a system down after the cause has gone. This is a metastable failure. Clients need backoff, jitter and a retry budget, and servers should shed load at the door.|কারণ চলে যাওয়ার পরেও রিট্রাই সিস্টেমকে বসিয়ে রাখতে পারে। একে বলে মেটাস্টেবল ব্যর্থতা। ক্লায়েন্টে ব্যাকঅফ, জিটার ও রিট্রাই বাজেট দরকার, আর সার্ভারের উচিত দরজাতেই লোড শেড করা।',
      events: [{ kind: 'blip', at: 15, until: 17, on: 'App servers cannot reach the cache or the database.|অ্যাপ সার্ভার ক্যাশ বা ডেটাবেসে পৌঁছাতে পারছে না।', off: 'The network has healed.|নেটওয়ার্ক ঠিক হয়েছে।' }] },
    { id: 'region', level: 'Advanced|উন্নত', start: 19 * 60 + 45, len: 80, lab: 'availability',
      title: 'Region outage|রিজিয়ন বিভ্রাট',
      story: 'At 20:00 your cloud region fails completely for 45 minutes. If you run other regions, DNS health checks move users there after about 3 minutes.|রাত ৮টায় আপনার ক্লাউড রিজিয়ন ৪৫ মিনিটের জন্য পুরোপুরি বন্ধ হয়ে যায়। অন্য রিজিয়ন থাকলে, DNS হেলথ চেক প্রায় ৩ মিনিট পরে ব্যবহারকারীদের সেখানে সরিয়ে নেয়।',
      watch: 'Whether the regions left can carry everyone. Regions are set on the Users box.|বাকি রিজিয়নগুলো সবাইকে বইতে পারে কি না। রিজিয়ন ঠিক হয় Users বাক্সে।',
      lesson: 'A region is the largest thing that fails all at once. Surviving it takes another region with room for everyone, and that costs as much again.|একসঙ্গে ব্যর্থ হওয়া সবচেয়ে বড় জিনিস একটি রিজিয়ন। এতে টিকতে লাগে আরেকটি রিজিয়ন, যাতে সবার জায়গা আছে, আর তাতে খরচও ততটাই বাড়ে।',
      events: [{ kind: 'region', at: 15, until: 60, on: 'The whole region is down.|পুরো রিজিয়ন বন্ধ।', off: 'The region is back.|রিজিয়ন ফিরে এসেছে।' }] },
    { id: 'bots', level: 'Core|মূল', start: 19 * 60 + 45, len: 70, lab: 'ddos',
      title: 'Bot flood|বট বন্যা',
      story: 'At 20:00 a farm of scrapers starts hammering your read API at five times the normal read traffic, for 30 minutes.|রাত ৮টায় একদল স্ক্র্যাপার আপনার রিড API-তে স্বাভাবিক রিডের পাঁচ গুণ চাপ দিতে শুরু করে, ৩০ মিনিট ধরে।',
      watch: 'Whether anything at the door can tell bots from people.|দরজায় কিছু কি বট আর মানুষকে আলাদা করতে পারে।',
      lesson: 'Capacity is not a defence against abuse. Rate limits at a gateway stop bad traffic before it costs anything.|ক্ষমতা অপব্যবহারের বিরুদ্ধে প্রতিরক্ষা নয়। গেটওয়েতে রেট লিমিট খারাপ ট্রাফিক কোনো খরচ হওয়ার আগেই থামায়।',
      events: [{ kind: 'bots', at: 15, until: 45, x: 5, on: 'Scrapers are flooding the read API.|স্ক্র্যাপার রিড API ভাসিয়ে দিচ্ছে।', off: 'The scrapers give up.|স্ক্র্যাপাররা হাল ছেড়েছে।' }] },
    { id: 'gameday', level: 'Advanced|উন্নত', start: 19 * 60 + 30, len: 105, lab: 'availability',
      title: 'Game day: sale night|গেম ডে: সেলের রাত',
      story: 'A big sale opens at 19:50. Traffic climbs to 2.2 times the normal peak by 20:10 and stays there. At 20:20 a zone fails, and at 20:55 the cache restarts. You know the sale is coming, so prepare the design before you press Play.|একটি বড় সেল শুরু হয় সন্ধ্যা ৭:৫০-এ। রাত ৮:১০-এর মধ্যে ট্রাফিক স্বাভাবিক পিকের ২.২ গুণে ওঠে, আর সেখানেই থাকে। রাত ৮:২০-এ একটি জোন ব্যর্থ হয়, আর রাত ৮:৫৫-এ ক্যাশ রিস্টার্ট হয়। সেল যে আসছে আপনি জানেন, তাই প্লে চাপার আগে ডিজাইন প্রস্তুত করুন।',
      watch: 'Every tier, the whole time.|প্রতিটি টিয়ার, পুরো সময়।',
      lesson: 'Known peaks are planned for, not just survived. Teams scale up before the event, freeze deploys and rehearse the failures they fear.|জানা পিকের জন্য আগে থেকে পরিকল্পনা করা হয়, শুধু টিকে থাকা নয়। দলগুলো ঘটনার আগে স্কেল করে, ডেপ্লয় বন্ধ রাখে আর যে ব্যর্থতার ভয় পায় তার মহড়া দেয়।',
      events: [{ kind: 'ramp', at: 20, to: 2.2, over: 20, on: 'The sale is open. Traffic is climbing.|সেল শুরু। ট্রাফিক বাড়ছে।' }, { kind: 'zone', at: 50, until: 70, on: 'Zone B loses power.|জোন B-তে বিদ্যুৎ নেই।', off: 'Zone B is back.|জোন B ফিরে এসেছে।' }, { kind: 'cold', at: 85, on: 'The cache cluster restarts empty.|ক্যাশ ক্লাস্টার খালি অবস্থায় রিস্টার্ট হয়েছে।' }] },
  ];

  /* What a runbook can add to each tier: the share added, and the minutes until it serves traffic.
     SQL gets one more replica, which must copy the data first. New shards mean moving data, which takes days. */
  const SCALE = { app: [.5, BOOT], worker: [.5, BOOT], ws: [.5, BOOT], lb: [.5, 2], gateway: [.5, BOOT], queue: [.5, BOOT], search: [.5, 10], cache: [.5, 5], nosql: [.5, 15], sql: [1, 20] };
  const FIELD = { sql: 'replicas' };

  /* The share of the day's peak traffic at a minute of the day: quiet at 08:30, busiest at 20:30. */
  function daily(min) { const h = (min % 1440) / 60, c = (1 + Math.cos((2 * Math.PI * (h - 20.5)) / 24)) / 2; return .22 + .78 * Math.pow(c, 1.6); }
  function seeded(seed) { let x = seed % 2147483647; if (x <= 0) x += 2147483646; return () => (x = (x * 16807) % 2147483647) / 2147483647; }
  const hashStr = (t) => { let x = 7; for (let i = 0; i < t.length; i++) x = (x * 31 + t.charCodeAt(i)) % 2147483647; return x; };

  function create(design, brief, stage, id, opts) {
    const sc = SCENARIOS.find((x) => x.id === id) || SCENARIOS[0], o = opts || {};
    const base = D.normalize(design), byId = {}, out = {};
    base.nodes.forEach((n) => { byId[n.id] = n; out[n.id] = []; });
    base.edges.forEach(([a, b]) => out[a].push(b));
    const users = base.nodes.find((n) => n.type === 'users'), regions = users ? users.regions || 1 : 1;
    const allowed = 1 - brief.slo.avail, budgetMin = allowed * MONTH_MIN;
    const of = (t) => base.nodes.filter((n) => n.type === t);
    const sqlNode = of('sql')[0], stores = base.nodes.filter((n) => n.type === 'sql' || n.type === 'nosql'), apps = of('app'), caches = of('cache');
    const gateway = of('gateway').length > 0, lb = of('lb').length > 0;
    const fleet = {}, floor = {}, start = {}, ceil = {}, low = {};
    base.nodes.forEach((n) => {
      if (!SCALE[n.type]) return;
      const k = FIELD[n.type] || 'count';
      fleet[n.id] = n[k] === undefined ? (k === 'count' ? 1 : 0) : n[k]; floor[n.id] = start[n.id] = fleet[n.id];
      if (n.auto && (n.type === 'app' || n.type === 'worker')) { ceil[n.id] = Math.max(1, fleet[n.id]) * D.AUTO_MAX; low[n.id] = 0; }
    });
    const rnd = seeded(hashStr(sc.id + ':' + brief.id + ':' + stage));
    let wobble = 0;
    const s = { sc, brief, stage, len: sc.len, t: 0, done: false, retry: o.retry || sc.retry || 'naive', regions, base, gateway, series: [], log: [], pending: [], timers: [], backlog: {}, lagOf: {}, alerts: {}, pages: [], used: [], ops: {}, maxed: {}, worst: null, prevFail: 0, budget: 0, budgetMin, allowed, r: null, row: null };
    const note = (t, kind, text) => s.log.push({ t, m: sc.start + t, kind, text });
    const later = (at, kind, text) => s.timers.push({ at, kind, text });
    const live = (e, t) => t >= e.at && (e.until === undefined || t < e.until);
    const on = (key, delay, t) => s.ops[key] !== undefined && t >= s.ops[key] + delay;
    const event = (kind) => sc.events.find((e) => e.kind === kind);
    const shedSpec = () => (gateway ? { at: .92, damp: .3, delay: 1 } : { at: .8, damp: .6, delay: 2 });

    function traffic(t) {
      wobble = .7 * wobble + .3 * (rnd() * 2 - 1);
      let x = daily(sc.start + t) * (1 + .03 * wobble);
      sc.events.forEach((e) => {
        if (e.kind === 'overshoot') x *= e.x;
        if (e.kind === 'surge' && t >= e.at) { const k = t - e.at; x *= 1 + (e.peak - 1) * (k < e.rise ? (k + 1) / e.rise : Math.exp(-(k - e.rise + 1) / e.decay)); }
        if (e.kind === 'ramp' && t >= e.at) x *= 1 + (e.to - 1) * Math.min(1, (t - e.at + 1) / e.over);
      });
      return x;
    }
    /* The share of app servers running the bad release: it spreads over a few minutes, and a rollback takes 4. */
    function deployShare(e, t) {
      const up = (x) => clamp((x - e.at + 1) / e.over, 0, 1);
      if (s.ops.rollback === undefined || t < s.ops.rollback) return up(t);
      return up(s.ops.rollback) * clamp(1 - (t - s.ops.rollback + 1) / 4, 0, 1);
    }
    function failoverWindow() { return sqlNode && sqlNode.multiAZ ? 1 : 2; }
    function faults(t) {
      const f = { degrade: {} };
      sc.events.forEach((e) => {
        if (e.kind === 'zone' && live(e, t)) f.zone = true;
        if (e.kind === 'region' && live(e, t)) f.region = true;
        if (e.kind === 'cold' && t >= e.at) { const w = 1 - Math.exp(-(t - e.at) / WARM); if (w < .995) f.warm = Math.min(f.warm === undefined ? 1 : f.warm, w); }
        if (e.kind === 'bots' && live(e, t)) f.ddos = on('botlimit', 3, t) ? 2 : e.x;
        if (e.kind === 'hot' && live(e, t)) { f.hot = e.share * (on('hotcache', 2, t) ? .1 : 1); f.readX = e.readX; }
        if (e.kind === 'deploy') { const k = deployShare(e, t); if (k > 0) apps.forEach((n) => { f.degrade[n.id] = { cap: 1 - (1 - e.cap) * k, lat: 1 + (e.lat - 1) * k }; }); }
        if (e.kind === 'slow' && live(e, t) && !on('fixdb', 5, t)) stores.forEach((n) => { f.degrade[n.id] = { cap: e.cap, lat: e.lat }; });
        if (e.kind === 'blip' && live(e, t)) f.down = [...stores, ...caches].map((n) => n.id);
        if (e.kind === 'primary' && t >= e.at) {
          if (sqlNode && sqlNode.replicas > 0) { if (t < e.at + failoverWindow()) f.failover = true; else f.primary = true; }
          else if (sqlNode) { if (!on('restore', RESTORE, t)) f.kill = sqlNode.id; }
          else if (stores.length && t < e.at + 20) f.killOne = 'nosql';
        }
      });
      return f;
    }
    /* Extra attempts per request when a share of attempts fails. */
    function retryAmp(fail, damp) {
      const p = clamp(fail, 0, .99);
      const a = s.retry === 'naive' ? (1 + p + p * p + p * p * p) * (1 + p) - 1 : s.retry === 'backoff' ? Math.min(.1, p) : 0;
      return a * damp;
    }
    /* The design as it runs this minute: the fleet's current size, no engine auto-scaling (this file does that), and runbook switches. */
    function work(t) {
      const w = JSON.parse(JSON.stringify(base));
      w.nodes.forEach((n) => {
        if (fleet[n.id] !== undefined) {
          const k = FIELD[n.type] || 'count', was = n[k] || 1;
          n[k] = fleet[n.id];
          if (n.type === 'cache') n.memGB = Math.max(1, Math.round((n.memGB * fleet[n.id]) / was));
        }
        n.auto = false;
        if (n.type === 'cache' && on('coalesce', 1, t)) n.coalesce = true;
      });
      return w;
    }
    /* The busiest tier that users wait on. Workers sit behind a queue, so they do not count. */
    function busiest(r) {
      let id = null, u = 0;
      Object.entries(r.nodes).forEach(([k, v]) => { const n = byId[k]; if (!n || n.type === 'users' || n.type === 'worker' || !Number.isFinite(v.util)) return; if (v.util > u) { u = v.util; id = k; } });
      return [id, u];
    }
    function startEvents(t) {
      sc.events.forEach((e) => {
        if (e.at === t && e.on) note(t, 'event', e.on);
        if (e.until === t && e.off) note(t, 'event', e.off);
        if (e.kind === 'primary' && e.at === t) {
          if (sqlNode && sqlNode.replicas > 0) later(t + failoverWindow(), 'ok', both(`A replica was promoted to primary after ${failoverWindow()} min. Writes are flowing again.`, `${failoverWindow()} মিনিট পরে একটি রেপ্লিকা প্রাইমারি হয়েছে। রাইট আবার চলছে।`));
          else if (sqlNode) note(t, 'bad', 'There is no replica to promote. The database is down until it is restored from a backup.|প্রাইমারি করার মতো কোনো রেপ্লিকা নেই। ব্যাকআপ থেকে ফেরানো পর্যন্ত ডেটাবেস বন্ধ।');
          else if (stores.length) note(t, 'ok', 'Your design has no SQL primary. One NoSQL node dies, and the other copies keep serving.|আপনার ডিজাইনে SQL প্রাইমারি নেই। একটি NoSQL নোড বন্ধ হয়, বাকি কপিগুলো সেবা চালিয়ে যায়।');
        }
        if (e.kind === 'cold' && e.at === t && !caches.length) note(t, 'ok', 'Your design has no cache, so nothing changes.|আপনার ডিজাইনে কোনো ক্যাশ নেই, তাই কিছুই বদলায় না।');
        if (e.kind === 'region' && e.at === t) note(t, regions > 1 ? 'ref' : 'bad', regions > 1 ? both(`DNS will move users to the other ${regions - 1 > 1 ? regions - 1 + ' regions' : 'region'} in about ${DNS} minutes.`, `প্রায় ${DNS} মিনিটের মধ্যে DNS ব্যবহারকারীদের অন্য রিজিয়নে সরিয়ে নেবে।`) : 'There is no other region to move users to.|ব্যবহারকারীদের সরানোর মতো অন্য কোনো রিজিয়ন নেই।');
      });
    }

    const RULES = [
      ['burn', 'page', 1, (row) => { const w = s.series.slice(-5), avg = w.reduce((a, x) => a + x.err, 0) / w.length; row.burn = avg / (allowed || 1e-9); return w.length >= 2 && row.burn > 14.4 && row.err > allowed; },
        (row) => both(`Error budget burning ${Math.round(row.burn)}× too fast. Errors at ${pct(row.err)}.`, `এরর বাজেট ${Math.round(row.burn)} গুণ দ্রুত পুড়ছে। ত্রুটি ${pct(row.err)}।`)],
      ['latency', 'page', 3, (row) => row.slow.length > 0,
        (row) => both(`${list(row.slow.map((k) => CLS[k]), 'en')}: p95 above target for 3 minutes.`, `${list(row.slow.map((k) => CLS[k]), 'bn')}: ৩ মিনিট ধরে p95 লক্ষ্যের ওপরে।`)],
      ['saturation', 'ticket', 5, (row) => row.top[1] >= .85,
        (row) => both(`${E(nm(byId[row.top[0]].type))} above 85% for 5 minutes.`, `${B(nm(byId[row.top[0]].type))} ৫ মিনিট ধরে ৮৫%-এর ওপরে।`)],
      ['lag', 'ticket', 1, (row) => row.lag >= 5,
        (row) => both(`The queue is ${Math.round(row.lag)} minutes behind.`, `কিউ ${Math.round(row.lag)} মিনিট পিছিয়ে।`)],
    ];
    const RESOLVED = { burn: 'Errors are back within budget.|ত্রুটি আবার বাজেটের মধ্যে।', latency: 'Latency is back under target.|ল্যাটেন্সি আবার লক্ষ্যের নিচে।', saturation: 'Saturation is back under 85%.|চাপ আবার ৮৫%-এর নিচে।', lag: 'The queue has caught up.|কিউ তাল ধরেছে।' };
    function alerts(row) {
      RULES.forEach(([key, sev, need, test, text]) => {
        const a = s.alerts[key] || (s.alerts[key] = { bad: 0, good: 0, on: false });
        if (test(row)) {
          a.bad++; a.good = 0;
          if (!a.on && a.bad >= need) { a.on = true; s.pages.push({ t: row.t, key, sev }); note(row.t, sev, text(row)); }
        } else {
          a.good++; a.bad = 0;
          if (a.on && a.good >= 3) { a.on = false; note(row.t, 'resolved', RESOLVED[key]); }
        }
      });
    }

    function step() {
      if (s.done) return null;
      const t = s.t;
      s.pending = s.pending.filter((p) => {
        if (p.at > t) return true;
        fleet[p.id] += p.n;
        const ty = byId[p.id].type;
        note(t, 'ok', ty === 'sql' ? 'A new read replica has caught up and is serving reads.|নতুন রিড রেপ্লিকা তাল ধরেছে এবং রিড সেবা দিচ্ছে।' : both(`${p.n} more ${E(nm(ty))} ${p.n > 1 ? 'are' : 'is'} in service. ${fleet[p.id]} running.`, `আরও ${p.n}টি ${B(nm(ty))} সেবায়। এখন ${fleet[p.id]}টি চলছে।`));
        return false;
      });
      s.timers = s.timers.filter((x) => { if (x.at > t) return true; note(t, x.kind, x.text); return false; });
      startEvents(t);
      const organic = traffic(t), f = faults(t), { readX, ...fx } = f, sh = shedSpec(), shedding = on('shed', sh.delay, t);
      const amp = retryAmp(s.prevFail, shedding ? sh.damp : 1), scale = organic * (1 + amp), w = work(t);
      const run = (x) => D.evaluate(w, brief, stage, { ...fx, load: { scale: x, readX: readX || 1 } });
      let r = run(scale), admitted = 1;
      if (shedding) for (let i = 0; i < 3; i++) { const u = busiest(r)[1]; if (u <= sh.at * 1.01) break; admitted *= sh.at / u; r = run(scale * admitted); }
      const [topId, topU] = busiest(r);
      let ok = r.succ * admitted;
      /* An overloaded tier also wastes work on requests whose callers have already given up. */
      if (!shedding && topU > 1) ok /= 1 + COLLAPSE * (topU - 1);
      const reg = sc.events.find((e) => e.kind === 'region' && live(e, t));
      if (reg && regions > 1 && t < reg.at + DNS) ok *= 1 - 1 / regions;
      const err = clamp(1 - ok, 0, 1);

      /* Queues: what workers cannot finish this minute waits for the next. */
      let lag = 0, held = 0;
      base.nodes.filter((n) => n.type === 'queue').forEach((q) => {
        const inRate = r.nodes[q.id].load.by.write || 0, ws = out[q.id].filter((k) => byId[k].type === 'worker');
        const sinks = [...new Set(ws.flatMap((k) => out[k]))].filter((k) => byId[k].type === 'sql' || byId[k].type === 'nosql');
        const blocked = sinks.some((k) => r.nodes[k].down || (f.failover && byId[k].type === 'sql'));
        const uw = Math.max(0, ...ws.map((k) => r.nodes[k].util || 0));
        const cap = !ws.length || blocked ? 0 : uw > 0 ? inRate / uw : Infinity;
        const was = s.backlog[q.id] || 0, done = Math.min(cap * 60, was + inRate * 60), left = Math.max(0, was + inRate * 60 - done);
        s.backlog[q.id] = left; held += left;
        const l = left <= 0 ? 0 : inRate > 0 && cap > 0 ? left / (inRate * 60) : (s.lagOf[q.id] || 0) + 1;
        s.lagOf[q.id] = l; lag = Math.max(lag, l);
      });

      /* Autoscaler: reacts to this minute, and its servers arrive BOOT minutes later. */
      Object.keys(ceil).forEach((id) => {
        const u = (r.nodes[id] || {}).util || 0, have = fleet[id], coming = s.pending.filter((p) => p.id === id).reduce((a, p) => a + p.n, 0), ty = byId[id].type;
        if (u > UP) {
          const want = Math.min(ceil[id], Math.ceil((have * u) / TARGET)), add = want - have - coming;
          if (add > 0) { s.pending.push({ at: t + BOOT, id, n: add, auto: true }); note(t, 'auto', both(`Auto-scaling: ${E(nm(ty))} at ${pct(u)}. Starting ${add} more, ready at ${hhmm(sc.start + t + BOOT)}.`, `অটো-স্কেলিং: ${B(nm(ty))} ${pct(u)}-এ। আরও ${add}টি চালু হচ্ছে, তৈরি হবে ${hhmm(sc.start + t + BOOT)}-এ।`)); }
          else if (have + coming >= ceil[id] && !s.maxed[id]) { s.maxed[id] = true; note(t, 'ticket', both(`Auto-scaling for ${E(nm(ty))} has reached its limit of ${ceil[id]}.`, `${B(nm(ty))}-এর অটো-স্কেলিং ${ceil[id]}-এর সীমায় পৌঁছেছে।`)); }
          low[id] = 0;
        } else if (u < DOWN && !coming && have > floor[id]) {
          if (++low[id] >= QUIET) {
            const to = Math.max(floor[id], Math.ceil((have * u) / TARGET));
            if (to < have) { fleet[id] = to; note(t, 'auto', both(`Auto-scaling: traffic is down, so ${E(nm(ty))} shrink to ${to}.`, `অটো-স্কেলিং: ট্রাফিক কমেছে, তাই ${B(nm(ty))} কমে ${to}টি।`)); }
            low[id] = 0;
          }
        } else low[id] = 0;
      });

      const offered = Object.values(r.classes).reduce((a, c) => a + c.rate, 0) / admitted;
      const p95 = {}, slow = [];
      Object.entries(r.classes).forEach(([k, c]) => { if (!c.routed) return; p95[k] = c.p95; if (c.p95 > (brief.slo[k] || Infinity)) slow.push(k); });
      const util = {};
      Object.entries(r.nodes).forEach(([k, v]) => { if (byId[k] && byId[k].type !== 'users') util[k] = Number.isFinite(v.util) ? v.util : 0; });
      s.budget += Math.min(1, err + (slow.length ? SLOW_COST : 0));
      const row = { t, m: sc.start + t, organic: offered / (1 + amp), offered, served: offered * ok, err, amp, p95, slow, top: [topId, topU], util, fleet: { ...fleet }, lag, held, hit: caches.length ? Math.min(...caches.map((c) => r.nodes[c.id].hit)) : null, cost: r.cost, shed: shedding, admitted, budget: s.budget / budgetMin };
      s.series.push(row);
      if (!s.worst || err > s.worst.err + 1e-9 || (Math.abs(err - s.worst.err) <= 1e-9 && topU > s.worst.u)) s.worst = { err, u: topU, r, t };
      alerts(row);
      s.prevFail = err; s.r = r; s.row = row;
      s.t++;
      if (s.t >= s.len) { s.done = true; note(s.t, 'event', 'End of the shift. The postmortem is ready.|শিফট শেষ। পোস্টমর্টেম তৈরি।'); }
      return row;
    }
    function runAll() { while (!s.done) step(); return report(); }

    function scaleText(n) {
      const [share, wait] = SCALE[n.type], k = FIELD[n.type] || 'count', have = fleet[n.id] + s.pending.filter((p) => p.id === n.id).reduce((a, p) => a + p.n, 0);
      if (n.type === 'sql') return have >= 5 ? 'It already has 5 replicas, the most allowed.|এর ইতিমধ্যে ৫টি রেপ্লিকা, সর্বোচ্চ।' : both(`One more read replica, serving in ${wait} minutes once it has copied the data. Replicas help reads, not writes. New shards mean moving data, which takes days.`, `আরও একটি রিড রেপ্লিকা, ডেটা কপি করে ${wait} মিনিটে সেবা দেবে। রেপ্লিকা রিডে সাহায্য করে, রাইটে নয়। নতুন শার্ড মানে ডেটা সরানো, যাতে দিন লাগে।`);
      void k;
      const add = Math.max(1, Math.ceil(have * share));
      return both(`${have} → ${have + add}, serving in ${wait} minutes.`, `${have} → ${have + add}, ${wait} মিনিটে সেবা দেবে।`);
    }
    function actions() {
      const t = s.t, out2 = [], done = s.done;
      const add = (key, label, why, ok, no) => out2.push({ id: key, label, why, ok: ok && !done, no: done ? 'The shift is over.|শিফট শেষ।' : no });
      const sh = shedSpec();
      if (gateway || lb) add('shed', gateway ? 'Shed excess load at the API gateway|এপিআই গেটওয়েতে বাড়তি চাপ ফেলে দিন' : 'Cap connections at the load balancer|লোড ব্যালান্সারে সংযোগের সীমা দিন',
        gateway ? 'Requests the system cannot serve get a fast 429 with Retry-After, so everyone else stays quick and clients back off. On in 1 minute, until the end of the shift.|সিস্টেম যা সামলাতে পারে না সেগুলো দ্রুত 429 আর Retry-After পায়, তাই বাকিরা দ্রুত থাকে আর ক্লায়েন্ট পিছিয়ে যায়। ১ মিনিটে চালু, শিফট শেষ পর্যন্ত।'
          : both(`A crude limit: it turns away more than it needs to, and clients still retry. On in ${sh.delay} minutes. An API gateway does this properly.`, `একটি স্থূল সীমা: যতটা দরকার তার চেয়ে বেশি ফিরিয়ে দেয়, আর ক্লায়েন্ট তবুও রিট্রাই করে। ${sh.delay} মিনিটে চালু। এপিআই গেটওয়ে এটি ঠিকভাবে করে।`),
        s.ops.shed === undefined, 'Already on.|ইতিমধ্যে চালু।');
      else add('shed', 'Shed excess load|বাড়তি চাপ ফেলে দিন', 'Turns away what the system cannot serve.|সিস্টেম যা সামলাতে পারে না তা ফিরিয়ে দেয়।', false, 'Needs an API gateway or a load balancer in the design.|ডিজাইনে এপিআই গেটওয়ে বা লোড ব্যালান্সার লাগবে।');
      const dep = event('deploy');
      if (dep) add('rollback', 'Roll back the release|রিলিজ রোলব্যাক করুন', 'Takes 4 minutes to reach every server.|সব সার্ভারে পৌঁছাতে ৪ মিনিট লাগে।', t >= dep.at && s.ops.rollback === undefined, t < dep.at ? 'Nothing has been released yet.|এখনও কিছু রিলিজ হয়নি।' : 'Already rolled back.|ইতিমধ্যে রোলব্যাক হয়েছে।');
      const slowE = event('slow');
      if (slowE) add('fixdb', 'Kill the slow query and rebuild the index|ধীর কোয়েরি বন্ধ করে ইনডেক্স আবার বানান', 'Takes 5 minutes.|৫ মিনিট লাগে।', live(slowE, t) && s.ops.fixdb === undefined, s.ops.fixdb !== undefined ? 'Already under way.|ইতিমধ্যে চলছে।' : 'Nothing is slow right now.|এখন কিছুই ধীর নয়।');
      const pr = event('primary');
      if (pr && sqlNode && !sqlNode.replicas) add('restore', 'Restore the database from backup|ব্যাকআপ থেকে ডেটাবেস ফিরিয়ে আনুন', both(`Takes ${RESTORE} minutes. Every write since last night's backup is lost.`, `${RESTORE} মিনিট লাগে। গত রাতের ব্যাকআপের পরের সব রাইট হারিয়ে যায়।`), t >= pr.at && s.ops.restore === undefined, t < pr.at ? 'The database is healthy.|ডেটাবেস সুস্থ।' : 'Already under way.|ইতিমধ্যে চলছে।');
      if (caches.length) add('coalesce', 'Coalesce cache misses|ক্যাশ মিস একত্র করুন', 'One request rebuilds each missing key, and the rest wait for it. On in 1 minute.|প্রতিটি হারানো কী একটি অনুরোধ আবার বানায়, বাকিরা তার অপেক্ষা করে। ১ মিনিটে চালু।', !caches.every((c) => c.coalesce) && s.ops.coalesce === undefined, caches.every((c) => c.coalesce) ? 'Already on in your design.|আপনার ডিজাইনে ইতিমধ্যে চালু।' : 'Already on.|ইতিমধ্যে চালু।');
      const hot = event('hot');
      if (hot) add('hotcache', 'Cache the hot key inside each app server|প্রতিটি অ্যাপ সার্ভারের ভেতরে হট কী ক্যাশ করুন', 'Takes 2 minutes to roll out. Each server then answers it from its own memory.|ছড়াতে ২ মিনিট লাগে। তারপর প্রতিটি সার্ভার নিজের মেমরি থেকে উত্তর দেয়।', t >= hot.at && s.ops.hotcache === undefined, t < hot.at ? 'No key is hot yet.|এখনও কোনো কী হট নয়।' : 'Already done.|ইতিমধ্যে হয়েছে।');
      const bots = event('bots');
      if (bots) add('botlimit', 'Emergency per-IP limits at the load balancer|লোড ব্যালান্সারে জরুরি প্রতি-IP সীমা', 'Crude, and takes 3 minutes to tune. A gateway does this properly.|স্থূল, আর ঠিক করতে ৩ মিনিট লাগে। গেটওয়ে এটি ঠিকভাবে করে।', !gateway && lb && t >= bots.at && s.ops.botlimit === undefined, gateway ? 'Your API gateway already rate limits the bots.|আপনার এপিআই গেটওয়ে ইতিমধ্যে বটের রেট লিমিট করছে।' : !lb ? 'Needs a load balancer.|লোড ব্যালান্সার লাগবে।' : t < bots.at ? 'No bots yet.|এখনও বট নেই।' : 'Already on.|ইতিমধ্যে চালু।');
      return out2;
    }
    function targets() { return base.nodes.filter((n) => SCALE[n.type]).map((n) => ({ id: n.id, type: n.type, label: nm(n.type), what: scaleText(n), ok: !s.done && !(n.type === 'sql' && fleet[n.id] + s.pending.filter((p) => p.id === n.id).reduce((a, p) => a + p.n, 0) >= 5) })); }
    function act(key, arg) {
      if (s.done) return false;
      const t = s.t;
      if (key === 'scale') {
        const n = byId[arg], tg = targets().find((x) => x.id === arg);
        if (!n || !tg || !tg.ok) return false;
        const [share, wait] = SCALE[n.type], have = fleet[n.id] + s.pending.filter((p) => p.id === n.id).reduce((a, p) => a + p.n, 0), add = n.type === 'sql' ? 1 : Math.max(1, Math.ceil(have * share));
        s.pending.push({ at: t + wait, id: n.id, n: add });
        floor[n.id] += add; if (ceil[n.id]) ceil[n.id] = Math.max(ceil[n.id], floor[n.id]);
        s.used.push({ t, id: key, arg });
        note(t, 'you', both(`You: add ${add} ${n.type === 'sql' ? 'read replica' : E(nm(n.type))}, serving at ${hhmm(sc.start + t + wait)}.`, `আপনি: ${add}টি ${n.type === 'sql' ? 'রিড রেপ্লিকা' : B(nm(n.type))} যোগ, সেবা দেবে ${hhmm(sc.start + t + wait)}-এ।`));
        return true;
      }
      const a = actions().find((x) => x.id === key);
      if (!a || !a.ok) return false;
      s.ops[key] = t; s.used.push({ t, id: key });
      note(t, 'you', both('You: ' + E(a.label) + '.', 'আপনি: ' + B(a.label) + '।'));
      if (key === 'shed') later(t + shedSpec().delay, 'ok', 'Load shedding is on.|লোড শেডিং চালু।');
      if (key === 'rollback') later(t + 4, 'ok', 'The rollback has reached every server.|রোলব্যাক সব সার্ভারে পৌঁছেছে।');
      if (key === 'fixdb') later(t + 5, 'ok', 'The index is rebuilt. Queries are fast again.|ইনডেক্স আবার বানানো হয়েছে। কোয়েরি আবার দ্রুত।');
      if (key === 'restore') later(t + RESTORE, 'ok', 'The database is restored from backup and serving again.|ব্যাকআপ থেকে ডেটাবেস ফিরেছে এবং আবার সেবা দিচ্ছে।');
      if (key === 'hotcache') later(t + 2, 'ok', 'App servers now keep the hot key in memory.|অ্যাপ সার্ভার এখন হট কী মেমরিতে রাখে।');
      if (key === 'botlimit') later(t + 3, 'ok', 'Per-IP limits are on at the load balancer.|লোড ব্যালান্সারে প্রতি-IP সীমা চালু।');
      if (key === 'coalesce') later(t + 1, 'ok', 'The cache now coalesces misses.|ক্যাশ এখন মিস একত্র করে।');
      return true;
    }

    /* ---------- the postmortem ---------- */
    function report() {
      const S = s.series;
      if (!S.length) return null;
      const bad = (x) => x.err > allowed || x.slow.length > 0;
      const firstEvent = Math.min(...sc.events.filter((e) => e.at !== undefined).map((e) => e.at));
      const from = Number.isFinite(firstEvent) ? firstEvent : Math.max(0, S.findIndex(bad));
      const page = s.pages.find((p) => p.sev === 'page' && p.t >= from) || null;
      let last = -1; S.forEach((x, i) => { if (bad(x)) last = i; });
      const badMin = S.filter(bad).length, latMin = S.filter((x) => x.slow.length).length;
      const failed = S.reduce((a, x) => a + x.offered * x.err * 60, 0);
      const used = s.budget / budgetMin;
      const grade = used < .005 && !badMin ? 'S' : used < .02 ? 'A' : used < .05 ? 'B' : used < .2 ? 'C' : 'D';
      const spend = S.reduce((a, x) => a + x.cost / MONTH_MIN, 0), peakSpend = Math.max(...S.map((x) => x.cost)) / 720;
      const worstErr = Math.max(...S.map((x) => x.err)), peakLag = Math.max(...S.map((x) => x.lag)), peakAmp = Math.max(...S.map((x) => x.amp));
      const ins = [];
      const say = (en, bn) => ins.push(both(en, bn));
      const topRow = S.reduce((a, x) => (x.top[1] > a.top[1] ? x : a), S[0]);
      if (topRow.top[0]) say(`The tightest tier was ${E(nm(byId[topRow.top[0]].type))}, at ${pct(topRow.top[1])} at ${hhmm(topRow.m)}.`, `সবচেয়ে চাপে ছিল ${B(nm(byId[topRow.top[0]].type))}, ${hhmm(topRow.m)}-এ ${pct(topRow.top[1])}।`);
      Object.keys(ceil).forEach((id) => {
        const top = Math.max(...S.map((x) => x.fleet[id])), ty = byId[id].type;
        if (top > start[id]) say(`Auto-scaling grew ${E(nm(ty))} from ${start[id]} to ${top}. New servers took ${BOOT} minutes to boot, so the first minutes of each rise fell on the servers already running.`, `অটো-স্কেলিং ${B(nm(ty))} ${start[id]} থেকে ${top}-এ বাড়িয়েছে। নতুন সার্ভার চালু হতে ${BOOT} মিনিট লেগেছে, তাই প্রতিটি উত্থানের প্রথম মিনিটগুলো চলমান সার্ভারকেই সইতে হয়েছে।`);
        if (s.maxed[id]) say(`${E(nm(ty))} hit the auto-scaling limit. Raise the starting count, or scale another tier.`, `${B(nm(ty))} অটো-স্কেলিংয়ের সীমায় পৌঁছেছে। শুরুর সংখ্যা বাড়ান, বা অন্য টিয়ার স্কেল করুন।`);
      });
      const fixed = [...new Set(S.filter((x) => x.err > allowed && x.top[1] > 1).map((x) => x.top[0]))].filter((id) => ['app', 'worker'].includes(byId[id].type) && !byId[id].auto);
      fixed.forEach((id) => say(`${E(nm(byId[id].type))} ran out of room and had no auto-scaling to grow.`, `${B(nm(byId[id].type))}-এর জায়গা ফুরিয়েছে, আর বাড়ার মতো অটো-স্কেলিং ছিল না।`));
      if (peakAmp > .3) say(`Retries added ${pct(peakAmp)} more requests at the worst moment, so failures made the load heavier.`, `সবচেয়ে খারাপ সময়ে রিট্রাই ${pct(peakAmp)} বাড়তি অনুরোধ যোগ করেছে, তাই ব্যর্থতা চাপ আরও বাড়িয়েছে।`);
      const blip = event('blip');
      if (blip && last >= blip.until + 3) say(`The network healed at ${hhmm(sc.start + blip.until)}, but errors went on until ${hhmm(sc.start + last + 1)}. Retries kept the system down after the cause had gone: a metastable failure.`, `নেটওয়ার্ক ${hhmm(sc.start + blip.until)}-এ ঠিক হয়েছে, কিন্তু ত্রুটি চলেছে ${hhmm(sc.start + last + 1)} পর্যন্ত। কারণ চলে যাওয়ার পরেও রিট্রাই সিস্টেমকে বসিয়ে রেখেছে: মেটাস্টেবল ব্যর্থতা।`);
      if (blip && last < blip.until + 3) ins.push('The system recovered soon after the network did, so the retries did not trap it.|নেটওয়ার্ক ঠিক হওয়ার পরপরই সিস্টেম সেরে উঠেছে, তাই রিট্রাই তাকে আটকে রাখতে পারেনি।');
      if (peakLag > .5) { const back = S.findIndex((x, i) => i > S.findIndex((y) => y.lag === peakLag) && x.lag === 0); say(`The queue fell ${Math.round(peakLag)} minutes behind and ${back >= 0 ? 'caught up by ' + hhmm(S[back].m) : 'had not caught up by the end'}. Users' writes were still accepted.`, `কিউ ${Math.round(peakLag)} মিনিট পিছিয়ে পড়েছিল এবং ${back >= 0 ? hhmm(S[back].m) + '-এর মধ্যে তাল ধরেছে' : 'শেষ পর্যন্ত তাল ধরতে পারেনি'}। ব্যবহারকারীর রাইট তবুও গৃহীত হয়েছে।`); }
      if (event('cold') && caches.length) {
        const low2 = Math.min(...S.filter((x) => x.hit !== null).map((x) => x.hit)), db = stores[0], dbTop = db ? Math.max(...S.map((x) => x.util[db.id] || 0)) : 0;
        say(`The cache hit rate fell to ${pct(low2)}${db ? ` and the ${E(nm(db.type))} peaked at ${pct(dbTop)}` : ''}.${caches.every((c) => c.coalesce) || s.ops.coalesce !== undefined ? '' : ' Coalescing misses would have kept it far calmer.'}`, `ক্যাশ হিট রেট নেমেছিল ${pct(low2)}-এ${db ? `, আর ${B(nm(db.type))} উঠেছিল ${pct(dbTop)}-এ` : ''}।${caches.every((c) => c.coalesce) || s.ops.coalesce !== undefined ? '' : ' মিস একত্র করলে এটি অনেক শান্ত থাকত।'}`);
      }
      const hasQ = base.nodes.some((n) => n.type === 'queue');
      if (event('primary') && sqlNode) {
        if (sqlNode.replicas > 0) say(`A replica took over after ${failoverWindow()} minute${failoverWindow() > 1 ? 's' : ''}. Writes failed until then${hasQ ? ', but writes through the queue waited instead of failing' : ''}.${sqlNode.syncRep ? '' : ' Replication was asynchronous, so the last second of writes may be gone.'}`, `${failoverWindow()} মিনিট পরে একটি রেপ্লিকা দায়িত্ব নিয়েছে। ততক্ষণ রাইট ব্যর্থ হয়েছে${hasQ ? ', তবে কিউ দিয়ে যাওয়া রাইট ব্যর্থ না হয়ে অপেক্ষা করেছে' : ''}।${sqlNode.syncRep ? '' : ' রেপ্লিকেশন অ্যাসিনক্রোনাস ছিল, তাই শেষ এক সেকেন্ডের রাইট হারিয়ে থাকতে পারে।'}`);
        else say(`There was no replica, so the database stayed down ${s.ops.restore !== undefined ? 'until the restore finished at ' + hhmm(sc.start + s.ops.restore + RESTORE) : 'for the rest of the shift'}.${s.ops.restore !== undefined ? ' Every write since last night\'s backup was lost.' : ''}`, `কোনো রেপ্লিকা ছিল না, তাই ডেটাবেস ${s.ops.restore !== undefined ? hhmm(sc.start + s.ops.restore + RESTORE) + '-এ রিস্টোর শেষ হওয়া পর্যন্ত' : 'শিফটের বাকি সময়'} বন্ধ ছিল।${s.ops.restore !== undefined ? ' গত রাতের ব্যাকআপের পরের সব রাইট হারিয়ে গেছে।' : ''}`);
      }
      if (event('zone') && s.worst) {
        const zt = S.find((x) => x.t === event('zone').at + 1) || S[S.length - 1], zr = D.evaluate(work(zt.t), brief, stage, { zone: true });
        const dark = base.nodes.filter((n) => zr.nodes[n.id] && zr.nodes[n.id].down).map((n) => nm(n.type));
        if (dark.length) say(`${list(dark, 'en')} ran in a single zone and went dark with it.`, `${list(dark, 'bn')} একটি জোনেই চলছিল, তাই জোনের সঙ্গেই বন্ধ হয়েছে।`);
      }
      if (event('region') && regions < 2) ins.push('With one region, losing it took the whole service down. Nothing on the runbook could help.|একটি রিজিয়ন থাকায় তা হারানো মানে পুরো সেবা বন্ধ। রানবুকের কিছুই সাহায্য করতে পারেনি।');
      if (event('deploy')) say(s.ops.rollback !== undefined ? `You rolled back at ${hhmm(sc.start + s.ops.rollback)}, ${s.ops.rollback - event('deploy').at} minutes after the release began.` : 'The slow release was never rolled back.', s.ops.rollback !== undefined ? `রিলিজ শুরুর ${s.ops.rollback - event('deploy').at} মিনিট পরে, ${hhmm(sc.start + s.ops.rollback)}-এ আপনি রোলব্যাক করেছেন।` : 'ধীর রিলিজটি কখনও রোলব্যাক করা হয়নি।');
      say(`These ${S.length} minutes cost ${money(spend)}, with spending peaking at ${money(peakSpend)} an hour.`, `এই ${S.length} মিনিটে খরচ ${money(spend)}, সর্বোচ্চ খরচের হার ঘণ্টায় ${money(peakSpend)}।`);
      const items = s.worst ? D.review(base, brief, stage, s.worst.r).filter((x) => x.sev !== 'info').slice(0, 4) : [];
      return { grade, pass: grade === 'S' || grade === 'A' || grade === 'B', used, failed, worstErr, badMin, latMin, from, page, ttd: page ? page.t - from : null, recovered: last >= 0 && last + 1 < S.length ? last + 1 : last < 0 ? from : null, spend, peakSpend, peakLag, peakAmp, actions: s.used.slice(), insights: ins, items, lesson: sc.lesson, lab: sc.lab };
    }

    return Object.assign(s, { step, runAll, act, actions, targets, report, clock: () => hhmm(sc.start + Math.min(s.t, s.len)), fleet, floor, byId });
  }

  root.RTOps = { SCENARIOS, POLICIES, create, pick, hhmm, pct, num, money, daily, NAME, CLS, BOOT, MONTH_MIN };
})(typeof window !== 'undefined' ? window : globalThis);
