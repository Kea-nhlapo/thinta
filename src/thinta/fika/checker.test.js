import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DEADLINE, DEMO_SCHOOL as S } from '../fika-demo-school.js';
import { planJobs, schedule } from './scheduler.js';
import { avoidFromProblems, checkSchedule } from './checker.js';

const base = () => ({
  schoolId: S.id, graphJobId: 'g1', clock: S.clockStart, machines: S.machines.map(m => ({ id: m.id, online: true })),
  jobs: schedule(planJobs(S, 'g1', DEMO_DEADLINE), S, { clock: S.clockStart }).jobs, checks: [], events: [], summary: {},
});
const edit = (d, id, patch) => ({ ...d, jobs: d.jobs.map(j => (j.id === id ? { ...j, ...patch } : j)) });
const failed = r => r.checks.filter(c => !c.pass).map(c => c.rule);

test('the scheduler output passes every rule', () => {
  const r = checkSchedule(base(), S);
  assert.deepEqual(r.checks.map(c => c.rule), ['capacity', 'offline', 'deadlines', 'coverage', 'phone-first', 'working-hours']);
  assert.equal(r.pass, true);
});

test('catches a hand-made double-booking', () => {
  const r = checkSchedule(edit(base(), 'g1-l2-tactile', { start: '2026-11-19T14:32:00+02:00', eta: '2026-11-19T14:36:00+02:00' }), S);
  assert.deepEqual(failed(r), ['capacity']);
  assert.ok(r.problems.some(p => /overlap/.test(p.reason) && p.jobId === 'g1-l2-tactile' && p.machineId === 'embosser-1'));
});

test('catches a job printed faster than the machine can go, or before its queued work', () => {
  const fast = checkSchedule(edit(base(), 'g1-l6-tactile', { pages: 20 }), S);
  assert.match(fast.problems[0].reason, /20 pages need 40\.0 min/);
  const early = checkSchedule(edit(base(), 'g1-l1-tactile', { start: '2026-11-19T13:00:00+02:00', eta: '2026-11-19T13:04:00+02:00' }), S);
  assert.ok(early.problems.some(p => /before the Braille embosser's queued work ends/.test(p.reason)));
  assert.equal(early.pass, false);
});

test('catches a job left on an offline machine, and the problem feeds back into schedule()', () => {
  const d = base();
  d.machines = d.machines.map(m => (m.id === 'embosser-1' ? { ...m, online: false } : m));
  const r = checkSchedule(d, S);
  assert.deepEqual(failed(r), ['offline']);
  assert.equal(r.problems.length, 4);
  const avoid = avoidFromProblems(r.problems);
  assert.deepEqual(avoid[0], { jobId: 'g1-l1-tactile', machineId: 'embosser-1' });
  const retry = { ...d, jobs: schedule(d.jobs, S, { clock: d.clock, machines: d.machines, avoid }).jobs };
  assert.equal(checkSchedule(retry, S).pass, true);
});

test('catches a missing learner item, an undelivered phone pack and an unflagged late print', () => {
  const d = base();
  const r = checkSchedule({ ...d, jobs: d.jobs.filter(j => j.id !== 'g1-l3-tactile') }, S);
  assert.deepEqual(failed(r), ['coverage']);
  assert.match(r.problems[0].reason, /Learner C has no tactile job/);
  assert.deepEqual(failed(checkSchedule(edit(d, 'g1-l1-phone-blind', { status: 'queued' }), S)), ['phone-first']);
  const late = checkSchedule(edit(d, 'g1-l1-tactile', { deadline: '2026-11-19T14:00:00+02:00' }), S);
  assert.deepEqual(failed(late), ['deadlines']);
  assert.deepEqual(failed(checkSchedule(edit(d, 'g1-l1-tactile', { status: 'late' }), S)), ['deadlines']);
});

test('catches printing outside school hours', () => {
  const r = checkSchedule(edit(base(), 'g1-l6-tactile', { start: '2026-11-19T16:28:00+02:00', eta: '2026-11-19T16:40:00+02:00' }), S);
  assert.ok(failed(r).includes('working-hours'));
});
