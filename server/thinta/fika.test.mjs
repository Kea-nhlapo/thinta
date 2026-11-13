import test from 'node:test';
import assert from 'node:assert/strict';
import { runDispatch, dispatchEvent, getDispatch } from './fika.mjs';
import { validateDispatch } from '../../src/thinta/contract.js';
import { fakeFikaDeps } from './fika-fakes.mjs';

const collect = async gen => { const out = []; for await (const e of gen) out.push(e); return out; };

test('approval → phone packs delivered at once, tactile prints scheduled and checked', async () => {
  const events = await collect(runDispatch({ graphJobId: 'fika-a', schoolId: 'demo-school', deps: fakeFikaDeps() }));
  const { dispatch } = events.at(-1);
  assert.deepEqual(validateDispatch(dispatch), []);
  assert.ok(dispatch.jobs.filter(j => j.item !== 'tactile').every(j => j.status === 'delivered'));
  assert.ok(dispatch.jobs.filter(j => j.item === 'tactile').every(j => j.machineId && j.eta));
  assert.ok(events.some(e => e.type === 'review' && e.review.agent === 'Schedule Checker' && e.review.pass));
  assert.deepEqual(getDispatch('fika-a').jobs, dispatch.jobs);
});

test('a failing check is sent back to the Dispatcher, then passes', async () => {
  const events = await collect(runDispatch({ graphJobId: 'fika-b', schoolId: 'demo-school', deps: fakeFikaDeps({ checkFailsFirst: 1 }) }));
  const reviews = events.filter(e => e.type === 'review' && e.review.check === 'schedule').map(e => e.review.pass);
  assert.deepEqual(reviews, [false, true]);
  assert.ok(events.some(e => e.type === 'trace' && e.entry.status === 'retry' && e.entry.agent === 'Schedule Checker'));
});

test('taking a machine offline replans with real corrections; all offline is flagged honestly', async () => {
  const deps = fakeFikaDeps();
  await collect(runDispatch({ graphJobId: 'fika-c', schoolId: 'demo-school', deps }));
  const first = await dispatchEvent({ graphJobId: 'fika-c', kind: 'machine-offline', machineId: 'swell-1', deps });
  assert.ok(first.corrections.length > 0);
  assert.ok(first.corrections.every(c => c.before !== c.after));
  assert.equal(first.dispatch.machines.find(m => m.id === 'swell-1').online, false);
  const second = await dispatchEvent({ graphJobId: 'fika-c', kind: 'machine-offline', machineId: 'embosser-1', deps });
  const tactile = second.dispatch.jobs.filter(j => j.item === 'tactile');
  assert.ok(tactile.every(j => j.status === 'late' && j.lateReason));
  assert.ok(second.dispatch.jobs.filter(j => j.item !== 'tactile').every(j => j.status === 'delivered'));
  assert.ok(second.trace.some(t => /Can't meet/.test(t.message) && /Flagged for the teacher/.test(t.message)));
});

test('the phone can resend its copy when the server has forgotten the plan', async () => {
  const deps = fakeFikaDeps();
  const { dispatch } = (await collect(runDispatch({ graphJobId: 'fika-d', schoolId: 'demo-school', deps }))).at(-1);
  const copy = { ...dispatch, graphJobId: 'fika-unknown' };
  const result = await dispatchEvent({ graphJobId: 'fika-unknown', kind: 'tick', dispatch: copy, deps });
  assert.ok(result);
  assert.notEqual(result.dispatch.clock, dispatch.clock);
  assert.equal(await dispatchEvent({ graphJobId: 'nothing-here', kind: 'tick', deps }), null);
});
