// Plain-language readings of a run for the phone: the self-corrections worth seeing first, where every check
// ended up, and what each Deaf solution step should highlight on the graph. Pure, so it runs under node --test.
import { formatPoint, formatValue, fieldLabel } from './format.js';

const CHECKS = ['reader-vs-prover', 'fresh-eyes', 'access-audio', 'access-deaf'];
const CHECK_NAMES = { 'reader-vs-prover': 'Reader vs Prover', 'fresh-eyes': 'Fresh eyes on the print', 'access-audio': 'Audio description', 'access-deaf': 'Deaf solution' };
export const outcomeName = check => CHECK_NAMES[check] || String(check || 'Check').replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());

// Fakes and older runs say check:'access' with a version; the pipeline says 'access-audio' / 'access-deaf'.
const checkOf = review => (review.check === 'access' && review.version ? `access-${review.version}` : review.check);
const scoreOf = review => (Number.isFinite(review?.score) && Number.isFinite(review?.total) ? `${review.score}/${review.total}` : null);
const isLabelMove = c => c.agent === 'Designer' && /^tactile\.labels\./.test(c.field) && Number.isFinite(c.before?.x) && Number.isFinite(c.after?.x);

// "Gemini read the rendered PNG. fresh read: turning point missing (proof (1, -9))" → "turning point missing".
export function shortReason(reason = '') {
  return String(reason).replace(/^.*?fresh read:\s*/i, '').replace(/^Gemini read the rendered [A-Z]+[.;]\s*/i, '').replace(/\s*\(proof [^)]*\)\)?/g, '').replace(/\.$/, '').trim();
}

// Trace lines without the plumbing: "Gemini read the rendered PNG. fresh read: turning point missing (proof (1, -9))".
export const tidyMessage = message => String(message || '').replace(/Gemini read the rendered [A-Z]+[.;]\s*(fresh read:\s*)?/gi, '').replace(/\s*\(proof (\([^)]*\)|[^)]*)\)/g, '');

// One entry per check, in pipeline order: how it ended and how many tries it took.
export function checkOutcomes(job) {
  const byCheck = new Map();
  for (const review of job?.reviews || []) {
    const check = checkOf(review);
    if (!byCheck.has(check)) byCheck.set(check, []);
    byCheck.get(check).push(review);
  }
  const order = [...CHECKS.filter(c => byCheck.has(c)), ...[...byCheck.keys()].filter(c => !CHECKS.includes(c))];
  return order.map(check => {
    const tries = byCheck.get(check);
    const first = tries[0], final = tries[tries.length - 1];
    // The Reader check "fails" when the Prover overrules it: that is the team working, not an open problem.
    const status = check === 'reader-vs-prover' ? (final.pass ? 'passed' : 'fixed') : !final.pass ? 'open' : tries.length > 1 ? 'fixed' : 'passed';
    return { check, name: outcomeName(check), status, tries: tries.length, first, final, firstScore: scoreOf(first), finalScore: scoreOf(final) };
  });
}

export function outcomeSummary(outcomes) {
  const count = status => outcomes.filter(o => o.status === status).length;
  return { passed: count('passed'), fixed: count('fixed'), open: count('open'), total: outcomes.length };
}

// The moments that show the team checking itself.
// tone: 'fixed' (caught and corrected), 'open' (needs the teacher), 'pass' (agreed first time).
export function headlines(job) {
  const out = [];
  const corrections = job?.corrections || [];
  const outcomes = Object.fromEntries(checkOutcomes(job).map(o => [o.check, o]));

  const overruled = corrections.filter(c => c.agent === 'Prover' && /^reading\./.test(c.field));
  if (overruled.length) {
    const c = overruled.find(x => /turningPoint/.test(x.field)) || overruled[0];
    out.push({ tone: 'fixed', title: 'The Prover overruled the Reader', what: `${fieldLabel(c.field)} read from the drawing`, before: formatValue(c.before), after: formatValue(c.after),
      detail: overruled.length > 1 ? `${overruled.length} values read from the photo disagreed with the algebra. The algebra wins.` : 'The value read from the photo disagreed with the algebra. The algebra wins.' });
  } else if (outcomes['reader-vs-prover']?.status === 'passed' && job?.proof?.turningPoint) {
    out.push({ tone: 'pass', title: 'Reader and Prover agree', detail: `The photo and the algebra both give the turning point ${formatPoint(job.proof.turningPoint)}.` });
  }

  const fresh = outcomes['fresh-eyes'];
  if (fresh?.status === 'fixed') {
    out.push({ tone: 'fixed', title: 'Fresh eyes caught an unclear print', what: 'Re-read without the photo', before: shortReason(fresh.first.reason), after: 'matches the proof',
      detail: `The Designer made the labels clearer and the print was read again${fresh.tries > 2 ? ` (${fresh.tries} reads)` : ''}.` });
  } else if (fresh?.status === 'open') {
    out.push({ tone: 'open', title: 'Fresh eyes still disagree', detail: `${shortReason(fresh.final.reason)}. The teacher decides.` });
  } else if (fresh?.status === 'passed') {
    out.push({ tone: 'pass', title: 'Fresh eyes read the print correctly', detail: 'A reader who never saw the photo found the same roots and turning point.' });
  }

  const moved = new Set(corrections.filter(isLabelMove).map(c => c.field));
  if (moved.size) out.push({ tone: 'fixed', title: `The Designer moved ${moved.size} label${moved.size === 1 ? '' : 's'} on the tactile print`, detail: 'Each braille label now sits at least 3.2 mm from the curve, so a finger can tell them apart.' });

  for (const check of ['access-audio', 'access-deaf']) {
    const o = outcomes[check];
    if (!o) continue;
    const version = check === 'access-audio' ? 'audio description' : 'Deaf solution';
    const wrongNumber = o.first.meaning && o.first.meaning.pass === false;
    if (o.status === 'fixed') {
      const before = o.firstScore && o.firstScore !== o.finalScore ? o.firstScore : wrongNumber ? 'a wrong number' : o.firstScore;
      out.push({ tone: 'fixed', title: `The ${version} was rewritten`, what: 'Worksheet score', before, after: o.finalScore,
        detail: `A reviewer with only the ${version} ${o.firstScore && o.firstScore !== o.finalScore ? `answered ${o.firstScore.replace('/', ' of ')} questions` : 'found a number that disagreed with the proof'}. After the rewrite: ${(o.finalScore || '').replace('/', ' of ')}.` });
    } else if (o.status === 'open') {
      const problems = o.final.meaning?.problems?.length;
      out.push({ tone: 'open', title: `The ${version} needs you`, detail: `${o.finalScore ? `${o.finalScore} worksheet questions answered` : 'The check did not pass'}${problems ? `, but ${problems} sentence${problems === 1 ? ' disagrees' : 's disagree'} with the proof` : ''} after ${o.tries - 1} rewrite${o.tries === 2 ? '' : 's'}.` });
    } else {
      out.push({ tone: 'pass', title: `The ${version} passed first time`, detail: `A reviewer with only the ${version} answered ${(o.finalScore || '').replace('/', ' of ')} worksheet questions.` });
    }
  }
  // Corrections lead (they are the story), then what needs the teacher, then what passed first time.
  const rank = { fixed: 0, open: 1, pass: 2 };
  return out.map((line, i) => ({ line, i })).sort((a, b) => rank[a.line.tone] - rank[b.line.tone] || a.i - b.i).map(({ line }) => line);
}

