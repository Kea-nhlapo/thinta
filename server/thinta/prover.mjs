// Prover: the ground truth. Pure JS algebra, no AI. It overrules the Reader whenever the drawing and the
// algebra disagree by more than LIMITS.valueTolerance, and logs each overrule as a correction.
import { LIMITS, DEFAULT_QUESTIONS, sampleCurve } from '../../src/thinta/contract.js';

// Rounds away float noise (1e-15) and -0 so numbers read cleanly in descriptions and fixtures.
export const round = (v, dp = 4) => Math.round(v * 10 ** dp) / 10 ** dp + 0;
export const fmt = v => String(round(v, 2));

// Unicode as phones and textbooks write it: −, –, ², ³, ×, ÷, "f(x) =".
export function normaliseEquation(text) {
  return String(text || '').toLowerCase()
    .replace(/[−–—]/g, '-').replace(/²/g, '^2').replace(/³/g, '^3').replace(/[×·]/g, '*').replace(/÷/g, '/')
    .replace(/\*\*/g, '^').replace(/f\s*\(\s*x\s*\)/g, 'y').replace(/\s+/g, '');
}

// Tiny recursive-descent parser for + - * / ^, brackets and implicit multiplication ("2x", "(x-4)(x+2)").
function compile(expr) {
  const tokens = expr.match(/\d+(?:[.,]\d+)?|\.\d+|[x()+\-*/^]|./g) || [];
  let i = 0;
  const peek = () => tokens[i], next = () => tokens[i++];
  const fail = () => { throw new Error(`Cannot read "${expr}"`); };
  const primary = () => {
    const t = next();
    if (t === 'x') return x => x;
    if (t === '(') { const e = sum(); if (next() !== ')') fail(); return e; }
    if (/^[\d.]/.test(t || '')) { const n = Number(t.replace(',', '.')); return () => n; }
    return fail();
  };
  const unary = () => {
    if (peek() === '-') { next(); const u = unary(); return x => -u(x); }
    if (peek() === '+') { next(); return unary(); }
    const base = primary();
    if (peek() !== '^') return base;
    next(); const exp = unary(); return x => base(x) ** exp(x);
  };
  const product = () => {
    let left = unary();
    while (peek() === '*' || peek() === '/' || peek() === 'x' || peek() === '(' || /^[\d.]/.test(peek() || '')) {
      const op = ['*', '/'].includes(peek()) ? next() : '*', l = left, r = unary();
      left = op === '*' ? x => l(x) * r(x) : x => l(x) / r(x);
    }
    return left;
  };
  const sum = () => {
    let left = product();
    while (peek() === '+' || peek() === '-') { const op = next(), l = left, r = product(); left = op === '+' ? x => l(x) + r(x) : x => l(x) - r(x); }
    return left;
  };
  const f = sum();
  if (i < tokens.length) fail();
  return f;
}

// Any polynomial of degree ≤ 2 → {a,b,c}, found by evaluating at -1, 0, 1 and checked at 2 and 3. Null if unreadable.
export function parseEquation(text) {
  const norm = normaliseEquation(text);
  if (!norm || !norm.includes('x') && !/=/.test(norm) && !/\d/.test(norm)) return null;
  const sides = norm.split('=');
  if (sides.length > 2) return null;
  try {
    let f;
    if (sides.length === 1) f = compile(sides[0]);
    else if (sides[0] === 'y') f = compile(sides[1]);
    else if (sides[1] === 'y') f = compile(sides[0]);
    else { const l = compile(sides[0]), r = compile(sides[1]); f = x => l(x) - r(x); }
    const c = f(0), a = (f(1) + f(-1)) / 2 - c, b = (f(1) - f(-1)) / 2;
    const q = x => a * x * x + b * x + c;
    if (![a, b, c].every(Number.isFinite) || [2, 3, -3].some(x => Math.abs(f(x) - q(x)) > 1e-6 * (1 + Math.abs(f(x))))) return null;
    return { a: round(a, 6), b: round(b, 6), c: round(c, 6) };
  } catch { return null; }
}

export function formatEquation({ a, b, c }) {
  const terms = [[a, 'x^2'], [b, 'x'], [c, '']].filter(([k]) => k !== 0);
  if (!terms.length) return 'y = 0';
  return 'y = ' + terms.map(([k, v], i) => {
    const mag = Math.abs(k) === 1 && v ? '' : fmt(Math.abs(k));
    return `${i ? (k < 0 ? ' - ' : ' + ') : k < 0 ? '-' : ''}${mag}${v}`;
  }).join('');
}

const niceStep = width => [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100].find(s => width / s <= 60) || width / 40;

