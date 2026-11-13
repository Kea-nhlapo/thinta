import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE_BAR_JOB, EXAMPLE_PARABOLA_JOB, LIMITS } from '../contract.js';
import { autoFix, BETA_NOTE, checkRules, designTactile, fixTactile, functionLayout, labelProblems, svgToDataUrl, svgToPdf, svgToPdfDataUrl, toBraille } from './index.js';

const parabola = EXAMPLE_PARABOLA_JOB.proof;
const markers = svg => [...svg.matchAll(/<g class="key-point" data-kind="([^"]+)" data-x="([^"]+)" data-y="([^"]+)"/g)].map(m => ({ kind: m[1], x: +m[2], y: +m[3] }));

test('demo parabola: markers at the roots, turning point and y-intercept in maths coordinates', () => {
  const { svg } = designTactile(parabola, { type: 'function' });
  assert.match(svg, /width="277mm" height="190mm" viewBox="0 0 277 190"/);
  assert.match(svg, /<title id="thinta-title">[^<]+<\/title>/);
  assert.match(svg, /<desc id="thinta-desc">[^<]*\(1, -9\)[^<]*<\/desc>/);
  assert.deepEqual(markers(svg), [
    { kind: 'root', x: -2, y: 0 }, { kind: 'root', x: 4, y: 0 },
    { kind: 'turning-point', x: 1, y: -9 }, { kind: 'y-intercept', x: 0, y: -8 },
  ]);
  for (const t of ['A (-2, 0)', 'B (4, 0)', 'C (1, -9)', 'D (0, -8)']) assert.ok(svg.includes(`>${t}</text>`), t);
  assert.ok(svg.includes(BETA_NOTE));
  assert.doesNotMatch(svg, /<pattern|transform=|fill="(red|blue|green)/);
});

test('every rule passes after auto-fix, and the fixes are real geometry moves', () => {
  const t = designTactile(parabola);
  assert.ok(t.initialChecks.some(c => !c.pass), 'natural label spots should collide on this parabola');
  for (const c of t.ruleChecks) assert.equal(c.pass, true, `${c.rule}: ${c.detail}`);
  assert.ok(t.corrections.length >= 1);
  for (const c of t.corrections) {
    assert.equal(c.agent, 'Designer');
    assert.match(c.field, /^tactile\.labels\./);
    assert.notDeepEqual(c.before, c.after);
    const label = t.layout.labels.find(l => `tactile.labels.${l.name}` === c.field);
    assert.ok(labelProblems(t.layout, label).ok, c.field);
  }
  // Every label really is clear of the curve by the print-scale minimum.
  for (const l of t.layout.labels) assert.ok(labelProblems(t.layout, l).curveGap >= LIMITS.minLabelGapMm, l.name);
});

test('a deliberately crowded label is moved off the curve and logged', () => {
  const layout = functionLayout(parabola);
  const label = layout.labels.find(l => l.name === 'turningPoint');
  const vertex = layout.markers.find(m => m.name === 'turningPoint');
  Object.assign(label, { x: vertex.x - label.w / 2, y: vertex.y - label.h / 2 }); // dead on the vertex
  assert.equal(checkRules(layout).find(c => c.rule === 'label-gap').pass, false);
  const { layout: fixed, corrections } = autoFix(layout);
  const c = corrections.find(x => x.field === 'tactile.labels.turningPoint');
  assert.ok(c, 'turning point label should be corrected');
  assert.deepEqual(c.before, { x: Math.round(vertex.x * 10) / 10, y: Math.round(vertex.y * 10) / 10 });
  assert.match(c.reason, /from the curve \(needs 3\.2 mm\)/);
  assert.ok(checkRules(fixed).every(r => r.pass));
});

test('stroke hierarchy fails when the curve is not thicker than the axes', () => {
  const layout = functionLayout(parabola);
  layout.strokes = { data: 1, axis: 1 };
  assert.equal(checkRules(layout).find(c => c.rule === 'stroke-hierarchy').pass, false);
});

test('fixTactile makes the reported labels larger and explicit, then re-checks', () => {
  const first = designTactile(parabola);
  const next = fixTactile(parabola, first, { missing: ['turningPoint'], unclear: ['roots'] });
  assert.ok(next.svg.includes('>C: turning point (1, -9)</text>'));
  assert.ok(next.svg.includes('>A: root (-2, 0)</text>'));
  const tp = next.layout.labels.find(l => l.name === 'turningPoint');
  assert.equal(tp.braille, toBraille('1,-9'));
  assert.ok(tp.printSize > first.layout.labels.find(l => l.name === 'turningPoint').printSize);
  assert.ok(next.corrections.some(c => c.field === 'tactile.labels.turningPoint' && /missing/.test(c.reason)));
  for (const c of next.ruleChecks) assert.equal(c.pass, true, `${c.rule}: ${c.detail}`);
});

test('bar chart renders one textured, outlined bar per value with braille values', () => {
  const t = designTactile(EXAMPLE_BAR_JOB.proof, { type: 'bar', title: 'Rainfall in Johannesburg', yLabel: 'Rainfall (mm)' });
  const bars = [...t.svg.matchAll(/<g class="bar" data-kind="bar" data-x="(\d+)" data-y="([\d.]+)" data-label="([^"]+)" data-texture="([^"]+)"/g)];
  assert.equal(bars.length, 3);
  assert.deepEqual(bars.map(b => +b[2]), [120, 95, 80]);
  assert.equal(new Set(bars.map(b => b[4])).size, 3, 'textures must differ');
  assert.ok(t.svg.includes(`data-braille="${toBraille('120')}"`));
  for (const c of t.ruleChecks) assert.equal(c.pass, true, `${c.rule}: ${c.detail}`);
});

test('downloads: SVG data URL and a well-formed vector PDF', () => {
  const { svg } = designTactile(parabola);
  assert.ok(svgToDataUrl(svg).startsWith('data:image/svg+xml;charset=utf-8,%3Csvg'));
  const pdf = svgToPdf(svg);
  const text = String.fromCharCode(...pdf.subarray(0, 20));
  assert.ok(text.startsWith('%PDF-1.4'));
  const all = Array.from(pdf, b => String.fromCharCode(b)).join('');
  const xref = +all.match(/startxref\n(\d+)/)[1];
  assert.ok(all.slice(xref).startsWith('xref'));
  assert.ok(all.includes(String.raw`(C \(1, -9\)) Tj`), 'print label drawn as PDF text');
  assert.doesNotMatch(all, / l \d+(\.\d+)? w S/, 'line width must not be set inside a path');
  assert.match(all, /\/MediaBox \[0 0 841\.89 595\.276\]/);
  assert.ok(svgToPdfDataUrl(svg).startsWith('data:application/pdf;base64,JVBERi0xLjQ'));
});

test('label-near-own-point: a label parked by another key point fails, and auto-fix brings it home', () => {
  const layout = functionLayout(parabola);
  const label = layout.labels.find(l => l.name === 'root1');
  const other = layout.markers.find(m => m.name === 'root2');
  Object.assign(label, { x: other.x - label.w / 2, y: other.y - 6 - label.h });
  assert.deepEqual(checkRules(layout).find(c => c.rule === 'label-near-own-point').labels, ['root1']);
  const { layout: fixed } = autoFix(layout);
  const p = labelProblems(fixed, fixed.labels.find(l => l.name === 'root1'));
  assert.ok(p.nearOwn && p.ownDist <= 15);
  for (const l of designTactile(parabola).layout.labels.filter(x => x.role === 'point')) assert.ok(labelProblems(designTactile(parabola).layout, l).nearOwn, l.name);
});
