import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from './pipeline.mjs';
import { EXAMPLE_PARABOLA_JOB, validateJob, LIMITS } from '../../src/thinta/contract.js';

const proof = EXAMPLE_PARABOLA_JOB.proof;
const collect = async gen => { const out = []; for await (const e of gen) out.push(e); return out; };

// Fake agents: each decides from its input, so retries only pass when the rewrite really changed something.
function fakeDeps(overrides = {}) {
  return {
    plan: async () => ({ steps: ['Read', 'Prove', 'Design', 'Review'], versions: ['tactile', 'sound', 'audio-description', 'deaf-solution'] }),
    readGraph: async () => ({ type: 'function', equation: 'y = x^2 - 2x - 8', turningPoint: { x: 1, y: -8.5 }, roots: [-2, 4], confidence: 0.6 }),
    prove: reading => ({ proof, corrections: Math.abs(reading.turningPoint.y - -9) > LIMITS.valueTolerance ? [{ agent: 'Prover', field: 'reading.turningPoint', before: reading.turningPoint, after: proof.turningPoint, reason: 'vertex' }] : [] }),
    designTactile: () => ({ svg: '<svg data-version="1"/>', warnings: [], ruleChecks: [{ rule: 'label-gap', pass: true, detail: '' }], corrections: [] }),
    fixTactile: () => ({ svg: '<svg data-version="2"/>', warnings: [], ruleChecks: [], corrections: [{ agent: 'Designer', field: 'tactile.labels.turningPoint', before: 'small', after: 'large', reason: 'fresh eyes missed it' }] }),
    freshEyes: async ({ svg }) => ({ review: { agent: 'Reviewer', check: 'fresh-eyes', pass: svg.includes('2'), reason: svg.includes('2') ? 'match' : 'turning point label missing' } }),
    explain: async ({ feedback }) => ({
      description: { en: feedback ? 'Roots -2 and 4. Turning point (1, -9), a minimum. Crosses the y-axis at -8. Below the x-axis between -2 and 4.' : 'Roots -2 and 4.', zu: 'Izimpande' },
      deafSolution: { steps: [{ text: 'Roots -2 and 4. Turning point (1, -9).', visual: '' }], keyTerms: ['ROOT'] },
    }),
    accessTest: async ({ text }) => { const score = text.includes('Turning point') ? 5 : 3; return { agent: 'Reviewer', check: 'access', pass: score >= 4, score, total: 5, failed: [], reason: '' }; },
    meaningCheck: () => ({ pass: true, problems: [] }),
    feedbackFrom: () => ['Say the turning point'],
    sonify: p => ({ samples: p.samples, keyPoints: [{ x: -2, y: 0, kind: 'root' }] }),
    ...overrides,
  };
}

test('a full run corrects the Reader, fixes the print and rewrites the description, then hands over', async () => {
  const events = await collect(runPipeline({ imageBase64: 'abc', equationHint: 'y = x^2 - 2x - 8', learners: ['blind', 'deaf'] }, { deps: fakeDeps() }));
  const done = events.at(-1);
  assert.equal(done.type, 'done');
  assert.deepEqual(validateJob(done.job), []);
  const job = done.job;
  assert.equal(job.input.imageBase64, '');
  assert.deepEqual(job.corrections.map(c => c.field), ['reading.turningPoint', 'tactile.labels.turningPoint', 'description.en']);
  const audio = job.reviews.filter(r => r.check === 'access' && r.version !== 'deaf');
  assert.equal(audio[0].score, 3);
  assert.equal(audio[1].before, '3/5');
  assert.equal(audio[1].after, '5/5');
  assert.ok(job.trace.some(t => t.status === 'retry' && t.agent === 'Reviewer'));
  assert.ok(job.calls <= LIMITS.maxAgentCalls);
  assert.match(job.trace.at(-1).message, /every check passes/);
});

test('an agreeing Reader gets no correction', async () => {
  const deps = fakeDeps({ readGraph: async () => ({ type: 'function', equation: 'y = x^2 - 2x - 8', turningPoint: { x: 1, y: -9 }, roots: [-2, 4], confidence: 0.9 }) });
  const { job } = (await collect(runPipeline({ imageBase64: 'abc', learners: ['blind'] }, { deps }))).at(-1);
  assert.equal(job.corrections.filter(c => c.agent === 'Prover').length, 0);
  assert.equal(job.reviews.find(r => r.check === 'reader-vs-prover').pass, true);
});

test('retries stop at the limit and escalate to the teacher', async () => {
  const deps = fakeDeps({ accessTest: async () => ({ agent: 'Reviewer', check: 'access', pass: false, score: 2, total: 5, failed: [], reason: '' }) });
  const { job } = (await collect(runPipeline({ imageBase64: 'abc', learners: ['blind'] }, { deps }))).at(-1);
  assert.equal(job.reviews.filter(r => r.check === 'access').length, LIMITS.maxRetries + 1);
  assert.ok(job.trace.some(t => /escalated to the teacher/.test(t.message)));
  assert.match(job.trace.at(-1).message, /needs? the teacher's eye/);
});

test('an unreadable photo falls back to the typed equation, and fails cleanly without one', async () => {
  const deps = fakeDeps({ readGraph: async () => { throw new Error('blurry'); }, prove: () => ({ proof, corrections: [] }) });
  const ok = (await collect(runPipeline({ imageBase64: 'abc', equationHint: 'y = x^2 - 2x - 8', learners: ['blind'] }, { deps }))).at(-1);
  assert.equal(ok.type, 'done');
  assert.ok(ok.job.trace.some(t => t.agent === 'Reader' && t.status === 'fail'));
  const bad = (await collect(runPipeline({ imageBase64: 'abc', learners: ['blind'] }, { deps }))).at(-1);
  assert.equal(bad.type, 'error');
});

test('the step cap ends a run that keeps calling agents', async () => {
  let n = 0;
  const deps = fakeDeps({ freshEyes: async () => ({ review: { agent: 'Reviewer', check: 'fresh-eyes', pass: false, reason: 'no' } }), accessTest: async () => { n++; return { pass: false, score: 0, total: 5, failed: [] }; } });
  const original = LIMITS.maxAgentCalls;
  LIMITS.maxAgentCalls = 6;
  try {
    const last = (await collect(runPipeline({ imageBase64: 'abc', learners: ['blind', 'deaf'] }, { deps }))).at(-1);
    assert.equal(last.type, 'error');
    assert.match(last.message, /Step cap/);
  } finally { LIMITS.maxAgentCalls = original; }
});
