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
| liblouis loads, or fallback table chosen | pending |
| Vibration + Web Audio on the demo Android phone | pending (needs the real phone) |

## Orchestrator

- Done: branch `thinta`, contract, Gemini helper, `/api/thinta/run` and `/approve` stubs (replay the example job), `/thinta` route placeholder, stub tests. Existing 54 tests still pass.
- Doing: real pipeline in `server/thinta.mjs` (Planner, step cap, retries, streaming).
- Blocked on: `GEMINI_API_KEY` in `.env.local` for live runs.

## A. Vision & Proof
_not started_

## B. Tactile Designer
_not started_

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
_not started_

## F. QA & Demo
_not started_

## G. Dispatcher (stretch)
_not started_
