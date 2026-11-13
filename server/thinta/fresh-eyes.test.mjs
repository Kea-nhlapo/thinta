import test from 'node:test';
import assert from 'node:assert/strict';
import { freshEyes, svgKeyPoints, printedSvg, compareWithProof } from './fresh-eyes.mjs';
import { EXAMPLE_PARABOLA_JOB, EXAMPLE_BAR_JOB } from '../../src/thinta/contract.js';

const proof = EXAMPLE_PARABOLA_JOB.proof;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 200"><title>y = x^2 - 2x - 8</title>
<path d="M10 10 Q 140 300 270 10" stroke-width="2"/>
<circle data-kind="root" data-x="-2" data-y="0" cx="60" cy="100" r="3"/><circle cx="200" cy="100" r="3" data-y="0" data-x="4" data-kind="root"/>
<circle data-kind="turning-point" data-x="1" data-y="-9" cx="130" cy="180" r="3"/>
<text x="60" y="90">(−2, 0)</text><text x="200" y="90">(4, 0)</text><text x="130" y="195">turning point (1, -9)</text></svg>`;
const gemini = (obj, calls = []) => async (url, init) => {
  calls.push(JSON.parse(init.body));
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) };
};

test('geometry: data-kind key points in any attribute order, else printed labels', () => {
  assert.deepEqual(svgKeyPoints(SVG), { roots: [-2, 4], turningPoint: { x: 1, y: -9 }, source: 'data' });
  assert.deepEqual(svgKeyPoints(printedSvg(SVG)), { roots: [-2, 4], turningPoint: { x: 1, y: -9 }, source: 'labels' });
  assert.deepEqual(svgKeyPoints('<svg><text>x = -2</text><text>x = 4</text><text>(0, -8)</text></svg>'), { roots: [-2, 4], source: 'labels' });
  assert.ok(!printedSvg(SVG).includes('data-'));
});

test('compareWithProof names each missing or wrong value', () => {
  assert.deepEqual(compareWithProof({ roots: [-2, 4.2], turningPoint: { x: 1, y: -9.1 } }, proof), []);
  assert.deepEqual(compareWithProof({ roots: [4], turningPoint: { x: 1, y: -8 } }, proof), ['root -2 missing', 'turning point (1, -8) vs proof (1, -9)']);
  assert.deepEqual(compareWithProof({ roots: [-2, 4, 6] }, proof), ['root 6 is not a root of the proof', 'turning point missing (proof (1, -9))']);
  assert.deepEqual(compareWithProof({ bars: [{ label: 'Jan', value: 120 }, { label: 'Feb', value: 90 }] }, EXAMPLE_BAR_JOB.proof), ['bar Feb 90 vs proof 95', 'bar Mar missing vs proof 80']);
});

test('fresh eyes sends only the printed graphic (PNG + SVG source), never the proof or the photo', async () => {
  const calls = [];
  const out = await freshEyes({ svg: SVG, proof, apiKey: 'k', rasterise: async svg => (assert.ok(!svg.includes('data-')), 'UE5HPNG'),
    fetchImpl: gemini({ roots: [-2, 4], turningPoint: { x: 1, y: -9 }, hasTurningPoint: true, unclear: [] }, calls) });
  assert.equal(out.review.pass, true);
  assert.equal(out.review.agent, 'Reviewer');
  assert.equal(out.review.check, 'fresh-eyes');
  assert.equal(out.reading.method, 'png');
  assert.deepEqual(out.reading.roots, [-2, 4]);
  const sent = JSON.stringify(calls[0]);
  assert.equal(calls[0].contents[0].parts[0].inlineData.mimeType, 'image/png');
  assert.ok(!sent.includes('data-kind') && !sent.includes('Algebra'), 'no answers leak in');
});

test('a disagreeing fresh read fails with the values that differ; SVG text is used when rasterising fails', async () => {
  const out = await freshEyes({ svg: SVG, proof, apiKey: 'k', rasterise: async () => null,
    fetchImpl: gemini({ roots: [-2], turningPoint: { x: 1, y: -8 }, hasTurningPoint: true, unclear: ['root at 4 has no label'] }) });
  assert.equal(out.review.pass, false);
  assert.equal(out.reading.method, 'svg-text');
  assert.match(out.review.reason, /root 4 missing/);
  assert.match(out.review.reason, /turning point \(1, -8\) vs proof \(1, -9\)/);
  assert.match(out.review.reason, /unclear: root at 4 has no label/);
  assert.deepEqual(out.review.before, { roots: [-2], turningPoint: { x: 1, y: -8 } });
  assert.deepEqual(out.review.after, { roots: [-2, 4], turningPoint: { x: 1, y: -9 } });
});

test('without Gemini the SVG geometry decides, and says so; a broken SVG fails it', async () => {
  const ok = await freshEyes({ svg: SVG, proof, rasterise: async () => null });
  assert.equal(ok.review.pass, true);
  assert.equal(ok.reading.method, 'geometry');
  assert.match(ok.review.reason, /Gemini unavailable.*geometry only/);
  const bad = await freshEyes({ svg: '<svg><text>(-2, 0)</text></svg>', proof, rasterise: async () => null });
  assert.equal(bad.review.pass, false);
  assert.match(bad.review.reason, /root 4 missing/);
  await assert.rejects(freshEyes({ svg: '', proof }), /needs the tactile SVG/);
});
