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
| Gemini reads a phone photo of the parabola into `reading` | pending |
| Gemini reads a rendered tactile SVG back (fresh eyes) | pending |
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
_not started_

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
