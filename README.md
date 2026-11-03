# Round Trip

An interactive course on how large web systems work. Learners follow a ten-stage roadmap through 82 topics, read plain explanations, experiment in live labs, keep what they learn with spaced review, practise designs in a Studio, work through interview problems, and play Scale Quest, a ten-episode game that grows a platform from 300 users to 25 million. It runs in English and Bengali.

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
| `js/core.js` | Helpers, UI parts, settings, routing, page shell |
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

## Adding a topic

1. Add an entry to a `RT.addTopics(chapter, bnChapter, { ... })` call in a `js/topics-*.js` file. One entry holds both languages. See the comment above `RT.addTopics` for the fields.
2. For a lab, put the logic in `js/models.js`, add a render function to `RT.labRender`, and test the model in `tests/models.test.js`.
3. Add the id to a stage in `STAGES` in `js/learn-more.js`. The sidebar, home page and Everything path all follow that order.

`tests/topics.js` fails if an id does not resolve, a topic is missing from the roadmap, prerequisites form a cycle, a topic comes before its prerequisites, the roadmap drops in difficulty, or the two languages differ in structure.

## Adding a language string

Most text on screen is translated at run time from `js/i18n-strings.js`, an English-to-Bengali map. The newer labs carry both languages inline. `{n}` stands for a value that changes, such as a number or a name. Theory and lab text have their own Bengali fields. Run `npm run test:bn` to see what is missing.

## Known limits

- Capacities, prices and latencies are teaching models, not measurements.
- The Bengali text has not had a professional review.
- Read aloud depends on the voices installed on the device, and many have no Bengali voice.
- The fonts need a connection. Offline, the site falls back to system fonts.

## Licence

No licence has been chosen, so all rights are reserved by the owner until one is added.
