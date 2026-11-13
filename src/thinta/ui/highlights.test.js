import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkOutcomes, outcomeSummary, headlines, groupLog, stepFocus, focusWords, shortReason } from './highlights.js';
import { EXAMPLE_PARABOLA_JOB } from '../contract.js';

// The real recorded live run (13 Nov): fresh eyes failed then passed, Deaf 0/5 → 5/5, audio escalated.
const recording = JSON.parse(readFileSync(new URL('../replay/recorded-parabola.json', import.meta.url), 'utf8'));
const recorded = recording.events.at(-1).event.job;

test('check outcomes say where each check ended, not how many attempts failed', () => {
  const outcomes = checkOutcomes(recorded);
  const byCheck = Object.fromEntries(outcomes.map(o => [o.check, o]));
  assert.equal(byCheck['reader-vs-prover'].status, 'passed');
  assert.equal(byCheck['fresh-eyes'].status, 'fixed');
  assert.equal(byCheck['access-deaf'].status, 'fixed');
  assert.equal(byCheck['access-deaf'].firstScore, '0/5');
  assert.equal(byCheck['access-deaf'].finalScore, '5/5');
  assert.equal(byCheck['access-audio'].status, 'open');
  assert.deepEqual(outcomeSummary(outcomes), { passed: 1, fixed: 2, open: 1, total: 4 });
});

test('headlines lead with the real self-corrections, in plain words', () => {
  const lines = headlines(recorded);
  const titles = lines.map(l => l.title);
  assert.ok(titles.includes('Fresh eyes caught an unclear print'));
  assert.ok(titles.includes('The Deaf solution was rewritten'));
  assert.ok(titles.includes('The audio description needs you'));
  assert.match(titles.join('|'), /moved \d+ labels/);
  const deaf = lines.find(l => l.title === 'The Deaf solution was rewritten');
  assert.equal(deaf.before, '0/5');
  assert.equal(deaf.after, '5/5');
  assert.equal(lines.find(l => /Fresh eyes/.test(l.title)).before, 'turning point missing');
  assert.ok(lines.every(l => !/turningPoint|tactile\.labels|PNG/.test(`${l.title} ${l.detail} ${l.before || ''}`)));
});

test('an overruled Reader becomes the first headline with before and after', () => {
  const [first] = headlines(EXAMPLE_PARABOLA_JOB);
  assert.equal(first.title, 'The Prover overruled the Reader');
  assert.equal(first.before, '(1, −8.5)');
  assert.equal(first.after, '(1, −9)');
});

test('label moves fold into one log line; other lines are kept in order', () => {
  const move = name => ({ kind: 'correction', agent: 'Designer', field: `tactile.labels.${name}`, before: { x: 1, y: 2 }, after: { x: 3, y: 4 } });
  const log = [{ kind: 'trace', agent: 'Designer' }, move('a'), move('b'), move('c'), { kind: 'review', check: 'fresh-eyes' }, move('d')];
  const grouped = groupLog(log);
  assert.deepEqual(grouped.map(i => i.kind), ['trace', 'label-moves', 'review', 'label-moves']);
  assert.equal(grouped[1].items.length, 3);
});

test('each Deaf step highlights what it talks about', () => {
  const proof = EXAMPLE_PARABOLA_JOB.proof;
  const kinds = text => stepFocus({ text }, proof).points.map(p => p.kind);
  assert.deepEqual(kinds('The graph crosses the x-axis at x = −2 and x = 4.'), ['root', 'root']);
  assert.deepEqual(kinds('The turning point is (1, −9).'), ['turning-point']);
  assert.deepEqual(kinds('The graph crosses the y-axis at (0, −8).'), ['y-intercept']);
  const below = stepFocus({ text: 'The curve is below the x-axis when −2 < x < 4.' }, proof);
  assert.deepEqual(below.region, { from: -2, to: 4, words: 'y < 0 here' });
  assert.deepEqual(stepFocus({ text: 'The equation is y = x² − 2x − 8.' }, proof).points, []);
  assert.match(focusWords(stepFocus({ text: 'Roots x = −2 and x = 4' }, proof)), /roots x = −2 and x = 4 marked/);
  assert.equal(stepFocus({ text: 'x-axis' }, { ...proof, bars: [{ label: 'Jan', value: 1 }] }), null);
});

test('fresh-eyes reasons lose the machinery', () => {
  assert.equal(shortReason('Gemini read the rendered PNG. fresh read: turning point missing (proof (1, -9))'), 'turning point missing');
});
