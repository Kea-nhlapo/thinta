import test from 'node:test';
import assert from 'node:assert/strict';
import { createLineParser, readNdjson } from './stream.js';
import { initialRun, applyEvent, agentStates, replayTimeline, timelineFromRecording, replayDelays } from './job.js';
import { formatNumber, formatPoint, formatValue, prettyMaths, fieldLabel } from './format.js';
import { EXAMPLE_PARABOLA_JOB, emptyJob } from '../contract.js';

test('line parser keeps partial lines across chunks', () => {
  const events = [];
  const parser = createLineParser(e => events.push(e));
  parser.push('{"type":"tra');
  assert.equal(events.length, 0);
  parser.push('ce","entry":{"agent":"Planner"}}\n{"type":"done"');
  assert.equal(events.length, 1);
  parser.push(',"job":{}}\n\n');
  parser.end();
  assert.deepEqual(events.map(e => e.type), ['trace', 'done']);
});

test('line parser flushes a final line without newline and flags bad lines', () => {
  const events = [];
  const parser = createLineParser(e => events.push(e));
  parser.push('not json\n{"type":"done"}');
  parser.end();
  assert.deepEqual(events.map(e => e.type), ['bad-line', 'done']);
});

test('readNdjson reads a streamed body split mid-character', async () => {
  const bytes = new TextEncoder().encode('{"type":"trace","entry":{"message":"x − y"}}\n{"type":"done"}\n');
  const cut = bytes.indexOf(0xe2) + 1; // split inside the UTF-8 minus sign
  const body = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, cut)); c.enqueue(bytes.slice(cut)); c.close(); } });
  const events = [];
  await readNdjson(new Response(body), e => events.push(e));
  assert.equal(events[0].entry.message, 'x − y');
  assert.equal(events[1].type, 'done');
});

test('applyEvent builds the job and an ordered log', () => {
  let state = initialRun(emptyJob());
  state = applyEvent(state, { type: 'trace', entry: { t: 0, agent: 'Reader', status: 'start', message: 'Reading' } });
  assert.equal(state.status, 'running');
  state = applyEvent(state, { type: 'patch', job: { reading: { turningPoint: { x: 1, y: -8.5 } } } });
  state = applyEvent(state, { type: 'correction', correction: EXAMPLE_PARABOLA_JOB.corrections[0] });
  state = applyEvent(state, { type: 'review', review: EXAMPLE_PARABOLA_JOB.reviews[2] });
  assert.deepEqual(state.log.map(l => l.kind), ['trace', 'correction', 'review']);
  assert.equal(state.job.corrections.length, 1);
  assert.equal(state.job.reading.turningPoint.y, -8.5);
  state = applyEvent(state, { type: 'done', job: { ...EXAMPLE_PARABOLA_JOB, calls: 9 } });
  assert.equal(state.status, 'done');
  assert.equal(state.job.calls, 9);
  assert.equal(state.log.length, 3, 'done does not rewrite the log');
});

test('applyEvent records errors and ignores unknown events', () => {
  let state = initialRun(emptyJob());
  assert.equal(applyEvent(state, { type: 'bad-line' }), state);
  state = applyEvent(state, { type: 'error', message: 'Network lost' });
  assert.equal(state.status, 'error');
  assert.equal(state.error, 'Network lost');
});

test('agentStates follows the trace and marks failures and retries', () => {
  const job = { ...emptyJob(), trace: [
    { agent: 'Planner', status: 'start' }, { agent: 'Planner', status: 'done' },
    { agent: 'Reader', status: 'start' }, { agent: 'Explainer', status: 'retry' }, { agent: 'Designer', status: 'fail' },
  ] };
  const states = agentStates(job);
  assert.equal(states.Planner, 'done');
  assert.equal(states.Reader, 'working');
  assert.equal(states.Explainer, 'retry');
  assert.equal(states.Designer, 'failed');
  assert.equal(states.Reviewer, 'waiting');
  assert.equal(agentStates(job, 'error').Reader, 'failed');
  assert.equal(agentStates(job, 'done').Reviewer, 'skipped');
  assert.equal(agentStates(emptyJob(), 'error').Planner, 'waiting', 'an empty plan is not Planner output');
});

test('replayTimeline places corrections after their agent and ends with done', () => {
  const timeline = replayTimeline(EXAMPLE_PARABOLA_JOB);
  const types = timeline.map(s => s.event.type);
  assert.equal(types.at(-1), 'done');
  const proverDone = timeline.findIndex(s => s.event.type === 'trace' && s.event.entry.agent === 'Prover' && s.event.entry.status === 'done');
  const correction = types.indexOf('correction');
  assert.ok(correction > proverDone);
  let state = initialRun(emptyJob({ mode: 'replay' }));
  for (const { event } of timeline) state = applyEvent(state, event);
  assert.equal(state.status, 'done');
  assert.equal(state.job.corrections.length, EXAMPLE_PARABOLA_JOB.corrections.length);
  assert.equal(state.job.reviews.length, EXAMPLE_PARABOLA_JOB.reviews.length);
});

test('timelineFromRecording accepts event lists and delays are capped', () => {
  const timeline = timelineFromRecording({ events: [{ t: 0, event: { type: 'trace', entry: {} } }, { type: 'done', job: {} }] });
  assert.deepEqual(timeline.map(s => s.t), [0, 300]);
  assert.deepEqual(replayDelays([{ t: 0 }, { t: 40000 }, { t: 40001 }], { speed: 4 }), [120, 1500, 120]);
});

test('formatting uses real minus signs and (x, y) points', () => {
  assert.equal(formatNumber(-9), '−9');
  assert.equal(formatNumber(1.3333), '1.33');
  assert.equal(formatPoint({ x: 1, y: -9 }), '(1, −9)');
  assert.equal(formatValue([-2, 4]), '−2, 4');
  assert.equal(formatValue('3/5'), '3/5');
  assert.equal(prettyMaths('y = x^2 - 2x - 8'), 'y = x² − 2x − 8');
  assert.equal(prettyMaths('-2 < x < 4'), '−2 < x < 4');
  assert.equal(prettyMaths('the y-intercept'), 'the y-intercept');
  assert.equal(fieldLabel('reading.turningPoint'), 'turning point');
});

test('chunkText splits at sentences under the /api/speak limit', async () => {
  const { chunkText } = await import('./speech.js');
  const text = 'A U-shaped curve. '.repeat(40);
  const pieces = chunkText(text);
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every(p => p.length <= 400 && p.endsWith('.')));
  assert.equal(pieces.join(' ').replace(/\s+/g, ' '), text.trim().replace(/\s+/g, ' '));
  assert.deepEqual(chunkText('x'.repeat(900)).map(p => p.length), [400, 400, 100]);
});
