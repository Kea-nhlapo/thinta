import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE_PARABOLA_JOB, EXAMPLE_BAR_JOB } from '../contract.js';
import { sonify, pitchFor, yAt, nearestKeyPoint, crossedKeyPoints, turningKind, yRange, spokenNumber, describeKeyPoint, describeX, stopsFor, sweepPlan, LOW_HZ, HIGH_HZ } from './sonify.js';

const parabola = sonify(EXAMPLE_PARABOLA_JOB.proof);
const bars = sonify(EXAMPLE_BAR_JOB.proof);

test('pitch rises with y and stays in 220-880 Hz', () => {
  let last = 0;
  for (let y = -9; y <= 16; y += 0.5) { const f = pitchFor(y, [-9, 16]); assert.ok(f > last, `${y}`); last = f; }
  assert.equal(pitchFor(-9, [-9, 16]), LOW_HZ);
  assert.ok(Math.abs(pitchFor(16, [-9, 16]) - HIGH_HZ) < 1e-9);
  assert.equal(pitchFor(-100, [-9, 16]), LOW_HZ); // clamped
  // Log scale: the middle of the range is an octave above the bottom (440 Hz).
  assert.ok(Math.abs(pitchFor(3.5, [-9, 16]) - 440) < 1e-9);
});

test('yAt interpolates between samples and clamps at the ends', () => {
  const s = [{ x: 0, y: 0 }, { x: 1, y: 10 }, { x: 2, y: 4 }];
  assert.equal(yAt(s, 0.5), 5);
  assert.equal(yAt(s, 1.5), 7);
  assert.equal(yAt(s, -3), 0);
  assert.equal(yAt(s, 9), 4);
  assert.equal(yAt([], 1), null);
  assert.equal(yAt(parabola.samples, 1), -9);
});

test('parabola key points: roots -2 and 4, minimum (1, -9), y-intercept -8', () => {
  const kinds = parabola.keyPoints.map(p => `${p.kind}@${p.x},${p.y}`);
  assert.deepEqual(kinds, ['root@-2,0', 'y-intercept@0,-8', 'turning-point@1,-9', 'root@4,0']);
  assert.equal(parabola.samples.length, EXAMPLE_PARABOLA_JOB.proof.samples.length);
  assert.equal(turningKind(parabola.samples, { x: 1, y: -9 }), 'minimum');
  assert.deepEqual(yRange(parabola), [-9, 16]);
});

test('same key points as the contract fixture, in any order', () => {
  const key = p => `${p.kind}${p.x},${p.y}`;
  assert.deepEqual(parabola.keyPoints.map(key).sort(), EXAMPLE_PARABOLA_JOB.sound.keyPoints.map(key).sort());
  assert.deepEqual(bars, EXAMPLE_BAR_JOB.sound);
});

test('a maximum is recognised', () => {
  const s = [-2, -1, 0, 1, 2].map(x => ({ x, y: -x * x + 4 }));
  assert.equal(turningKind(s, { x: 0, y: 4 }), 'maximum');
});

test('a root at the origin is kept once, as a root', () => {
  const s = sonify({ roots: [0, 2], turningPoint: { x: 1, y: -1 }, yIntercept: 0, domain: [-1, 3], samples: [-1, 0, 1, 2, 3].map(x => ({ x, y: x * x - 2 * x })) });
  assert.deepEqual(s.keyPoints.map(p => p.kind), ['root', 'turning-point', 'root']);
});

test('key points outside the domain are left out', () => {
  const s = sonify({ roots: [-5, 1], domain: [0, 3], samples: [{ x: 0, y: -1 }, { x: 3, y: 8 }] });
  assert.deepEqual(s.keyPoints.map(p => `${p.kind}${p.x}`), ['y-intercept0', 'root1']);
});

