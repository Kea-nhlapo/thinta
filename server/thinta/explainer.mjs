// Explainer: writes the audio description for blind learners and the plain-language worked solution for
// Deaf learners from the Prover's numbers only. Gemini writes; the Reviewer's meaning check runs on the
// result before it is returned. isiZulu and audio come from injected translate/speak (the gateway's).
import { geminiJSON } from './gemini.mjs';
import { meaningCheck, parseNumbers } from './reviewer.mjs';

const SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    steps: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, visual: { type: 'string' } }, required: ['text', 'visual'] } },
    keyTerms: { type: 'array', items: { type: 'string' } },
  },
  required: ['description', 'steps', 'keyTerms'],
};
const SPEAK_LIMIT = 400; // /api/speak takes at most 400 characters per call

const fmt = n => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

// The facts Gemini may use, written out so it never has to work anything out itself.
export function proofFacts(proof, reading) {
  const lines = [`Equation: ${proof.equation}`];
  const c = proof.coefficients;
  if (c) lines.push(`Coefficients: a = ${fmt(c.a)}, b = ${fmt(c.b)}, c = ${fmt(c.c)}`);
  if (proof.roots?.length) lines.push(`Roots (crosses the x-axis): x = ${proof.roots.map(fmt).join(' and x = ')}`);
  if (proof.turningPoint) lines.push(`Turning point: (${fmt(proof.turningPoint.x)}, ${fmt(proof.turningPoint.y)}), a ${c ? (c.a > 0 ? 'minimum (curve opens upwards, U-shape)' : 'maximum (curve opens downwards)') : 'turning point'}`);
  if (proof.yIntercept !== undefined) lines.push(`y-intercept (crosses the y-axis): (0, ${fmt(proof.yIntercept)})`);
  if (c && proof.roots?.length === 2) {
    const [r1, r2] = [...proof.roots].sort((p, q) => p - q);
    const inside = c.a > 0 ? 'below the x-axis (y < 0)' : 'above the x-axis (y > 0)';
    const outside = c.a > 0 ? 'above the x-axis (y > 0)' : 'below the x-axis (y < 0)';
    lines.push(`Between x = ${fmt(r1)} and x = ${fmt(r2)} the curve is ${inside}. For x < ${fmt(r1)} or x > ${fmt(r2)} it is ${outside}.`);
  }
  if (proof.domain) lines.push(`Drawn for x from ${fmt(proof.domain[0])} to ${fmt(proof.domain[1])}`);
  for (const bar of proof.bars || []) lines.push(`Bar "${bar.label}": ${fmt(bar.value)}`);
  for (const a of proof.answers || []) lines.push(`Q: ${a.question} A: ${a.answer}`);
  if (reading?.axes?.y?.label && reading.axes.y.label !== 'y') lines.push(`y-axis label: ${reading.axes.y.label}`);
  if (reading?.labels?.length) lines.push(`Labels on the picture: ${reading.labels.join('; ')}`);
  return lines.join('\n');
}

const feedbackLines = feedback => (feedback || []).map(f => (typeof f === 'string' ? f : JSON.stringify(f)));

export function explainPrompt(proof, reading, feedback) {
  const fixes = feedbackLines(feedback);
  return `You write maths access materials for South African high-school learners. The graph below has been proved with algebra.

PROVED FACTS (these are the ONLY numbers you may use; do not calculate or invent any other values):
${proofFacts(proof, reading)}

Write two things:
1. "description": an English audio description for a BLIND learner, to be read aloud. Short sentences. Say the shape first. Say numbers as a listener would hear them: "negative 9", "x equals 4", the point "1, negative 9". Give every proved fact above: where it crosses the x-axis, the turning point and whether it is a minimum or maximum, where it crosses the y-axis, and where the curve is above or below the x-axis. Under 450 characters.
2. "steps": a step-by-step worked solution for a DEAF learner who reads English as a second language. One idea per step, 4 to 6 steps, very short sentences, plain words, maths symbols allowed (=, −, ², ÷, <). Each step has "visual": a short instruction for what to highlight on the graph for that step (for example "mark −2 and 4 on the x-axis"). Never describe or invent sign language.
3. "keyTerms": 3 to 5 maths words the learner should fingerspell, in UPPERCASE (for example ROOT, TURNING POINT).
${fixes.length ? `\nTHE LAST VERSION FAILED A CHECK. Fix every one of these:\n${fixes.map(f => `- ${f}`).join('\n')}\n` : ''}
Return JSON only.`;
}

