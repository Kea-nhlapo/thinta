import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDispatch } from '../contract.js';
import { DEMO_DEADLINE, DEMO_SCHOOL as S } from '../fika-demo-school.js';
import { planJobs, replan, schedule } from './scheduler.js';
import { checkSchedule } from './checker.js';
import { addWorkingMinutes, formatEta, inWorkingHours, workingMinutesBetween } from './time.js';

const H = S.hours;
const tactile = jobs => jobs.filter(j => j.item === 'tactile');
const etas = jobs => tactile(jobs).map(j => `${j.learnerId}:${j.machineId || '-'}:${j.eta ? formatEta(j.eta) : '-'}`);
const dispatchOf = (jobs, machines = S.machines.map(m => ({ id: m.id, online: true }))) => ({
  schoolId: S.id, graphJobId: 'g1', clock: S.clockStart, machines, jobs, checks: [], events: [], summary: { en: '', zu: '', ready: 0, late: 0 },
});
const normal = () => dispatchOf(schedule(planJobs(S, 'g1', DEMO_DEADLINE), S, { clock: S.clockStart }).jobs);

test('time: work carries over the 16:30 close to 07:30 the next weekday', () => {
  assert.equal(addWorkingMinutes('2026-11-19T16:00:00+02:00', 45, H), '2026-11-20T07:45:00+02:00');
  assert.equal(addWorkingMinutes('2026-11-19T16:00:00+02:00', 30, H), '2026-11-19T16:30:00+02:00');
  assert.equal(addWorkingMinutes('2026-11-19T18:00:00+02:00', 10, H), '2026-11-20T07:40:00+02:00');
  assert.equal(addWorkingMinutes('2026-11-19T06:00:00+02:00', 0, H), '2026-11-19T07:30:00+02:00');
});

test('time: Friday work carries over the weekend to Monday', () => {
  assert.equal(addWorkingMinutes('2026-11-20T16:20:00+02:00', 30, H), '2026-11-23T07:50:00+02:00');
  assert.equal(addWorkingMinutes('2026-11-21T10:00:00+02:00', 60, H), '2026-11-23T08:30:00+02:00');
  assert.equal(workingMinutesBetween('2026-11-20T16:20:00+02:00', '2026-11-23T07:50:00+02:00', H), 30);
  assert.equal(formatEta('2026-11-19T13:10:00Z'), 'Thu 15:10');
  assert.equal(inWorkingHours('2026-11-21T10:00:00+02:00', H), false);
  assert.equal(inWorkingHours('2026-11-19T16:30:00+02:00', H), true);
});

test('planJobs: one job per learner per need, phone items delivered at once, stable ids', () => {
  const jobs = planJobs(S, 'g1', DEMO_DEADLINE);
  assert.equal(jobs.length, 9);
  assert.ok(jobs.some(j => j.id === 'g1-l3-tactile' && j.pages === 2 && j.status === 'queued'));
  for (const j of jobs.filter(j => j.item !== 'tactile')) assert.deepEqual([j.status, j.eta, j.pages], ['delivered', '2026-11-19T13:00:00+02:00', 0]);
  assert.deepEqual(planJobs(S, 'g1', DEMO_DEADLINE), jobs);
});

// Demo school, clock Thu 13:00: embosser free 14:30 (45 queued pages at 30/h), swell free 15:00 (80 at 40/h).
test('normal: every tactile print on the embosser, ready Thu 14:34, 14:38, 14:42, 14:46, before Fri 07:30', () => {
  const d = normal();
  assert.deepEqual(etas(d.jobs), ['l1:embosser-1:Thu 14:34', 'l2:embosser-1:Thu 14:38', 'l3:embosser-1:Thu 14:42', 'l6:embosser-1:Thu 14:46']);
  assert.ok(d.jobs.every(j => j.status === (j.item === 'tactile' ? 'queued' : 'delivered')));
  assert.deepEqual(validateDispatch(d), []);
  const check = checkSchedule(d, S);
  assert.equal(check.pass, true, JSON.stringify(check.problems));
  assert.deepEqual(check.late, []);
});

test('embosser offline: prints move to the swell heater, Thu 15:03 to 15:12, with ETA corrections', () => {
  const d = normal();
  const r = replan(d, S, { kind: 'machine-offline', machineId: 'embosser-1' });
  assert.deepEqual(etas(r.jobs), ['l1:swell-1:Thu 15:03', 'l2:swell-1:Thu 15:06', 'l3:swell-1:Thu 15:09', 'l6:swell-1:Thu 15:12']);
  const eta = r.corrections.find(c => c.field === 'dispatch.jobs.g1-l1-tactile.eta');
  assert.deepEqual([eta.agent, eta.before, eta.after], ['Dispatcher', '2026-11-19T14:34:00+02:00', '2026-11-19T15:03:00+02:00']);
  assert.match(eta.reason, /braille embosser went offline.*swell-paper heater, ready Thu 15:03 instead of Thu 14:34/);
  assert.equal(r.corrections.filter(c => c.field.endsWith('.machineId')).length, 4);
  assert.ok(!r.corrections.some(c => c.field.includes('phone')));
  assert.equal(r.machines.find(m => m.id === 'embosser-1').online, false);
  assert.equal(checkSchedule({ ...d, jobs: r.jobs, machines: r.machines }, S).pass, true);
  // And back online: they return to the embosser.
  const back = replan({ ...d, jobs: r.jobs, machines: r.machines }, S, { kind: 'machine-online', machineId: 'embosser-1' });
  assert.deepEqual(etas(back.jobs), etas(d.jobs));
});

