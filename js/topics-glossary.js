/* New glossary terms, learning paths and on-screen labels for the intermediate topics, each with its Bengali
   text. Runs after the string table loads and before the learning layer reads the glossary. */
(function () {
  const L = window.RTLearn, S = window.RTStrings;
  const TERMS = [
    ['Bandwidth-delay product', 'Bandwidth × round-trip time: how much data must be in flight to fill a link.', 'netmetrics', ['BDP'], 'ব্যান্ডউইথ × আসা-যাওয়ার সময়: লিংক ভরতে কতটা ডেটা পথে থাকতে হবে।'],
    ['Goodput', 'The useful data delivered each second, without headers and resends.', 'netmetrics', null, 'প্রতি সেকেন্ডে পৌঁছানো কাজের ডেটা, হেডার ও আবার পাঠানো বাদে।'],
    ['Packet loss', 'The share of packets that never reach the other end.', 'netmetrics', ['lost packets'], 'যত অংশ প্যাকেট অন্য প্রান্তে কখনও পৌঁছায় না।'],
    ['Backpressure', 'A slow component telling callers to slow down.', 'degrade', null, 'ধীর কম্পোনেন্ট কলারদের ধীর হতে বলা।'],
    ['Blue-green deployment', 'Running a full new copy beside the old one, then switching traffic.', 'deploys', ['blue-green'], 'পুরনোর পাশে পুরো নতুন কপি চালিয়ে ট্রাফিক বদলানো।'],
    ['Bounded context', 'An area of a business where each word has one clear meaning.', 'boundaries', null, 'ব্যবসার এমন এলাকা যেখানে প্রতিটি শব্দের একটিই অর্থ।'],
    ['Bulkhead', 'Separate pools, so one bad dependency cannot sink everything.', 'resilience', null, 'আলাদা পুল, যাতে একটি খারাপ নির্ভরতা সব না ডোবায়।'],
    ['Burn rate', 'How fast you are spending your error budget.', 'slo', null, 'কত দ্রুত এরর বাজেট খরচ হচ্ছে।'],
    ['Canary release', 'Sending a small share of traffic to a new version first.', 'deploys', ['canary'], 'আগে ট্রাফিকের ছোট অংশ নতুন সংস্করণে পাঠানো।'],
    ['Change data capture', 'Turning a database\'s commit log into a stream of events.', 'outbox', ['CDC'], 'ডেটাবেসের কমিট লগকে ইভেন্টের স্ট্রিম বানানো।'],
    ['Circuit breaker', 'Stops calling a failing dependency for a while, so it can recover.', 'resilience', ['circuit breakers'], 'ব্যর্থ নির্ভরতাকে কিছুক্ষণ ডাকা থামায়, যাতে সেরে ওঠে।'],
    ['Cold start', 'The delay while a new instance boots and warms up.', 'deploys', ['cold starts'], 'নতুন ইনস্ট্যান্স চালু ও গরম হওয়ার দেরি।'],
    ['Compaction', 'Merging storage files to drop old versions and deleted data.', 'storage', null, 'পুরনো সংস্করণ ও মোছা ডেটা ফেলতে স্টোরেজ ফাইল মেশানো।'],
    ['Compensating action', 'A new step that undoes the effect of an earlier one.', 'dtx', ['compensation'], 'আগের ধাপের প্রভাব ফেরানো একটি নতুন ধাপ।'],
    ['Connection pool', 'A small set of open database connections that requests share.', 'servers', null, 'খোলা ডেটাবেস সংযোগের ছোট সেট, যা অনুরোধগুলো ভাগ করে।'],
    ['Content addressing', 'Naming data by the hash of its content.', 'objectstore', null, 'বিষয়বস্তুর হ্যাশ দিয়ে ডেটার নাম দেওয়া।'],
    ['Consensus', 'A group of machines agreeing on one value, despite some failures.', 'consensus', null, 'কিছু ব্যর্থতা সত্ত্বেও একদল মেশিনের এক মানে একমত হওয়া।'],
    ['CQRS', 'Using separate models for changing data and reading it.', 'cqrs', null, 'ডেটা বদলানো ও পড়ার জন্য আলাদা মডেল ব্যবহার।'],
    ['CRDT', 'A data type that merges to the same result in any order.', 'clocks', ['CRDTs'], 'যেকোনো ক্রমে মেশালে একই ফল দেয় এমন ডেটা টাইপ।'],
    ['Erasure coding', 'Splitting data into pieces plus parity, so some can be lost.', 'objectstore', null, 'ডেটাকে টুকরো ও প্যারিটিতে ভাগ করা, যাতে কিছু হারানো সয়।'],
    ['Error budget', 'The amount of failure your reliability target allows.', 'slo', ['error budgets'], 'নির্ভরযোগ্যতার লক্ষ্য যতটা ব্যর্থতা মানে।'],
    ['Event sourcing', 'Storing every change as an event, not just the latest state.', 'cqrs', null, 'শুধু সর্বশেষ অবস্থা নয়, প্রতিটি বদল ইভেন্ট হিসেবে রাখা।'],
    ['Feature flag', 'A switch that turns code on or off without a deployment.', 'degrade', ['feature flags'], 'ডিপ্লয় ছাড়াই কোড চালু বা বন্ধ করার সুইচ।'],
    ['Fencing token', 'An increasing number that lets storage reject a stale lock holder.', 'dlock', ['fencing'], 'বাড়তে থাকা সংখ্যা, যা দিয়ে স্টোরেজ পুরনো লক ধারককে ফেরায়।'],
    ['Geohash', 'A string for a location, where a shared prefix means nearby.', 'searchgeo', null, 'অবস্থানের স্ট্রিং, মিল উপসর্গ মানে কাছাকাছি।'],
    ['GeoDNS', 'DNS that answers with a server near the person asking.', 'gslb', null, 'যে ডিএনএস প্রশ্নকর্তার কাছের সার্ভার দিয়ে উত্তর দেয়।'],
    ['Gossip protocol', 'Nodes spreading news by telling a few random others.', 'repair', ['gossip'], 'নোড এলোমেলো কয়েকজনকে বলে খবর ছড়ায়।'],
    ['High-water mark', 'The last record safely copied, and the most readers may see.', 'cs-kafka', null, 'নিরাপদে কপি হওয়া শেষ রেকর্ড, পাঠক এতটুকুই দেখতে পারে।'],
    ['Hinted handoff', 'A healthy node keeps a write for a dead one until it returns.', 'repair', null, 'সুস্থ নোড মৃত নোডের রাইট তার ফেরা পর্যন্ত রাখে।'],
    ['Idempotency key', 'A unique value that lets a server recognise a repeated request.', 'idempotency', ['idempotency keys'], 'অনন্য মান, যা দিয়ে সার্ভার পুনরাবৃত্ত অনুরোধ চেনে।'],
    ['Inverted index', 'A map from each word to the documents containing it.', 'searchgeo', null, 'প্রতিটি শব্দ থেকে তার ডকুমেন্টগুলোর ম্যাপ।'],
    ['Isolation level', 'How much overlapping transactions may see of each other.', 'isolation', ['isolation levels'], 'একসঙ্গে চলা ট্রানজ্যাকশন একে অপরের কতটা দেখবে।'],
    ['Jitter', 'Variation in timing. On a network, how much delay changes between packets. In retries, random delay added so that many clients do not act together.', 'netmetrics', null, 'সময়ের তারতম্য। নেটওয়ার্কে, প্যাকেটের মধ্যে দেরি কতটা বদলায়। রিট্রাইয়ে, যোগ করা এলোমেলো দেরি, যাতে অনেক ক্লায়েন্ট একসঙ্গে কাজ না করে।'],
    ['Lamport clock', 'A counter that orders events by cause and effect.', 'clocks', null, 'কারণ-ফল ধরে ঘটনা সাজানো কাউন্টার।'],
    ['Lease', 'A lock with an expiry, which the holder must keep renewing.', 'dlock', ['leases'], 'মেয়াদসহ লক, ধারককে নবায়ন করতে হয়।'],
    ['Liveness check', 'A test of whether a process is stuck and needs a restart.', 'lbdeep', ['liveness'], 'প্রসেস আটকে গেছে কি না, রিস্টার্ট লাগবে কি না তার পরীক্ষা।'],
    ['Little\'s Law', 'Items inside a system equal the arrival rate times time inside.', 'queueing', null, 'সিস্টেমের ভেতরের সংখ্যা = আগমনের হার গুণ ভেতরের সময়।'],
    ['Load shedding', 'Dropping some work on purpose during overload.', 'degrade', null, 'অতিরিক্ত চাপে ইচ্ছা করে কিছু কাজ ফেলা।'],
    ['LSM tree', 'A storage design that appends to sorted files and merges them later.', 'storage', null, 'সাজানো ফাইলে যোগ করে পরে মেশানোর স্টোরেজ নকশা।'],
    ['Memtable', 'The sorted in-memory table that holds new writes in an LSM tree.', 'storage', null, 'LSM ট্রিতে নতুন রাইট রাখা মেমোরির সাজানো টেবিল।'],
    ['Merkle tree', 'A tree of hashes used to find differences cheaply.', 'repair', ['Merkle trees'], 'সস্তায় পার্থক্য খোঁজার হ্যাশের গাছ।'],
    ['mTLS', 'TLS where both sides prove their identity with certificates.', 'mtls', null, 'যে টিএলএসে দুই পক্ষই সার্টিফিকেটে পরিচয় প্রমাণ করে।'],
    ['MVCC', 'Keeping several versions of a row, so readers do not block writers.', 'isolation', null, 'একটি সারির কয়েক সংস্করণ রাখা, যাতে পাঠক লেখককে না আটকায়।'],
    ['NAT', 'Rewrites packets so that private machines can share a public address.', 'cloudnet', null, 'প্যাকেট বদলে প্রাইভেট মেশিনকে পাবলিক ঠিকানা ভাগ করতে দেয়।'],
    ['Negative caching', 'Caching the answer "not found" for a short time.', 'freshness', null, 'অল্প সময়ের জন্য "পাওয়া যায়নি" উত্তর ক্যাশ করা।'],
    ['Outbox pattern', 'Writing an event in the same transaction as the data it describes.', 'outbox', ['outbox'], 'ডেটার সঙ্গে একই ট্রানজ্যাকশনে ইভেন্ট লেখা।'],
    ['Raft', 'A consensus algorithm built around a leader and a replicated log.', 'consensus', null, 'লিডার ও রেপ্লিকেটেড লগভিত্তিক কনসেনসাস অ্যালগরিদম।'],
    ['Read repair', 'Fixing a stale replica when a read notices it.', 'repair', null, 'রিডের সময় ধরা পড়া পুরনো রেপ্লিকা ঠিক করা।'],
    ['Readiness check', 'A test of whether a process can take traffic right now.', 'lbdeep', ['readiness'], 'প্রসেস এখন ট্রাফিক নিতে পারবে কি না তার পরীক্ষা।'],
    ['RPO', 'Recovery point objective: how much recent data you can afford to lose.', 'dr', null, 'রিকভারি পয়েন্ট অবজেক্টিভ: কত সাম্প্রতিক ডেটা হারানো যায়।'],
    ['RTO', 'Recovery time objective: how long you can afford to be down.', 'dr', null, 'রিকভারি টাইম অবজেক্টিভ: কতক্ষণ বন্ধ থাকা যায়।'],
    ['Saga', 'A chain of local transactions, with undo steps for failure.', 'dtx', ['sagas'], 'স্থানীয় ট্রানজ্যাকশনের শৃঙ্খল, ব্যর্থতায় ফেরানোর ধাপসহ।'],
    ['Service mesh', 'Small proxies beside each service that handle network concerns.', 'containers', null, 'প্রতিটি সার্ভিসের পাশে নেটওয়ার্কের কাজ সামলানো ছোট প্রক্সি।'],
    ['Sidecar', 'A helper process that runs beside a service.', 'containers', null, 'সার্ভিসের পাশে চলা সহায়ক প্রসেস।'],
    ['SLA', 'Service level agreement: a contract promise, often with penalties.', 'slo', null, 'সার্ভিস লেভেল অ্যাগ্রিমেন্ট: চুক্তির প্রতিশ্রুতি, প্রায়ই জরিমানাসহ।'],
    ['SLI', 'Service level indicator: a measurement of service health.', 'slo', null, 'সার্ভিস লেভেল ইন্ডিকেটর: সেবার স্বাস্থ্যের মাপ।'],
    ['Snowflake ID', 'A 64-bit id made of time, worker number and sequence.', 'ids', null, 'সময়, ওয়ার্কার নম্বর ও সিকোয়েন্সে তৈরি ৬৪-বিট আইডি।'],
    ['Span', 'One timed step in a distributed trace.', 'tracing', ['spans'], 'ডিস্ট্রিবিউটেড ট্রেসের সময়সহ একটি ধাপ।'],
    ['Split brain', 'Two groups each believing they are in charge.', 'dlock', null, 'দুই দলই নিজেকে দায়িত্বে ভাবা।'],
    ['SSTable', 'An immutable, sorted file of keys and values on disk.', 'storage', ['SSTables'], 'ডিস্কে কী ও মানের অপরিবর্তনীয় সাজানো ফাইল।'],
    ['Sticky session', 'Sending one user to the same server every time.', 'lbdeep', ['sticky sessions'], 'একজন ব্যবহারকারীকে প্রতিবার একই সার্ভারে পাঠানো।'],
    ['Tail latency', 'How slow your slowest requests are, such as p99.', 'queueing', null, 'সবচেয়ে ধীর অনুরোধ কত ধীর, যেমন p99।'],
    ['Token bucket', 'A limiter where steady tokens pay for requests, allowing bursts.', 'ratelimit', null, 'স্থির টোকেনে অনুরোধ চলে এমন লিমিটার, ঝটকা মানে।'],
    ['Tombstone', 'A marker that records a delete in append-only storage.', 'storage', ['tombstones'], 'যোগ-করা স্টোরেজে ডিলিট লিখে রাখার চিহ্ন।'],
    ['Trace', 'The recorded path of one request across services.', 'tracing', ['traces'], 'সার্ভিস জুড়ে একটি অনুরোধের রেকর্ড করা পথ।'],
    ['Vector clock', 'One counter per machine, used to detect concurrent changes.', 'clocks', ['vector clocks'], 'প্রতি মেশিনে একটি কাউন্টার, সমসাময়িক বদল ধরতে।'],
    ['Watermark', 'An estimate that all events up to a time have arrived.', 'streaming', ['watermarks'], 'একটি সময় পর্যন্ত সব ইভেন্ট এসেছে, এমন অনুমান।'],
    ['Write-ahead log', 'Recording a change on disk before applying it.', 'storage', ['WAL'], 'প্রয়োগের আগে ডিস্কে পরিবর্তন লেখা।'],
  ];
  const have = new Set(L.GLOSSARY.map((g) => g[0]));
  TERMS.forEach(([term, def, lab, alts, bn]) => {
    if (have.has(term)) return;
    L.GLOSSARY.push(alts ? [term, def, lab, alts] : [term, def, lab]);
    S[def] = bn;
  });

  /* Older entries pointed at the nearest lab of their day. Send them to the topic that now teaches them. */
  const TERM_LAB = { Bandwidth: 'netmetrics', Latency: 'netmetrics', Throughput: 'netmetrics', Idempotent: 'idempotency', SLO: 'slo', 'Rate limit': 'ratelimit', Backoff: 'resilience', p95: 'queueing', Utilisation: 'queueing', Region: 'cloudnet', Serverless: 'deploys', Bottleneck: 'queueing', Asynchronous: 'delivery', Fan: 'walkthroughs', Failover: 'dr', 'Multi-AZ': 'cloudnet' };
  L.GLOSSARY.forEach((g) => { if (TERM_LAB[g[0]]) g[2] = TERM_LAB[g[0]]; });
  const TECH_LAB = { Cassandra: 'cs-cassandra', DynamoDB: 'cs-dynamo', Docker: 'containers', Kubernetes: 'containers', 'AWS Lambda': 'deploys', etcd: 'consensus', Prometheus: 'slo', gRPC: 'apistyles', Kafka: 'cs-kafka' };
  L.TECH.forEach((t) => { if (TECH_LAB[t.name]) t.lab = TECH_LAB[t.name]; });
  L.PARTS.app.lab = 'servers';
  L.PARTS.search.lab = 'searchgeo';

  const P = (id) => L.PATHS.find((p) => p.id === id);
  P('starter').labs = ['basics', 'map', 'url', 'dns', 'tcp', 'http', 'tls', 'servers', 'netmetrics', 'scalability', 'lb', 'eviction', 'cacheflow', 'cdn', 'databases', 'index', 'acid', 'replication', 'sharding', 'cap', 'kafka', 'idempotency', 'game', 'studio'];
  P('interview').labs = ['playbook', 'map', 'netmetrics', 'scalability', 'queueing', 'estimate', 'lb', 'cacheflow', 'databases', 'sharding', 'sharddesign', 'replication', 'cap', 'storage', 'kafka', 'idempotency', 'delivery', 'quorum', 'ratelimit', 'ids', 'resilience', 'microservices', 'walkthroughs', 'trainer', 'workbench', 'studio', 'review'];
  P('backend').labs = ['servers', 'netmetrics', 'databases', 'acid', 'concurrency', 'isolation', 'index', 'storage', 'schema', 'cacheflow', 'stampede', 'freshness', 'apistyles', 'pagination', 'idempotency', 'ratelimit', 'kafka', 'delivery', 'outbox', 'realtime', 'auth', 'sessions', 'availability', 'resilience', 'observability', 'tracing', 'heartbeat', 'ddos', 'workbench', 'studio'];
  L.PATHS.push(
    { id: 'bridge', name: 'Beyond the fundamentals', say: 'For anyone who knows the basics: the intermediate ideas that connect them to real systems.', labs: ['servers', 'queueing', 'lbdeep', 'httpcache', 'pagination', 'ratelimit', 'idempotency', 'freshness', 'sharddesign', 'ids', 'schema', 'isolation', 'storage', 'delivery', 'outbox', 'resilience', 'degrade', 'slo', 'deploys'] },
    { id: 'distributed', name: 'Distributed systems', say: 'How machines agree, disagree and recover, ending in real systems.', labs: ['replication', 'quorum', 'cap', 'heartbeat', 'checksum', 'storage', 'clocks', 'repair', 'consensus', 'dlock', 'dtx', 'cs-dynamo', 'cs-cassandra', 'cs-kafka', 'cs-chubby', 'cs-gfs', 'cs-bigtable'] },
    { id: 'sre', name: 'Reliability and operations', say: 'Keeping a system healthy once it is live.', labs: ['availability', 'resilience', 'degrade', 'dr', 'observability', 'slo', 'tracing', 'deploys', 'containers', 'cloudnet', 'gslb', 'schema'] },
  );
  Object.assign(S, {
    'Interview': 'ইন্টারভিউ', 'APIs': 'এপিআই', 'Database internals': 'ডেটাবেসের ভেতরে', 'Distributed systems': 'ডিস্ট্রিবিউটেড সিস্টেম', 'Operations': 'অপারেশন', 'Architecture': 'আর্কিটেকচার', 'Case studies': 'কেস স্টাডি',
    'Beyond the fundamentals': 'ভিত্তির পরে', 'Reliability and operations': 'নির্ভরযোগ্যতা ও অপারেশন',
    'For anyone who knows the basics: the intermediate ideas that connect them to real systems.': 'যাঁরা মূল বিষয় জানেন তাঁদের জন্য: যে মধ্যবর্তী ধারণা এগুলোকে আসল সিস্টেমে জোড়ে।',
    'How machines agree, disagree and recover, ending in real systems.': 'মেশিন কীভাবে একমত হয়, ভিন্নমত হয় ও সেরে ওঠে, শেষে আসল সিস্টেম।',
    'Keeping a system healthy once it is live.': 'চালু হওয়ার পর সিস্টেম সুস্থ রাখা।',
  });
})();
