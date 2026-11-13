import test from 'node:test';
import assert from 'node:assert/strict';
import { notify, numberCheck, deliveryFacts, templateSummary, notifyPrompt } from './notifier.mjs';
import { EXAMPLE_DISPATCH } from '../../../src/thinta/contract.js';
import { DEMO_SCHOOL, DEMO_DEADLINE } from '../../../src/thinta/fika-demo-school.js';
import { planJobs, schedule, replan } from '../../../src/thinta/fika/scheduler.js';
import { formatEta } from '../../../src/thinta/fika/time.js';
import { finish } from './tracker.mjs';

const G = 'example-parabola', DUE = '2026-11-20T07:30:00+02:00', NOW = '2026-11-19T13:00:00+02:00';
const phone = (id, learnerId, item = 'phone-blind') => ({ id, graphJobId: G, learnerId, item, pages: 0, deadline: DUE, eta: NOW, status: 'delivered' });
const print = (id, learnerId, machineId, start, eta, status = 'queued') => ({ id, graphJobId: G, learnerId, item: 'tactile', pages: 2, deadline: DUE, machineId, start, eta, status });
// Demo school, normal day: 5 learners have their phone items, 4 tactile prints on two machines, the last at Thu 15:10.
const normal = () => ({
  ...structuredClone(EXAMPLE_DISPATCH),
  jobs: [phone('p1', 'l1'), phone('p2', 'l2'), phone('p6', 'l6'), phone('p4', 'l4', 'deaf-solution'), phone('p5', 'l5', 'deaf-solution'),
    print('t1', 'l1', 'embosser-1', '2026-11-19T14:30:00+02:00', '2026-11-19T14:34:00+02:00', 'ready'),
    print('t2', 'l2', 'swell-1', '2026-11-19T15:00:00+02:00', '2026-11-19T15:03:00+02:00'),
    print('t3', 'l3', 'swell-1', '2026-11-19T15:03:00+02:00', '2026-11-19T15:06:00+02:00'),
    print('t6', 'l6', 'embosser-1', '2026-11-19T15:06:00+02:00', '2026-11-19T15:10:00+02:00')],
});
// All tactile machines offline: no print has a slot, the phone packs are the fallback.
const allOffline = () => {
  const d = normal();
  d.machines = d.machines.map(m => (m.id === 'printer-1' ? m : { ...m, online: false }));
  d.jobs = d.jobs.map(j => (j.item === 'tactile' ? { ...j, machineId: undefined, start: undefined, eta: undefined, status: 'late', lateReason: 'All tactile machines are offline' } : j));
  return d;
};

const GOOD = 'Phone packs are with 5 learners now. 1 of 4 tactile prints is ready, and the other 3 will be ready by Thu 15:10, well before the Fri 08:00 lesson. Nothing is late.';
// Fake Gemini: answers each call with the next summary in the list; records prompts.
const gemini = (summaries, seen = []) => async (url, init) => {
  seen.push(JSON.parse(init.body).contents[0].parts[0].text);
  const summary = summaries[Math.min(seen.length - 1, summaries.length - 1)];
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ summary }) }] } }] }) };
};
const zulu = async text => ({ text: `[zu] ${text}` });

test('facts come from the dispatch: counts, latest ETA, lesson time', () => {
  const f = deliveryFacts(normal(), DEMO_SCHOOL);
  assert.equal(f.phoneLearners, 5);
  assert.equal(f.prints, 4);
  assert.equal(f.printsReady, 1);
  assert.equal(f.printsComing, 3);
  assert.equal(f.latestEta, 'Thu 15:10');
  assert.deepEqual(f.lesson, { title: 'Grade 10 maths: parabolas', at: 'Fri 08:00', day: 'Friday' });
  assert.equal(f.ready, 6);
  assert.equal(f.lateCount, 0);
  assert.equal(f.cannotMeet, false);
  const prompt = notifyPrompt(f);
  assert.match(prompt, /ONLY numbers, times and days/);
  assert.match(prompt, /ready at Thu 15:10/);
  assert.doesNotMatch(prompt, /FAILED/);
});

