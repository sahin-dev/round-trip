/* Scale Quest: ten episodes that take one platform from hundreds of users to millions.
   No DOM here, so every episode can be proven solvable by a test. */
(function (root) {
  'use strict';
  const D = root.RTDesign;
  const base = { reads: 400, writes: 20, recordKB: .5, years: 1, peak: 6, maxHit: .94, hotShare: .05 };
  const tiny = { app: { count: 1, cpu: 1, ram: 2 }, sql: { cpu: 2, ram: 4, disk: .5 }, lb: { count: 1 }, cache: { count: 1, memGB: 4 } };

  const add = (d, id, type, x, y, cfg) => { d.nodes.push({ id, type, x, y, ...D.DEFAULTS[type], ...cfg }); return d; };
  const link = (d, ...pairs) => { pairs.forEach((p) => d.edges.push(p)); return d; };
  const node = (d, id) => d.nodes.find((n) => n.id === id);
  const linked = (n, d, from, to) => d.edges.some(([a, b]) => { const A = n.find((x) => x.id === a), B = n.find((x) => x.id === b); return A && B && A.type === from && B.type === to; });
  const allAZ = (d) => d.nodes.forEach((n) => { if (!['users', 'cdn', 'blob'].includes(n.type)) n.multiAZ = true; });

  const EPISODES = [
    { id: 'ep1', icon: '1', dau: 300, slo: { read: 300, write: 400, avail: .97 }, allowed: ['app', 'sql'], topic: 'tcp',
      title: { en: 'Hello, World', bn: 'হ্যালো, ওয়ার্ল্ড' },
      tagline: { en: 'Get the shop online', bn: 'দোকানটি অনলাইনে আনুন' },
      story: { en: 'You and your co-founder Rumi have just started Notun Haat, an online market for handmade goods. Three hundred customers are waiting, and there is nothing to visit yet. Rumi says: "Keep it simple. One server, one database. Just make it work."', bn: 'আপনি আর আপনার সহ-প্রতিষ্ঠাতা রুমি সবে শুরু করেছেন "নতুন হাট", হাতে তৈরি পণ্যের একটি অনলাইন বাজার। তিনশো ক্রেতা অপেক্ষা করছেন, কিন্তু এখনও দেখার মতো কিছুই নেই। রুমি বলছেন: "সহজ রাখুন। একটি সার্ভার, একটি ডেটাবেস। আগে চালু করুন।"' },
      goal: { en: 'Connect Users to an app server, and the app server to a database.', bn: 'ইউজারদের অ্যাপ সার্ভারের সঙ্গে এবং অ্যাপ সার্ভারকে ডেটাবেসের সঙ্গে যুক্ত করুন।' },
      learn: { en: 'Every web platform starts the same way: code that handles requests, and a database that remembers things. The app can restart at any time, because the data lives elsewhere.', bn: 'প্রতিটি ওয়েব প্ল্যাটফর্ম একইভাবে শুরু হয়: অনুরোধ সামলানোর কোড, আর তথ্য মনে রাখার ডেটাবেস। অ্যাপ যেকোনো সময় রিস্টার্ট হতে পারে, কারণ ডেটা থাকে অন্য জায়গায়।' },
      obstacles: [{ fault: {}, name: { en: 'First customers arrive', bn: 'প্রথম ক্রেতারা আসছেন' }, say: { en: 'Doors open. Do pages load?', bn: 'দরজা খুলল। পেজ কি লোড হচ্ছে?' }, hint: { en: 'Requests need a path all the way to a database. Check every connection.', bn: 'অনুরোধগুলোর ডেটাবেস পর্যন্ত পথ দরকার। প্রতিটি সংযোগ পরীক্ষা করুন।' } }],
      solve: (d) => { add(d, 'app', 'app', 330, 242, tiny.app); add(d, 'db', 'sql', 660, 242, tiny.sql); link(d, ['users', 'app'], ['app', 'db']); } },

    { id: 'ep2', icon: '2', dau: 20000, slo: { read: 300, write: 400, avail: .97 }, allowed: ['app', 'sql'], topic: 'availability',
      title: { en: 'Thousands Show Up', bn: 'হাজারো মানুষ এল' },
      tagline: { en: 'Upgrade the machine', bn: 'মেশিন আপগ্রেড করুন' },
      story: { en: 'A popular blogger posted about Notun Haat, and 20,000 people came overnight. Your little server is gasping. There is no time to redesign, so Rumi asks: "Can we just buy a bigger machine for now?"', bn: 'একজন জনপ্রিয় ব্লগার নতুন হাট নিয়ে লিখেছেন, আর এক রাতেই ২০,০০০ মানুষ এসে গেছেন। আপনার ছোট সার্ভারটি হাঁপাচ্ছে। নতুন করে ডিজাইনের সময় নেই, তাই রুমি জিজ্ঞেস করছেন: "আপাতত একটা বড় মেশিন কিনলে হয় না?"' },
      goal: { en: 'Select the app server and raise its processor and RAM. Keep them in balance: 2 GB of RAM per vCPU is a good start.', bn: 'অ্যাপ সার্ভার সিলেক্ট করে প্রসেসর ও র‍্যাম বাড়ান। দুটির ভারসাম্য রাখুন: প্রতি vCPU-তে ২ জিবি র‍্যাম ভালো শুরু।' },
      learn: { en: 'Buying a bigger machine is called vertical scaling. It is quick and needs no code changes, which makes it the right first move. But processor and RAM limit each other, and big machines cost more than they return.', bn: 'বড় মেশিন কেনাকে বলে ভার্টিক্যাল স্কেলিং। এটি দ্রুত, কোড বদলাতে হয় না, তাই প্রথম পদক্ষেপ হিসেবে ঠিক। তবে প্রসেসর ও র‍্যাম একে অপরকে সীমিত করে, আর বড় মেশিনের দাম তার ফলের চেয়ে দ্রুত বাড়ে।' },
      obstacles: [{ fault: { spike: 1.5 }, name: { en: 'The blog post goes viral', bn: 'ব্লগ পোস্ট ভাইরাল' }, say: { en: 'Traffic jumps 50% above the usual peak.', bn: 'ট্রাফিক স্বাভাবিক সর্বোচ্চের চেয়ে ৫০% বেড়ে গেল।' }, hint: { en: 'Your server is overloaded. Raise CPU and RAM together: more of one alone hits the limit of the other.', bn: 'সার্ভারে চাপ বেশি। সিপিইউ ও র‍্যাম একসঙ্গে বাড়ান: একটি বাড়ালে অন্যটির সীমায় আটকে যাবেন।' } }],
      need: (n) => n.some((x) => x.type === 'app' && x.cpu >= 4 && x.ram >= 8),
      solve: (d) => { Object.assign(node(d, 'app'), { cpu: 8, ram: 16 }); } },

    { id: 'ep3', icon: '3', dau: 50000, slo: { read: 300, write: 400, avail: .98 }, allowed: ['app', 'sql', 'lb'], topic: 'lb',
      title: { en: 'The 2 AM Phone Call', bn: 'রাত দুটোর ফোন' },
      tagline: { en: 'Survive a server failure', bn: 'সার্ভার নষ্ট হলেও টিকে থাকুন' },
      story: { en: 'At 2 AM your phone rings. The server has crashed, the site is down, and customers are angry on Facebook. It takes you an hour to bring it back. Rumi says: "That can never happen again. One machine can\'t be the whole company."', bn: 'রাত দুটোয় ফোন বাজল। সার্ভার ক্র্যাশ করেছে, সাইট বন্ধ, ফেসবুকে ক্রেতারা ক্ষুব্ধ। চালু করতে এক ঘণ্টা লাগল। রুমি বলছেন: "এমন যেন আর না হয়। একটা মেশিন পুরো কোম্পানি হতে পারে না।"' },
      goal: { en: 'Run at least two app servers behind a load balancer, so one can die without anyone noticing.', bn: 'লোড ব্যালান্সারের পেছনে অন্তত দুটি অ্যাপ সার্ভার চালান, যাতে একটি নষ্ট হলেও কেউ টের না পায়।' },
      learn: { en: 'Horizontal scaling means adding more machines. A load balancer spreads traffic across them and skips any that fail. This removes the single point of failure, and it can keep growing long after a single machine reaches its limit.', bn: 'হরাইজন্টাল স্কেলিং মানে আরও মেশিন যোগ করা। লোড ব্যালান্সার ট্রাফিক সেগুলোতে ভাগ করে আর নষ্টগুলো এড়িয়ে যায়। এতে সিঙ্গেল পয়েন্ট অব ফেইলিওর দূর হয়, আর একটি মেশিনের সীমার পরেও বৃদ্ধি চলতে পারে।' },
      obstacles: [{ fault: { killOne: 'app' }, name: { en: 'A server dies', bn: 'একটি সার্ভার নষ্ট' }, say: { en: 'One app server crashes without warning.', bn: 'কোনো সতর্কতা ছাড়াই একটি অ্যাপ সার্ভার ক্র্যাশ করল।' }, hint: { en: 'If one server is everything, its failure is total. Add a load balancer and a second server, and make sure the rest can carry the full load.', bn: 'একটি সার্ভারই সব হলে তার ব্যর্থতা মানেই সম্পূর্ণ বন্ধ। লোড ব্যালান্সার ও দ্বিতীয় সার্ভার যোগ করুন, আর বাকিরা যেন পুরো চাপ নিতে পারে।' } }],
      solve: (d) => { add(d, 'lb', 'lb', 176, 242, tiny.lb); d.edges = d.edges.filter(([a]) => a !== 'users'); link(d, ['users', 'lb'], ['lb', 'app']); node(d, 'app').count = 3; } },

    { id: 'ep4', icon: '4', dau: 200000, slo: { read: 250, write: 400, avail: .98 }, allowed: ['app', 'sql', 'lb', 'cache'], topic: 'cacheflow',
      title: { en: 'The Slow Database', bn: 'ধীরগতির ডেটাবেস' },
      tagline: { en: 'Stop asking the same question', bn: 'একই প্রশ্ন বারবার করা বন্ধ করুন' },
      story: { en: 'Pages now take seconds to load. You look at the logs and find the database answering the same homepage query thousands of times a minute. Rumi asks: "Why do we keep working out an answer we already know?"', bn: 'এখন পেজ লোড হতে কয়েক সেকেন্ড লাগছে। লগ দেখে বুঝলেন, ডেটাবেস প্রতি মিনিটে হাজারবার একই হোমপেজ কোয়েরির উত্তর দিচ্ছে। রুমি জিজ্ঞেস করছেন: "যে উত্তর জানা, সেটা বারবার কেন বের করছি?"' },
      goal: { en: 'Add a cache beside the app servers, and give it enough RAM to hold the hot data.', bn: 'অ্যাপ সার্ভারের পাশে একটি ক্যাশ যোগ করুন, আর হট ডেটা রাখার মতো র‍্যাম দিন।' },
      learn: { en: 'Most traffic asks for a small share of the data. A cache keeps those answers in memory, so most reads never touch the database. A few gigabytes of RAM can replace a much larger database.', bn: 'বেশিরভাগ ট্রাফিক ডেটার ছোট একটি অংশই চায়। ক্যাশ সেই উত্তরগুলো মেমোরিতে রাখে, ফলে বেশিরভাগ রিড ডেটাবেস পর্যন্ত যায়ই না। কয়েক জিবি র‍্যাম অনেক বড় ডেটাবেসের কাজ করে দিতে পারে।' },
      obstacles: [{ fault: { spike: 3 }, name: { en: 'Everyone opens the homepage', bn: 'সবাই হোমপেজ খুলছেন' }, say: { en: 'A read storm hits at three times the peak.', bn: 'সর্বোচ্চের তিন গুণ রিডের ঝড় এল।' }, hint: { en: 'The database is doing repeated work. A cache is far cheaper than a bigger database here. Size its RAM close to the hot data shown in the goals.', bn: 'ডেটাবেস একই কাজ বারবার করছে। এখানে বড় ডেটাবেসের চেয়ে ক্যাশ অনেক সস্তা। লক্ষ্যে দেখানো হট ডেটার কাছাকাছি র‍্যাম দিন।' } }],
      need: (n, d) => linked(n, d, 'app', 'cache'),
      solve: (d) => { add(d, 'cache', 'cache', 682, 143, { ...tiny.cache, memGB: 8 }); link(d, ['app', 'cache']); node(d, 'db').disk = 2; } },

    { id: 'ep5', icon: '5', dau: 400000, slo: { read: 250, write: 400, avail: .99 }, allowed: ['app', 'sql', 'lb', 'cache'], topic: 'replication',
      title: { en: 'The Database Dies', bn: 'ডেটাবেস বন্ধ' },
      tagline: { en: 'Never have one copy of the truth', bn: 'সত্যের একটিমাত্র কপি রাখবেন না' },
      story: { en: 'The disk under your database has failed. Orders from the last six hours are gone, and you spend the night apologising. App servers are easy to replace, but data is not. Rumi says quietly: "We almost lost the company tonight."', bn: 'ডেটাবেসের ডিস্ক নষ্ট হয়ে গেছে। গত ছয় ঘণ্টার অর্ডার হারিয়ে গেছে, সারা রাত আপনি ক্ষমা চাইছেন। অ্যাপ সার্ভার সহজে বদলানো যায়, ডেটা যায় না। রুমি আস্তে বলছেন: "আজ রাতে কোম্পানিটাই হারাতে বসেছিলাম।"' },
      goal: { en: 'Add a read replica to the database, so a copy can take over when the primary fails. Enable zones to reach the availability target.', bn: 'ডেটাবেসে একটি রিড রেপ্লিকা যোগ করুন, যাতে প্রাইমারি নষ্ট হলে কপিটি দায়িত্ব নিতে পারে। অ্যাভেইলেবিলিটি লক্ষ্যে পৌঁছাতে জোন চালু করুন।' },
      learn: { en: 'Replication keeps a live copy of your data on another machine. When the primary dies, a replica is promoted, and the site stays up. Keep backups too: replication copies mistakes as faithfully as it copies data.', bn: 'রেপ্লিকেশন অন্য মেশিনে ডেটার জীবন্ত কপি রাখে। প্রাইমারি নষ্ট হলে একটি রেপ্লিকা দায়িত্ব নেয়, সাইট চালু থাকে। ব্যাকআপও রাখুন: রেপ্লিকেশন ভুলগুলোকেও ডেটার মতোই নকল করে।' },
      obstacles: [{ fault: { primary: true }, name: { en: 'The primary database fails', bn: 'প্রাইমারি ডেটাবেস নষ্ট' }, say: { en: 'The main database stops answering.', bn: 'মূল ডেটাবেস সাড়া দেওয়া বন্ধ করল।' }, hint: { en: 'Select the SQL database and set Read replicas per shard to at least 1.', bn: 'SQL ডেটাবেস সিলেক্ট করে প্রতি শার্ডে রিড রেপ্লিকা অন্তত ১ করুন।' } }],
      need: (n) => n.some((x) => x.type === 'sql' && x.replicas >= 1),
      solve: (d) => { Object.assign(node(d, 'db'), { replicas: 1, multiAZ: true, cpu: 8, ram: 32, disk: 2 }); node(d, 'app').multiAZ = true; node(d, 'lb').count = 2; node(d, 'lb').multiAZ = true; node(d, 'cache').count = 2; node(d, 'cache').multiAZ = true; } },

    { id: 'ep6', icon: '6', dau: 1000000, slo: { read: 250, write: 400, avail: .995 }, allowed: ['app', 'sql', 'lb', 'cache', 'queue', 'worker', 'gateway'], topic: 'kafka', spike: 5,
      title: { en: 'The Eid Sale', bn: 'ঈদের সেল' },
      tagline: { en: 'One million shoppers at midnight', bn: 'মধ্যরাতে দশ লাখ ক্রেতা' },
      story: { en: 'Marketing announced a midnight Eid sale. One million people will press "Buy" in the same few minutes, at five times the normal peak. The database can only take so many orders a second, and Rumi asks: "What if orders could wait in line, instead of crashing the shop?"', bn: 'মার্কেটিং মধ্যরাতের ঈদ সেল ঘোষণা করেছে। দশ লাখ মানুষ একই কয়েক মিনিটে "কিনুন" চাপবেন, স্বাভাবিক সর্বোচ্চের পাঁচ গুণ। ডেটাবেস প্রতি সেকেন্ডে সীমিত অর্ডার নিতে পারে। রুমি জিজ্ঞেস করছেন: "দোকান ক্র্যাশ না করে অর্ডারগুলো লাইনে দাঁড়াতে পারে না?"' },
      goal: { en: 'Put a message queue and workers in front of the database, and turn on auto-scaling for the app servers.', bn: 'ডেটাবেসের সামনে মেসেজ কিউ ও ওয়ার্কার বসান, আর অ্যাপ সার্ভারে অটো-স্কেলিং চালু করুন।' },
      learn: { en: 'A queue turns a sudden spike into a steady flow: the app says "order received" at once, and workers save orders at a safe pace. Auto-scaling adds servers when traffic rises, so you don\'t pay for peak capacity all year.', bn: 'কিউ হঠাৎ চাপকে স্থির প্রবাহে বদলে দেয়: অ্যাপ সঙ্গে সঙ্গে বলে "অর্ডার পেয়েছি", আর ওয়ার্কাররা নিরাপদ গতিতে অর্ডার সেভ করে। অটো-স্কেলিং ট্রাফিক বাড়লে সার্ভার যোগ করে, ফলে সারা বছর সর্বোচ্চ ক্ষমতার টাকা দিতে হয় না।' },
      obstacles: [{ fault: { spike: 5 }, name: { en: 'Midnight: the sale opens', bn: 'মধ্যরাত: সেল শুরু' }, say: { en: 'Traffic jumps to five times the peak.', bn: 'ট্রাফিক সর্বোচ্চের পাঁচ গুণ হলো।' }, hint: { en: 'Writes are drowning the database, and replicas can\'t help with writes. Connect App servers → Message queue → Workers → Database, and enable auto-scaling.', bn: 'রাইট ডেটাবেসকে ডুবিয়ে দিচ্ছে, আর রেপ্লিকা রাইটে সাহায্য করতে পারে না। অ্যাপ সার্ভার → মেসেজ কিউ → ওয়ার্কার → ডেটাবেস যুক্ত করুন, আর অটো-স্কেলিং চালু করুন।' } }],
      need: (n, d) => linked(n, d, 'app', 'queue') && linked(n, d, 'queue', 'worker') && n.some((x) => x.type === 'app' && x.auto),
      solve: (d) => { add(d, 'q', 'queue', 506, 429, { count: 2, multiAZ: true }); add(d, 'w', 'worker', 682, 429, { count: 4, multiAZ: true, auto: true }); link(d, ['app', 'q'], ['q', 'w'], ['w', 'db']); node(d, 'app').auto = true; node(d, 'cache').coalesce = true; } },

    { id: 'ep7', icon: '7', dau: 2000000, media: 100, mediaKB: 200, global: true, slo: { read: 400, write: 500, media: 150, avail: .995 }, allowed: ['app', 'sql', 'lb', 'cache', 'queue', 'worker', 'gateway', 'cdn', 'blob'], topic: 'cdn',
      title: { en: 'Photos for the World', bn: 'বিশ্বজুড়ে ছবি' },
      tagline: { en: 'Serve media from nearby', bn: 'কাছ থেকে মিডিয়া দিন' },
      story: { en: 'Sellers now upload thousands of product photos, and customers abroad are ordering gifts home. A shopper in London waits eight seconds for one image from your servers in Dhaka. Rumi says: "We can\'t move the customers. Can we move the photos?"', bn: 'বিক্রেতারা এখন হাজারো পণ্যের ছবি আপলোড করছেন, আর প্রবাসীরা দেশে উপহার পাঠাচ্ছেন। লন্ডনের একজন ক্রেতা ঢাকার সার্ভার থেকে একটি ছবির জন্য আট সেকেন্ড অপেক্ষা করছেন। রুমি বলছেন: "ক্রেতাদের সরানো যাবে না। ছবিগুলো সরানো যায় না?"' },
      goal: { en: 'Store media in object storage, and serve it to users through a CDN.', bn: 'মিডিয়া অবজেক্ট স্টোরেজে রাখুন, আর ব্যবহারকারীদের কাছে সিডিএনের মাধ্যমে পৌঁছে দিন।' },
      learn: { en: 'Light takes time to cross the world, and no server upgrade changes that. A CDN keeps copies of files close to users. Object storage holds the originals cheaply. Together they take almost all media traffic off your servers.', bn: 'পৃথিবী পার হতে আলোরও সময় লাগে, কোনো সার্ভার আপগ্রেডে তা বদলায় না। সিডিএন ব্যবহারকারীর কাছে ফাইলের কপি রাখে। অবজেক্ট স্টোরেজ মূল ফাইল সস্তায় রাখে। দুটি মিলে প্রায় সব মিডিয়া ট্রাফিক সার্ভার থেকে সরিয়ে নেয়।' },
      obstacles: [{ fault: { spike: 2 }, name: { en: 'New photo gallery launches', bn: 'নতুন ফটো গ্যালারি চালু' }, say: { en: 'Image requests double across the world.', bn: 'সারা বিশ্বে ছবির অনুরোধ দ্বিগুণ হলো।' }, hint: { en: 'Media has no fast path. Connect Users → CDN → Object storage.', bn: 'মিডিয়ার দ্রুত পথ নেই। ইউজার → সিডিএন → অবজেক্ট স্টোরেজ যুক্ত করুন।' } }],
      solve: (d) => { add(d, 'cdn', 'cdn', 176, 55, {}); add(d, 'blob', 'blob', 341, 55, {}); link(d, ['users', 'cdn'], ['cdn', 'blob']); } },

    { id: 'ep8', icon: '8', dau: 5000000, media: 100, mediaKB: 200, global: true, slo: { read: 400, write: 500, media: 150, avail: .995 }, allowed: ['app', 'sql', 'nosql', 'lb', 'cache', 'queue', 'worker', 'gateway', 'cdn', 'blob'], topic: 'sharding', maxDisk: 8,
      title: { en: 'Out of Disk', bn: 'ডিস্ক ভরে গেছে' },
      tagline: { en: 'Split the data', bn: 'ডেটা ভাগ করুন' },
      story: { en: 'An alert wakes you: the database disk is 91% full. Even the largest machine on sale can\'t hold what is coming, and write traffic is close to its limit too. Rumi draws a line through the database on a whiteboard: "What if it wasn\'t one database?"', bn: 'একটি অ্যালার্টে ঘুম ভাঙল: ডেটাবেসের ডিস্ক ৯১% ভরে গেছে। বাজারের সবচেয়ে বড় মেশিনেও আগামী ডেটা ধরবে না, রাইট ট্রাফিকও সীমার কাছাকাছি। রুমি হোয়াইটবোর্ডে ডেটাবেসের ওপর দিয়ে একটি দাগ টেনে বললেন: "এটা যদি একটা ডেটাবেস না হতো?"' },
      goal: { en: 'Shard the database, or move to a NoSQL store, so data fits and writes spread out. Each machine is limited to 8 TB.', bn: 'ডেটাবেস শার্ড করুন, অথবা NoSQL স্টোরে যান, যাতে ডেটা ধরে এবং রাইট ছড়িয়ে পড়ে। প্রতিটি মেশিনে সর্বোচ্চ ৮ টিবি।' },
      learn: { en: 'Replicas copy data, so they add no room and no write capacity. Sharding splits data across machines by a key, so both storage and writes grow with each shard. The price is complexity: joins across shards get hard, and a poor key creates a hot shard.', bn: 'রেপ্লিকা ডেটা নকল করে, তাই জায়গা বা রাইট ক্ষমতা বাড়ায় না। শার্ডিং একটি কী দিয়ে ডেটা মেশিনে ভাগ করে, ফলে প্রতি শার্ডে স্টোরেজ ও রাইট দুটোই বাড়ে। মূল্য হলো জটিলতা: শার্ডজুড়ে জয়েন কঠিন, আর ভুল কী হট শার্ড তৈরি করে।' },
      obstacles: [{ fault: { spike: 2 }, name: { en: 'The disk fills up', bn: 'ডিস্ক ভরে যাচ্ছে' }, say: { en: 'Data keeps growing while traffic doubles.', bn: 'ট্রাফিক দ্বিগুণ হচ্ছে, ডেটাও বাড়ছে।' }, hint: { en: 'Set the disk to 8 TB, then raise Shards until the data fits. Replicas do not add storage.', bn: 'ডিস্ক ৮ টিবি করুন, তারপর ডেটা না ধরা পর্যন্ত শার্ড বাড়ান। রেপ্লিকা স্টোরেজ বাড়ায় না।' } }],
      need: (n) => n.some((x) => (x.type === 'sql' && x.shards >= 2) || x.type === 'nosql'),
      solve: (d) => { node(d, 'db').disk = 8; node(d, 'db').shards = 4; } },

    { id: 'ep9', icon: '9', dau: 10000000, media: 100, mediaKB: 200, global: true, slo: { read: 400, write: 500, media: 150, avail: .999 }, allowed: ['app', 'sql', 'nosql', 'lb', 'cache', 'queue', 'worker', 'gateway', 'cdn', 'blob'], topic: 'availability',
      title: { en: 'The Data Centre Fire', bn: 'ডেটা সেন্টারে আগুন' },
      tagline: { en: 'Survive losing a whole building', bn: 'পুরো ভবন হারালেও টিকে থাকুন' },
      story: { en: 'A fire breaks out at your data centre. Everything in that building is gone within minutes: servers, caches and databases. Ten million people depend on Notun Haat now. Rumi asks: "How do we stop one building, or one city, from being our single point of failure?"', bn: 'আপনার ডেটা সেন্টারে আগুন লেগেছে। কয়েক মিনিটে সেই ভবনের সব শেষ: সার্ভার, ক্যাশ, ডেটাবেস। এখন এক কোটি মানুষ নতুন হাটের ওপর নির্ভরশীল। রুমি জিজ্ঞেস করছেন: "একটা ভবন বা একটা শহর যেন আমাদের সিঙ্গেল পয়েন্ট অব ফেইলিওর না হয়, সেটা কীভাবে করব?"' },
      goal: { en: 'Spread every tier across zones, then select Users and add a second region.', bn: 'প্রতিটি স্তর জোনজুড়ে ছড়িয়ে দিন, তারপর ইউজার সিলেক্ট করে দ্বিতীয় রিজিয়ন যোগ করুন।' },
      learn: { en: 'An availability zone is a separate data centre nearby. Spreading across zones survives a building failure with little delay. A second region survives a whole-city disaster, at a real cost in money and in keeping data in step.', bn: 'অ্যাভেইলেবিলিটি জোন হলো কাছাকাছি আলাদা একটি ডেটা সেন্টার। জোনজুড়ে ছড়ালে সামান্য বিলম্বেই ভবনের ব্যর্থতা সামলানো যায়। দ্বিতীয় রিজিয়ন পুরো শহরের দুর্যোগ সামলায়, তবে টাকা ও ডেটা মেলানোর সত্যিকারের খরচ আছে।' },
      obstacles: [
        { fault: { zone: true }, name: { en: 'Fire in Zone A', bn: 'জোন এ-তে আগুন' }, say: { en: 'One availability zone goes dark.', bn: 'একটি অ্যাভেইলেবিলিটি জোন অন্ধকার হলো।' }, hint: { en: 'Any tier without "Spread across zones" dies with the building. Half your capacity also vanishes, so each tier needs room to absorb that.', bn: '"জোনজুড়ে ছড়ান" ছাড়া যেকোনো স্তর ভবনের সঙ্গেই শেষ। অর্ধেক ক্ষমতাও চলে যায়, তাই প্রতিটি স্তরে তা সামলানোর জায়গা রাখুন।' } },
        { fault: { region: true }, name: { en: 'The whole region fails', bn: 'পুরো রিজিয়ন বন্ধ' }, say: { en: 'Power fails across the city.', bn: 'পুরো শহরে বিদ্যুৎ চলে গেল।' }, hint: { en: 'Select Users and set Regions to 2.', bn: 'ইউজার সিলেক্ট করে রিজিয়ন ২ করুন।' } },
      ],
      solve: (d) => { allAZ(d); node(d, 'users').regions = 2; } },

    { id: 'ep10', icon: '10', dau: 25000000, media: 100, mediaKB: 200, global: true, slo: { read: 400, write: 500, media: 150, avail: .999 }, allowed: ['app', 'sql', 'nosql', 'lb', 'cache', 'queue', 'worker', 'gateway', 'cdn', 'blob', 'search'], topic: 'ddos', final: true,
      title: { en: 'The Final Boss', bn: 'চূড়ান্ত লড়াই' },
      tagline: { en: 'Everything fails at once', bn: 'সব একসঙ্গে ভেঙে পড়ছে' },
      story: { en: 'Notun Haat now serves 25 million people, and the biggest sale in its history begins tonight. Then the alerts start: a botnet attack, a failing zone, a cold cache and a dead database, one after another. Rumi looks at you and says: "Remember the single server? Show them what we built."', bn: 'নতুন হাট এখন আড়াই কোটি মানুষকে সেবা দিচ্ছে, আর আজ রাতে শুরু হচ্ছে ইতিহাসের সবচেয়ে বড় সেল। তারপরই অ্যালার্ট শুরু: বটনেট আক্রমণ, জোন ব্যর্থতা, ঠান্ডা ক্যাশ, মৃত ডেটাবেস, একের পর এক। রুমি আপনার দিকে তাকিয়ে বললেন: "সেই একটা সার্ভারের কথা মনে আছে? দেখিয়ে দিন আমরা কী বানিয়েছি।"' },
      goal: { en: 'Survive every incident in a row. Put an API gateway at the front, and turn on request coalescing in the cache.', bn: 'একের পর এক প্রতিটি ঘটনা সামলান। সামনে এপিআই গেটওয়ে বসান, আর ক্যাশে রিকোয়েস্ট কোয়ালেসিং চালু করুন।' },
      learn: { en: 'You took one server to a platform for millions. Each layer exists because something broke. Real systems are built this way: not perfect from the start, but improved after every failure, with no single part able to take the whole platform down.', bn: 'একটি সার্ভার থেকে আপনি কোটি মানুষের প্ল্যাটফর্ম বানালেন। প্রতিটি স্তর আছে কারণ কিছু একটা ভেঙেছিল। আসল সিস্টেম এভাবেই তৈরি হয়: শুরু থেকে নিখুঁত নয়, বরং প্রতিটি ব্যর্থতার পর উন্নত, যেখানে কোনো একটি অংশ পুরো প্ল্যাটফর্ম ফেলে দিতে পারে না।' },
      obstacles: [
        { fault: { spike: 4 }, name: { en: 'The sale begins', bn: 'সেল শুরু' }, say: { en: 'Traffic jumps to four times the peak.', bn: 'ট্রাফিক সর্বোচ্চের চার গুণ হলো।' }, hint: { en: 'Auto-scaling must be on for app servers and workers.', bn: 'অ্যাপ সার্ভার ও ওয়ার্কারে অটো-স্কেলিং চালু থাকতে হবে।' } },
        { fault: { ddos: 6 }, name: { en: 'Botnet attack', bn: 'বটনেট আক্রমণ' }, say: { en: 'Millions of fake requests flood in.', bn: 'লাখ লাখ ভুয়া অনুরোধ ঢুকছে।' }, hint: { en: 'Put an API gateway between the load balancer and the app servers. It rate limits abusive traffic at the door.', bn: 'লোড ব্যালান্সার ও অ্যাপ সার্ভারের মাঝে এপিআই গেটওয়ে বসান। এটি দরজাতেই ক্ষতিকর ট্রাফিক সীমিত করে।' } },
        { fault: { zone: true }, name: { en: 'A zone goes dark', bn: 'একটি জোন অন্ধকার' }, say: { en: 'A data centre loses power.', bn: 'একটি ডেটা সেন্টারের বিদ্যুৎ গেল।' }, hint: { en: 'Every tier needs "Spread across zones", with room to spare.', bn: 'প্রতিটি স্তরে "জোনজুড়ে ছড়ান" চাই, বাড়তি জায়গাসহ।' } },
        { fault: { cold: true }, name: { en: 'The cache restarts empty', bn: 'ক্যাশ খালি হয়ে রিস্টার্ট' }, say: { en: 'Every read misses at once.', bn: 'একসঙ্গে সব রিড মিস করছে।' }, hint: { en: 'Turn on "Coalesce misses" in the cache, and add read replicas so the database survives the rush.', bn: 'ক্যাশে "মিস কোয়ালেস" চালু করুন, আর রিড রেপ্লিকা বাড়ান যাতে ডেটাবেস এই ধাক্কা সামলাতে পারে।' } },
        { fault: { primary: true }, name: { en: 'The primary database dies', bn: 'প্রাইমারি ডেটাবেস নষ্ট' }, say: { en: 'A failover must happen under full load.', bn: 'পুরো চাপের মধ্যেই ফেইলওভার করতে হবে।' }, hint: { en: 'Every shard needs a replica.', bn: 'প্রতিটি শার্ডে রেপ্লিকা চাই।' } },
      ],
      need: (n) => n.some((x) => x.type === 'gateway') && n.some((x) => x.type === 'cache' && x.coalesce),
      solve: (d) => { add(d, 'gw', 'gateway', 341, 242, { count: 3, multiAZ: true }); d.edges = d.edges.filter(([a, b]) => !(a === 'lb' && b === 'app')); link(d, ['lb', 'gw'], ['gw', 'app']); } },
  ];

  const RANKS = [[0, { en: 'Intern', bn: 'ইন্টার্ন' }], [300, { en: 'Junior Engineer', bn: 'জুনিয়র ইঞ্জিনিয়ার' }], [800, { en: 'Engineer', bn: 'ইঞ্জিনিয়ার' }], [1500, { en: 'Senior Engineer', bn: 'সিনিয়র ইঞ্জিনিয়ার' }], [2400, { en: 'Staff Engineer', bn: 'স্টাফ ইঞ্জিনিয়ার' }], [3400, { en: 'Principal Architect', bn: 'প্রিন্সিপাল আর্কিটেক্ট' }], [4600, { en: 'CTO', bn: 'সিটিও' }]];
  const BADGES = {
    firstTry: { en: 'First try', bn: 'প্রথম চেষ্টায়' }, thrifty: { en: 'Thrifty', bn: 'মিতব্যয়ী' }, survivor: { en: 'Survivor', bn: 'টিকে থাকা' }, ironman: { en: 'No retries', bn: 'কোনো পুনরায় চেষ্টা নয়' }, champion: { en: 'Million-user architect', bn: 'কোটি ব্যবহারকারীর স্থপতি' },
  };

  const briefOf = (ep) => ({ id: ep.id, title: ep.title.en, pitch: ep.tagline.en, stages: [{ name: ep.title.en, dau: ep.dau, budget: budgetOf(ep) }], ...base, media: ep.media, mediaKB: ep.mediaKB, global: ep.global, slo: ep.slo, spike: ep.spike || 3, shape: {} });
  const blank = () => ({ nodes: [{ id: 'users', type: 'users', x: 11, y: 242, regions: 1 }], edges: [] });

  /* Reference solutions build on one another, like the player's platform does. */
  const memo = {};
  function solution(i) {
    if (memo[i]) return JSON.parse(JSON.stringify(memo[i]));
    const d = i ? solution(i - 1) : blank(), ep = EPISODES[i];
    ep.solve(d);
    const b = { ...briefOf0(ep) };
    D.fit(d, b, 0, ep.obstacles.map((o) => o.fault).filter((f) => Object.keys(f).length), .6);
    memo[i] = d;
    return JSON.parse(JSON.stringify(d));
  }
  const briefOf0 = (ep) => ({ id: ep.id, title: ep.title.en, stages: [{ name: ep.title.en, dau: ep.dau, budget: 1e12 }], ...base, media: ep.media, mediaKB: ep.mediaKB, global: ep.global, slo: ep.slo, spike: ep.spike || 3, shape: {} });
  function budgetOf(ep) {
    const c = D.evaluate(solution(EPISODES.indexOf(ep)), briefOf0(ep), 0).cost * 1.3, mag = Math.pow(10, Math.floor(Math.log10(c)) - 1);
    return Math.ceil(c / mag) * mag;
  }

  /* Run one episode against a design. Stops at the first obstacle that breaks it. */
  function play(ep, design) {
    const brief = briefOf(ep), r = D.evaluate(design, brief, 0), limit = budgetOf(ep), c = r.checks;
    const norm = D.normalize(design), apps = norm.nodes.filter((n) => n.type === 'app');
    const balanced = !apps.some((n) => n.count > 1) || norm.nodes.some((n) => n.type === 'lb');
    const lesson = !ep.need || ep.need(norm.nodes, norm);
    const diskOk = !ep.maxDisk || norm.nodes.every((n) => !(n.disk > ep.maxDisk));
    const gates = [
      ['routes', c.routes], ['capacity', c.capacity], ['storage', c.storage], ['latency', c.latency], ['avail', c.avail], ['budget', r.cost <= limit], ['balanced', balanced], ['disk', diskOk], ['lesson', lesson],
    ];
    const steps = ep.obstacles.map((o) => { const x = D.evaluate(design, brief, 0, o.fault); return { o, r: x, pass: x.checks.routes && x.succ >= .98 }; });
    const failedGate = gates.find(([, v]) => !v);
    const failedStep = steps.find((s) => !s.pass);
    return { r, limit, gates, steps, failedGate: failedGate && failedGate[0], failedStep, pass: !failedGate && !failedStep, findings: D.review(design, brief, 0, r) };
  }
  function stars(ep, res, attempts) { return 1 + (res.r.cost <= res.limit * .8 ? 1 : 0) + (attempts <= 1 ? 1 : 0); }
  const rankOf = (xp) => { let i = 0; RANKS.forEach((x, k) => { if (xp >= x[0]) i = k; }); return { i, name: RANKS[i][1], next: RANKS[i + 1] }; };

  root.RTGame = { EPISODES, RANKS, BADGES, tiny, briefOf, blank, solution, budgetOf, play, stars, rankOf };
})(typeof window !== 'undefined' ? window : globalThis);
