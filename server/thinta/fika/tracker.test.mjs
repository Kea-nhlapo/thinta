import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, nextClock, boundaries, finish } from './tracker.mjs';
import { EXAMPLE_DISPATCH, DISPATCH_STATUSES, validateDispatch } from '../../../src/thinta/contract.js';
import { DEMO_SCHOOL } from '../../../src/thinta/fika-demo-school.js';

const G = 'example-parabola', DUE = '2026-11-20T07:30:00+02:00';
// The contract example plus a swell print, a late print that still finishes, and one that has no slot at all.
const dispatch = () => ({
  ...structuredClone(EXAMPLE_DISPATCH),
  jobs: [
    ...structuredClone(EXAMPLE_DISPATCH.jobs),
    { id: 'd4', graphJobId: G, learnerId: 'l3', item: 'tactile', pages: 2, deadline: DUE, machineId: 'swell-1', start: '2026-11-19T15:00:00+02:00', eta: '2026-11-19T15:03:00+02:00', status: 'queued' },
    { id: 'd5', graphJobId: G, learnerId: 'l6', item: 'tactile', pages: 2, deadline: DUE, machineId: 'embosser-1', start: '2026-11-20T07:30:00+02:00', eta: '2026-11-20T07:34:00+02:00', status: 'late', lateReason: 'The embosser queue runs past Fri 07:30' },
    { id: 'd6', graphJobId: G, learnerId: 'l2', item: 'tactile', pages: 2, deadline: DUE, status: 'late', lateReason: 'All tactile machines are offline' },
  ],
});
const rank = { queued: 0, late: 0, printing: 1, ready: 2, delivered: 2 };
const byId = d => Object.fromEntries(d.jobs.map(j => [j.id, j]));

test('a clock sweep moves queued → printing → ready, never backwards, and never touches eta or machine', () => {
  let d = dispatch();
  const before = byId(d);
  const seen = [];
  for (let m = 0; m <= 24 * 60; m += 7) {
    const prev = byId(d);
    const out = advance(d, DEMO_SCHOOL, { toClock: nextClock(d, { minutes: 7 }) });
    d = out.dispatch;
    seen.push(...out.events);
    for (const job of d.jobs) {
      assert.ok(DISPATCH_STATUSES.includes(job.status));
      assert.ok(rank[job.status] >= rank[prev[job.id].status], `${job.id} went backwards`);
      assert.equal(job.eta, before[job.id].eta);
      assert.equal(job.machineId, before[job.id].machineId);
    }
  }
  const mid = byId(advance(dispatch(), DEMO_SCHOOL, { toClock: '2026-11-19T14:32:00+02:00' }).dispatch);
  assert.equal(mid.d2.status, 'printing');
  assert.equal(mid.d4.status, 'queued');
  const after = byId(d);
  assert.equal(after.d1.status, 'delivered');
  assert.equal(after.d3.status, 'delivered');
  assert.equal(after.d2.status, 'ready');
  assert.equal(after.d4.status, 'ready');
  // The late print finished: ready, but it keeps its reason and a note that it missed the deadline.
  assert.equal(after.d5.status, 'ready');
  assert.equal(after.d5.lateReason, 'The embosser queue runs past Fri 07:30');
  assert.match(after.d5.lateNote, /after the deadline/);
  // No slot at all: stays late with its reason.
  assert.equal(after.d6.status, 'late');
  assert.equal(after.d6.lateReason, 'All tactile machines are offline');
  assert.deepEqual(validateDispatch(d), []);
  assert.deepEqual(seen.map(e => e.detail), [
    "Learner A's tactile print is ready on the embosser",
    "Learner C's tactile print is ready on the swell-paper heater",
    "Learner F's tactile print is ready on the embosser, after the deadline (Fri 07:30)",
  ]);
  assert.ok(seen.every(e => e.kind === 'job-done' && e.t));
  assert.equal(d.events.length, 3);
});

test('one big jump gives the same final statuses, events in time order, and the clock never goes back', () => {
  const stepped = (() => { let d = dispatch(); for (let t; (t = nextClock(d));) d = advance(d, DEMO_SCHOOL, { toClock: t }).dispatch; return d; })();
  const { dispatch: jumped, events } = finish(dispatch(), DEMO_SCHOOL);
  assert.deepEqual(jumped.jobs, stepped.jobs);
  assert.deepEqual(events.map(e => e.jobId), ['d2', 'd4', 'd5']);
  assert.equal(nextClock(jumped), null);
  const back = advance(jumped, DEMO_SCHOOL, { toClock: '2026-11-19T13:00:00+02:00' });
  assert.equal(back.dispatch.clock, jumped.clock);
  assert.deepEqual(back.events, []);
});

test('nextClock steps by minutes, by speed, or to the next boundary', () => {
  const d = dispatch();
  assert.equal(nextClock(d, { minutes: 30 }), '2026-11-19T13:30:00+02:00');
  assert.equal(nextClock(d, { speed: 60, realSeconds: 2 }), '2026-11-19T15:00:00+02:00');
  assert.equal(nextClock(d), '2026-11-19T14:30:00+02:00');
  assert.equal(nextClock(d, { to: 'end' }), '2026-11-20T07:34:00+02:00');
  assert.equal(boundaries(d).length, 6);
});

test('a print on an offline machine does not progress until the Dispatcher replans it', () => {
  const d = dispatch();
  d.machines = d.machines.map(m => (m.id === 'embosser-1' ? { ...m, online: false } : m));
  const { dispatch: out } = advance(d, DEMO_SCHOOL, { toClock: '2026-11-19T16:00:00+02:00' });
  assert.equal(byId(out).d2.status, 'queued');
  assert.equal(byId(out).d4.status, 'ready');
  assert.equal(d.jobs[1].status, 'queued', 'input is not mutated');
});
