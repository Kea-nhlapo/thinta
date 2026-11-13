import test from 'node:test';
import assert from 'node:assert/strict';
import { explain, explainPrompt, speakDescription, speechChunks } from './explainer.mjs';
import { EXAMPLE_PARABOLA_JOB } from '../../src/thinta/contract.js';

const ex = EXAMPLE_PARABOLA_JOB;
const geminiReturning = (body, seen = {}) => async (url, init) => {
  seen.prompt = JSON.parse(init.body).contents[0].parts[0].text;
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }) };
};
const good = { description: ex.description.en, steps: ex.deafSolution.steps, keyTerms: ['root', 'Turning Point', 'MINIMUM'] };

test('the prompt lists the proof values as the only allowed numbers and carries feedback', () => {
  const prompt = explainPrompt(ex.proof, ex.reading, ['A blind listener could not answer "What is the turning point of the graph?"']);
  assert.match(prompt, /ONLY numbers you may use/);
  assert.match(prompt, /Turning point: \(1, -9\), a minimum/);
  assert.match(prompt, /Between x = -2 and x = 4 the curve is below the x-axis/);
  assert.match(prompt, /FAILED A CHECK[\s\S]*turning point of the graph/);
  assert.doesNotMatch(explainPrompt(ex.proof, ex.reading), /FAILED/);
});

test('explain returns description, Deaf steps, uppercase key terms and isiZulu', async () => {
  const calls = [];
  const out = await explain({ proof: ex.proof, reading: ex.reading, apiKey: 'k', fetchImpl: geminiReturning(good),
    translate: async (text, from, to) => { calls.push([from, to]); return { text: 'Ijika ... u-x elingana no-negethivu 2 no-4, 1, negethivu 9, negethivu 8, 0' }; } });
  assert.equal(out.description.en, ex.description.en);
  assert.match(out.description.zu, /negethivu/);
  assert.deepEqual(calls, [['en', 'zu']]);
  assert.deepEqual(out.deafSolution.keyTerms, ['ROOT', 'TURNING POINT', 'MINIMUM']);
  assert.equal(out.deafSolution.steps.length, 5);
  assert.equal(out.meaning.description.pass, true);
  assert.equal(out.meaning.deafSolution.pass, true);
  assert.deepEqual(out.warnings, []);
});

test('a wrong value from Gemini is caught by the meaning check, and a failed translation leaves zu empty', async () => {
  const bad = { ...good, description: 'A U-shaped curve. The turning point is at 1, negative 8.' };
  const out = await explain({ proof: ex.proof, reading: ex.reading, apiKey: 'k', fetchImpl: geminiReturning(bad), translate: async () => { throw new Error('busy'); } });
  assert.equal(out.meaning.description.pass, false);
  assert.equal(out.description.zu, '');
  assert.match(out.warnings[0], /isiZulu translation failed/);
});

test('speakDescription speaks both languages and splits long text under the speak limit', async () => {
  const said = [];
  const audio = await speakDescription({ description: { en: 'One. Two.', zu: 'Kunye.' }, speak: async (text, lang) => { said.push([text, lang]); return `${lang}.wav`; } });
  assert.deepEqual(audio, { en: 'en.wav', zu: 'zu.wav' });
  assert.equal(said.length, 2);
  const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  assert.ok(speechChunks(long).length > 1 && speechChunks(long).every(c => c.length <= 400));
  assert.deepEqual(await speakDescription({ description: { en: 'Hi.', zu: '' }, speak: async () => { throw new Error('down'); } }), { en: null, zu: null });
});
