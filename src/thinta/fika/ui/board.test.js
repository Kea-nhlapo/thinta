import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ITEM_LABELS, statusLabel, formatClock, weekdayName, initialBoard, applyFikaEvent, applyEventResult, etaJobId, latestEtaCorrections,
  groupByLearner, lateTactileJobs, uniqueReasons, phoneFallbacks, machineOnline, eventBody, fikaAgentStates, readableLog, replayPlan,
} from './board.js';
import { EXAMPLE_DISPATCH, DISPATCH_STATUSES } from '../../contract.js';
import { DEMO_SCHOOL } from '../../fika-demo-school.js';

const copy = () => structuredClone(EXAMPLE_DISPATCH);

test('every item and status has words', () => {
  assert.equal(ITEM_LABELS.tactile, 'Tactile print');
  assert.equal(ITEM_LABELS['phone-blind'], 'Phone pack: sound, touch and audio');
  assert.equal(ITEM_LABELS['deaf-solution'], 'Deaf step-by-step solution');
  for (const status of DISPATCH_STATUSES) {
    const [icon, word] = statusLabel(status);
    assert.ok(icon && /^[A-Z][a-z]+$/.test(word), status);
  }
});

test('formatClock shows the school day and time', () => {
  assert.equal(formatClock('2026-11-19T15:10:00+02:00'), 'Thu 15:10');
  assert.equal(formatClock('2026-11-20T06:10:00Z'), 'Fri 08:10');
  assert.equal(formatClock(''), '—');
  assert.equal(formatClock('soon'), 'soon');
  assert.equal(weekdayName(DEMO_SCHOOL.lesson.at), 'Friday');
});

test('stream events build the board and end with the dispatch', () => {
  let state = initialBoard();
  state = applyFikaEvent(state, { type: 'trace', entry: { t: 0, agent: 'Dispatcher', status: 'start', message: 'Planning' } });
  assert.equal(state.status, 'running');
  state = applyFikaEvent(state, { type: 'review', review: { agent: 'Schedule Checker', check: 'capacity', pass: true } });
  state = applyFikaEvent(state, { type: 'correction', correction: { agent: 'Dispatcher', field: 'dispatch.jobs.d2.eta', before: 'a', after: 'b', reason: 'r' } });
  state = applyFikaEvent(state, { type: 'patch', dispatch: { clock: 'x' } });
  assert.equal(state.dispatch.clock, 'x');
  state = applyFikaEvent(state, { type: 'done', dispatch: copy() });
  assert.equal(state.status, 'done');
  assert.equal(state.dispatch.jobs.length, 3);
  assert.deepEqual(state.log.map(l => l.kind), ['trace', 'review', 'correction']);
  assert.equal(state.corrections.length, 1);
  assert.equal(applyFikaEvent(state, { type: 'error', message: 'boom' }).error, 'boom');
  assert.equal(applyFikaEvent(state, null), state);
});

test('applyEventResult appends trace and corrections and swaps the dispatch', () => {
  const start = applyFikaEvent(initialBoard(), { type: 'done', dispatch: copy() });
  const next = copy();
  next.jobs[1].eta = '2026-11-20T08:10:00+02:00';
  const correction = { agent: 'Dispatcher', field: 'dispatch.jobs.d2.eta', before: '2026-11-19T15:10:00+02:00', after: next.jobs[1].eta, reason: 'Embosser offline' };
  const state = applyEventResult(start, { dispatch: next, corrections: [correction], trace: [{ t: 1, agent: 'Dispatcher', status: 'done', message: 'Replanned' }] });
  assert.equal(state.dispatch, next);
  assert.deepEqual(state.corrections, [correction]);
  assert.deepEqual(state.log.map(l => l.kind), ['trace', 'correction']);
  assert.equal(applyEventResult(state, {}), state);
});

test('latest ETA correction per job', () => {
  assert.equal(etaJobId('dispatch.jobs.d2.eta'), 'd2');
  assert.equal(etaJobId('jobs.d7.eta'), 'd7');
  assert.equal(etaJobId('dispatch.jobs.d2.status'), null);
  const map = latestEtaCorrections([
    { field: 'dispatch.jobs.d2.eta', after: 1 }, { field: 'reading.roots', after: 0 }, { field: 'dispatch.jobs.d2.eta', after: 2 }, { field: 'dispatch.jobs.d3.eta', after: 3 },
  ]);
  assert.equal(map.get('d2').after, 2);
  assert.equal(map.get('d3').after, 3);
  assert.equal(map.size, 2);
});

