// Reader: Gemini vision turns the teacher's photo into a `reading`. It reports what it SEES, including its own
// read of the roots and turning point off the drawn curve, so the Prover has something honest to check.
import { LIMITS } from '../../src/thinta/contract.js';
import { geminiJSON } from './gemini.mjs';

const POINT = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] };
export const READING_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['function', 'bar'] },
    equation: { type: 'string', description: 'The equation exactly as written on the page, or empty if none is written' },
    roots: { type: 'array', items: { type: 'number' }, description: 'x values where the DRAWN curve crosses the x-axis, read off the picture' },
    turningPoint: { ...POINT, description: 'The lowest or highest point of the DRAWN curve, read off the picture' },
    hasTurningPoint: { type: 'boolean' },
    points: { type: 'array', items: POINT, description: 'Points marked or labelled on the drawing' },
    xMin: { type: 'number' }, xMax: { type: 'number' }, xLabel: { type: 'string' },
    yMin: { type: 'number' }, yMax: { type: 'number' }, yLabel: { type: 'string' },
    labels: { type: 'array', items: { type: 'string' }, description: 'Titles and labels written on the graph' },
    questions: { type: 'array', items: { type: 'string' }, description: 'Questions written on the page' },
    bars: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' } }, required: ['label', 'value'] } },
    confidence: { type: 'number', description: '0 to 1: how sure you are of your reads of the drawing' },
  },
  required: ['type', 'confidence'],
};

// The typed equation is deliberately not sent: the Reader must read the drawing, not solve the algebra.
const PROMPT = `This is a teacher's photo of a maths graph from a South African school worksheet: either a function graph (often a parabola drawn by hand, with its equation written beside it) or a bar chart. Report only what you can SEE in the picture.
- type: "function" for a curve or line, "bar" for a bar chart.
- equation: copy the equation exactly as written on the page, using ^ for powers (e.g. y = 2x^2 + 3x - 1). Empty if none is written.
- roots and turningPoint: read them off the DRAWN curve using the axis ticks and grid: where the curve crosses the x-axis, and its lowest or highest point. Do not work them out from the equation; another agent does the algebra and needs your independent read of the drawing, even if it is rough. Set hasTurningPoint false for a straight line.
- points: any points that are marked or labelled on the drawing.
- xMin, xMax, yMin, yMax: the smallest and largest values shown on each axis; xLabel, yLabel: the axis names.
- labels: titles and other labels written on the graph. questions: any questions written on the page.
- bars: for a bar chart, each bar's label and the value read against the axis, left to right.
- confidence: 0 to 1, how sure you are of your reads of the drawing.
Use plain numbers. Leave out anything you cannot see.`;

const num = v => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(+v) ? +v : undefined;
const point = p => p && num(p.x) !== undefined && num(p.y) !== undefined ? { x: num(p.x), y: num(p.y) } : undefined;
const texts = (list, max = 10) => (Array.isArray(list) ? list : []).filter(t => typeof t === 'string').map(t => t.trim().slice(0, 200)).filter(Boolean).slice(0, max);
const axis = (min, max, label) => {
  const a = { ...(num(min) !== undefined && { min: num(min) }), ...(num(max) !== undefined && { max: num(max) }), ...(typeof label === 'string' && label.trim() && { label: label.trim().slice(0, 60) }) };
  return 'min' in a && 'max' in a && a.min < a.max ? a : a.label ? { label: a.label } : undefined;
};

// Gemini output → contract `reading`: numbers only where they are finite, junk dropped, sensible caps.
export function normaliseReading(raw = {}) {
  const type = raw.type === 'bar' ? 'bar' : 'function';
  const confidence = Math.min(1, Math.max(0, num(raw.confidence) ?? 0.5));
  const x = axis(raw.xMin, raw.xMax, raw.xLabel), y = axis(raw.yMin, raw.yMax, raw.yLabel);
  const reading = { type, confidence, labels: texts(raw.labels), questions: texts(raw.questions) };
  if (x || y) reading.axes = { ...(x && { x }), ...(y && { y }) };
  if (type === 'bar') {
    reading.bars = (Array.isArray(raw.bars) ? raw.bars : []).map(b => ({ label: typeof b?.label === 'string' ? b.label.trim().slice(0, 40) : '', value: num(b?.value) }))
      .filter(b => b.label && b.value !== undefined).slice(0, 24);
    return reading;
  }
  if (typeof raw.equation === 'string' && raw.equation.trim()) reading.equation = raw.equation.trim().slice(0, 120);
  const points = (Array.isArray(raw.points) ? raw.points : []).map(point).filter(Boolean).slice(0, 20);
  if (points.length) reading.points = points;
  const roots = (Array.isArray(raw.roots) ? raw.roots : []).map(num).filter(v => v !== undefined).sort((a, b) => a - b).slice(0, 4);
  if (roots.length) reading.roots = roots;
  const tp = point(raw.turningPoint);
  if (tp && raw.hasTurningPoint !== false) reading.turningPoint = tp;
  return reading;
}

export class ReaderInputError extends Error {}

// Accepts raw base64 or a data: URL; the size cap matches /api/describe-images.
export function checkImage(imageBase64, mimeType) {
  if (typeof imageBase64 !== 'string') throw new ReaderInputError('Send the photo as a base64 image.');
  const match = imageBase64.match(/^data:(image\/[\w.+-]+);base64,/);
  const data = match ? imageBase64.slice(match[0].length) : imageBase64;
  if (data.length < 100) throw new ReaderInputError('The photo is empty. Take it again.');
  if (data.length > LIMITS.maxImageBytes) throw new ReaderInputError('The photo is too large (over 3.5 MB). Take it at a lower resolution.');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(data.slice(0, 2000))) throw new ReaderInputError('The photo is not valid base64.');
  const type = match?.[1] || mimeType || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(type)) throw new ReaderInputError('Use a JPEG, PNG or WebP photo.');
  return { data, mimeType: type };
}

// equationHint is accepted for the interface but not shown to Gemini (see PROMPT); the Prover uses it.
export async function readGraph({ imageBase64, mimeType, equationHint, apiKey, fetchImpl, timeoutMs }) {
  const image = checkImage(imageBase64, mimeType);
  const raw = await geminiJSON({ apiKey, fetchImpl, timeoutMs, schema: READING_SCHEMA, temperature: 0.1, parts: [{ inlineData: image }, { text: PROMPT }] });
  return normaliseReading(raw);
}