// Groups the Designer's many small label moves into one log line, so the trace stays readable.
export function groupLog(log) {
  const out = [];
  for (const item of log) {
    if (item.kind === 'correction' && isLabelMove(item)) {
      const last = out[out.length - 1];
      if (last?.kind === 'label-moves') { last.items.push(item); continue; }
      out.push({ kind: 'label-moves', agent: 'Designer', items: [item] });
      continue;
    }
    out.push(item);
  }
  return out;
}

const near = (a, b) => Math.abs(a - b) < 1e-6;
const mentions = (text, n) => new RegExp(`(^|[^\\d.])[−-]?${String(Math.abs(n)).replace('.', '\\.')}(?![\\d.])`).test(text) && (n >= 0 || /[−-]\s*\d/.test(text));

// What one Deaf solution step should highlight: its key points, and the stretch of curve it talks about.
export function stepFocus(step, proof) {
  if (!proof?.samples?.length || proof.bars?.length) return null;
  const text = `${step?.text || ''} ${step?.visual || ''}`.toLowerCase();
  const roots = proof.roots || [];
  const points = [];
  const wantRoots = /x-axis|roots?\b|x-intercept|zeros?\b|solutions?\b/.test(text) || (roots.length && roots.every(r => mentions(text, r)) && /x\s*=/.test(text));
  if (wantRoots) roots.forEach((x, i) => points.push({ x, y: 0, kind: 'root', label: `x = ${formatValue(x)}`, key: `root${i}` }));
  if (proof.turningPoint && /turning point|vertex|minimum|maximum|lowest|highest/.test(text)) points.push({ ...proof.turningPoint, kind: 'turning-point', label: formatPoint(proof.turningPoint), key: 'tp' });
  if (Number.isFinite(proof.yIntercept) && /y-axis|y-intercept|x\s*=\s*0\b/.test(text)) points.push({ x: 0, y: proof.yIntercept, kind: 'y-intercept', label: formatPoint({ x: 0, y: proof.yIntercept }), key: 'yint' });
  let region = null;
  if (roots.length === 2) {
    const [a, b] = [...roots].sort((p, q) => p - q);
    const negativeInside = (proof.coefficients?.a ?? 1) > 0;
    if (/below|less than 0|<\s*0|negative values|y is negative/.test(text)) region = negativeInside ? { from: a, to: b, words: 'y < 0 here' } : null;
    else if (/above|greater than 0|>\s*0|y is positive/.test(text)) region = negativeInside ? null : { from: a, to: b, words: 'y > 0 here' };
    if (region && !points.some(p => p.kind === 'root')) roots.forEach((x, i) => points.push({ x, y: 0, kind: 'root', label: `x = ${formatValue(x)}`, key: `root${i}` }));
  }
  const unique = points.filter((p, i) => points.findIndex(q => near(q.x, p.x) && near(q.y, p.y)) === i);
  return { points: unique, region };
}

// Words for the picture's accessible name, e.g. "Graph with the roots x = −2 and x = 4 marked".
export function focusWords(focus) {
  if (!focus) return 'Graph';
  const parts = [];
  const roots = focus.points.filter(p => p.kind === 'root');
  if (roots.length) parts.push(`the root${roots.length > 1 ? 's' : ''} ${roots.map(r => r.label).join(' and ')}`);
  for (const p of focus.points.filter(q => q.kind !== 'root')) parts.push(`the ${p.kind.replace('-', ' ')} ${p.label}`);
  const marked = parts.length ? ` with ${parts.join(', ')} marked` : '';
  return `Graph${marked}${focus.region ? `, and the part of the curve where ${focus.region.words.replace(' here', '')} highlighted` : ''}`;
}
