# Design Studio model

How `js/practice-engine.js` turns a drawn system and a brief into load, latency, availability and cost. The Studio and Scale Quest both use it. The engine has no page code, so `tests/engine.test.js` runs it directly.

It is a steady-state capacity model. It does not replay individual requests. Capacities and prices are round teaching figures, so results are for comparing designs and finding limits, not for forecasting production.

## Traffic

Each kind of request (reads, writes, media, search, realtime) enters at Users and follows the connections to something that can serve it. Traffic splits evenly between the next tiers.

- Offered load settles over several passes, because each tier's limit changes what the next tier receives. A bottleneck shields the tiers behind it, so fixing one can reveal the next.
- Success is the share of requests that get through every tier, so one bottleneck sets it.
- Caches and CDNs answer hits, and only misses travel on.
- WebSocket servers hand each message to whatever follows them. A cache gets a lookup, and anything else gets a write. Workers also keep connected caches, indexes and object stores updated. The sender does not wait for this work, so it adds load but not latency.
- A queue acknowledges writes at once. Workers drain it at their normal pace, even during a spike, and a backlog is reported if they cannot keep up.

## Latency

p95 is the sum of each tier on the slowest path that more than 5% of requests take, multiplied by 1.6, plus the network.

- Queueing uses Sakasegawa's approximation of M/M/c. Parallelism comes from Little's Law: capacity × service time. One busy server queues at 50%, while a large pool stays quick to about 90%.
- The network part is the round trip for the user's location, plus extra slow-start round trips and sending time for large messages.
- When more than 5% of a kind of request fails, its p95 is the 5-second client timeout.

## Scaling

- **Regions** are full stacks, paid for separately. They add capacity for stateless work and reads. Every copy of the data applies every write, so they add no write capacity. Writes to a single SQL primary travel to its region unless a queue acknowledges them first.
- **Read replicas** add read capacity, minus the work of replaying writes.
- **Shards and NoSQL nodes** add write capacity. NoSQL writes are divided by the replication factor.
- **Auto-scaling** can double a tier during a sudden spike, because new servers take minutes. Sustained load in a load test can grow it up to 10×, and the extra instances are billed.
- **Cache memory** is limited to 256 GB a node.

## Failures

| Test | Effect |
|---|---|
| Traffic spike | Traffic multiplies by the brief's spike factor |
| Zone outage | Half of a spread tier is lost, or all of an unspread tier. With several regions, only one region is hit |
| Primary dies | A replica takes over, which costs one replica of read capacity. With no replica, the tier is down |
| Cache goes cold | Every read misses, unless misses are coalesced |

The failover window itself is not modelled. Results show the steady state after it.

## Cost

Instances, storage, CDN and data sent to users, at round list prices. Regions multiply instance costs. Data coming in is free.

## Validity

`sanitize` runs on every design that is stored, pasted or evaluated. It drops unknown types, duplicate ids, a second Users box and connections that `LINKS` does not allow, and it clamps numbers to `LIMITS`. A browser cannot call a database or a cache, so those connections cannot exist. A design also fails if Users connect straight to several app servers with nothing sharing the traffic.

## Not modelled

Replication lag and stale reads, the failover window, connection limits on WebSocket servers, indexing delay, cross-zone transfer cost, and uneven splitting between tiers.

## Tests

`tests/engine.test.js` proves that every reference design passes, that naive and impossible designs fail, and that each design decision moves the numbers the way a practitioner expects. It also runs 1,500 random designs against laws that must hold for any design: all numbers stay finite and in range, more capacity never lowers success, and more traffic never raises it.
