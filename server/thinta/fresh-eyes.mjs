// Fresh eyes: a second Gemini read that never sees the photo or the proof, only the tactile SVG the learner
// gets. It is backed by a deterministic geometry check of the SVG itself, then both are compared with the proof.
import { LIMITS } from '../../src/thinta/contract.js';
import { geminiJSON } from './gemini.mjs';

const POINT = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] };
export const FRESH_SCHEMA = {
  type: 'object',
  properties: {
    roots: { type: 'array', items: { type: 'number' }, description: 'x values where the curve crosses or touches the x-axis' },
    turningPoint: POINT, hasTurningPoint: { type: 'boolean' },
    bars: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' } }, required: ['label', 'value'] } },
    unclear: { type: 'array', items: { type: 'string' }, description: 'Anything a learner could not read or would find ambiguous' },
  },
  required: ['roots'],
};

const PROMPT = `This is a tactile graph that will be printed on swell paper for a blind learner. You have not seen the original worksheet. Read ONLY what this graphic shows a learner: its curve, axes, tick labels, and printed point labels.
Report where the curve crosses or touches the x-axis (roots), and its turning point (lowest or highest point) if it has one; set hasTurningPoint false for a straight line or a bar chart. For a bar chart, list each bar's label and value instead.
List in "unclear" anything missing, unlabelled or ambiguous. Use plain numbers. Do not guess values the graphic does not show.`;

