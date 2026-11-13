// Reviewer: checks the Explainer's text for blind and Deaf learners. Gemini only answers the worksheet
// questions from the text it is given (never the photo, never the proof); every grade and every meaning
// check below is deterministic, so a pass or fail can be explained and repeated.
import { geminiJSON } from './gemini.mjs';
import { LIMITS } from '../../src/thinta/contract.js';

const NUM = '-?\\d+(?:\\.\\d+)?';
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const WORD_RE = WORDS.join('|');
const near = (a, b) => Math.abs(a - b) <= LIMITS.valueTolerance;
const fmt = n => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

// Spoken and typeset maths become plain tokens: "negative nine" -> "-9", "x²" -> "x", "equals" -> "=".
export function normalize(text = '') {
  return String(text).toLowerCase()
    .replace(/[−‒–—﹣－]/g, '-')
    .replace(/[²³]|\^\s*\d+/g, '')
    .replace(/\bx squared\b/g, 'x')
    .replace(new RegExp(`\\b(${WORD_RE})\\b`, 'g'), w => String(WORDS.indexOf(w)))
    .replace(/\b(?:negative|minus)\s+(\d)/g, '-$1')
    .replace(/\bis equal to\b|\bequals\b|\bis equals\b/g, '=')
    .replace(/≤/g, '<=').replace(/≥/g, '>=');
}

// Signed numbers in normalized text. A minus counts as a sign only when it is attached to the digits and
// does not follow an operand, so "1 - 2 - 8" reads as 1, 2, 8 but "x = -2" reads as -2.
export function parseNumbers(text) {
  const out = [];
  for (const m of normalize(text).matchAll(/(-?)(\d+(?:\.\d+)?)/g)) {
    const before = m.input[m.index - 1] || ' ';
    if (/[a-z]/.test(before) && !m[1]) continue; // "y1", "x2" style names
    out.push(m[1] && !/[\w)]/.test(before) ? -m[2] : +m[2]);
  }
  return out;
}

const pairs = t => [...t.matchAll(new RegExp(`\\(\\s*(${NUM})\\s*[,;]\\s*(${NUM})\\s*\\)`, 'g'))].map(m => ({ x: +m[1], y: +m[2], index: m.index }));
// "x = 4" but not "x = 2a" or "x = 2(...)": the number must end the term.
const xEquals = t => [...t.matchAll(new RegExp(`(?<![\\w)])x\\s*=\\s*(${NUM})(?![\\w(]|\\.\\d)`, 'g'))].map(m => +m[1]);
const yEquals = t => [...t.matchAll(new RegExp(`(?<![\\w)])y\\s*=\\s*(${NUM})(?![\\w(]|\\.\\d)`, 'g'))].map(m => +m[1]);
const sameSet = (a, b) => a.length === b.length && a.every(v => b.some(w => near(v, w))) && b.every(v => a.some(w => near(v, w)));
const unique = list => list.filter((v, i) => list.findIndex(w => near(v, w)) === i);

// y = f(x) from the coefficients, or from the samples when there is no formula.
function evaluator(proof) {
  const c = proof.coefficients;
  if (c) return x => c.a * x * x + c.b * x + c.c;
  const s = [...(proof.samples || [])].sort((p, q) => p.x - q.x);
  return x => {
    for (let i = 1; i < s.length; i++) if (x <= s[i].x && x >= s[i - 1].x) return s[i - 1].y + (s[i].y - s[i - 1].y) * (x - s[i - 1].x) / (s[i].x - s[i - 1].x || 1);
    return NaN;
  };
}

// --- Access test: grading ------------------------------------------------------------------------------

export function questionKind(question) {
  const q = question.toLowerCase();
  if (/minimum or (a )?maximum|maximum or (a )?minimum/.test(q)) return 'minmax';
  if (/turning point|vertex/.test(q)) return 'turning-point';
  if (/y-axis|y-intercept/.test(q)) return 'y-intercept';
  if (/less than|greater than|below|above|negative|positive|< ?0|> ?0/.test(q)) return 'interval';
  if (/x-axis|roots?\b|x-intercept|zeros?\b/.test(q)) return 'roots';
  return 'other';
}

