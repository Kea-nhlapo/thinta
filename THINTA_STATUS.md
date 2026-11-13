# Thinta status board

Deadline: hacking ends 11:00 Sat 14 Nov 2026, present 12:00. Branch `thinta`. Brief: the Thinta build brief (sections referenced below as §).

Each sub-agent updates **only its own section** at least every 45 minutes: Done, Doing, Blocked on, Interface changes requested.

## Contract (frozen)

- `src/thinta/contract.js`: GraphJob types, `LIMITS`, `DEFAULT_QUESTIONS`, `emptyJob`, `sampleCurve`, `validateJob`, `EXAMPLE_PARABOLA_JOB`, `EXAMPLE_BAR_JOB`. Only the orchestrator edits it.
- Stream: `POST /api/thinta/run` answers `application/x-ndjson`, one event per line: `trace`, `correction`, `review`, `patch` (partial job), `done` (final job), `error`.
- `POST /api/thinta/approve` `{jobId, by}` → `{jobId, approval}`.
- Shared Gemini helper: `server/thinta/gemini.mjs` → `geminiJSON({apiKey, parts, schema, fetchImpl})`. Use it; pass `fetchImpl` in tests.
- Routing note: Thinta is **not** a gateway route (it streams). `api/router.js` sends `/api/thinta/*` to `handleThinta`; `vite.config.mjs` mounts `thintaMiddleware`. Both done.

### Module interfaces the orchestrator will call

| Owner | Module | Export |
|---|---|---|
| A | `server/thinta/reader.mjs` | `readGraph({imageBase64, equationHint, apiKey, fetchImpl}) → reading` |
| A | `server/thinta/prover.mjs` | `prove(reading, {equationHint, questions}) → {proof, corrections}` (pure, no AI) |
| A | `server/thinta/fresh-eyes.mjs` | `freshEyes({svg, proof, apiKey, fetchImpl}) → {reading:{roots, turningPoint}, review}` |
| B | `src/thinta/tactile/index.js` | `designTactile(proof, {type}) → {svg, warnings, ruleChecks, corrections}` and `fixTactile(proof, tactile, feedback)` |
| C | `src/thinta/sound/` | `sonify(proof) → sound` plus the `<TouchGraph job>` React component |
| D | `server/thinta/explainer.mjs` | `explain({proof, reading, feedback?, apiKey, fetchImpl, translate, speak}) → {description, deafSolution}` |
| D | `server/thinta/reviewer.mjs` | `accessTest({version:'audio'|'deaf', text, proof, questions, apiKey, fetchImpl}) → review` and `meaningCheck(text, proof) → {pass, problems}` |
| E | `src/thinta/ThintaApp.jsx` | default export, route `/thinta` (already wired) |

## Go/no-go (+1:00)

| Check | Result |
|---|---|
| Gemini reads a phone photo of the parabola into `reading` | blocked: no GEMINI_API_KEY. Run `node server/thinta/smoke-a.mjs [photo.jpg] ["y = x^2 - 2x - 8"]` (A) |
| Gemini reads a rendered tactile SVG back (fresh eyes) | blocked: no GEMINI_API_KEY (same smoke script). Rasterising works: `@resvg/resvg-js` renders B's SVG to PNG locally; geometry fallback reads B's SVG to roots [-2, 4], TP (1, -9) (A) |
| liblouis loads, or fallback table chosen | **No-go for liblouis** (multi-MB emscripten build, too heavy for the phone bundle). Built-in Grade 1 UEB-style table chosen (`src/thinta/tactile/braille.js`). Maths braille labelled beta on every sheet |
| Vibration + Web Audio on the demo Android phone | pending (needs the real phone) |

## Orchestrator

- Done: contract, Gemini helper, pipeline (`server/thinta/pipeline.mjs`: Planner → Reader → Prover → Designer ∥ Explainer, Sonifier → fresh eyes → access tests with meaning checks; step cap 20, 2 retries, escalation to teacher), NDJSON streaming in Vercel router and Vite. A–E integrated. 122 tests pass across the repo, `npm run build` passes, `/thinta` loads in the real dev server and Replay plays end to end at 375 px.
- Doing: live go/no-go and a real recorded run, as soon as the key is in.
- Blocked on: `GEMINI_API_KEY` in `.env.local` (Kea adding it).
- Before the demo: replace the contract example in Replay with a real recorded run (`src/thinta/replay/recorded-parabola.json`). The example's "3/5 → 5/5" is fixture data, not a run. `npm run build` rewrites tracked `dist/`; restore with `git checkout -- dist` before committing.

