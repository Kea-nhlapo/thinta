import test from 'node:test';
import assert from 'node:assert/strict';
import { accessTest, meaningCheck, feedbackFrom, parseNumbers, normalize, grade, gradeAnswer, deafText } from './reviewer.mjs';
import { EXAMPLE_PARABOLA_JOB, DEFAULT_QUESTIONS } from '../../src/thinta/contract.js';

const proof = EXAMPLE_PARABOLA_JOB.proof;

// A fake Gemini that returns the given answers and records the prompt it was sent.
const fakeGemini = (answers, seen = {}) => async (url, init) => {
  seen.prompt = JSON.parse(init.body).contents[0].parts[0].text;
  const text = JSON.stringify({ answers: DEFAULT_QUESTIONS.map((question, i) => ({ question, answer: answers[i] })) });
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
};

test('spoken numbers, words and the unicode minus parse to signed values', () => {
  assert.deepEqual(parseNumbers('negative 9, minus two, four, −3'), [-9, -2, 4, -3]);
  assert.deepEqual(parseNumbers('y = 1 − 2 − 8 = −9'), [1, 2, 8, -9]);
  assert.deepEqual(parseNumbers('x² − 2x − 8'), [2, 8]);
  assert.deepEqual(parseNumbers('the point 1, negative 9'), [1, -9]);
  assert.equal(normalize('x equals negative two'), 'x = -2');
});

test('the example description scores 5/5 from the Gemini reader', async () => {
  const seen = {};
  const review = await accessTest({ version: 'audio', text: EXAMPLE_PARABOLA_JOB.description.en, proof, questions: DEFAULT_QUESTIONS, apiKey: 'k',
    fetchImpl: fakeGemini(['x = negative 2 and x = 4', '(1, -9)', 'a minimum', 'at negative 8', 'between x = -2 and x = 4'], seen) });
  assert.equal(review.score, 5); assert.equal(review.total, 5); assert.equal(review.pass, true);
  assert.equal(review.check, 'access-audio'); assert.equal(review.agent, 'Reviewer'); assert.deepEqual(review.failed, []);
  // The reader sees the text only, never the proof's values.
  assert.ok(seen.prompt.includes(EXAMPLE_PARABOLA_JOB.description.en));
  assert.ok(!seen.prompt.includes('x = -2 and x = 4'));
});

test('a description missing the turning point fails that question', async () => {
  const thin = 'A U-shaped curve. It crosses the x-axis at negative 2 and 4. It crosses the y-axis at negative 8.';
  const review = await accessTest({ version: 'deaf', text: thin, proof, questions: DEFAULT_QUESTIONS, apiKey: 'k',
    fetchImpl: fakeGemini(['-2 and 4', 'not stated', 'not stated', '-8', 'not stated']) });
  assert.equal(review.check, 'access-deaf');
  assert.equal(review.score, 2); assert.equal(review.pass, false);
  assert.deepEqual(review.failed.map(f => f.question), [DEFAULT_QUESTIONS[1], DEFAULT_QUESTIONS[2], DEFAULT_QUESTIONS[4]]);
  assert.equal(review.failed[0].expected, '(1, -9)');
  const feedback = feedbackFrom(review);
  assert.equal(feedback.length, 3);
  assert.match(feedback[0], /turning point/);
});

test('grading is strict about wrong values', () => {
  const q = DEFAULT_QUESTIONS; const e = proof.answers.map(a => a.answer);
  assert.equal(gradeAnswer(q[0], e[0], 'x = -2 and x = 3'), false);
  assert.equal(gradeAnswer(q[0], e[0], 'At (-2, 0) and (4, 0)'), true);
  assert.equal(gradeAnswer(q[1], e[1], '(1, -8)'), false);
  assert.equal(gradeAnswer(q[1], e[1], '1, negative 9'), true);
  assert.equal(gradeAnswer(q[2], e[2], 'maximum'), false);
  assert.equal(gradeAnswer(q[3], e[3], '(0, −8)'), true);
  assert.equal(gradeAnswer(q[4], e[4], 'x < -2 or x > 4'), false);
  assert.equal(gradeAnswer(q[4], e[4], 'y is less than 0 when x is between -2 and 4'), true);
  assert.equal(grade({ version: 'audio', questions: q, answers: ['-2, 4', '(1,-9)', 'minimum', '-8', 'not stated'], proof }).pass, true); // 4/5 passes
});

test('meaning check passes the example description and Deaf solution', () => {
  assert.deepEqual(meaningCheck(EXAMPLE_PARABOLA_JOB.description.en, proof), { pass: true, problems: [] });
  assert.equal(meaningCheck(deafText(EXAMPLE_PARABOLA_JOB.deafSolution), proof).pass, true);
  assert.equal(meaningCheck(EXAMPLE_PARABOLA_JOB.deafSolution.steps.map(s => s.visual).join('. '), proof).pass, true);
  assert.equal(meaningCheck('The curve is above the x-axis when x < -2 or x > 4. y is less than 0 for -2 < x < 4.', proof).pass, true);
});

test('meaning check catches a wrong turning point, a wrong inequality and a wrong root', () => {
  const tp = meaningCheck('The turning point is at (1, -8).', proof);
  assert.equal(tp.pass, false); assert.match(tp.problems[0].reason, /turning point given as \(1, -8\)/);
  const spoken = meaningCheck('Its lowest point, the turning point, is at 1, negative 8.', proof);
  assert.equal(spoken.pass, false);
  const ineq = meaningCheck('The curve is above the x-axis between -2 and 4.', proof);
  assert.equal(ineq.pass, false); assert.match(ineq.problems[0].reason, /above 0/);
  assert.equal(meaningCheck('Between x equals negative 2 and x equals 4 the curve is below the x-axis.', proof).pass, true);
  assert.equal(meaningCheck('It crosses the x-axis at x = −2 and x = 3.', proof).pass, false);
  assert.equal(meaningCheck('It crosses the y-axis at negative 9.', proof).pass, false);
  const stray = meaningCheck('The curve reaches 37 at the edge.', proof);
  assert.equal(stray.pass, false); assert.match(stray.problems[0].reason, /37 is not a value/);
  assert.match(feedbackFrom(tp)[0], /This sentence is wrong/);
});