const NUM = '[-−–]?\\d+(?:\\.\\d+)?';
const toNum = s => Number(String(s).replace(/[−–]/g, '-'));
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`))?.[1];
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#8722;|&minus;/g, '-');

// Deterministic read of the SVG: data-kind key points first (B's convention), else printed "(x, y)" / "x = n" labels.
export function svgKeyPoints(svg) {
  const roots = [], bars = []; let turningPoint, source = 'data';
  for (const [tag] of String(svg).matchAll(/<[a-z][^>]*\sdata-kind\s*=[^>]*>/gi)) {
    const kind = attr(tag, 'data-kind'), x = toNum(attr(tag, 'data-x')), y = toNum(attr(tag, 'data-y'));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (kind === 'root') roots.push(x);
    else if (kind === 'turning-point') turningPoint = { x, y };
    else if (kind === 'bar') bars.push({ label: attr(tag, 'data-label') || '', value: y });
  }
  if (!roots.length && !turningPoint && !bars.length) {
    source = 'labels';
    const text = [...String(svg).matchAll(/<(text|title|desc)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m => decode(m[2].replace(/<[^>]+>/g, ' '))).join('\n');
    const pairs = [...text.matchAll(new RegExp(`([a-z ]*)\\(\\s*(${NUM})\\s*[,;]\\s*(${NUM})\\s*\\)`, 'gi'))].map(m => ({ word: m[1].toLowerCase(), x: toNum(m[2]), y: toNum(m[3]) }));
    roots.push(...pairs.filter(p => p.y === 0).map(p => p.x));
    if (!roots.length) roots.push(...[...text.matchAll(new RegExp(`\\bx\\s*=\\s*(${NUM})`, 'gi'))].map(m => toNum(m[1])));
    const named = pairs.find(p => /turn|vertex|min|max|tp/.test(p.word));
    const others = pairs.filter(p => p.y !== 0 && p.x !== 0);
    turningPoint = named ? { x: named.x, y: named.y } : others.length === 1 ? { x: others[0].x, y: others[0].y } : undefined;
  }
  return { roots: [...new Set(roots)].sort((a, b) => a - b), ...(turningPoint && { turningPoint }), ...(bars.length && { bars }), source };
}

// Default rasteriser: resvg (native, small). Returns base64 PNG or null so callers fall back to the SVG text.
export async function rasteriseSvg(svg) {
  try {
    const { Resvg } = await import('@resvg/resvg-js');
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1000 }, background: 'white', font: { loadSystemFonts: true, defaultFontFamily: 'Arial' } }).render().asPng();
    return Buffer.from(png).toString('base64');
  } catch { return null; }
}

// What the learner sees, without our machine-readable answers: data-* attributes are removed before Gemini reads it.
export const printedSvg = svg => String(svg).replace(/\sdata-[\w-]+\s*=\s*("[^"]*"|'[^']*')/g, '');

const near = (a, b) => Math.abs(a - b) <= LIMITS.valueTolerance;
const show = v => v === undefined || v === null ? 'missing' : typeof v === 'number' ? String(v) : Array.isArray(v) ? `[${v.join(', ')}]` : `(${v.x}, ${v.y})`;

// Lists every value that disagrees with the proof or is missing, e.g. "turning point (1, -8) vs proof (1, -9)".
export function compareWithProof(read, proof) {
  const problems = [];
  if (proof.bars?.length) {
    for (const [i, bar] of proof.bars.entries()) {
      const got = read.bars?.find(b => b.label?.toLowerCase() === bar.label.toLowerCase()) || read.bars?.[i];
      if (!got || !near(got.value, bar.value)) problems.push(`bar ${bar.label} ${got ? got.value : 'missing'} vs proof ${bar.value}`);
    }
    return problems;
  }
  const roots = [...(read.roots || [])].sort((a, b) => a - b);
  for (const r of proof.roots) if (!roots.some(v => near(v, r))) problems.push(`root ${r} missing`);
  for (const v of roots) if (!proof.roots.some(r => near(v, r))) problems.push(`root ${v} is not a root of the proof`);
  const tp = read.turningPoint, want = proof.turningPoint;
  if (want && !tp) problems.push(`turning point missing (proof ${show(want)})`);
  else if (want && !(near(tp.x, want.x) && near(tp.y, want.y))) problems.push(`turning point ${show(tp)} vs proof ${show(want)}`);
  else if (!want && tp) problems.push(`turning point ${show(tp)} shown, but the proof has none`);
  return problems;
}

const finite = v => typeof v === 'number' && Number.isFinite(v);
function normalise(raw = {}) {
  const tp = raw.turningPoint;
  return {
    roots: (Array.isArray(raw.roots) ? raw.roots : []).filter(finite).sort((a, b) => a - b),
    ...(tp && finite(tp.x) && finite(tp.y) && raw.hasTurningPoint !== false && { turningPoint: { x: tp.x, y: tp.y } }),
    ...(Array.isArray(raw.bars) && raw.bars.length && { bars: raw.bars.filter(b => typeof b?.label === 'string' && finite(b.value)) }),
    unclear: (Array.isArray(raw.unclear) ? raw.unclear : []).filter(s => typeof s === 'string' && s.trim()).slice(0, 5),
  };
}

export async function freshEyes({ svg, proof, apiKey, fetchImpl, rasterise = rasteriseSvg, timeoutMs }) {
  if (typeof svg !== 'string' || !svg.includes('<svg')) throw new Error('Fresh eyes needs the tactile SVG.');
  const geometry = svgKeyPoints(svg);
  const printed = printedSvg(svg);
  const png = await rasterise(printed).catch(() => null);
  const parts = [
    ...(png ? [{ inlineData: { mimeType: 'image/png', data: png } }, { text: 'Above: the tactile graph as printed. Below: its SVG source, for any small text the picture blurs.' }] : [{ text: 'The tactile graph as SVG source:' }]),
    { text: printed.slice(0, 60000) }, { text: PROMPT },
  ];
  let gemini = null, geminiError = '';
  try { gemini = normalise(await geminiJSON({ apiKey, fetchImpl, timeoutMs, schema: FRESH_SCHEMA, parts, temperature: 0 })); }
  catch (error) { geminiError = error.message; }

  const seen = gemini || geometry;
  const geminiProblems = gemini ? compareWithProof(gemini, proof) : [];
  const geometryProblems = compareWithProof(geometry, proof);
  const after = proof.bars?.length ? proof.bars : { roots: proof.roots, turningPoint: proof.turningPoint ?? null };
  const before = proof.bars?.length ? seen.bars || [] : { roots: seen.roots, turningPoint: seen.turningPoint ?? null };
  const how = gemini ? `Gemini read the ${png ? 'rendered PNG' : 'SVG source'}` : `Gemini unavailable (${geminiError.slice(0, 80)}), SVG geometry only`;
  const issues = [...geminiProblems.map(p => `fresh read: ${p}`), ...geometryProblems.map(p => `SVG ${geometry.source}: ${p}`), ...(gemini?.unclear || []).map(u => `unclear: ${u}`)];
  // Brief §5.5: if Gemini cannot read it, the SVG's own geometry decides, and the reason says so.
  const pass = !geminiProblems.length && !geometryProblems.length;
  const reason = pass ? `${how}; roots and turning point match the proof within ${LIMITS.valueTolerance}` : `${how}. ${issues.join('; ')}`;
  return {
    reading: { roots: seen.roots, turningPoint: seen.turningPoint ?? null, ...(seen.bars && { bars: seen.bars }), method: gemini ? (png ? 'png' : 'svg-text') : 'geometry', geometry },
    review: { agent: 'Reviewer', check: 'fresh-eyes', pass, before, after, reason },
  };
}