test('bar chart: one key point per bar, pitch range starts at 0', () => {
  assert.deepEqual(bars.keyPoints.map(p => `${p.kind}${p.x}:${p.y}`), ['bar0:120', 'bar1:95', 'bar2:80']);
  assert.deepEqual(yRange(bars), [0, 120]);
  assert.ok(pitchFor(120, yRange(bars)) > pitchFor(95, yRange(bars)));
  assert.deepEqual(stopsFor(bars), [0, 1, 2]);
});

test('nearest and crossed key points', () => {
  assert.equal(nearestKeyPoint(-1.9, parabola.keyPoints, 0.2).x, -2);
  assert.equal(nearestKeyPoint(2.5, parabola.keyPoints, 0.2), null);
  assert.equal(nearestKeyPoint(2.5, parabola.keyPoints).x, 1);
  assert.deepEqual(crossedKeyPoints(-3, 2, parabola.keyPoints).map(p => p.x), [-2, 0, 1]);
  assert.deepEqual(crossedKeyPoints(5, 0.5, parabola.keyPoints).map(p => p.x), [4, 1]);
  assert.deepEqual(crossedKeyPoints(null, 2, parabola.keyPoints), []);
  // Landing on a point fires once; moving off it does not fire again.
  assert.deepEqual(crossedKeyPoints(-2.5, -2, parabola.keyPoints).map(p => p.x), [-2]);
  assert.deepEqual(crossedKeyPoints(-2, -1.5, parabola.keyPoints), []);
});

test('spoken wording for screen readers', () => {
  assert.equal(spokenNumber(-2), 'minus 2');
  assert.equal(spokenNumber(1.23456), '1.23');
  assert.equal(spokenNumber(-0.0001), '0');
  const ctx = { samples: parabola.samples };
  assert.equal(describeKeyPoint({ x: -2, y: 0, kind: 'root' }, ctx), 'Root at x equals minus 2');
  assert.equal(describeKeyPoint({ x: 1, y: -9, kind: 'turning-point' }, ctx), 'Turning point, minimum, at 1, minus 9');
  assert.equal(describeKeyPoint({ x: 0, y: -8, kind: 'y-intercept' }, ctx), 'Crosses the y-axis at y equals minus 8');
  assert.equal(describeKeyPoint(bars.keyPoints[0], { bars: EXAMPLE_BAR_JOB.proof.bars }), 'Jan, 120. Bar 1 of 3');
  assert.equal(describeX(2, parabola), 'x 2, y minus 8');
  assert.equal(describeX(4, parabola), 'x 4, y 0. Root at x equals 4');
});

test('slider stops include every key point', () => {
  const stops = stopsFor(parabola);
  for (const p of parabola.keyPoints) assert.ok(stops.includes(p.x), `${p.x}`);
  assert.equal(stops[0], -4);
  assert.equal(stops.at(-1), 6);
  assert.deepEqual(stops, [...stops].sort((a, b) => a - b));
});

test('sweep plan: glide left to right with ticks at the key points', () => {
  const plan = sweepPlan(parabola, { durationMs: 5000 });
  assert.equal(plan.seconds, 5);
  assert.equal(plan.glide[0].t, 0);
  assert.equal(plan.glide.at(-1).t, 5);
  assert.equal(plan.glide[0].pan, -1);
  assert.equal(plan.glide.at(-1).pan, 1);
  assert.deepEqual(plan.ticks.map(t => [t.kind, +t.t.toFixed(2)]), [['root', 1], ['y-intercept', 2], ['turning-point', 2.5], ['root', 4]]);
  const lowest = plan.glide.reduce((a, b) => (b.freq < a.freq ? b : a));
  assert.equal(lowest.x, 1);
});

test('sweep plan: bars are separate held notes, tallest highest', () => {
  const plan = sweepPlan(bars, { durationMs: 3000 });
  assert.equal(plan.tones.length, 3);
  assert.ok(plan.tones[0].freq > plan.tones[1].freq && plan.tones[1].freq > plan.tones[2].freq);
  assert.ok(plan.tones[0].end < plan.tones[1].start);
  assert.deepEqual(plan.ticks.map(t => t.t), [0, 1, 2]);
});