const firstPair = text => {
  const t = normalize(text); const p = pairs(t)[0];
  if (p) return p;
  const n = parseNumbers(t);
  return n.length >= 2 ? { x: n[0], y: n[1] } : null;
};
const extremeWord = text => {
  const t = text.toLowerCase(); const min = t.search(/minimum|lowest/); const max = t.search(/maximum|highest/);
  if (min < 0 && max < 0) return null;
  return max < 0 || (min >= 0 && min < max) ? 'minimum' : 'maximum';
};
const yIntercept = text => {
  const t = normalize(text);
  const p = pairs(t).find(q => near(q.x, 0));
  if (p) return p.y;
  const y = yEquals(t)[0];
  if (y !== undefined) return y;
  const n = parseNumbers(t);
  return n.find(v => v !== 0) ?? n[0] ?? null;
};
// {ends, inside}: "-2 < x < 4" or "between -2 and 4" is inside; "x < -2 or x > 4" is outside.
const interval = text => {
  const t = normalize(text).replace(/\by\s*(<=?|>=?|=)\s*0\b|\b(?:less|greater|more|smaller|bigger) than 0\b/g, ' ');
  const ends = unique(parseNumbers(t)).sort((a, b) => a - b);
  const outside = /\bor\b/.test(t) && !/\bbetween\b/.test(t);
  return { ends, inside: !outside };
};

// Deterministic grade of one answer. Returns true when `got` gives the same maths as `expected`.
export function gradeAnswer(question, expected, got) {
  if (!got || /not stated/i.test(got)) return false;
  const kind = questionKind(question);
  if (kind === 'roots') {
    const want = unique(parseNumbers(expected).filter(v => v !== 0 || /\b0\b/.test(normalize(expected).replace(/\(\s*-?\d+(?:\.\d+)?\s*,\s*0\s*\)|y\s*=\s*0/g, ''))));
    const have = unique(parseNumbers(got).filter(v => v !== 0 || want.some(w => near(w, 0))));
    return sameSet(want, have);
  }
  if (kind === 'turning-point') {
    const want = firstPair(expected); const have = firstPair(got);
    return !!(want && have && near(want.x, have.x) && near(want.y, have.y));
  }
  if (kind === 'minmax') return extremeWord(expected) !== null && extremeWord(expected) === extremeWord(got);
  if (kind === 'y-intercept') {
    const want = yIntercept(expected); const have = yIntercept(got);
    return want !== null && have !== null && near(want, have);
  }
  if (kind === 'interval') {
    const want = interval(expected); const have = interval(got);
    return want.inside === have.inside && sameSet(want.ends, have.ends);
  }
  const want = parseNumbers(expected);
  if (want.length) return sameSet(unique(want), unique(parseNumbers(got)));
  return normalize(got).includes(normalize(expected).trim());
}

// Prover-derived answer for each question, matched by text first, then by position.
const expectedFor = (proof, question, i) => (proof.answers || []).find(a => a.question === question)?.answer ?? proof.answers?.[i]?.answer ?? '';

export function grade({ version, questions, answers, proof }) {
  const failed = [];
  questions.forEach((question, i) => {
    const expected = expectedFor(proof, question, i);
    const got = answers[i] ?? 'not stated';
    if (!gradeAnswer(question, expected, got)) failed.push({ question, expected, got });
  });
  const total = questions.length; const score = total - failed.length;
  const pass = score >= Math.ceil(total * LIMITS.accessPassMark / 5);
  const check = version === 'deaf' ? 'access-deaf' : 'access-audio';
  const reason = failed.length
    ? `${score}/${total}: a reader of the ${version === 'deaf' ? 'Deaf solution' : 'audio description'} could not answer ${failed.map(f => `"${f.question}"`).join(', ')}`
    : `${score}/${total}: every question answered from the ${version === 'deaf' ? 'Deaf solution' : 'audio description'} alone`;
  return { agent: 'Reviewer', check, pass, score, total, failed, reason };
}

// --- Access test: the Gemini reader --------------------------------------------------------------------

