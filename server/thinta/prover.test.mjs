import test from 'node:test';
import assert from 'node:assert/strict';
import { prove, parseEquation, formatEquation } from './prover.mjs';
import { EXAMPLE_PARABOLA_JOB, EXAMPLE_BAR_JOB, DEFAULT_QUESTIONS, validateJob, emptyJob } from '../../src/thinta/contract.js';

const agreeing = { type: 'function', equation: 'y = x^2 - 2x - 8', roots: [-2, 4], turningPoint: { x: 1, y: -9 }, confidence: 0.9 };

test('demo parabola: roots -2 and 4, vertex (1, -9), y-intercept -8, domain [-4, 6]', () => {
  const { proof, corrections } = prove(agreeing, { equationHint: 'y = x^2 - 2x - 8' });
  assert.deepEqual(proof.roots, [-2, 4]);
  assert.deepEqual(proof.turningPoint, { x: 1, y: -9 });
  assert.equal(proof.yIntercept, -8);
  assert.deepEqual(proof.coefficients, { a: 1, b: -2, c: -8 });
  assert.deepEqual(proof.domain, [-4, 6]);
  assert.deepEqual(proof.range, [-9, 16]);
  assert.equal(proof.equation, 'y = x^2 - 2x - 8');
  assert.deepEqual(proof.samples, EXAMPLE_PARABOLA_JOB.proof.samples);
  assert.deepEqual(proof.answers.map(a => a.answer), EXAMPLE_PARABOLA_JOB.proof.answers.map(a => a.answer));
  assert.deepEqual(proof.answers.map(a => a.question), DEFAULT_QUESTIONS);
  assert.deepEqual(corrections, [], 'an agreeing Reader is never "corrected"');
  assert.deepEqual(validateJob({ ...emptyJob(), proof }), []);
});

test('unicode, superscripts and f(x) all parse to the same coefficients', () => {
  for (const eq of ['y=x²−2x−8', 'y = x^2 – 2x – 8', 'f(x) = x**2 - 2*x - 8', 'Y = X² - 2X - 8', 'y = (x-4)(x+2)', 'y = (x − 1)² − 9', 'x^2 - 2x - 8 = y'])
    assert.deepEqual(parseEquation(eq), { a: 1, b: -2, c: -8 }, eq);
  assert.deepEqual(parseEquation('y = 2x^2 + 3x - 1'), { a: 2, b: 3, c: -1 });
  assert.deepEqual(parseEquation('y = -x^2 + 4'), { a: -1, b: 0, c: 4 });
  assert.deepEqual(parseEquation('y = 0.5x^2'), { a: 0.5, b: 0, c: 0 });
  assert.equal(parseEquation('y = x^3'), null);
  assert.equal(parseEquation('hello'), null);
  assert.equal(parseEquation(''), null);
  assert.equal(formatEquation({ a: -1, b: 0, c: 4 }), 'y = -x^2 + 4');
});

test('a disagreeing Reader gets exactly the right corrections, with algebra reasons', () => {
  const reading = { ...agreeing, roots: [-2, 4.1], turningPoint: { x: 1, y: -8.5 } };
  const { corrections } = prove(reading, { equationHint: 'y = x^2 - 2x - 8' });
  assert.deepEqual(corrections.map(c => c.field), ['reading.turningPoint'], '4.1 is within 0.25 so roots stand');
  assert.deepEqual(corrections[0].before, { x: 1, y: -8.5 });
  assert.deepEqual(corrections[0].after, { x: 1, y: -9 });
  assert.match(corrections[0].reason, /-b\/2a = 2\/2 = 1, y = f\(1\) = -9/);
  assert.equal(corrections[0].agent, 'Prover');

  const worse = prove({ ...agreeing, equation: 'y = x^2 - 2x + 8', roots: [-1.5, 4], turningPoint: { x: 1.4, y: -9 } }, { equationHint: 'y = x² − 2x − 8' });
  assert.deepEqual(worse.corrections.map(c => c.field), ['reading.equation', 'reading.roots', 'reading.turningPoint']);
  assert.deepEqual(worse.corrections[1].after, [-2, 4]);
  assert.match(worse.corrections[1].reason, /b² - 4ac = 36/);
});