## A. Vision & Proof
_not started_

## B. Tactile Designer
- **Done:** `src/thinta/tactile/` (pure JS, runs in Node and the browser, no new packages). 10 tests pass: `node --test src/thinta/tactile/*.test.js`.
  - `designTactile(proof, {type?, title?, yLabel?}) → {svg, warnings, ruleChecks, corrections, layout, initialChecks, options}`. `type` defaults from `proof.bars`. Store the whole object as `job.tactile` so `fixTactile` can reuse `options`/`layout`.
  - `fixTactile(proof, tactile, {missing:[], unclear:[]})`: keys `roots`, `turningPoint`, `yIntercept`, `bars`. Those labels get larger print (`C: turning point (1, -9)`) and braille coordinates at the point, then the rule checker re-runs. Adds Designer corrections for the change.
  - `checkRules(layout)`, `autoFix(layout)`, `toBraille(text)`, `svgToDataUrl(svg)`, `svgToPdf(svg) → Uint8Array`, `svgToPdfDataUrl(svg)`.
  - Rules: `label-gap` (≥ 3.2 mm from the curve or bar outline stroke edge), `stroke-hierarchy`, `label-overlap`, `label-in-page`, `label-axis-gap` (≥ 1.5 mm), `label-near-own-point` (point, value and category labels stay ≤ 15 mm from their own point and nearer it than any other key point; added at the orchestrator's request). On the demo parabola, the natural label positions really do hit the curve. The fixer moves root1, root2, turningPoint and yIntercept and logs a correction for each, e.g. `{agent:'Designer', field:'tactile.labels.turningPoint', before:{x,y}, after:{x,y}, reason:'Label 0 mm from the curve (needs 3.2 mm)…'}` (mm, label centre).
- **SVG conventions (A and E depend on these):** `width="277mm" height="190mm" viewBox="0 0 277 190"` (1 unit = 1 mm), `<title id="thinta-title">`, `<desc id="thinta-desc">` (has every key point in words). Key points: `<g class="key-point" data-kind="root|turning-point|y-intercept" data-x data-y data-key="A" data-name="root1">`, with **maths** coordinates. Bars: `<g class="bar" data-kind="bar" data-x="<index>" data-y="<value>" data-label data-texture>`. Curve: `<polyline id="curve" data-kind="curve" points=…>` in mm. `<g id="plot" data-x-min data-x-max data-y-min data-y-max data-left data-right data-top data-bottom data-x-axis-y data-y-axis-x>` maps mm back to maths. Labels: `<g class="label" data-name data-role data-braille data-print>`. Print text is a real `<text>` with an ASCII minus, e.g. `A (-2, 0)`. Braille is drawn as true-size circles (1.5 mm dots, 2.5/6 mm spacing), not a font, so resvg rasterises it without braille fonts.
- **Doing:** nothing. Done unless asked.
- **Blocked on:** nothing.
- **Interface changes requested:** none (the extra return fields are additive).

## C. Sound & Touch
- **Done:**
  - `src/thinta/sound/sonify.js` (pure, Node-safe): `sonify(proof) → {samples, keyPoints}` (roots, turning-point, y-intercept, or one `bar` per bar at x = 0, 1, 2 …; key points sorted by x), `pitchFor(y, [min,max])` (220–880 Hz, log scale), `yAt(samples, x)`, `nearestKeyPoint(x, keyPoints, tol)`, `crossedKeyPoints(fromX, toX, keyPoints)`, `yRange`, `turningKind`, `spokenNumber`, `describeKeyPoint`, `describeX`, `stopsFor`, `sweepPlan`.
  - `src/thinta/sound/audio-engine.js` (browser): `createAudioEngine()` (unlock on gesture incl. iOS silent-buffer trick, finger tone, ticks with distinct timbres per kind, stereo-panned `playSweep`, mute) plus `playSweep(sound, {durationMs})`, `vibrate(kind)`, `canVibrate()`.
  - `src/thinta/sound/TouchGraph.jsx` (default export) + `touch-graph.css`: `<TouchGraph job={job} durationMs={4000} />`. Uses `job.sound` if filled, else `sonify(job.proof)`. Drag to trace (pointer events, `touch-action: none`), key points tick + vibrate + `aria-live="assertive"` announcement. Screen reader path: native range slider (TalkBack/VoiceOver swipe up/down) stepping through a grid plus every key point, `aria-valuetext` reads x, y and the key point; buttons Play the whole curve/chart, Previous key point, Next key point, Mute. Shapes not colour (circle root, square turning point, triangle y-intercept), text ≥ 16 px, "Sound on" pill, "Vibration works on Android only" note when unsupported.
  - Dev page: `/src/thinta/sound/dev.html` (`?job=bar` for the bar chart). Needs Vite; at the time of testing the shared `vite.config.mjs` failed to load (`server/thinta/pipeline.mjs` imports files that did not exist yet), so I ran Vite with a bare config.
  - Tests: `node --test src/thinta/sound/*.test.js`: 13 pass.
  - Desktop check (built-in browser, 375 px mobile emulation): Web Audio context reaches `running` after a tap; drag announces the roots, y-intercept and turning point in order; Next/Previous and Play announce correctly; bar chart steps Jan → Feb → Mar; no console errors.
- **Doing:** nothing; ready for E to mount `<TouchGraph job={job}/>` in the Blind tab.
- **Blocked on:** the real Android phone for the go/no-go.
- **Interface changes requested:** none.
- **Phone go/no-go checklist (Vibration + Web Audio):**
  1. Android Chrome, media volume up, not on silent: open the Blind tab (or `/src/thinta/sound/dev.html` on the dev server). Pill says "Sound starts when you touch the graph".
  2. Drag a finger left to right: hear a smooth tone that falls then rises; pill turns to "Sound on". Page does not scroll while dragging.
  3. At x = −2 and x = 4: bright click + one short buzz. At (1, −9): low double "boop" + a long buzz pattern. At (0, −8): woodblock + double buzz. Announcement text updates.
  4. Tap "Play the whole curve": the curve plays in about 4 s, moving left ear to right ear on headphones, with ticks at the key points.
  5. TalkBack on: swipe to the "Explore x" slider, swipe up/down (or volume keys): each step reads "x …, y …" and lands exactly on "Root at x equals minus 2". Next/Previous key point buttons read the point. Dragging on the graph with TalkBack is not expected to work (TalkBack takes the gesture).
  6. Bar chart: each bar its own note, label read ("Jan, 120 mm. Bar 1 of 3").
  7. iPhone Safari: same, with the ring/silent switch OFF (Web Audio is muted on silent); the "Vibration works on Android only" note shows; VoiceOver swipe up/down moves the slider.
  Result: pending (needs the real phone).

## D. Explainer & Reviewer
- Done: `server/thinta/explainer.mjs`, `server/thinta/reviewer.mjs`, 10 tests (`node --test server/thinta/explainer.test.mjs server/thinta/reviewer.test.mjs`, all pass), live smoke script `server/thinta/smoke-d.mjs`.
- Exports:
  - `explain({proof, reading, feedback?, apiKey, fetchImpl, translate}) → {description:{en, zu}, deafSolution:{steps, keyTerms}, meaning:{description, deafSolution}, warnings}`. One Gemini call (25 s timeout) with the proof facts as the only allowed numbers. `meaning` is our own meaning check on the result (`{pass, problems}` each); if it fails, pass `feedbackFrom(meaning.description)` back in as `feedback`. `translate(text,'en','zu')` may return a string or `{text}`; on failure `zu` is `''` and `warnings` says why. Warns if numbers went missing in the isiZulu.
  - `speakDescription({description, speak}) → {en, zu}`: each is whatever `speak(text, lang)` returns, an array of clips if the text was over the 400-char `/api/speak` limit, or `null` on failure. Optional; skip when short of time.
  - `accessTest({version:'audio'|'deaf', text, proof, questions, apiKey, fetchImpl}) → {agent:'Reviewer', check:'access-audio'|'access-deaf', pass, score, total, failed:[{question, expected, got}], reason, answers}`. Gemini sees only `text`; grading is deterministic against `proof.answers`. Pass = score ≥ `LIMITS.accessPassMark` (scaled if not 5 questions). For the Deaf version pass `deafText(deafSolution)`.
  - `meaningCheck(text, proof) → {pass, problems:[{sentence, reason}]}`: deterministic. Checks turning point, roots, y-intercept claims (signed), above/below/less/greater than against the curve, and flags any number not derivable from the proof. Handles "negative 9", "minus two", unicode minus.
  - `feedbackFrom(reviewOrMeaning) → string[]` for `explain({feedback})`.
- Smoke: not run, no `.env.local` / `GEMINI_API_KEY` here. Orchestrator: `node server/thinta/smoke-d.mjs` runs thin description → access test → rewrite with feedback → re-test, plus the Deaf access test, and prints the "n/5 → n/5" loop.
- Blocked on: nothing. Interface changes requested: none (`explain` takes no `speak`; audio is the separate `speakDescription`).

## E. Phone UI & Trace
- Done: `/thinta` phone UI (`src/thinta/ThintaApp.jsx`, `thinta.css`, `ui/`, `replay/`). Snap screen (Take a photo with `capture="environment"`, Choose a picture, canvas downscale to 1600 px JPEG 0.85 with retry under the 3.5 MB limit, preview, optional equation, collapsible questions defaulting to `DEFAULT_QUESTIONS`). Live trace: incremental NDJSON reader, pipeline chips (icon + word for waiting/working/done/retry/failed/not run), `aria-live` log, corrections as `<del>` → `<ins>` with agent and reason, reviews with pass/fail and "3/5 → 5/5" or score/total and attempt. Non-200 JSON (e.g. the 501 without a key) and mid-stream drops show the error plus "Replay a recorded run". Result tabs: Blind (C's `TouchGraph` via guarded `import.meta.glob`, key points, EN + isiZulu description with Read aloud: POST `/api/speak` per ≤400-char chunk, `speechSynthesis` fallback, device voice only in replay; tactile preview as `<img>` data URL, SVG + PDF (B's `svgToPdf`, guarded) downloads only after approval). Deaf (large steps with "Picture:" visual, key terms as spaced letters, SASL reviewer note; `src/fingerspelling.js` is an ASL classifier, not a display, so not reused). Teacher (check summary, reviews, corrections, rule checks, calls/ms, Approve → `/api/thinta/approve`, "Approved by … at …", full trace). Replay: sticky "REPLAY · a saved run, not live" banner, plays `replay/recorded-*.json` if present else the contract example (labelled as example), original timing sped ×4 and capped, zero network calls (approval stays local). Focus moves to results when done. Tests: `node --test src/thinta/ui/*.test.js` (10 pass).
- Verified in the built-in browser at 375 px: live flow against a stub stream (lines split across chunks), correction/review rendering, all three tabs, approve + downloads, 501 and dropped-stream errors, replay from the error box with no network calls, Read aloud start/stop, no text under 16 px, no console errors. `npm run build` passes.
- Doing: nothing; available for polish.
- Blocked on: nothing.
- Interface notes: replay loader accepts a GraphJob, an array of events, or `{events:[{t, event}]}` in `src/thinta/replay/recorded-parabola.json` (F/orchestrator to drop it in). TouchGraph is used as `<TouchGraph job={job}/>` (default export). PDF: `svgToPdf(svg)` may return Blob, bytes or a URL string.