const ANSWER_SCHEMA = {
  type: 'object',
  properties: { answers: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string' } }, required: ['question', 'answer'] } } },
  required: ['answers'],
};

// The Deaf solution is graded as the text a learner would read, step by step.
export const deafText = deafSolution => (deafSolution?.steps || []).map((s, i) => `Step ${i + 1}. ${s.text}`).join('\n');

export async function accessTest({ version = 'audio', text, proof, questions, apiKey, fetchImpl = fetch, timeoutMs = 25000 }) {
  questions = questions?.length ? questions : (proof.answers || []).map(a => a.question);
  const who = version === 'deaf' ? 'a Deaf learner reading this worked solution' : 'a blind learner listening to this audio description';
  const prompt = `You are ${who}. You cannot see any graph or picture. Answer each question using ONLY what the text below states.
Rules: do not solve, factorise or calculate anything from an equation yourself; only report values the text actually gives. If the text does not state the answer, answer exactly "not stated". Keep each answer short, with numbers as digits (for example -9).

TEXT:
"""
${text || ''}
"""

QUESTIONS:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Return one answer per question, in the same order.`;
  const result = await geminiJSON({ apiKey, parts: [{ text: prompt }], schema: ANSWER_SCHEMA, temperature: 0, timeoutMs, fetchImpl });
  const list = Array.isArray(result?.answers) ? result.answers : [];
  const answers = questions.map((q, i) => (list.find(a => a?.question === q) ?? list[i])?.answer ?? 'not stated');
  return { ...grade({ version, questions, answers, proof }), answers };
}

// --- Meaning check -------------------------------------------------------------------------------------

// Every value the proof allows a sentence to mention, as absolute values (signs are checked by the claim
// checks below). Includes the small numbers a worked method needs: 0-5, 2a, b², 4ac and the discriminant.
export function allowedNumbers(proof) {
  const v = [0, 1, 2, 3, 4, 5, ...(proof.roots || []), ...(proof.domain || []), ...(proof.range || []), ...parseNumbers(proof.equation || '')];
  if (proof.turningPoint) v.push(proof.turningPoint.x, proof.turningPoint.y);
  if (proof.yIntercept !== undefined) v.push(proof.yIntercept);
  for (const bar of proof.bars || []) v.push(bar.value);
  const c = proof.coefficients;
  if (c) {
    const disc = c.b * c.b - 4 * c.a * c.c;
    v.push(c.a, c.b, c.c, 2 * c.a, c.b * c.b, 4 * c.a, 4 * c.a * c.c, disc, -c.b / (2 * c.a));
    if (disc >= 0) v.push(Math.sqrt(disc));
    if (proof.turningPoint) { const x = proof.turningPoint.x; v.push(c.a * x * x, c.b * x); }
  }
  return new Set(v.filter(Number.isFinite).map(n => Math.abs(+n.toFixed(2))));
}

const splitSentences = text => String(text || '').split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
const TP_RE = /turning point|vertex|lowest point|highest point|minimum point|maximum point/;
const ROOT_RE = /\broots?\b|x-intercepts?|(?:cross|cut|meet|touch|hit)\w*\s+(?:the\s+)?x-axis/;
const YINT_RE = /y-intercept|(?:cross|cut|meet|touch|hit)\w*\s+(?:the\s+)?y-axis/;
const NEG_RE = /below the x-axis|under the x-axis|y\s*<=?\s*0|y is (?:less|smaller) than 0|y (?:is|values are) negative/;
const POS_RE = /above the x-axis|y\s*>=?\s*0|y is (?:greater|more|bigger) than 0|y (?:is|values are) positive/;

// Values a sentence claims for the turning point, roots and y-intercept.
function claims(t) {
  const out = [];
  const tp = t.search(TP_RE);
  if (tp >= 0) {
    const after = t.slice(tp);
    const p = pairs(after)[0]
      || (m => m && { x: +m[1], y: +m[2] })(after.match(new RegExp(`\\b(?:is|at)\\s+(?:at\\s+)?(?:the point\\s+)?(${NUM})\\s*,\\s*(${NUM})`)))
      || (m => m && { x: +m[1], y: +m[2] })(after.match(new RegExp(`x\\s*=\\s*(${NUM})\\s*(?:,|and)\\s*y\\s*=\\s*(${NUM})`)));
    if (p) out.push({ kind: 'turning-point', value: p });
  }
  const root = t.match(ROOT_RE);
  if (root) {
    const after = t.slice(root.index);
    let values = xEquals(after);
    if (!values.length) values = pairs(after).filter(p => near(p.y, 0)).map(p => p.x);
    if (!values.length) values = parseNumbers(after.replace(new RegExp(`[xy]\\s*=\\s*${NUM}`, 'g'), ' ').replace(/\bbetween\b.*$/, ' '));
    if (values.length) out.push({ kind: 'roots', value: values });
  }
  const yint = t.match(YINT_RE);
  if (yint) {
    const after = t.slice(yint.index);
    const p = pairs(after).find(q => near(q.x, 0));
    const values = p ? [p.y] : yEquals(after).length ? yEquals(after) : parseNumbers(after.replace(new RegExp(`x\\s*=\\s*${NUM}`, 'g'), ' '));
    if (values.length) out.push({ kind: 'y-intercept', value: values[0] });
  }
  return out;
}

// x-regions a clause names: "between A and B", "A < x < B", "x < A", "x > B".
function regions(clause) {
  const out = [];
  const between = clause.match(new RegExp(`between\\s+(?:x\\s*=\\s*)?(${NUM})\\s+and\\s+(?:x\\s*=\\s*)?(${NUM})`));
  if (between) out.push({ from: Math.min(+between[1], +between[2]), to: Math.max(+between[1], +between[2]), label: `x between ${between[1]} and ${between[2]}` });
  for (const m of clause.matchAll(new RegExp(`(${NUM})\\s*<=?\\s*x\\s*<=?\\s*(${NUM})`, 'g'))) out.push({ from: +m[1], to: +m[2], label: `${m[1]} < x < ${m[2]}` });
  if (!out.length) for (const m of clause.matchAll(new RegExp(`(?<![\\w<>=\\d]\\s*)x\\s*(?:is\\s*)?(<=?|>=?|less than|greater than|smaller than|bigger than|more than)\\s*(${NUM})`, 'g'))) {
    const below = /</.test(m[1]) || /less|smaller/.test(m[1]);
    out.push(below ? { from: -Infinity, to: +m[2], label: `x < ${m[2]}` } : { from: +m[2], to: Infinity, label: `x > ${m[2]}` });
  }
  return out;
}

// Does f have the claimed sign throughout the region? Tested at a few points strictly inside it.
function signHolds(f, region, sign) {
  const pts = Number.isFinite(region.from) && Number.isFinite(region.to)
    ? [0.25, 0.5, 0.75].map(k => region.from + (region.to - region.from) * k)
    : Number.isFinite(region.to) ? [region.to - 0.5, region.to - 1] : [region.from + 0.5, region.from + 1];
  const ys = pts.map(f).filter(Number.isFinite);
  return !ys.length || ys.every(y => (sign < 0 ? y < 0 : y > 0));
}

export function meaningCheck(text, proof) {
  const allowed = allowedNumbers(proof); const f = evaluator(proof); const problems = [];
  for (const sentence of splitSentences(text)) {
    const t = normalize(sentence).replace(/\bstep\s+\d+\b/g, ' ');
    const stray = unique(parseNumbers(t).filter(n => !allowed.has(Math.abs(+n.toFixed(2)))));
    if (stray.length) problems.push({ sentence, reason: `${stray.map(fmt).join(', ')} ${stray.length > 1 ? 'are' : 'is'} not a value from the proof` });
    for (const claim of claims(t)) {
      if (claim.kind === 'turning-point' && proof.turningPoint && !(near(claim.value.x, proof.turningPoint.x) && near(claim.value.y, proof.turningPoint.y)))
        problems.push({ sentence, reason: `turning point given as (${fmt(claim.value.x)}, ${fmt(claim.value.y)}) but the proof gives (${fmt(proof.turningPoint.x)}, ${fmt(proof.turningPoint.y)})` });
      if (claim.kind === 'roots' && proof.roots?.length && claim.value.some(v => !proof.roots.some(r => near(r, v))))
        problems.push({ sentence, reason: `roots given as ${claim.value.map(fmt).join(' and ')} but the proof gives ${proof.roots.map(fmt).join(' and ')}` });
      if (claim.kind === 'y-intercept' && proof.yIntercept !== undefined && !near(claim.value, proof.yIntercept))
        problems.push({ sentence, reason: `y-intercept given as ${fmt(claim.value)} but the proof gives ${fmt(proof.yIntercept)}` });
    }
    // Inequality words: a sign claim uses the region in its own clause, or the last one named in the sentence.
    let last = [];
    for (const clause of t.split(/[;,]|\bso\b|\bbut\b|\bwhile\b|\bwhereas\b/)) {
      const named = regions(clause); if (named.length) last = named;
      const sign = NEG_RE.test(clause) ? -1 : POS_RE.test(clause) ? 1 : 0;
      if (!sign || NEG_RE.test(clause) && POS_RE.test(clause)) continue;
      for (const region of last) if (!signHolds(f, region, sign))
        problems.push({ sentence, reason: `says y is ${sign < 0 ? 'below 0 (under the x-axis)' : 'above 0 (over the x-axis)'} for ${region.label}, but the proof shows it is ${sign < 0 ? 'above' : 'below'} there` });
    }
  }
  return { pass: !problems.length, problems };
}

// --- Feedback for the Explainer's rewrite --------------------------------------------------------------

// Turns an access-test review or a meaning-check result into the list explain() puts in its rewrite prompt.
export function feedbackFrom(review) {
  if (!review) return [];
  if (Array.isArray(review.failed)) return review.failed.map(f => `A ${review.check === 'access-deaf' ? 'Deaf reader' : 'blind listener'} could not answer "${f.question}" from the text (they said "${f.got}"; the right answer is ${f.expected}). State it plainly.`);
  if (Array.isArray(review.problems)) return review.problems.map(p => `This sentence is wrong: "${p.sentence}". Reason: ${p.reason}. Rewrite it using only the proof's values.`);
  return review.reason ? [review.reason] : [];
}
