// Turns a proof into a tactile layout in mm on A4 landscape swell paper. Pure data: rules.js checks it,
// render.js draws it. Design follows BANA tactile-graphics practice: thick data line, thinner axes, no
// grid, sparse ticks, distinct marker shapes, braille key, nothing that relies on colour.
import { BRAILLE, brailleWidth, toBraille } from './braille.js';
import { ALL_SIDES, placeAt } from './rules.js';

export const PAGE = { w: 277, h: 190, margin: 4 }; // printable area of A4 landscape (297 x 210) with 10 mm edges
export const STROKES = { curve: 2, bar: 1.5, axis: 1, tick: 1, texture: 0.5 };
export const PRINT = { label: 3.5, emphasis: 4.5, title: 5, footer: 3.2 };
export const BETA_NOTE = 'Maths braille: beta, check with a transcriber';

const KEY_LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const charW = 0.58; // average sans-serif glyph width per mm of font size, slightly generous

export const num = v => String(Math.round(v * 100) / 100);
// ASCII minus in print coordinates so the fresh-eyes checker can parse them back (orchestrator request).
const printNum = v => num(v);
export const printCoord = p => `(${printNum(p.x)}, ${printNum(p.y)})`;
const brailleCoord = p => `(${num(p.x)},${num(p.y)})`;
export const prettyEquation = eq => String(eq || '').replace(/\^2/g, '²').replace(/\^3/g, '³').replace(/\*/g, '').replace(/-/g, '−');

// A label is a braille block plus a small print line for sighted teachers, measured as one rect.
export function makeLabel({ name, role, braille = '', print = '', printSize = PRINT.label, mode = 'row', anchor, pad = 2, sides = ALL_SIDES, optional = false, fixed = false, x, y }) {
  const bw = brailleWidth(braille);
  const pw = print.length * printSize * charW;
  const w = mode === 'row' ? bw + (print ? (bw ? 2 : 0) + pw : 0) : Math.max(bw, pw);
  const h = mode === 'row' ? Math.max(braille ? BRAILLE.cellH : 0, printSize * 1.2) : (braille ? BRAILLE.cellH + 1.5 : 0) + (print ? printSize * 1.2 : 0);
  const label = { name, role, braille, print, printSize, mode, anchor, pad, sides, optional, fixed, w, h, x, y };
  if (x === undefined) Object.assign(label, placeAt(label, sides[0], pad)); // natural spot: first side, nearest distance
  return label;
}