test('both tactile machines offline: prints late with a reason, phone packs still delivered, checker flags them', () => {
  const d = normal();
  const a = replan(d, S, { kind: 'machine-offline', machineId: 'embosser-1' });
  const b = replan({ ...d, jobs: a.jobs, machines: a.machines }, S, { kind: 'machine-offline', machineId: 'swell-1' });
  for (const j of tactile(b.jobs)) assert.deepEqual([j.status, j.lateReason, j.machineId], ['late', 'No tactile machine is online', undefined]);
  assert.ok(b.jobs.filter(j => j.item !== 'tactile').every(j => j.status === 'delivered'));
  assert.ok(b.corrections.some(c => c.field === 'dispatch.jobs.g1-l1-tactile.status' && c.after === 'late'));
  const check = checkSchedule({ ...d, jobs: b.jobs, machines: b.machines }, S);
  assert.deepEqual(check.late, ['g1-l1-tactile', 'g1-l2-tactile', 'g1-l3-tactile', 'g1-l6-tactile']);
  assert.match(check.checks.find(c => c.rule === 'deadlines').detail, /4 late with a reason/);
  assert.deepEqual(validateDispatch({ ...d, jobs: b.jobs }), []);
});

test('busy machine: late with a reason naming the offline machine and when the other is free', () => {
  const busy = { ...S, machines: S.machines.map(m => (m.id === 'swell-1' ? { ...m, queue: [{ id: 'q', label: 'Exams', pages: 400 }] } : m)) };
  const machines = busy.machines.map(m => ({ id: m.id, online: m.id !== 'embosser-1' }));
  const { jobs, notes } = schedule(planJobs(busy, 'g1', DEMO_DEADLINE), busy, { clock: S.clockStart, machines });
  const j = jobs.find(x => x.id === 'g1-l1-tactile');
  assert.equal(j.status, 'late');
  assert.equal(j.lateReason, 'The braille embosser is offline and the swell-paper heater is busy until Fri 14:00');
  assert.equal(formatEta(j.eta), 'Fri 14:03');
  assert.ok(inWorkingHours(j.start, H) && inWorkingHours(j.eta, H));
  assert.ok(notes.some(n => /can't make Fri 07:30/.test(n)));
  assert.equal(checkSchedule(dispatchOf(jobs, machines), busy).pass, true);
});

test('replan never moves a printing or ready job, but an offline machine hands its printing job back', () => {
  const d = normal();
  d.jobs = d.jobs.map(j => (j.id === 'g1-l1-tactile' ? { ...j, status: 'ready' } : j.id === 'g1-l2-tactile' ? { ...j, status: 'printing' } : j));
  const online = replan(d, S, { kind: 'machine-offline', machineId: 'swell-1' });
  assert.deepEqual(online.jobs.slice(0, 3), d.jobs.slice(0, 3));
  const off = replan(d, S, { kind: 'machine-offline', machineId: 'embosser-1' });
  assert.equal(off.jobs[0].status, 'ready');
  assert.deepEqual([off.jobs[2].status, off.jobs[2].machineId], ['queued', 'swell-1']);
  assert.ok(off.corrections.some(c => c.field === 'dispatch.jobs.g1-l2-tactile.status' && c.before === 'printing'));
});

test('urgent pack due Thu 16:00 jumps the queue by deadline and pushes the others later', () => {
  const d = normal();
  const r = replan(d, S, { kind: 'urgent', learnerId: 'l3' });
  const urgent = r.jobs.find(j => j.urgent);
  assert.deepEqual([urgent.id, urgent.pages, urgent.deadline, urgent.machineId, formatEta(urgent.start), formatEta(urgent.eta)],
    ['g1-l3-urgent-1', 4, '2026-11-19T16:00:00+02:00', 'embosser-1', 'Thu 14:30', 'Thu 14:38']);
  assert.deepEqual(etas(r.jobs.filter(j => !j.urgent)), ['l1:embosser-1:Thu 14:42', 'l2:embosser-1:Thu 14:46', 'l3:embosser-1:Thu 14:50', 'l6:embosser-1:Thu 14:54']);
  assert.equal(r.corrections.filter(c => c.field.endsWith('.eta')).length, 4);
  assert.match(r.corrections[0].reason, /urgent 4-page tactile print for Learner C, due Thu 16:00/);
  assert.equal(checkSchedule({ ...d, jobs: r.jobs }, S).pass, true);
});

test('avoid: a job kept off a machine goes to the next best one', () => {
  const { jobs, notes } = schedule(planJobs(S, 'g1', DEMO_DEADLINE), S, { clock: S.clockStart, avoid: [{ jobId: 'g1-l1-tactile', machineId: 'embosser-1' }] });
  assert.deepEqual(etas(jobs), ['l1:swell-1:Thu 15:03', 'l2:embosser-1:Thu 14:34', 'l3:embosser-1:Thu 14:38', 'l6:embosser-1:Thu 14:42']);
  assert.ok(notes.length >= 4);
});