// Domain that holds every key point with margin; y = x² − 2x − 8 gives [-4, 6].
function domainFor(xs) {
  const lo = Math.min(...xs), hi = Math.max(...xs), m = Math.max(2, (hi - lo) * 0.25);
  let min = Math.floor(lo - m), max = Math.ceil(hi + m);
  if (max - min < 6) { const pad = Math.ceil((6 - (max - min)) / 2); min -= pad; max += pad; }
  return [min, max];
}

const intervalText = (roots, a, sign) => {
  // sign: -1 for y < 0, +1 for y > 0. For a line, a is the slope.
  const up = a > 0 === sign > 0;
  if (roots.length === 2) return up ? `x < ${fmt(roots[0])} or x > ${fmt(roots[1])}` : `${fmt(roots[0])} < x < ${fmt(roots[1])}`;
  if (roots.length === 1 && a !== 0 && roots.isLine) return up ? `x > ${fmt(roots[0])}` : `x < ${fmt(roots[0])}`;
  if (roots.length === 1) return up ? `all x except x = ${fmt(roots[0])}` : `no values of x (y is never ${sign < 0 ? 'less' : 'greater'} than 0)`;
  return up ? 'all values of x' : `no values of x (y is never ${sign < 0 ? 'less' : 'greater'} than 0)`;
};

function answerFunction(q, p, { a, b, c }) {
  const s = q.toLowerCase(), line = a === 0;
  if (line && b === 0 && /less than 0|<\s*0|below|greater than 0|>\s*0|above/.test(s)) return (c < 0) === /less|<|below/.test(s) && c !== 0 ? 'all values of x' : 'no values of x';
  if (/less than 0|<\s*0|below the x|negative/.test(s)) return intervalText(p.roots, line ? b : a, -1);
  if (/greater than 0|more than 0|>\s*0|above the x|positive/.test(s)) return intervalText(p.roots, line ? b : a, 1);
  if (/minimum|maximum/.test(s)) return line ? 'neither: a straight line has no turning point' : a > 0 ? 'minimum' : 'maximum';
  if (/turning point|vertex/.test(s)) return p.turningPoint ? `(${fmt(p.turningPoint.x)}, ${fmt(p.turningPoint.y)})` : 'a straight line has no turning point';
  if (/axis of symmetry/.test(s)) return p.turningPoint ? `x = ${fmt(p.turningPoint.x)}` : 'none';
  if (/y-axis|y axis|y-intercept|y intercept/.test(s)) return `y = ${fmt(c)}, at (0, ${fmt(c)})`;
  if (/x-axis|x axis|root|zero|x-intercept|solution|solve/.test(s)) {
    if (!p.roots.length) return 'it does not cross the x-axis (no real roots)';
    if (p.roots.length === 1 && !line) return `x = ${fmt(p.roots[0])} only (the graph touches the x-axis there)`;
    return p.roots.map(r => `x = ${fmt(r)}`).join(' and ');
  }
  return '';
}

const MONTHS = { jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June', jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December' };
const fullLabel = label => MONTHS[label.toLowerCase().slice(0, 3)] && label.length <= 4 ? MONTHS[label.toLowerCase().slice(0, 3)] : label;

function answerBar(q, bars, unit) {
  const s = q.toLowerCase(), byValue = [...bars].sort((m, n) => n.value - m.value);
  if (/most|highest|largest|biggest|greatest|tallest|maximum/.test(s)) return fullLabel(byValue[0].label);
  if (/least|lowest|smallest|fewest|shortest|minimum/.test(s)) return fullLabel(byValue.at(-1).label);
  const bar = bars.find(b => [b.label, fullLabel(b.label)].some(l => s.includes(l.toLowerCase())));
  if (bar) return `${fmt(bar.value)}${unit}`;
  if (/total|altogether|sum/.test(s)) return `${fmt(bars.reduce((t, b) => t + b.value, 0))}${unit}`;
  return '';
}

function proveBar(reading, questions) {
  const bars = (reading.bars || []).map(b => ({ label: String(b?.label ?? '').trim(), value: Number(b?.value) }))
    .filter(b => b.label && Number.isFinite(b.value)).map(b => ({ label: b.label, value: round(b.value) }));
  if (!bars.length) throw new Error('The Reader found no bars with a label and a number.');
  const unit = (reading.axes?.y?.label || '').match(/\(([^)]+)\)/)?.[1];
  const values = bars.map(b => b.value);
  const proof = {
    equation: '', roots: [], domain: [0, bars.length - 1], range: [Math.min(0, ...values), Math.max(...values)],
    bars, samples: bars.map((b, x) => ({ x, y: b.value })),
    answers: questions.map(question => ({ question, answer: answerBar(question, bars, unit ? ` ${unit}` : '') })),
  };
  return { proof, corrections: [] };
}