function niceStep(range, mmPerUnit, minMm) {
  for (const m of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (m * mmPerUnit >= minMm) return m;
  return range;
}

function chrome(layout, title) {
  const braille = toBraille(title);
  const maxCells = Math.floor((PAGE.w - 2 * PAGE.margin - 10) / BRAILLE.cellPitch);
  if (braille.length > maxCells) layout.warnings.push(`Title braille cut to ${maxCells} cells; read the print title`);
  layout.labels.push(
    makeLabel({ name: 'title', role: 'title', braille: braille.slice(0, maxCells), print: title, printSize: PRINT.title, mode: 'stack', fixed: true, x: 10, y: 7 }),
    makeLabel({ name: 'betaNote', role: 'note', print: BETA_NOTE, printSize: PRINT.footer, fixed: true, x: 10, y: PAGE.h - PAGE.margin - 6 }),
  );
}

const SHAPES = { root: 'circle', 'turning-point': 'square', 'y-intercept': 'triangle' };
const KIND_WORDS = { root: 'root', 'turning-point': 'turning point', 'y-intercept': 'y-intercept' };
const FEEDBACK_KEYS = { root: 'roots', 'turning-point': 'turningPoint', 'y-intercept': 'yIntercept' };

export function functionLayout(proof, { title, emphasize = [] } = {}) {
  const [xMin, xMax] = proof.domain;
  const ys = proof.samples.map(p => p.y);
  let yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys);
  const padY = (yMax - yMin) * 0.08 || 1;
  yMin -= padY; yMax += padY;
  const plot = { left: 20, right: 172, top: 36, bottom: 166 };
  const sx = (plot.right - plot.left) / (xMax - xMin), sy = (plot.bottom - plot.top) / (yMax - yMin);
  const toMm = p => ({ x: plot.left + (p.x - xMin) * sx, y: plot.bottom - (p.y - yMin) * sy });
  const xAxisY = toMm({ x: 0, y: yMin <= 0 && yMax >= 0 ? 0 : yMin }).y;
  const yAxisX = toMm({ x: xMin <= 0 && xMax >= 0 ? 0 : xMin, y: 0 }).x;
  const eq = prettyEquation(proof.equation);
  const layout = {
    kind: 'function', dataName: 'curve', page: PAGE, strokes: { data: STROKES.curve, axis: STROKES.axis },
    title: title || (eq ? `Graph of ${eq}` : 'Function graph'), equation: eq,
    plot: { ...plot, xMin, xMax, yMin, yMax, xAxisY, yAxisX },
    axes: [[{ x: plot.left, y: xAxisY }, { x: plot.right, y: xAxisY }], [{ x: yAxisX, y: plot.top }, { x: yAxisX, y: plot.bottom }]],
    ticks: [], dataLines: [proof.samples.filter(p => p.y >= yMin && p.y <= yMax).map(toMm)],
    markers: [], labels: [], warnings: [],
  };
  chrome(layout, eq || layout.title);

  // Key points, lettered in reading order: roots left to right, then turning point, then y-intercept.
  const points = [...proof.roots].sort((a, b) => a - b).map((x, i) => ({ name: `root${i + 1}`, kind: 'root', value: { x, y: 0 } }));
  if (proof.turningPoint) points.push({ name: 'turningPoint', kind: 'turning-point', value: proof.turningPoint });
  if (Number.isFinite(proof.yIntercept) && xMin <= 0 && xMax >= 0 && !proof.roots.some(r => Math.abs(r) < 1e-9 && Math.abs(proof.yIntercept) < 1e-9)) points.push({ name: 'yIntercept', kind: 'y-intercept', value: { x: 0, y: proof.yIntercept } });
  const keyX = 186;
  layout.labels.push(makeLabel({ name: 'keyHeading', role: 'key', braille: toBraille('key'), print: 'Key', mode: 'row', fixed: true, x: keyX, y: plot.top }));
  points.forEach((pt, i) => {
    const letter = KEY_LETTERS[i];
    const at = toMm(pt.value);
    const r = pt.kind === 'root' ? 1.75 : 2.2;
    layout.markers.push({ name: pt.name, kind: pt.kind, shape: SHAPES[pt.kind], key: letter.toUpperCase(), x: at.x, y: at.y, r, value: pt.value });
    const loud = emphasize.includes(FEEDBACK_KEYS[pt.kind]);
    // Default: one key letter at the point, full coordinates in the key. Emphasised: coordinates at the point.
    const label = loud
      ? makeLabel({ name: pt.name, role: 'point', braille: toBraille(`${num(pt.value.x)},${num(pt.value.y)}`), print: `${letter.toUpperCase()}: ${KIND_WORDS[pt.kind]} ${printCoord(pt.value)}`, printSize: PRINT.emphasis, mode: 'stack', anchor: at, pad: r + 2 })
      : makeLabel({ name: pt.name, role: 'point', braille: toBraille(letter), print: `${letter.toUpperCase()} ${printCoord(pt.value)}`, mode: 'stack', anchor: at, pad: r + 2 });
    layout.labels.push(label);
    layout.labels.push(makeLabel({ name: `key_${pt.name}`, role: 'key', braille: `${toBraille(letter)}⠀${toBraille(brailleCoord(pt.value))}`, print: `${letter.toUpperCase()} = ${KIND_WORDS[pt.kind]} ${printCoord(pt.value)}`, mode: 'stack', fixed: true, x: keyX, y: plot.top + 12 + i * 17 }));
  });

  // Axis names at the far ends, then sparse scale ticks (at least 30 mm apart), skipping key points.
  layout.labels.push(
    makeLabel({ name: 'axisX', role: 'axis', braille: toBraille('x'), print: 'x', anchor: { x: plot.right, y: xAxisY }, pad: 2, sides: ['right', 'upper-right', 'lower-right', 'above', 'below'] }),
    makeLabel({ name: 'axisY', role: 'axis', braille: toBraille('y'), print: 'y', anchor: { x: yAxisX, y: plot.top }, pad: 2, sides: ['upper-right', 'right', 'upper-left', 'left'] }),
  );
  const tick = (name, value, seg, anchor, sides) => {
    layout.ticks.push({ name, seg, value });
    layout.labels.push(makeLabel({ name, role: 'tick', braille: toBraille(num(value)), print: printNum(value), mode: 'stack', anchor, pad: 4, sides, optional: true }));
  };
  const xStep = niceStep(xMax - xMin, sx, 30);
  for (let v = Math.ceil(xMin / xStep) * xStep; v <= xMax + 1e-9; v += xStep) {
    if (Math.abs(v) < 1e-9 || proof.roots.some(r => Math.abs(r - v) < xStep / 3)) continue;
    const x = toMm({ x: v, y: 0 }).x;
    tick(`tickX_${num(v)}`, v, [{ x, y: xAxisY - 1.5 }, { x, y: xAxisY + 1.5 }], { x, y: xAxisY }, ['below', 'above']);
  }
  const yStep = niceStep(yMax - yMin, sy, 30);
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax + 1e-9; v += yStep) {
    if (Math.abs(v) < 1e-9 || (Number.isFinite(proof.yIntercept) && Math.abs(proof.yIntercept - v) < yStep / 3)) continue;
    const y = toMm({ x: 0, y: v }).y;
    tick(`tickY_${num(v)}`, v, [{ x: yAxisX - 1.5, y }, { x: yAxisX + 1.5, y }], { x: yAxisX, y }, ['left', 'right']);
  }

  const parts = points.map(pt => `${KIND_WORDS[pt.kind]} ${printCoord(pt.value)}`);
  const shape = proof.coefficients?.a ? (proof.coefficients.a > 0 ? ' U-shaped (opens upward, so the turning point is a minimum).' : ' Opens downward (the turning point is a maximum).') : '';
  layout.desc = `Tactile graph of ${eq || 'a function'} for x from ${printNum(xMin)} to ${printNum(xMax)}.${shape} Key points: ${parts.join('; ')}. Solid circles are roots, the square is the turning point, the triangle is the y-intercept. ${BETA_NOTE}.`;
  return layout;
}