test('without a hint the Reader equation is used, and a Reader with no reads gets no corrections', () => {
  const { proof, corrections } = prove({ type: 'function', equation: 'y = x² − 2x − 8', confidence: 0.5 });
  assert.deepEqual(proof.roots, [-2, 4]);
  assert.deepEqual(corrections, []);
  assert.throws(() => prove({ type: 'function', confidence: 0.1 }), /Could not read an equation/);
});

test('no real roots: discriminant < 0', () => {
  const { proof, corrections } = prove({ type: 'function', roots: [-1, 1], confidence: 0.4 }, { equationHint: 'y = x^2 + 2x + 5' });
  assert.deepEqual(proof.roots, []);
  assert.deepEqual(proof.turningPoint, { x: -1, y: 4 });
  assert.ok(proof.domain[0] <= -3 && proof.domain[1] >= 2);
  assert.match(proof.answers[0].answer, /no real roots/);
  assert.match(proof.answers[4].answer, /no values of x/);
  assert.equal(corrections.length, 1);
  assert.match(corrections[0].reason, /< 0, so there are no real roots/);
});

test('one repeated root and a maximum', () => {
  const touch = prove(null, { equationHint: 'y = x^2 - 6x + 9' }).proof;
  assert.deepEqual(touch.roots, [3]);
  assert.match(touch.answers[0].answer, /x = 3 only/);
  const cap = prove(null, { equationHint: 'y = -x^2 + 4' }).proof;
  assert.deepEqual(cap.roots, [-2, 2]);
  assert.deepEqual(cap.turningPoint, { x: 0, y: 4 });
  assert.equal(cap.answers[2].answer, 'maximum');
  assert.equal(cap.answers[4].answer, 'x < -2 or x > 2');
});

test('linear: one root, no turning point, a Reader turning point is overruled', () => {
  const { proof, corrections } = prove({ type: 'function', turningPoint: { x: 0, y: 1 }, confidence: 0.5 }, { equationHint: 'y = 2x + 1' });
  assert.deepEqual(proof.roots, [-0.5]);
  assert.equal(proof.turningPoint, undefined);
  assert.equal(proof.yIntercept, 1);
  assert.equal(proof.answers[4].answer, 'x < -0.5');
  assert.match(proof.answers[2].answer, /no turning point/);
  assert.deepEqual(corrections.map(c => [c.field, c.after]), [['reading.turningPoint', null]]);
});

test('factored form and non-integer roots round cleanly (no -0, no float noise)', () => {
  const { proof } = prove(null, { equationHint: 'y = (x-4)(x+2)' });
  assert.deepEqual(proof.roots, [-2, 4]);
  const odd = prove(null, { equationHint: 'y = 2x^2 + 3x - 1' }).proof;
  assert.deepEqual(odd.roots, [-1.7808, 0.2808]);
  assert.deepEqual(odd.turningPoint, { x: -0.75, y: -2.125 });
  const zero = prove(null, { equationHint: 'y = x^2' }).proof;
  assert.ok(Object.is(zero.turningPoint.x, 0) && Object.is(zero.roots[0], 0));
  assert.ok(zero.samples.every(p => !Object.is(p.y, -0) && !Object.is(p.x, -0)));
});

test('bar chart: validated bars, one sample per bar, highest and per-bar answers', () => {
  const reading = { ...EXAMPLE_BAR_JOB.reading, bars: [...EXAMPLE_BAR_JOB.reading.bars, { label: '', value: 3 }, { label: 'Apr', value: 'n/a' }] };
  const { proof, corrections } = prove(reading, { questions: [...EXAMPLE_BAR_JOB.input.questions, 'Which month had the least rain?'] });
  assert.deepEqual(proof.bars, EXAMPLE_BAR_JOB.proof.bars);
  assert.deepEqual(proof.samples, EXAMPLE_BAR_JOB.proof.samples);
  assert.deepEqual(proof.roots, []);
  assert.deepEqual(proof.answers.map(a => a.answer), ['January', '80 mm', 'March']);
  assert.deepEqual(corrections, []);
  assert.throws(() => prove({ type: 'bar', bars: [] }), /no bars/);
});
