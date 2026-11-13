// Thinta's Sonifier, the pure half: turns a proof into sound data (samples plus key points) and the maths the
// touch graph needs (pitch, interpolation, key-point lookup, spoken wording). No browser APIs, so it runs
// under `node --test` and on the server.

export const LOW_HZ = 220;
export const HIGH_HZ = 880;

const round = (n, places = 4) => +(+n).toFixed(places);

// Bar charts become one sample per bar at x = 0, 1, 2 …; function graphs keep the Prover's samples.
export function sonify(proof) {
  if (!proof) return { samples: [], keyPoints: [] };
  if (proof.bars?.length) {
    const samples = proof.bars.map((bar, i) => ({ x: i, y: bar.value }));
    return { samples, keyPoints: samples.map(p => ({ ...p, kind: 'bar' })) };
  }
  const samples = (proof.samples || []).slice().sort((a, b) => a.x - b.x);
  const [min, max] = proof.domain || [samples[0]?.x, samples.at(-1)?.x];
  const inside = x => x >= min - 1e-9 && x <= max + 1e-9;
  const keyPoints = [];
  for (const x of proof.roots || []) if (inside(x)) keyPoints.push({ x: round(x), y: 0, kind: 'root' });
  if (proof.turningPoint && inside(proof.turningPoint.x)) keyPoints.push({ x: round(proof.turningPoint.x), y: round(proof.turningPoint.y), kind: 'turning-point' });
  // The y-intercept only exists on the drawing when x = 0 is in the domain.
  if (inside(0)) {
    const y = Number.isFinite(proof.yIntercept) ? proof.yIntercept : yAt(samples, 0);
    // A root at the origin is the same point; keep it once, as the root.
    if (y !== null && !keyPoints.some(p => Math.abs(p.x) < 1e-9 && Math.abs(p.y - y) < 1e-9)) keyPoints.push({ x: 0, y: round(y), kind: 'y-intercept' });
  }
  keyPoints.sort((a, b) => a.x - b.x);
  return { samples, keyPoints };
}

// Lowest and highest y the learner can hear; bars always start from 0 so heights compare fairly.
export function yRange(sound) {
  const ys = [...(sound.samples || []), ...(sound.keyPoints || [])].map(p => p.y);
  if (!ys.length) return [0, 1];
  let min = Math.min(...ys), max = Math.max(...ys);
  if (sound.keyPoints?.some(p => p.kind === 'bar')) min = Math.min(0, min);
  if (max - min < 1e-9) { min -= 1; max += 1; }
  return [min, max];
}

// Higher y = higher pitch, on a log scale so equal steps in y sound like equal musical steps.
export function pitchFor(y, [min, max], { low = LOW_HZ, high = HIGH_HZ } = {}) {
  const t = max > min ? Math.min(1, Math.max(0, (y - min) / (max - min))) : 0.5;
  return low * Math.pow(high / low, t);
}

// Straight-line interpolation between samples; outside the samples the nearest end is used.
export function yAt(samples, x) {
  if (!samples?.length) return null;
  if (x <= samples[0].x) return samples[0].y;
  if (x >= samples.at(-1).x) return samples.at(-1).y;
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid].x <= x) lo = mid; else hi = mid; }
  const a = samples[lo], b = samples[hi];
  return b.x === a.x ? a.y : a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
}

export function nearestKeyPoint(x, keyPoints, tolerance = Infinity) {
  let best = null;
  for (const p of keyPoints || []) if (Math.abs(p.x - x) <= tolerance && (!best || Math.abs(p.x - x) < Math.abs(best.x - x))) best = p;
  return best;
}

// Key points a finger passed over between two readings, in the order it met them. A fast swipe can jump
// right over a root, so tolerance alone would miss it.
export function crossedKeyPoints(fromX, toX, keyPoints) {
  if (fromX === null || fromX === undefined || fromX === toX) return [];
  const [lo, hi] = fromX < toX ? [fromX, toX] : [toX, fromX];
  const hit = (keyPoints || []).filter(p => (fromX < toX ? p.x > lo && p.x <= hi : p.x >= lo && p.x < hi));
  return fromX < toX ? hit : hit.reverse();
}

// Whether a turning point is the bottom or the top of the curve, from the samples either side.
export function turningKind(samples, point) {
  const span = (samples.at(-1)?.x ?? 1) - (samples[0]?.x ?? 0);
  const d = Math.max(span / 50, 1e-3);
  const around = (yAt(samples, point.x - d) + yAt(samples, point.x + d)) / 2;
  return around >= point.y ? 'minimum' : 'maximum';
}