// Distinct tactile fills (never colour): each is a set of lines clipped to the bar.
// No dot texture: small dots inside a bar would read as stray braille under a finger.
const TEXTURES = ['diagonal', 'horizontal', 'cross', 'vertical', 'none'];

function texture(kind, r) {
  const lines = [], dots = [];
  const gap = 4;
  if (kind === 'horizontal' || kind === 'cross') for (let y = r.y + gap; y < r.y + r.h - 1; y += gap) lines.push([{ x: r.x, y }, { x: r.x + r.w, y }]);
  if (kind === 'vertical' || kind === 'cross') for (let x = r.x + gap; x < r.x + r.w - 1; x += gap) lines.push([{ x, y: r.y }, { x, y: r.y + r.h }]);
  if (kind === 'diagonal') {
    // 45-degree lines x - y = c, clipped to the rect.
    for (let c = r.x - (r.y + r.h) + gap * 1.4; c < r.x + r.w - r.y; c += gap * 1.4) {
      const y1 = Math.max(r.y, r.x - c), y2 = Math.min(r.y + r.h, r.x + r.w - c);
      if (y2 - y1 > 0.5) lines.push([{ x: y1 + c, y: y1 }, { x: y2 + c, y: y2 }]);
    }
  }
  return { kind, lines, dots };
}

export function barLayout(proof, { title, yLabel, emphasize = [] } = {}) {
  const bars = proof.bars || [];
  const vMax = Math.max(0, ...bars.map(b => b.value)) * 1.15 || 1;
  const plot = { left: 28, right: 262, top: 50, bottom: 152 };
  const slot = (plot.right - plot.left) / Math.max(bars.length, 1);
  const sy = (plot.bottom - plot.top) / vMax;
  const loud = emphasize.includes('bars');
  const layout = {
    kind: 'bar', dataName: 'bar outlines', page: PAGE, strokes: { data: STROKES.bar, axis: STROKES.axis },
    title: title || 'Bar chart', plot: { ...plot, yMin: 0, yMax: vMax, xAxisY: plot.bottom, yAxisX: plot.left },
    axes: [[{ x: plot.left, y: plot.bottom }, { x: plot.right, y: plot.bottom }], [{ x: plot.left, y: plot.top - 6 }, { x: plot.left, y: plot.bottom }]],
    ticks: [], dataLines: [], bars: [], markers: [], labels: [], warnings: [],
  };
  chrome(layout, layout.title);
  if (bars.length > TEXTURES.length) layout.warnings.push(`${bars.length} bars but only ${TEXTURES.length} distinct textures; some repeat`);
  bars.forEach((b, i) => {
    const w = Math.min(slot * 0.6, 40);
    const rect = { x: plot.left + slot * i + (slot - w) / 2, y: plot.bottom - b.value * sy, w, h: b.value * sy };
    const cx = rect.x + w / 2;
    layout.bars.push({ name: `bar${i + 1}`, index: i, label: b.label, value: b.value, rect, texture: texture(TEXTURES[i % TEXTURES.length], rect) });
    layout.dataLines.push([{ x: rect.x, y: plot.bottom }, { x: rect.x, y: rect.y }, { x: rect.x + w, y: rect.y }, { x: rect.x + w, y: plot.bottom }]);
    layout.labels.push(
      makeLabel({ name: `value${i + 1}`, role: 'value', braille: toBraille(num(b.value)), print: num(b.value), printSize: loud ? PRINT.emphasis : PRINT.label, mode: 'stack', anchor: { x: cx, y: rect.y }, pad: 4.5, sides: ['above', 'upper-right', 'upper-left'] }),
      makeLabel({ name: `category${i + 1}`, role: 'category', braille: toBraille(b.label), print: b.label, printSize: loud ? PRINT.emphasis : PRINT.label, mode: 'stack', anchor: { x: cx, y: plot.bottom }, pad: 2, sides: ['below', 'lower-right', 'lower-left'] }),
    );
  });
  if (yLabel) layout.labels.push(makeLabel({ name: 'axisY', role: 'axis', braille: toBraille(yLabel), print: yLabel, mode: 'stack', anchor: { x: plot.left, y: plot.top - 6 }, pad: 2, sides: ['upper-right', 'right', 'above'] }));
  layout.desc = `Tactile bar chart: ${layout.title}. ${bars.length} bars, left to right: ${bars.map((b, i) => `${b.label} ${num(b.value)} (${TEXTURES[i % TEXTURES.length]} texture)`).join(', ')}.${yLabel ? ` Values in ${yLabel}.` : ''} ${BETA_NOTE}.`;
  return layout;
}