test('the number check reads digits, spoken times, am/pm and day names', () => {
  const f = deliveryFacts(normal(), DEMO_SCHOOL);
  assert.deepEqual(numberCheck(GOOD, f), { pass: true, problems: [] });
  assert.equal(numberCheck('The last print is ready at 3:10 pm on Thursday.', f).pass, true);
  assert.equal(numberCheck('The last print is ready at 15h10.', f).pass, true);
  assert.deepEqual(numberCheck('The last print is ready at 3:15 pm.', f).problems, ['the time 15:15 is not in the facts']);
  assert.deepEqual(numberCheck('Phone packs are with 7 learners.', f).problems, ['the number 7 is not in the facts']);
  assert.deepEqual(numberCheck('Phone packs are with six learners.', f).problems, ['the number 6 is not in the facts']);
  assert.deepEqual(numberCheck('Everything is ready by Wednesday.', f).problems, ['Wednesday is not a day in the facts']);
  // The contract's example text matches its own dispatch.
  assert.equal(numberCheck(EXAMPLE_DISPATCH.summary.en, deliveryFacts(EXAMPLE_DISPATCH, DEMO_SCHOOL)).pass, true);
});

test('a correct Gemini summary passes first time; ready and late come from the dispatch', async () => {
  const seen = [];
  const out = await notify({ dispatch: normal(), school: DEMO_SCHOOL, apiKey: 'k', fetchImpl: gemini([GOOD], seen), translate: zulu });
  assert.equal(seen.length, 1);
  assert.equal(out.source, 'gemini');
  assert.deepEqual(out.summary, { en: GOOD, zu: `[zu] ${GOOD}`, ready: 6, late: 0 });
  assert.deepEqual(out.numberCheck, { pass: true, problems: [] });
  assert.deepEqual(out.warnings, []);
});

test('a wrong time fails the check and the retry carries the problem as feedback', async () => {
  const seen = [];
  const out = await notify({ dispatch: normal(), school: DEMO_SCHOOL, apiKey: 'k', fetchImpl: gemini([GOOD.replace('15:10', '15:40'), GOOD], seen), translate: zulu });
  assert.equal(seen.length, 2);
  assert.match(seen[1], /FAILED THE NUMBER CHECK[\s\S]*the time 15:40 is not in the facts/);
  assert.equal(out.source, 'gemini');
  assert.equal(out.summary.en, GOOD);
  assert.equal(out.numberCheck.pass, true);
});

test('a wrong count twice falls back to the fixed template, and says so', async () => {
  const seen = [];
  const out = await notify({ dispatch: normal(), school: DEMO_SCHOOL, apiKey: 'k', fetchImpl: gemini([GOOD.replace('5 learners', '7 learners')], seen), translate: zulu });
  assert.equal(seen.length, 2);
  assert.equal(out.source, 'template');
  assert.equal(out.summary.en, 'Phone packs and plain-language solutions are with 5 learners now. Tactile prints ready: 1 of 4; 3 more by Thu 15:10, before the Fri 08:00 lesson.');
  assert.equal(out.numberCheck.pass, true);
  assert.match(out.warnings[0], /fixed template.*the number 7 is not in the facts/);
});

test('no API key: the template, with no network at all', async () => {
  const out = await notify({ dispatch: normal(), school: DEMO_SCHOOL, apiKey: '', fetchImpl: () => { throw new Error('no network in this test'); } });
  assert.equal(out.source, 'template');
  assert.equal(out.numberCheck.pass, true);
  assert.equal(out.summary.zu, '');
  assert.deepEqual(out.summary.ready, 6);
  assert.match(out.warnings[0], /fixed template: Set GEMINI_API_KEY/);
  assert.match(out.warnings[1], /isiZulu translation not available/);
});

test('Gemini errors and translation failures degrade with warnings', async () => {
  const down = async () => ({ ok: false, status: 503, text: async () => 'overloaded' });
  const out = await notify({ dispatch: normal(), school: DEMO_SCHOOL, apiKey: 'k', fetchImpl: down, translate: async () => { throw new Error('gateway down'); } });
  assert.equal(out.source, 'template');
  assert.equal(out.summary.zu, '');
  assert.match(out.warnings.join('\n'), /fixed template[\s\S]*isiZulu translation failed: gateway down/);
});

