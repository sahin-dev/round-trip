/* Design briefs: traffic models and interview guides for the Studio. */
(function (root) {
  'use strict';
  const stages = (a, b, c) => [{ name: 'Launch', dau: a }, { name: 'Growth', dau: b }, { name: 'Hyper-scale', dau: c }];
  const BRIEFS = [
    { id: 'url', title: 'URL Shortener', level: 'Starter', pitch: 'Turn long links into short ones, and redirect billions of clicks.',
      stages: stages(2e5, 5e6, 1e8), reads: 20, writes: .5, recordKB: .5, years: 5, peak: 3, maxHit: .96, hotShare: .15,
      slo: { read: 120, write: 200, avail: .999 }, shape: { store: 'nosql', cache: 1 },
      guide: {
        ask: ['How long should links live, and can users choose an alias?', 'What is the read-to-write ratio?', 'Do redirects need analytics?', 'Can a short code ever be reused?'],
        api: ['POST /links {url, alias?, expires?} → {code}', 'GET /{code} → 301 or 302 redirect'],
        data: ['links(code PK, long_url, owner, created_at, expires_at)', 'A key-value store fits: lookups are by exact key, and there are no joins.'],
        deep: ['Code generation: a counter in base62, or random with collision checks. Seven characters give 3.5 trillion codes.', '301 is cacheable by browsers, which cuts load but also cuts analytics. 302 keeps every click visible.', 'Cache hot links: click traffic is heavily skewed.'],
      } },
    { id: 'feed', title: 'Photo Feed', level: 'Core', pitch: 'Users post photos, and followers see them in a personal feed.',
      stages: stages(5e5, 1e7, 2e8), reads: 60, writes: 2, media: 40, recordKB: 2, mediaKB: 400, years: 3, peak: 3, maxHit: .9, fanout: 40, global: true,
      slo: { read: 250, write: 400, media: 200, avail: .999 }, shape: { store: 'nosql', cache: 1, cdn: 1, queue: 1, regions: 2 },
      guide: {
        ask: ['What is the average follower count, and how large do celebrities get?', 'Must the feed be strictly chronological?', 'How fresh must a feed be?', 'How large are the photos?'],
        api: ['POST /posts {photo, caption}', 'GET /feed?cursor=…&limit=20', 'POST /follow/{user}'],
        data: ['users, follows(follower, followee)', 'posts(post_id, author, media_url, created_at)', 'feeds(user_id, post_id, ranked_at), precomputed in a cache'],
        deep: ['Fan-out on write gives fast reads and costly writes. Fan-out on read reverses that. Use a hybrid for celebrities.', 'Photos go straight to object storage, with a CDN in front. They should never pass through app servers.', 'Use cursor pagination, because offsets drift as new posts arrive.'],
      } },
    { id: 'chat', title: 'Chat App', level: 'Core', pitch: 'One-to-one and group messaging, delivered instantly.',
      stages: stages(3e5, 8e6, 1.5e8), reads: 15, writes: 30, realtime: 60, recordKB: .4, years: 3, peak: 4, maxHit: .85, global: true,
      slo: { read: 200, write: 250, rt: 120, avail: .9995 }, shape: { store: 'nosql', cache: 1, queue: 1, ws: 1, regions: 2 },
      guide: {
        ask: ['One-to-one only, or groups? How large?', 'Are delivery and read receipts needed?', 'Must messages stay after delivery?', 'How should offline users be handled?'],
        api: ['WebSocket: send {to, body, client_id}, receive {from, body, seq}', 'GET /conversations/{id}/messages?before=…'],
        data: ['messages(conversation_id, seq, sender, body), partitioned by conversation', 'presence(user_id → gateway server), held in a cache'],
        deep: ['WebSockets need a registry: which server holds each user\'s connection?', 'Order by per-conversation sequence, since clocks across servers disagree.', 'Client-generated IDs make retries safe, so a retry never creates a duplicate.'],
      } },
    { id: 'video', title: 'Video Streaming', level: 'Advanced', pitch: 'Upload, process and stream video to a global audience.',
      stages: stages(3e5, 1e7, 2e8), reads: 40, writes: .3, media: 300, searches: 3, recordKB: 5, mediaKB: 900, years: 5, peak: 2.5, maxHit: .92, fanout: 30, global: true,
      slo: { read: 250, write: 800, media: 150, search: 300, avail: .9995 }, shape: { store: 'nosql', cache: 1, cdn: 1, queue: 1, search: 1, regions: 2 },
      guide: {
        ask: ['What resolutions must be supported?', 'What is the upload-to-view ratio?', 'Is live streaming in scope?', 'How quickly must an upload become watchable?'],
        api: ['POST /videos → pre-signed upload URL', 'GET /videos/{id}/manifest', 'GET /search?q=…'],
        data: ['videos(id, owner, status, renditions)', 'Segments in object storage, served by the CDN', 'A search index over titles'],
        deep: ['Transcoding is slow and bursty, so queue it. One upload fans out to many renditions and segments.', 'Adaptive bitrate: small segments at several qualities, chosen by the player.', 'Most views go to few videos, so the CDN carries nearly all the traffic and cost.'],
      } },
    { id: 'shop', title: 'Flash Sale Store', level: 'Advanced', pitch: 'Sell limited stock in a huge traffic spike, and never oversell.',
      stages: stages(2e5, 2e6, 3e7), reads: 40, writes: 3, media: 25, recordKB: 2, mediaKB: 120, years: 3, peak: 8, spike: 4, maxHit: .93, strong: true,
      slo: { read: 180, write: 350, media: 180, avail: .9995 }, shape: { store: 'sql', cache: 1, cdn: 1, gateway: 1, queue: 1 },
      guide: {
        ask: ['How much stock, and how many buyers at the moment of sale?', 'Is overselling ever acceptable?', 'How long may a cart hold stock?', 'Which pages can be slightly stale?'],
        api: ['GET /products/{id}', 'POST /orders {sku, qty, idempotency_key}'],
        data: ['inventory(sku PK, available, version)', 'orders(order_id, user, sku, status)'],
        deep: ['Stock counts need strong consistency, but product pages do not. Split them.', 'Protect the database with rate limits and a queue, so a spike becomes a steady flow.', 'Idempotency keys stop a retried payment from charging twice.'],
      } },
    { id: 'notify', title: 'Notification System', level: 'Core', pitch: 'Deliver push, email and SMS to millions, reliably.',
      stages: stages(5e5, 1e7, 3e8), reads: 2, writes: 5, recordKB: 1, years: 1, peak: 5, maxHit: .85, fanout: 8,
      slo: { read: 200, write: 200, avail: .999 }, shape: { store: 'nosql', cache: 1, queue: 1, gateway: 1 },
      guide: {
        ask: ['Which channels, and what are their providers\' limits?', 'At-least-once or at-most-once delivery?', 'Do users set preferences and quiet hours?', 'Do some alerts outrank marketing messages?'],
        api: ['POST /notifications {user, template, data, priority}', 'GET /users/{id}/preferences'],
        data: ['notifications(id, user, channel, status)', 'preferences(user, channel, enabled)', 'A dead-letter queue for repeated failures'],
        deep: ['Separate queues per priority, so a marketing blast cannot delay a password reset.', 'Retries need backoff and a dead-letter queue.', 'Deduplicate at the worker, because at-least-once delivery will repeat.'],
      } },
    { id: 'search', title: 'Search Autocomplete', level: 'Core', pitch: 'Suggest completions on every keystroke, in milliseconds.',
      stages: stages(1e6, 2e7, 4e8), reads: 3, writes: .2, searches: 30, recordKB: .2, years: 1, peak: 3, maxHit: .9, global: true,
      slo: { read: 200, write: 400, search: 180, avail: .999 }, shape: { store: 'nosql', cache: 1, search: 1, queue: 1, regions: 2 },
      guide: {
        ask: ['How many suggestions per keystroke?', 'How fresh must trending terms be?', 'Is it personalised?', 'Which languages?'],
        api: ['GET /suggest?prefix=syst&limit=8'],
        data: ['A trie or prefix index holding the top queries per prefix', 'Query logs aggregated in batches'],
        deep: ['Precompute top-k per prefix, so a lookup is a read and not a computation.', 'Debounce in the client to remove most of the requests.', 'Rebuild from logs with a batch job, with a stream for fast-moving trends.'],
      } },
    { id: 'metrics', title: 'Metrics Pipeline', level: 'Advanced', pitch: 'Ingest millions of metric points and serve dashboards.',
      stages: stages(5e4, 1e6, 1e7), reads: 300, writes: 8000, recordKB: .1, years: 1, peak: 2, maxHit: .8,
      slo: { read: 400, write: 150, avail: .999 }, shape: { store: 'nosql', cache: 1, queue: 1, gateway: 1 },
      guide: {
        ask: ['How many series, and what resolution?', 'How long should raw data stay?', 'Is losing a few points acceptable?', 'How fresh must dashboards be?'],
        api: ['POST /ingest (batched points)', 'GET /query?series=…&from=…&to=…'],
        data: ['points(series_id, bucket, timestamp, value)', 'Rollups at 1 minute and 1 hour'],
        deep: ['Writes vastly outnumber reads, so absorb them with a log, then write in batches.', 'Partition by series and time bucket, which avoids one endlessly hot shard.', 'Downsample old data: nobody needs one-second data from last year.'],
      } },
  ];
  root.RTDesign = Object.assign(root.RTDesign || {}, { BRIEFS });
})(typeof window !== 'undefined' ? window : globalThis);
