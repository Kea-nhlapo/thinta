// Fika: after the teacher approves a Thinta pack, the Dispatcher plans delivery and schedules the tactile prints,
// the Schedule Checker validates the schedule (sending it back up to 2 times), the Tracker runs the simulated clock
// and the Notifier tells the teacher. Phone packs are delivered at once; only tactile prints wait on machines.
// Agents are injected (deps) so tests run with fakes; defaults load H's scheduler/checker and I's tracker/notifier.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, ITEM_MACHINES } from '../../src/thinta/contract.js';
import { DEMO_SCHOOLS, DEMO_DEADLINE } from '../../src/thinta/fika-demo-school.js';

// State lives in memory per graph job; locally it is also written to a JSON file so a dev-server restart keeps it.
// On Vercel, instances do not share memory, so callers may send their last copy of the dispatch with each event.
const FILE = join(tmpdir(), 'thinta-dispatch.json');
const store = new Map(Object.entries((() => { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return {}; } })()));
const save = () => { try { writeFileSync(FILE, JSON.stringify(Object.fromEntries(store))); } catch { /* read-only file system on Vercel */ } };

export const getDispatch = graphJobId => store.get(graphJobId) || null;
export function putDispatch(dispatch) { store.set(dispatch.graphJobId, dispatch); save(); return dispatch; }

export async function defaultFikaDeps() {
  const [scheduler, checker, tracker, notifier] = await Promise.all([
    import('../../src/thinta/fika/scheduler.js'), import('../../src/thinta/fika/checker.js'),
    import('./fika/tracker.mjs'), import('./fika/notifier.mjs'),
  ]);
  return { ...scheduler, ...checker, ...tracker, ...notifier };
}

// A school's machines as Fika sees them, with availability from the dispatch when it has changed.
const schoolNow = (school, dispatch) => ({ ...school, machines: school.machines.map(m => ({ ...m, online: dispatch?.machines?.find(x => x.id === m.id)?.online ?? m.online })) });
const isPrinted = job => ITEM_MACHINES[job.item]?.length > 0;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function recorder(clock) {
  const events = [];
  const trace = [];
  const corrections = [];
  const started = Date.now();
  return {
    events, trace, corrections,
    trace_(agent, status, message) { const entry = { t: Date.now() - started, agent, status, message, clock: clock() }; trace.push(entry); events.push({ type: 'trace', entry }); },
    correct(c) { corrections.push(c); events.push({ type: 'correction', correction: c }); },
    review(r) { events.push({ type: 'review', review: r }); },
  };
}

// Schedule Checker loop: schedule, check, and on failure send the problems back to the Dispatcher (max 2 retries).
function scheduleChecked(deps, rec, jobs, school, clock, reviews) {
  let avoid = [];
  let result;
  for (let attempt = 0; attempt <= LIMITS.maxRetries; attempt++) {
    result = deps.schedule(jobs, school, { clock, machines: school.machines, avoid });
    (result.notes || []).forEach(note => rec.trace_('Dispatcher', 'done', note));
    const draft = { jobs: result.jobs, machines: school.machines.map(({ id, online }) => ({ id, online })), clock };
    const check = deps.checkSchedule(draft, school);
    const review = { agent: 'Schedule Checker', check: 'schedule', pass: check.pass, attempt, reason: check.pass ? `${check.checks.length} checks pass` : check.problems.map(p => p.reason).join('; '), checks: check.checks };
    reviews.push(review);
    rec.review(review);
    if (check.pass) { rec.trace_('Schedule Checker', 'done', `${check.checks.filter(c => c.pass).length}/${check.checks.length} checks pass: capacity, deadlines, no machine double-booked`); return { jobs: result.jobs, checks: check.checks }; }
    if (attempt === LIMITS.maxRetries) { rec.trace_('Schedule Checker', 'fail', `Still failing after ${attempt} reschedules: ${review.reason}. Flagged for the teacher`); return { jobs: result.jobs, checks: check.checks }; }
    rec.trace_('Schedule Checker', 'retry', `Sent back to the Dispatcher: ${review.reason}`);
    avoid = deps.avoidFromProblems ? deps.avoidFromProblems(check.problems) : check.problems;
  }
  return { jobs: result.jobs, checks: [] };
}

function lateNotes(rec, jobs, school) {
  const late = jobs.filter(j => j.status === 'late');
  if (!late.length) return;
  // The lesson day in South African time (fixed UTC+2), e.g. "Friday's lesson".
  const day = new Date(Date.parse(school.lesson.at) + 2 * 3600_000).toLocaleDateString('en-ZA', { weekday: 'long', timeZone: 'UTC' });
  rec.trace_('Dispatcher', 'fail', `Can't meet ${day}'s lesson for ${plural(late.length, 'tactile print')}: ${[...new Set(late.map(j => j.lateReason))].join('; ')}. Flagged for the teacher; the phone pack is the fallback`);
}

async function summarise(deps, rec, dispatch, school, ctx) {
  rec.trace_('Notifier', 'start', 'Writing the teacher summary');
  const { summary, numberCheck, warnings = [] } = await deps.notify({ dispatch, school, ...ctx });
  warnings.forEach(w => rec.trace_('Notifier', 'fail', w));
  if (numberCheck) rec.review({ agent: 'Schedule Checker', check: 'summary-numbers', pass: numberCheck.pass, reason: numberCheck.pass ? 'Every number in the summary matches the schedule' : numberCheck.problems.map(p => p.reason || p).join('; ') });
  rec.trace_('Notifier', 'done', `Summary: ${summary.ready} ready, ${summary.late} late${summary.zu ? ', in English and isiZulu' : ''}`);
  return summary;
}