// Numbers as a screen reader should say them: "minus 2", never "dash 2" or "hyphen 2".
export function spokenNumber(n) {
  const value = round(n, 2);
  return value < 0 ? `minus ${String(-value)}` : String(value === 0 ? 0 : value);
}

// One sentence per key point, e.g. "Root at x equals minus 2" or "Turning point, minimum, at 1, minus 9".
export function describeKeyPoint(point, { samples = [], bars = [], unit = '' } = {}) {
  const say = spokenNumber;
  if (point.kind === 'root') return `Root at x equals ${say(point.x)}`;
  if (point.kind === 'turning-point') return `Turning point, ${turningKind(samples, point)}, at ${say(point.x)}, ${say(point.y)}`;
  if (point.kind === 'y-intercept') return `Crosses the y-axis at y equals ${say(point.y)}`;
  if (point.kind === 'bar') {
    const label = bars[point.x]?.label ?? `Bar ${point.x + 1}`;
    return `${label}, ${say(point.y)}${unit ? ` ${unit}` : ''}. Bar ${point.x + 1} of ${bars.length || '?'}`;
  }
  return `Point at ${say(point.x)}, ${say(point.y)}`;
}

// Where the explore slider can stop: an even grid across the domain plus every key point, so a learner
// stepping with a screen reader always lands exactly on the roots and turning point.
export function stopsFor(sound, steps = 20) {
  const { samples = [], keyPoints = [] } = sound;
  if (keyPoints.some(p => p.kind === 'bar')) return keyPoints.map(p => p.x);
  if (!samples.length) return [];
  const min = samples[0].x, max = samples.at(-1).x;
  const xs = new Set(keyPoints.map(p => round(p.x)));
  for (let i = 0; i <= steps; i++) xs.add(round(min + (max - min) * i / steps));
  return [...xs].sort((a, b) => a - b);
}

// The phrase read for any x: its y, plus the key point if one sits there.
export function describeX(x, sound, context = {}) {
  const at = nearestKeyPoint(x, sound.keyPoints, 1e-6);
  if (at?.kind === 'bar') return describeKeyPoint(at, context);
  const y = yAt(sound.samples, x);
  const base = `x ${spokenNumber(x)}, y ${spokenNumber(y)}`;
  return at ? `${base}. ${describeKeyPoint(at, { samples: sound.samples, ...context })}` : base;
}

// The whole-curve playback as a schedule (seconds from start), so the audio engine only has to play it.
// Functions glide left to right; bars play one held note each with a gap between, like steps.
export function sweepPlan(sound, { durationMs = 4000 } = {}) {
  const seconds = durationMs / 1000;
  const range = yRange(sound);
  const { samples = [], keyPoints = [] } = sound;
  if (!samples.length) return { seconds: 0, tones: [], ticks: [] };
  const pan = x => (samples.length > 1 ? -1 + 2 * (x - samples[0].x) / (samples.at(-1).x - samples[0].x) : 0);
  if (keyPoints.some(p => p.kind === 'bar')) {
    const slot = seconds / samples.length;
    const tones = samples.map((p, i) => ({ start: i * slot, end: i * slot + slot * 0.75, freq: pitchFor(p.y, range), pan: pan(p.x), x: p.x }));
    const ticks = keyPoints.map((p, i) => ({ t: i * slot, kind: p.kind, point: p }));
    return { seconds, tones, ticks };
  }
  const x0 = samples[0].x, span = samples.at(-1).x - x0 || 1;
  const at = x => (x - x0) / span * seconds;
  const glide = samples.map(p => ({ t: at(p.x), freq: pitchFor(p.y, range), pan: pan(p.x), x: p.x }));
  return { seconds, glide, tones: [], ticks: keyPoints.map(p => ({ t: at(p.x), kind: p.kind, point: p })) };
}

// Where the finger is against the curve, in screen units (y grows downwards): 'above', 'below' or null when it is
// within `tolerance` of the line. Drives the off-curve buzz and the "move up / move down" announcement.
export function curveSide(fingerY, curveY, tolerance) {
  if (!Number.isFinite(fingerY) || !Number.isFinite(curveY)) return null;
  if (fingerY < curveY - tolerance) return 'above';
  if (fingerY > curveY + tolerance) return 'below';
  return null;
}
