# Curriculum analysis

How the two extra course sets were compared with Round Trip, what was missing, and what was added in response.

## What was analysed

| Source | Lessons | Words | Main content |
|---|---|---|---|
| Grokking System Design Fundamentals (2025) | 103 | 125,000 | The site's original base |
| Grokking Scalable Systems for Interviews (2025) | 56 | 158,000 | Focused intermediate questions, one concept per lesson |
| Educative: Scalability & System Design skill path (2023) | 427 | 291,000 | Web architecture, microservices, case studies, patterns, AWS |

Method: lesson text was extracted from all 586 HTML files, then 80 concepts were counted across the site and each source. All outlines and section headings were read, along with the interview guide, the case-study summaries and a sample of lessons. Not every lesson was read word for word.

## What the comparison showed

The site covered the fundamentals well. Against the other two sources it had three gaps:

1. **Concepts it never mentioned.** 31 of the 80 tracked concepts had no mentions at all, including MVCC, LSM trees, the outbox pattern, CQRS, Little's Law, watermarks, mTLS, liveness and readiness checks, and rendezvous hashing. Another 18 appeared only once.
2. **No bridge between the basics and real systems.** A learner could go from "what is a cache" to a Cassandra case study with nothing between them. Cassandra needs LSM trees, gossip, read repair and vector clocks.
3. **No way to review or to see a path.** Lessons had no next link on theory pages, search skipped lesson text, and nothing showed what depended on what.

## New topics

39 intermediate and advanced topics and 6 case studies were added, each in English and Bengali. "Bridge" marks ideas that none of the three sources teach properly as a lesson, but that learners need in order to follow them.

| Area | Topics | Main source |
|---|---|---|
| Foundations | Inside a server, Queues & Little's Law | Bridge, Scalable 019–020 |
| Networking | Cloud networks | Educative AWS module, Scalable 040 |
| Traffic | Sessions & health checks, Global load balancing | Scalable 007–009 |
| APIs | REST/gRPC/GraphQL, Pagination, HTTP caching, Rate limiting, Idempotency | Bridge for API styles, Scalable 010–013, 038 |
| Caching | Cache freshness | Scalable 003–006 |
| Data | Shard keys, Unique IDs, Schema changes, Object storage, Search & geo indexes | Scalable 018, 022–024, 042–044, 051–052; bridge for search and geo |
| Database internals | Storage engines, Isolation & MVCC | Scalable 014–017, Educative patterns; LSM trees are a bridge |
| Distributed systems | Clocks & conflicts, Gossip & repair, Consensus, Locks & leases, Sagas & 2PC | Scalable 029–031, 053, Educative patterns; consensus and sagas are bridges |
| Messaging | Delivery & ordering, Stream processing, Outbox & CDC, CQRS & event sourcing | Scalable 025–028, 045–046, Educative stream module |
| Reliability | Retries & breakers, Graceful degradation, Disaster recovery | Scalable 047–050 |
| Security | Sessions vs JWTs, mTLS & secrets | Scalable 035–037 |
| Operations | SLOs & error budgets, Tracing, Deploys & autoscaling, Containers & Kubernetes | Scalable 021, 032–034, Educative microservices modules |
| Architecture | Service boundaries, Frontend architecture, Architecture styles | Educative modules 1–3 |
| Case studies | Dynamo, Cassandra, Kafka, Chubby, GFS & HDFS, Bigtable | Educative module 4 |

## Where the sources were corrected or updated

- **Kafka and ZooKeeper.** The Educative case study relies on ZooKeeper. Current Kafka uses KRaft, so the site teaches that and notes the older design.
- **Netflix Hystrix and Ribbon.** These are presented as history, because that work has moved to platforms and service meshes.
- **Dynamo and DynamoDB.** The site separates the 2007 paper from today's service, since older material often blurs the two.
- **Isolation levels.** Textbook tables differ from real databases. The lab models snapshot databases such as PostgreSQL, and says so.
- **Backoff.** Courses tend to present exponential backoff as the fix for retry storms. The model showed that with a long outage, bounded retries still multiply the load, even with backoff. The topic teaches that backoff handles short blips, and that long outages need a circuit breaker or retry budget.

## Left out on purpose

- Spring Boot, Cloud Foundry, Atom feeds and the step-by-step AWS console guide. These are tool tutorials that date quickly and teach little about design.
- Mobile development detail beyond the PWA summary.
- Quizzes and text from the courses. All text on the site is original, and no course images or wording were copied.

## Platform changes

| Change | Why |
|---|---|
| Roadmap with ten stages | Sets the one course order: Core topics, then Intermediate, then Advanced, with no topic before its prerequisites and practice tools between stages |
| Core, Intermediate and Advanced levels | Lets people filter the home page and judge a topic |
| Spaced review | Each topic's question returns on a growing schedule |
| Cheat sheets | Latency, traffic, sizes, nines, formulas and a tool chooser, printable |
| Interview playbook | Seven timed steps, with what to say and what to avoid |
| Worked designs | Eleven problems, revealed one step at a time |
| Studio load test | Learners change traffic, reads, writes, sizes and user location on a live design, and see where it breaks and why |
| Full-text search | Now searches lesson text in both languages |
| Collapsible sidebar | Keeps 15 groups manageable |
| Next and previous on all lessons | Theory-only topics had none |
| "This unlocks" links | Shows what a topic leads to |

## Known limits

- The Bengali text has not had a professional review. The new text matches the style of the existing text, and technical terms follow the same transliterations.
- Capacities and latencies on the cheat sheets are orders of magnitude for reasoning.
- The script bundle grew to about 470 KB gzipped, because nearly all content ships in it. The service worker caches it after the first visit.
- Decision Trainer cards and Technology Guide entries were not extended for the new topics, apart from linking existing entries to them.