test('groupByLearner keeps the school order and keeps unknown learners', () => {
  const jobs = [...copy().jobs, { id: 'd9', learnerId: 'zz', item: 'tactile', status: 'queued' }];
  const groups = groupByLearner(jobs, DEMO_SCHOOL.learners);
  assert.deepEqual(groups.map(g => g.learner.name), ['Learner A', 'Learner D', 'zz']);
  assert.deepEqual(groups[0].jobs.map(j => j.id), ['d1', 'd2']);
});

test('late tactile prints, their reasons and the phone pack fallback', () => {
  const dispatch = copy();
  assert.deepEqual(lateTactileJobs(dispatch), []);
  dispatch.jobs[1] = { ...dispatch.jobs[1], status: 'late', lateReason: 'Both tactile machines are offline' };
  dispatch.jobs.push({ id: 'd5', learnerId: 'l2', item: 'tactile', status: 'late', lateReason: 'Both tactile machines are offline' });
  assert.equal(lateTactileJobs(dispatch).length, 2);
  assert.deepEqual(uniqueReasons(lateTactileJobs(dispatch)), ['Both tactile machines are offline']);
  assert.deepEqual(phoneFallbacks(dispatch).map(j => j.id), ['d1']);
});

test('machineOnline prefers what Fika last saw', () => {
  const dispatch = copy();
  assert.equal(machineOnline(dispatch, 'embosser-1', DEMO_SCHOOL), true);
  dispatch.machines[1].online = false;
  assert.equal(machineOnline(dispatch, 'embosser-1', DEMO_SCHOOL), false);
  assert.equal(machineOnline({ machines: [] }, 'swell-1', DEMO_SCHOOL), true);
});

test('eventBody always sends the dispatch, and a tick asks for one hour on', () => {
  const dispatch = copy();
  assert.deepEqual(eventBody({ graphJobId: 'g', kind: 'machine-offline', machineId: 'embosser-1', dispatch }), { graphJobId: 'g', kind: 'machine-offline', machineId: 'embosser-1', dispatch });
  const tick = eventBody({ graphJobId: 'g', kind: 'tick', dispatch });
  assert.equal(tick.dispatch, dispatch);
  assert.equal(tick.toClock, '2026-11-19T12:00:00.000Z');
  assert.equal('machineId' in eventBody({ graphJobId: 'g', kind: 'urgent', dispatch }), false);
});

test('fikaAgentStates follows the trace', () => {
  const log = [{ kind: 'trace', agent: 'Dispatcher', status: 'done' }, { kind: 'trace', agent: 'Schedule Checker', status: 'start' }, { kind: 'trace', agent: 'Planner', status: 'done' }];
  assert.deepEqual(fikaAgentStates(log), { Dispatcher: 'done', 'Schedule Checker': 'working', Tracker: 'waiting', Notifier: 'waiting' });
  assert.deepEqual(fikaAgentStates(log, 'done'), { Dispatcher: 'done', 'Schedule Checker': 'done', Tracker: 'skipped', Notifier: 'skipped' });
});

test('readableLog shows ETA corrections as day and time', () => {
  const log = [{ kind: 'correction', field: 'dispatch.jobs.d2.eta', before: '2026-11-19T15:10:00+02:00', after: '2026-11-20T08:10:00+02:00' }, { kind: 'correction', field: 'reading.roots', before: 1, after: 2 }];
  const out = readableLog(log);
  assert.equal(out[0].before, 'Thu 15:10');
  assert.equal(out[0].after, 'Fri 08:10');
  assert.equal(out[1], log[1]);
});

test('replayPlan accepts events, {events, actions} and a bare dispatch', () => {
  const dispatch = copy();
  const fromList = replayPlan([{ type: 'trace', entry: {} }, { t: 900, event: { type: 'done', dispatch } }]);
  assert.deepEqual(fromList.timeline.map(i => i.t), [300, 900]);
  const action = { kind: 'machine-offline', machineId: 'embosser-1', result: { dispatch, corrections: [], trace: [] } };
  const fromObject = replayPlan({ events: [{ type: 'done', dispatch }], actions: [action, { kind: 'tick' }] });
  assert.deepEqual(fromObject.actions, [action]);
  const bare = replayPlan(dispatch);
  assert.deepEqual(bare.timeline, [{ t: 0, event: { type: 'done', dispatch } }]);
  assert.deepEqual(replayPlan({ dispatch }).timeline[0].event.dispatch, dispatch);
  assert.deepEqual(replayPlan(null).timeline, []);
});