## F. QA & Demo
_not started_

## G. Dispatcher (stretch)
_not started_

---

# Fika (delivery add-on), branch `fika` from tag `thinta-submitted`

Brief: `0a4b5646-FIKA_DISPATCHER_BRIEF.md` in the session uploads. Rule one: every Thinta test and the Thinta demo must still pass after each commit.

## Fika contract (frozen)

- `src/thinta/contract.js`: `FIKA_AGENTS`, `ITEM_MACHINES` (tactile → swell or embosser; phone items need no machine), `ITEM_PAGES` (tactile = 2 sheets), `DISPATCH_STATUSES`, `validateDispatch`, `EXAMPLE_DISPATCH`. Dispatch also carries `graphJobId`, `clock` (simulated now) and `machines` (availability), and late jobs need a `lateReason`.
- `src/thinta/fika-demo-school.js`: `DEMO_SCHOOL` (demo values; clock starts Thu 19 Nov 13:00, lesson Fri 20 Nov 08:00, items due 07:30, machines only run 07:30–16:30 Mon–Fri), `DEMO_DEADLINE`, `DEMO_SCHOOLS`.
- Routes (stubbed, in `server/thinta.mjs` → `server/thinta/fika.mjs`; router and Vite middleware already cover `/api/thinta/*`, GET included):
  - `POST /api/thinta/dispatch` `{graphJobId, schoolId, approved:true}` → NDJSON (trace, correction, review, patch) ending `{type:'done', dispatch}`. 409 if not approved.
  - `POST /api/thinta/dispatch/event` `{graphJobId, kind:'machine-offline'|'machine-online'|'urgent'|'tick', machineId?, dispatch?}` → `{dispatch, corrections, trace}`. Send `dispatch` (the phone's last copy) too: Vercel instances don't share memory.
  - `GET /api/thinta/dispatch/:graphJobId` → `{dispatch}`.

### Module interfaces the orchestrator will call

| Owner | Module | Export |
|---|---|---|
| H | `src/thinta/fika/scheduler.js` | `planJobs(school, graphJobId, deadline) → DispatchJob[]`, `schedule(jobs, school, {clock, machines}) → {jobs, notes}`, `replan(dispatch, school, event) → {jobs, corrections}` |
| H | `src/thinta/fika/checker.js` | `checkSchedule(dispatch, school) → {pass, checks, problems}` |
| I | `server/thinta/fika/tracker.mjs` | `advance(dispatch, school, {toClock}) → {dispatch, events}` (simulated clock) |
| I | `server/thinta/fika/notifier.mjs` | `notify({dispatch, school, apiKey, fetchImpl, translate}) → {summary, numberCheck}` |
| J | `src/thinta/fika/DeliveryBoard.jsx` | `<DeliveryBoard job={job} />` mounted as a Delivery tab after approval |

## Fika orchestrator
- Done: tag `thinta-submitted`, branch `fika`, contract extension, demo school, stubbed routes + test. 124 tests pass.
- Doing: spawning H, I, J; then the real Fika pipeline in `server/thinta/fika.mjs`.
- Gemini budget: Kea's quota is limited. Sub-agents make **no** live Gemini calls; the orchestrator runs one live check.

## H. Scheduler & Checker
- Done (commit `H: working-hours time maths...`): `src/thinta/fika/time.js`, `scheduler.js`, `checker.js`, 16 tests (`node --test src/thinta/fika/*.test.js`). All Thinta tests still pass. Pure JS, no AI.
- Signatures:
  - `planJobs(school, graphJobId, deadline, clock = school.clockStart) → DispatchJob[]` ids `${graphJobId}-${learnerId}-${item}`; phone items `delivered`, `eta = clock`.
  - `schedule(jobs, school, {clock, machines?, avoid?, queueFrom?}) → {jobs, notes}`. `machines` = `[{id, online}]`; `avoid` = `[{jobId?, machineId}]`; `queueFrom` (default `school.clockStart`) is when other classes' queues started, so a later clock doesn't re-count them. Ready/delivered never move; printing stays unless its machine is offline.
  - `replan(dispatch, school, event) → {jobs, machines, clock, corrections, notes, event}`. Events: `machine-offline|machine-online {machineId}`, `urgent {learnerId?, pages=4, deadline=today 16:00, item='tactile'}`, anything else (`tick`) just recomputes; optional `at`, `avoid`. Corrections: one per changed `eta`/`machineId`/`status`, field `dispatch.jobs.<id>.<field>`, before/after ISO, plain-English reason. `event` is ready to push onto `dispatch.events`; store `machines`/`clock` back on the dispatch.
  - `checkSchedule(dispatch, school) → {pass, checks, problems, late}`; rules `capacity, offline, deadlines, coverage, phone-first, working-hours`. Late-with-reason passes `deadlines` (detail says "N late with a reason"); `late` lists them for the teacher flag.
  - Retry loop: `schedule(dispatch.jobs, school, {clock, machines, avoid: avoidFromProblems(problems)})` (from `checker.js`).
  - `time.js`: `addWorkingMinutes(iso, min, hours)`, `formatEta(iso) → 'Thu 14:34'`, `workingMinutesBetween`, `inWorkingHours`, `toIso`/`toMs`. Fixed +02:00 (SA has no DST).
- Demo school ETAs (clock Thu 13:00; embosser free 14:30, swell free 15:00):
  - Normal: all 4 prints on the embosser, Thu 14:34 / 14:38 / 14:42 / 14:46. Checker passes.
  - Embosser offline: all move to the swell heater, Thu 15:03 / 15:06 / 15:09 / 15:12 (8 corrections: eta + machineId each). Still on time.
  - Both offline: 4 prints `late`, "No tactile machine is online"; phone packs delivered; checker `late` = 4.
  - Urgent 4 pages for Learner C due Thu 16:00: embosser 14:30–14:38, others pushed to 14:42–14:54.
- Demo note (optional, no change needed): the embosser-offline strike-through is visible (Thu ~~14:34~~ → 15:03) but nothing becomes late. If you want "offline embosser → late on the swell heater, busy until Fri ...", give `swell-1` a queue of ~400 pages (it is then busy until Fri 14:00, and the reason reads "The braille embosser is offline and the swell-paper heater is busy until Fri 14:00").

## I. Tracker & Notifier
_not started_

## J. Delivery UI
_not started_

## K. QA & Replay
_not started (orchestrator runs it after integration)_