const LANGUAGE_NAMES = { zu: 'isiZulu', nso: 'Sepedi' };

// Translate one text; a failure leaves '' so the caller can warn and keep the English.
async function translated(text, lang, translate) {
  const name = LANGUAGE_NAMES[lang];
  if (!translate || !text) return { text: '', warning: `${name} translation not available` };
  try {
    // Spoken negatives go in as "−2": in a live run the translation dropped "negative" and flipped a root's sign.
    const out = await translate(text.replace(/\bnegative\s+(\d+(?:\.\d+)?)/gi, '−$1'), 'en', lang);
    const result = (typeof out === 'string' ? out : out?.text || '').trim();
    if (!result) return { text: '', warning: `${name} translation came back empty` };
    // Numbers, signs included, must survive translation; NLLB sometimes drops or changes them.
    const missing = [...new Set(parseNumbers(text))].filter(n => !parseNumbers(result).includes(n));
    return { text: result, warning: missing.length ? `${name} text may be missing the number(s) ${missing.join(', ')}; check before use` : '' };
  } catch (error) { return { text: '', warning: `${name} translation failed: ${error.message}` }; }
}

export async function explain({ proof, reading, feedback, apiKey, fetchImpl = fetch, translate, timeoutMs = 25000 }) {
  const out = await geminiJSON({ apiKey, parts: [{ text: explainPrompt(proof, reading, feedback) }], schema: SCHEMA, temperature: 0.3, timeoutMs, fetchImpl });
  const en = String(out?.description || '').trim();
  const steps = (Array.isArray(out?.steps) ? out.steps : []).filter(s => s?.text).map(s => ({ text: String(s.text).trim(), visual: String(s.visual || '').trim() }));
  const keyTerms = [...new Set((out?.keyTerms || []).map(t => String(t).trim().toUpperCase()).filter(Boolean))];
  // Our own meaning check before handing over: the orchestrator turns these into the next rewrite's feedback.
  const meaning = {
    description: meaningCheck(en, proof),
    deafSolution: meaningCheck(steps.flatMap(s => [s.text, s.visual]).join('\n'), proof),
  };
  // isiZulu and Sepedi side by side, so the second language adds no waiting.
  const [zu, nso] = await Promise.all([translated(en, 'zu', translate), translated(en, 'nso', translate)]);
  const warnings = [zu.warning, nso.warning].filter(Boolean);
  if (!en) warnings.push('Gemini returned no description');
  if (!steps.length) warnings.push('Gemini returned no Deaf solution steps');
  return { description: { en, zu: zu.text, nso: nso.text }, deafSolution: { steps, keyTerms }, meaning, warnings };
}

// Sentence-sized pieces under the /api/speak limit.
export function speechChunks(text, limit = SPEAK_LIMIT) {
  const chunks = [];
  for (const sentence of String(text || '').split(/(?<=[.!?])\s+/).filter(Boolean)) {
    const last = chunks.length - 1;
    if (last >= 0 && chunks[last].length + 1 + sentence.length <= limit) chunks[last] += ` ${sentence}`;
    else for (let i = 0; i < sentence.length; i += limit) chunks.push(sentence.slice(i, i + limit));
  }
  return chunks;
}

// Audio for both languages, kept apart from explain() so it can be skipped when time is short. Each value is
// whatever speak() returns (one clip, or a list when the text needed more than one call), or null on failure.
export async function speakDescription({ description, speak }) {
  const say = async (text, lang) => {
    const chunks = speechChunks(text);
    if (!speak || !chunks.length) return null;
    try {
      const clips = await Promise.all(chunks.map(chunk => speak(chunk, lang)));
      return clips.length === 1 ? clips[0] : clips;
    } catch { return null; }
  };
  const [en, zu] = await Promise.all([say(description?.en, 'en'), say(description?.zu, 'zu')]);
  return { en, zu };
}
