# Thinta

**Live: https://thinta-production.up.railway.app/thinta**

Thinta (isiZulu for "touch") is a team of AI agents inside SA Educate that makes maths graphs accessible to blind and Deaf learners. A teacher photographs a graph, like a parabola with its equation written beside it. The agents read it, check the maths, and build a version for each learner. Nothing reaches a learner until the teacher approves it.

**Fika** ("arrive") is the second team. After approval it gets each pack to every learner: phone packs straight away, tactile prints scheduled on the school's machines.

Built for Melsoft Academy's Colleague Zero hackathon (November 2026).

## Why

Maths lives in graphs, and blind and Deaf learners in South Africa are locked out of them. In 2015 only 2 of 22 schools for blind learners offered maths. A tactile copy of one graph can take weeks, because someone has to redraw it by hand. And AI on its own can't be trusted to read charts: on a 2025 benchmark the best model scored 63% where people scored 93%. So Thinta never trusts a single AI read. It proves the maths with algebra and checks its own work.

## What a teacher gets

| Tab | For | What's in it |
|---|---|---|
| **Blind** | Blind learners | Touch the graph: drag a finger and the pitch follows the curve, with a click and a vibration at each root and the turning point, and a buzz when the finger drifts off the line. An audio description read aloud in English, isiZulu or Sepedi. A tactile print (SVG or PDF) with braille labels, ready for swell paper or an embosser. |
| **Deaf** | Deaf learners | A plain-language, step-by-step worked solution, with a drawn picture for each step and key terms to fingerspell. Signs are left to a human SASL reviewer. |
| **Teacher** | The teacher | Where every check ended, every correction the team made, the full trace, and the Approve button. |
| **Delivery** | Everyone | Fika's board: each learner's items, which machine prints them, when they'll be ready, and an honest flag when a deadline can't be met. |

## The agents

**Thinta**

- **Planner** decides which versions to build for the learners in the class.
- **Reader** reads the photo with Gemini vision: the equation, points, axes and its own read of the roots and turning point.
- **Prover** works the true answers out with algebra (no AI). When the Reader is off, its value is crossed out and the Prover's replaces it.
- **Designer** draws the tactile print and runs print rules on it (labels at least 3.2 mm from the curve, curve thicker than the axes, nothing overlapping), moving labels until every rule passes.
- **Sonifier** turns the curve into sound and vibration for touch-the-graph.
- **Explainer** writes the audio description, translates it into isiZulu and Sepedi, and writes the Deaf step-by-step solution.
- **Reviewer** checks everything and sends work back, up to twice per check:
  - *Fresh eyes:* a second Gemini call that never saw the photo reads the tactile print and must agree with the proof.
  - *Access tests:* it answers the worksheet using only the audio description, then only the Deaf solution, and needs 4 out of 5.
  - *Meaning check:* every number and "above/below" claim in the text must match the proof.

**Fika**

- **Dispatcher** plans each learner's items and schedules the tactile prints, earliest deadline first, within each machine's capacity and school hours.
- **Schedule Checker** independently checks capacity, deadlines, offline machines and that every learner is covered, and sends a failing schedule back.
- **Tracker** runs a demo clock and moves items through queued, printing, ready and delivered.
- **Notifier** writes the teacher's summary. Every number and time in it is checked against the schedule, with a fixed template if the check fails.

Every agent writes to one trace, which the phone shows live as the team works.

## Run it locally

You need Node.js 20 or newer.

```bash
npm install
```

Create `.env.local` in the project folder with your Gemini key (get one at aistudio.google.com):

```
GEMINI_API_KEY=your-key
```

Then start it:

```bash
npm run dev
```

Open http://127.0.0.1:8765/thinta.

- **No key?** Tick **Replay a recorded run** on the first screen. It plays a real recorded run with no network calls.
- **Database (optional):** set `DATABASE_URL` to a Postgres connection string and packs, approvals and delivery plans are kept there. The tables are created on first use. Without it, they're kept in memory and a local file.
- **Translation and voices (optional):** `HF_TOKEN` (a free Hugging Face token) raises the free allowance for translation and speech.

### Tests

```bash
node --test server/*.test.mjs server/thinta/*.test.mjs server/thinta/fika/*.test.mjs src/*.test.js src/learnbridge/*.test.js src/lesson-integration/*.test.js src/thinta/*/*.test.js src/thinta/fika/ui/*.test.js
```

### Production build

```bash
npm run build
npm start
```

`npm start` serves the built app and every API route from one Node process on `PORT` (default 8765).

## Deploy (Railway)

1. New project → **Deploy from GitHub repo** → this repo. `railway.json` sets the build (`npm run build`) and start (`npm start`) commands.
2. Add a **PostgreSQL** database to the same project.
3. On the app service, under **Variables**, add `GEMINI_API_KEY` and `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`.
4. **Settings → Networking → Generate Domain**, then open `/thinta`.

## API

| Route | What it does |
|---|---|
| `POST /api/thinta/run` | Starts the agent team on a photo. Streams the trace as newline-delimited JSON and ends with the finished pack, which is saved. |
| `POST /api/thinta/approve` | Records the teacher's approval on a saved pack. |
| `GET /api/thinta/packs`, `GET /api/thinta/packs/:id` | Lists and reopens saved packs. |
| `POST /api/thinta/dispatch` | Plans delivery for an approved pack (streamed). |
| `POST /api/thinta/dispatch/event` | A machine goes offline or online, an urgent pack, or the clock moves on. Fika replans and returns what changed. |
| `GET /api/thinta/dispatch/:id` | The current delivery plan. |

## Where things are

| Path | What |
|---|---|
| `src/thinta/contract.js` | The shared job every agent reads and writes |
| `server/thinta.mjs` | Routes |
| `server/thinta/pipeline.mjs` | Thinta's agent pipeline, retries and step cap |
| `server/thinta/` | Reader, Prover, fresh eyes, Explainer, Reviewer, the database store |
| `server/thinta/fika.mjs`, `server/thinta/fika/` | Fika's pipeline, Tracker and Notifier |
| `src/thinta/tactile/` | Tactile print, braille labels, print rules, PDF |
| `src/thinta/sound/` | Sonifier and touch-the-graph |
| `src/thinta/fika/` | Scheduler, Schedule Checker and the Delivery tab |
| `src/thinta/ThintaApp.jsx`, `src/thinta/ui/` | The phone app |

## SA Educate

Thinta lives inside SA Educate, a lesson platform that turns a teacher's PDF into a lesson learners can read, hear or follow in sign language. The rest of the app is at `/app`; this README covers the Thinta and Fika work.
