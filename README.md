# Round Trip

An interactive course on how large web systems work. Learners follow a ten-stage roadmap through 80 topics, watch a step-by-step animated walkthrough of each one, read plain explanations, experiment in live labs, keep what they learn with spaced review, practise designs in a Studio, work through interview problems, and play Scale Quest, a ten-episode game that grows a platform from 300 users to 25 million. It runs in English and Bengali.

It is a static site with no framework, no backend and no accounts. Progress stays in the visitor's browser.

## Run it

Open `index.html` in a browser. No build is needed for development.

To work on production files you need Node 20 or later:

```
npm install
npm run build      # writes dist/
npm run preview    # serves dist/ at http://localhost:4173 with production headers
```

## Check it

| Command | What it does |
|---|---|
| `npm run lint` | ESLint over `js/` |
| `npm test` | Simulation engine, game logic and lab models, no browser |
| `npm run test:e2e` | Every page and the main journeys in Chrome |
| `npm run test:a11y` | axe accessibility audit |
| `npm run test:bn` | Bengali coverage; writes `tests/missing.txt` |
| `npm run test:dist` | Builds, then checks CSP, the service worker and offline use |

Browser tests need Chrome. Set `CHROME_PATH` if it is not in the default Windows location, and `SITE_URL` to test a deployed copy.

## Deploy

Run `npm run build` and upload `dist/` to any static host.

- `dist/_headers` holds the security and cache headers in the format used by Netlify and Cloudflare Pages. On other hosts, set the same headers by hand. Keep `/assets/*` immutable and `index.html` and `sw.js` at `no-cache`.
- Serve over HTTPS. The service worker only registers on HTTPS or localhost.
- Routing uses the URL hash, so no rewrite rules are needed.

Live DNS calls `dns.google`, and fonts come from Google Fonts. If you remove either, update the CSP in `public/_headers` and the privacy section in `js/topics-extra.js`.

## Layout

| Path | Contents |
|---|---|
| `js/core.js` | Helpers, UI parts, settings, routing, page shell, the animation clock and playback bar |
| `js/scene.js` | The walkthrough player, and the extra lesson sections (when to use, trade-offs, interview notes, where it is used, a second question) |
| `js/lessons-1.js` … `js/lessons-8.js` | One walkthrough and the extra sections for every topic, by roadmap stage, both languages |
| `js/lab-*.js`, `js/labs-*.js` | The labs |
| `js/practice-*.js` | Simulation engine, briefs, Studio and its load test, Workbench, Estimator, Trainer |
| `js/game-data.js`, `js/game.js` | Scale Quest |
| `js/models.js` | Pure models behind the newer labs, tested by `tests/models.test.js` |
| `js/labs-bridge-*.js` | Labs for the intermediate topics |
| `js/theory-*.js`, `js/theory-extra.js` | Theory, examples, mistakes and deep notes for the first topics |
| `js/topics-extra.js` | Theory-only topics, prerequisites, About page, and `RT.addTopics` |
| `js/topics-*.js` | Intermediate and advanced topics and case studies, English and Bengali side by side |
| `js/topics-glossary.js` | Newer glossary terms and learning paths |
| `js/learn-*.js` | Glossary, tours, search, settings, System Map, learning paths, roadmap, review, cheat sheets, playbook, worked designs |
| `docs/curriculum-analysis.md` | How the course material was compared, and why each topic exists |
| `docs/studio-model.md` | How the Design Studio calculates its numbers, and what it leaves out |
| `js/i18n*.js` | Translator and Bengali text |
| `scripts/` | Build, preview and service worker template |
| `public/` | Files copied into `dist/` as they are |

Scripts are classic scripts, loaded in the order set in `index.html`.

## Animation

Every animation reads time from a clock in `js/core.js` (`RT.clock`, `ctx.now()`), never from `performance.now()` or `setTimeout`. That is what lets one bar pause, step, slow down and reset everything on the page. In a lab, use `ctx.sleep`, `ctx.after`, `ctx.every`, `ctx.loop` and `ctx.frame`, and `RT.now()` for timestamps.

- **Labs** get a playback bar: Play/Pause (Space or K), Step (full stop), Reset (R) and speed from ¼× to 4×. Reset throws the lab away and builds it again. Clicking any control in a paused lab resumes it. A hidden browser tab pauses by itself.
- **Packets** keep to their own lane on a wire, so requests and replies do not overlap, leave a short trail, light up the wire while they travel, and ring the node they reach. A lost packet tumbles and fades. Reduced motion turns these effects off.
- **Walkthroughs** on theory pages have their own clock, so they never disturb the lab. Back, Play, Next, Reset, a dot per step and a written list of every step. Space plays, the arrow keys step and R resets while the walkthrough has focus.

## Adding a topic

1. Add an entry to a `RT.addTopics(chapter, bnChapter, { ... })` call in a `js/topics-*.js` file. One entry holds both languages. See the comment above `RT.addTopics` for the fields.
2. Add its walkthrough and extra sections to an `RT.enrich({ ... })` call in the matching `js/lessons-*.js` file. The walkthrough is plain data: nodes, wires and steps written in a short action language described at the top of `js/scene.js`. Text that differs by language is written `English|বাংলা`.
3. For a lab, put the logic in `js/models.js`, add a render function to `RT.labRender`, and test the model in `tests/models.test.js`.
4. Add the id to a stage in `STAGES` in `js/learn-more.js`. The sidebar, home page and Everything path all follow that order.

`tests/topics.js` fails if an id does not resolve, a topic is missing from the roadmap, prerequisites form a cycle, a topic comes before its prerequisites, the roadmap drops in difficulty, the two languages differ in structure, a topic has no walkthrough or extra sections, or a walkthrough names a node that does not exist. It also checks that Pause freezes time, Step moves it and Reset rebuilds a lab.

## Adding a language string

Most text on screen is translated at run time from `js/i18n-strings.js`, an English-to-Bengali map. The newer labs carry both languages inline. `{n}` stands for a value that changes, such as a number or a name. Theory and lab text have their own Bengali fields. Run `npm run test:bn` to see what is missing.

## Known limits

- Capacities, prices and latencies are teaching models, not measurements.
- The Bengali text has not had a professional review.
- Read aloud depends on the voices installed on the device, and many have no Bengali voice.
- The fonts need a connection. Offline, the site falls back to system fonts.

## Licence

No licence has been chosen, so all rights are reserved by the owner until one is added.
