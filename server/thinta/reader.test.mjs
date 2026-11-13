import test from 'node:test';
import assert from 'node:assert/strict';
import { readGraph, normaliseReading, checkImage, READING_SCHEMA } from './reader.mjs';
import { LIMITS } from '../../src/thinta/contract.js';

const IMAGE = 'A'.repeat(400);
const gemini = (obj, calls = []) => async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) };
};

test('readGraph sends the photo with a strict schema and no typed equation, and normalises the answer', async () => {
  const calls = [];
  const reading = await readGraph({
    imageBase64: `data:image/png;base64,${IMAGE}`, equationHint: 'y = x^2 - 2x - 8', apiKey: 'k',
    fetchImpl: gemini({ type: 'function', equation: ' y = x² − 2x − 8 ', roots: [4, '-2', 'junk'], turningPoint: { x: 1, y: -8.5 }, hasTurningPoint: true,
      xMin: -4, xMax: 6, xLabel: 'x', yMin: -10, yMax: 8, labels: ['y = x² − 2x − 8', 7, ''], points: [{ x: 0, y: -8 }, { x: 'a', y: 1 }], confidence: 1.7 }, calls),
  });
  assert.deepEqual(reading, {
    type: 'function', confidence: 1, labels: ['y = x² − 2x − 8'], questions: [],
    axes: { x: { min: -4, max: 6, label: 'x' }, y: { min: -10, max: 8 } },
    equation: 'y = x² − 2x − 8', points: [{ x: 0, y: -8 }], roots: [-2, 4], turningPoint: { x: 1, y: -8.5 },
  });
  const body = calls[0].body;
  assert.deepEqual(body.generationConfig.responseJsonSchema, READING_SCHEMA);
  assert.deepEqual(body.contents[0].parts[0], { inlineData: { data: IMAGE, mimeType: 'image/png' } });
  assert.match(body.contents[0].parts[1].text, /Do not work them out from the equation/);
  assert.ok(!JSON.stringify(body).includes('x^2 - 2x - 8'), 'the typed hint is not shown to the Reader');
});

test('straight lines drop the turning point; bar charts keep only labelled numeric bars', () => {
  assert.equal(normaliseReading({ type: 'function', turningPoint: { x: 0, y: 1 }, hasTurningPoint: false }).turningPoint, undefined);
  const bar = normaliseReading({ type: 'bar', bars: [{ label: 'Jan', value: 120 }, { label: '', value: 3 }, { label: 'Feb', value: null }], yMin: 0, yMax: 150, yLabel: 'Rainfall (mm)', confidence: 'x' });
  assert.deepEqual(bar, { type: 'bar', confidence: 0.5, labels: [], questions: [], axes: { y: { min: 0, max: 150, label: 'Rainfall (mm)' } }, bars: [{ label: 'Jan', value: 120 }] });
  assert.deepEqual(normaliseReading({}), { type: 'function', confidence: 0.5, labels: [], questions: [] });
});

test('image checks: empty, too large, wrong type, not base64', () => {
  assert.throws(() => checkImage('', undefined), /empty/);
  assert.throws(() => checkImage('A'.repeat(LIMITS.maxImageBytes + 1)), /too large/);
  assert.throws(() => checkImage(IMAGE, 'image/gif'), /JPEG, PNG or WebP/);
  assert.throws(() => checkImage('!'.repeat(200)), /base64/);
  assert.deepEqual(checkImage(IMAGE), { data: IMAGE, mimeType: 'image/jpeg' });
});

test('readGraph without a key fails before calling Gemini', async () => {
  let called = false;
  await assert.rejects(readGraph({ imageBase64: IMAGE, fetchImpl: async () => { called = true; } }), /GEMINI_API_KEY/);
  assert.equal(called, false);
});
