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

## Live incidents

`js/practice-ops.js` plays a design through an evening, one simulated minute at a time, and calls the engine once a minute (more while shedding load). The engine stays a steady-state model. This file adds what changes from minute to minute. It has no page code, so `tests/ops.test.js` runs it directly. The Studio's **Live incident** tab draws it, and the page's control dock drives it: Play, Next (one minute), Reset and speed.

- **Traffic** follows a daily curve that peaks at 20:30, with a little seeded noise, so the same run always gives the same minutes. Scenarios add an overshoot, a surge that rises in 3 minutes and fades, or a ramp that holds.
- **Auto-scaling** belongs to this file during a run, not to the engine. Above 75% a tier asks for enough servers to reach 60%, and they serve traffic 3 minutes later. After 10 quiet minutes under 35% it shrinks, never below its starting size, and never past 10×.
- **Queues** carry a backlog between minutes. Workers drain it as fast as their spare capacity allows, and stop while the database behind them is down or failing over. Lag is the backlog divided by the incoming rate.
- **Caches** warm after a restart with a 4-minute time constant. Coalescing keeps at least 65% of the full hit rate.
- **Failover** takes 1 minute with a Multi-AZ replica and 2 without. During it, SQL writes fail and reads carry on. With no replica, the database stays down until a restore from backup (15 minutes), and recent writes are lost.
- **Regions**: DNS moves users away from a dead region after 3 minutes. Until then, that region's share of users fails.
- **Retries**: each minute's failures add load the next minute. Naive clients retry 3 times at once, and app servers retry the database once. Backoff with jitter and a retry budget adds at most 10%. Retries can hold a system above capacity after the fault has gone, which is a metastable failure.
- **Overload**: without load shedding, a tier over capacity also wastes work on requests whose callers have given up, so goodput falls below capacity. Shedding at an API gateway admits up to 92% of the busiest tier, turns the rest away with a fast 429, and cuts their retries by 70%. A load balancer can only do a cruder version.
- **Alerts** need a breach to last. A page fires when the 5-minute error rate burns the budget 14.4 times too fast, or a p95 stays over target for 3 minutes. Tickets fire for 85% saturation over 5 minutes, or a queue 5 minutes behind. An alert resolves after 3 good minutes.
- **Error budget**: the SLO's allowed failures over 30 days. Each minute spends its error rate, and a minute over a latency target spends another quarter, up to one minute. Grades: S under 0.5% with no bad minutes, A under 2%, B under 5%, C under 20%, otherwise D.
- **Runbook** actions take effect after a delay: new servers 3 minutes, a read replica 20, NoSQL nodes 15, a rollback 4, an index rebuild 5, a restore 15. Shards cannot be added during an incident, because that means moving data.

The engine gained options for this, all unused by the Studio's grade: `warm` (cache fill, 0 to 1), `degrade` (per-node capacity and latency multipliers), `hot` (the share of reads on one key, which lands on one cache node or shard), `failover` (SQL writes fail), and `down` (nodes that cannot be reached). Each class also reports `raw`, its p95 before the timeout rule, and each cache reports `hit`.

## Not modelled

Replication lag and stale reads, the failover window outside live incidents, connection limits on WebSocket servers, indexing delay, cross-zone transfer cost, and uneven splitting between tiers.

## Tests

`tests/ops.test.js` runs every scenario on every reference design, and checks that each mechanism above moves the numbers the right way: a single-zone design goes dark with its zone, servers arrive only after they boot, naive retries trap a lean design and backoff or shedding frees it, and so on.

`tests/engine.test.js` proves that every reference design passes, that naive and impossible designs fail, and that each design decision moves the numbers the way a practitioner expects. It also runs 1,500 random designs against laws that must hold for any design: all numbers stay finite and in range, more capacity never lowers success, and more traffic never raises it.