const pt = p => `(${fmt(p.x)}, ${fmt(p.y)})`;
const rootsText = r => r.length ? r.map(fmt).join(' and ') : 'none';

// Reader vs Prover: only real disagreements become corrections. If the Reader agreed, nothing is logged.
function compareReading(reading, proof, k, hintCoeffs) {
  const out = [], tol = LIMITS.valueTolerance, { a, b, c } = k;
  if (hintCoeffs && reading?.equation) {
    const read = parseEquation(reading.equation);
    if (!read || ['a', 'b', 'c'].some(key => Math.abs(read[key] - hintCoeffs[key]) > 1e-6))
      out.push({ agent: 'Prover', field: 'reading.equation', before: reading.equation, after: proof.equation, reason: `The teacher typed ${proof.equation}; the typed equation is used over the photo` });
  }
  if (Array.isArray(reading?.roots) && reading.roots.length) {
    const read = reading.roots.map(Number).filter(Number.isFinite).sort((m, n) => m - n);
    if (read.length !== proof.roots.length || read.some((r, i) => Math.abs(r - proof.roots[i]) > tol)) {
      const d = b * b - 4 * a * c;
      const reason = a === 0
        ? (b === 0 ? 'Algebra: y is constant, so there is no single x-intercept' : `Algebra: set y = 0, ${fmt(b)}x + ${fmt(c)} = 0, so x = ${rootsText(proof.roots)}`)
        : d < 0 ? `Algebra: b² - 4ac = ${fmt(d)} < 0, so there are no real roots`
          : `Algebra: b² - 4ac = ${fmt(d)}, x = (${fmt(-b)} ± ${fmt(Math.sqrt(d))}) / ${fmt(2 * a)} = ${rootsText(proof.roots)}`;
      out.push({ agent: 'Prover', field: 'reading.roots', before: read, after: proof.roots, reason });
    }
  }
  const tp = reading?.turningPoint;
  if (tp && Number.isFinite(+tp.x) && Number.isFinite(+tp.y)) {
    const before = { x: +tp.x, y: +tp.y }, after = proof.turningPoint || null;
    if (!after || Math.abs(before.x - after.x) > tol || Math.abs(before.y - after.y) > tol)
      out.push({ agent: 'Prover', field: 'reading.turningPoint', before, after,
        reason: after ? `Algebra: x = -b/2a = ${fmt(-b)}/${fmt(2 * a)} = ${fmt(after.x)}, y = f(${fmt(after.x)}) = ${fmt(after.y)}` : 'Algebra: a straight line has no turning point' });
  }
  return out;
}

export function prove(reading, { equationHint, questions } = {}) {
  const qs = Array.isArray(questions) && questions.length ? questions : DEFAULT_QUESTIONS;
  if (reading?.type === 'bar') return proveBar(reading, qs);
  const hintCoeffs = equationHint ? parseEquation(equationHint) : null;
  const k = hintCoeffs || parseEquation(reading?.equation);
  if (!k) throw new Error(`Could not read an equation from ${equationHint ? `"${equationHint}"` : reading?.equation ? `"${reading.equation}"` : 'the photo'}. Type it in, for example y = x^2 - 2x - 8.`);
  const { a, b, c } = k, f = x => a * x * x + b * x + c;

  let roots = [];
  if (a !== 0) {
    const d = b * b - 4 * a * c;
    if (Math.abs(d) < 1e-9) roots = [round(-b / (2 * a))];
    else if (d > 0) roots = [(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)].map(r => round(r)).sort((m, n) => m - n);
  } else if (b !== 0) { roots = [round(-c / b)]; roots.isLine = true; }
  const turningPoint = a !== 0 ? { x: round(-b / (2 * a)), y: round(f(-b / (2 * a))) } : undefined;

  const domain = domainFor([0, ...roots, ...(turningPoint ? [turningPoint.x] : [])]);
  const samples = sampleCurve(f, domain, niceStep(domain[1] - domain[0])).map(p => ({ x: round(p.x), y: round(p.y) }));
  const ys = [...samples.map(p => p.y), ...(turningPoint ? [turningPoint.y] : [])];
  const proof = {
    equation: formatEquation(k), coefficients: { a, b, c }, roots: [...roots], ...(turningPoint && { turningPoint }),
    yIntercept: round(c), domain, range: [Math.min(...ys), Math.max(...ys)], samples,
  };
  proof.answers = qs.map(question => ({ question, answer: answerFunction(question, { ...proof, roots }, k) }));
  return { proof, corrections: compareReading(reading, proof, k, hintCoeffs) };
}