// Plans delivery for an approved pack. Yields stream events and ends with {type:'done', dispatch}.
export async function* runDispatch({ graphJobId, schoolId, apiKey, translate, fetchImpl, deps }) {
  const school = DEMO_SCHOOLS[schoolId];
  if (!school) { yield { type: 'error', message: 'Unknown school.' }; return; }
  const clock = school.clockStart;
  const rec = recorder(() => clock);
  const flush = function* () { while (rec.events.length) yield rec.events.shift(); };
  try {
    deps = deps || await defaultFikaDeps();
    const learners = school.learners.length;
    rec.trace_('Dispatcher', 'start', `Planning delivery for ${plural(learners, 'learner')} before ${school.lesson.title}`);
    const planned = deps.planJobs(school, graphJobId, DEMO_DEADLINE);
    const phone = planned.filter(j => !isPrinted(j));
    rec.trace_('Dispatcher', 'done', `${plural(phone.length, 'phone pack')} delivered now; ${plural(planned.length - phone.length, 'tactile print')} to schedule on ${school.machines.filter(m => m.online).length} machines`);
    yield* flush();
    const reviews = [];
    const { jobs, checks } = scheduleChecked(deps, rec, planned, school, clock, reviews);
    lateNotes(rec, jobs, school);
    yield* flush();
    let dispatch = { schoolId, graphJobId, clock, machines: school.machines.map(({ id, online }) => ({ id, online })), jobs, checks, events: [], summary: { en: '', zu: '', ready: 0, late: 0 } };
    yield { type: 'patch', dispatch };
    dispatch.summary = await summarise(deps, rec, dispatch, school, { apiKey, translate, fetchImpl });
    putDispatch(dispatch);
    yield* flush();
    yield { type: 'done', dispatch: { ...dispatch, trace: rec.trace, corrections: rec.corrections, reviews } };
  } catch (error) {
    rec.trace_('Dispatcher', 'fail', error.message);
    yield* flush();
    yield { type: 'error', message: error.message };
  }
}

// Replans after an event and returns {dispatch, corrections, trace, reviews}. 'tick' advances the demo clock an hour.
export async function dispatchEvent({ graphJobId, kind, machineId, dispatch: sent, apiKey, translate, fetchImpl, deps }) {
  const current = getDispatch(graphJobId) || (sent?.graphJobId === graphJobId ? sent : null);
  if (!current) return null;
  if (!DEMO_SCHOOLS[current.schoolId]) return null;
  const school = schoolNow(DEMO_SCHOOLS[current.schoolId], current);
  deps = deps || await defaultFikaDeps();
  let clock = current.clock;
  const rec = recorder(() => clock);
  const reviews = [];
  let next = structuredClone(current);
  delete next.trace; delete next.corrections; delete next.reviews;

  if (kind === 'tick') {
    const toClock = deps.nextClock ? deps.nextClock(next, { minutes: 60, school }) : new Date(Date.parse(clock) + 3600_000).toISOString();
    const { dispatch: advanced, events } = deps.advance(next, school, { toClock });
    next = advanced;
    clock = next.clock = advanced.clock || toClock;
    next.events = [...(current.events || []), ...events];
    rec.trace_('Tracker', 'done', events.length ? events.map(e => e.detail).join('. ') : 'Clock moved on; nothing finished in that hour');
  } else {
    const machine = school.machines.find(m => m.id === machineId);
    if (kind !== 'urgent' && !machine) return null;
    const event = { t: clock, kind, machineId, detail: kind === 'urgent' ? 'An urgent pack was added' : `${machine.name} went ${kind === 'machine-offline' ? 'offline' : 'online'}` };
    rec.trace_('Tracker', 'done', event.detail);
    const replanned = deps.replan(next, school, event);
    (replanned.notes || []).forEach(note => rec.trace_('Dispatcher', 'done', note));
    replanned.corrections.forEach(c => rec.correct(c));
    // The scheduler returns the machines' new availability; fall back to applying the event ourselves.
    const machines = replanned.machines || school.machines.map(m => ({ id: m.id, online: m.id === machineId ? kind === 'machine-online' : m.online }));
    const updated = schoolNow(school, { machines });
    next = { ...next, jobs: replanned.jobs, machines: machines.map(({ id, online }) => ({ id, online })), clock: replanned.clock || next.clock, events: [...(current.events || []), { ...event, ...(replanned.event || {}) }] };
    rec.trace_('Dispatcher', 'done', replanned.corrections.length ? `Replanned: ${plural(replanned.corrections.length, 'change')}` : 'Replanned: nothing had to move');
    const check = deps.checkSchedule(next, updated);
    next.checks = check.checks;
    const review = { agent: 'Schedule Checker', check: 'schedule', pass: check.pass, reason: check.pass ? `${check.checks.length} checks pass` : check.problems.map(p => p.reason).join('; '), checks: check.checks };
    reviews.push(review);
    rec.review(review);
    rec.trace_('Schedule Checker', check.pass ? 'done' : 'fail', check.pass ? 'The new schedule passes every check' : `${review.reason}. Flagged for the teacher`);
    lateNotes(rec, next.jobs, school);
  }
  // A clock tick where nothing finished changes no facts, so the last summary stands (and costs no Gemini call).
  const unchanged = kind === 'tick' && next.events.length === (current.events || []).length && current.summary?.en;
  if (unchanged) rec.trace_('Notifier', 'done', 'Nothing new to tell the teacher');
  else next.summary = await summarise(deps, rec, next, school, { apiKey, translate, fetchImpl });
  putDispatch(next);
  return { dispatch: next, corrections: rec.corrections, trace: rec.trace, reviews };
}