test('all tactile machines offline: honest failure wording, phone pack as the fallback', async () => {
  const f = deliveryFacts(allOffline(), DEMO_SCHOOL);
  assert.equal(f.cannotMeet, true);
  assert.deepEqual(f.fallback, ['Learner A', 'Learner B', 'Learner F']);
  const text = templateSummary(f);
  assert.equal(text, "Phone packs and plain-language solutions are with 5 learners now. Tactile prints ready: 0 of 4. Can't meet Friday's lesson. Flagged for the teacher. Late for Learner A, Learner B, Learner C and Learner F: All tactile machines are offline. The phone pack was delivered as the fallback for Learner A, Learner B and Learner F.");
  assert.equal(numberCheck(text, f).pass, true);
  // Gemini hiding the failure (no "can't meet", a late learner left out) is caught.
  const soft = 'Phone packs are with 5 learners. The tactile prints are delayed for Learner A, Learner B and Learner F.';
  assert.deepEqual(numberCheck(soft, f).problems, ['Learner C is late but not named', 'the summary must say "Can\'t meet Friday\'s lesson. Flagged for the teacher"']);
  const out = await notify({ dispatch: allOffline(), school: DEMO_SCHOOL, apiKey: 'k', fetchImpl: gemini([soft]), translate: zulu });
  assert.equal(out.source, 'template');
  assert.match(out.summary.en, /Can't meet Friday's lesson\. Flagged for the teacher/);
  assert.deepEqual([out.summary.ready, out.summary.late], [5, 4]);
});

test('a print that finishes after the deadline is ready but still reported late', () => {
  const d = normal();
  d.jobs[8] = { ...d.jobs[8], start: '2026-11-20T07:30:00+02:00', eta: '2026-11-20T07:34:00+02:00', status: 'ready', lateReason: 'The embosser queue runs past Fri 07:30' };
  const f = deliveryFacts(d, DEMO_SCHOOL);
  assert.equal(f.cannotMeet, false);
  assert.deepEqual([f.ready, f.lateCount], [7, 1]);
  const text = templateSummary(f);
  assert.match(text, /Late for Learner F \(ready at Fri 07:34\): The embosser queue runs past Fri 07:30\./);
  assert.equal(numberCheck(text, f).pass, true);
});

test("H's real scheduler output: on time, tracked to the end, then every tactile machine offline", async () => {
  const jobs = schedule(planJobs(DEMO_SCHOOL, G, DEMO_DEADLINE), DEMO_SCHOOL, {}).jobs;
  let d = { schoolId: DEMO_SCHOOL.id, graphJobId: G, clock: DEMO_SCHOOL.clockStart, machines: DEMO_SCHOOL.machines.map(m => ({ id: m.id, online: true })), jobs, checks: [], events: [], summary: { en: '', zu: '', ready: 0, late: 0 } };
  const latest = formatEta(jobs.filter(j => j.eta).map(j => j.eta).sort().pop());
  const start = await notify({ dispatch: d, school: DEMO_SCHOOL });
  assert.equal(start.summary.en, `Phone packs and plain-language solutions are with 5 learners now. Tactile prints ready: 0 of 4; all 4 by ${latest}, before the Fri 08:00 lesson.`);
  assert.equal(start.numberCheck.pass, true);
  const done = finish(d, DEMO_SCHOOL);
  assert.equal(done.events.length, 4);
  assert.equal((await notify({ dispatch: done.dispatch, school: DEMO_SCHOOL })).summary.en, 'Phone packs and plain-language solutions are with 5 learners now. Tactile prints ready: 4 of 4.');
  for (const machineId of ['embosser-1', 'swell-1']) { const r = replan(d, DEMO_SCHOOL, { kind: 'machine-offline', machineId }); d = { ...d, jobs: r.jobs, machines: r.machines }; }
  const out = await notify({ dispatch: d, school: DEMO_SCHOOL });
  assert.match(out.summary.en, /Can't meet Friday's lesson\. Flagged for the teacher\. Late for Learner A, Learner B, Learner C and Learner F: .+\. The phone pack was delivered as the fallback for Learner A, Learner B and Learner F\./);
  assert.equal(out.numberCheck.pass, true);
  assert.deepEqual([out.summary.ready, out.summary.late], [5, 4]);
});
