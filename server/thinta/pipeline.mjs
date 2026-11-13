// The Thinta run: Planner → Reader → Prover → (Designer ∥ Explainer, Sonifier) → Reviewer loop.
// Every decision lands in job.trace / job.corrections / job.reviews and is emitted as it happens.
// Agents are injected (deps) so tests can run the whole loop with fakes; defaults load the real modules.
import { emptyJob, LIMITS, DEFAULT_QUESTIONS } from '../../src/thinta/contract.js';
import { geminiJSON } from './gemini.mjs';

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    steps: { type: 'array', items: { type: 'string' } },
    versions: { type: 'array', items: { type: 'string', enum: ['tactile', 'sound', 'audio-description', 'deaf-solution'] } },
    note: { type: 'string' },
  },
  required: ['steps', 'versions'],
};

export async function defaultDeps() {
  const [reader, prover, freshEyes, tactile, explainer, reviewer, sound] = await Promise.all([
    import('./reader.mjs'), import('./prover.mjs'), import('./fresh-eyes.mjs'), import('../../src/thinta/tactile/index.js'),
    import('./explainer.mjs'), import('./reviewer.mjs'), import('../../src/thinta/sound/sonify.js').catch(() => null),
  ]);
  return {
    plan: planWithGemini,
    readGraph: reader.readGraph, prove: prover.prove, freshEyes: freshEyes.freshEyes,
    designTactile: tactile.designTactile, fixTactile: tactile.fixTactile,
    explain: explainer.explain, accessTest: reviewer.accessTest, meaningCheck: reviewer.meaningCheck, feedbackFrom: reviewer.feedbackFrom,
    sonify: sound?.sonify || fallbackSonify,
  };
}

// Planner: Gemini decides the steps and versions for the learners the teacher picked.
async function planWithGemini({ input, apiKey, fetchImpl }) {
  const prompt = `You lead a team that makes maths graphs accessible for South African learners. The teacher photographed a graph${input.equationHint ? ` (equation given: ${input.equationHint})` : ''} for these learners: ${input.learners.join(', ')}. ` +
    `The team: Reader (reads the photo), Prover (checks the maths with algebra), Designer (tactile print for blind learners), Sonifier (sound and touch-the-graph), Explainer (audio description in English and isiZulu, and a plain-language step-by-step solution for Deaf learners), Reviewer (checks everything). ` +
    `Choose which versions to build: tactile, sound and audio-description for blind learners; deaf-solution for Deaf learners. Write 4 to 6 short steps for the team, in order. note: one sentence to the teacher.`;
  return geminiJSON({ apiKey, fetchImpl, schema: PLAN_SCHEMA, parts: [{ text: prompt }], timeoutMs: 15000 });
}

function fallbackSonify(proof) {
  const keyPoints = [
    ...(proof.roots || []).map(x => ({ x, y: 0, kind: 'root' })),
    ...(proof.turningPoint ? [{ ...proof.turningPoint, kind: 'turning-point' }] : []),
    ...(proof.yIntercept !== undefined && proof.yIntercept !== null ? [{ x: 0, y: proof.yIntercept, kind: 'y-intercept' }] : []),
    ...(proof.bars || []).map((b, i) => ({ x: i, y: b.value, kind: 'bar' })),
  ];
  return { samples: proof.samples, keyPoints };
}

const versionsFor = learners => [...(learners.includes('blind') ? ['tactile', 'sound', 'audio-description'] : []), ...(learners.includes('deaf') ? ['deaf-solution'] : [])];
const deafText = deafSolution => (deafSolution?.steps || []).map(s => s.text).join('\n');
const scoreText = review => (review?.score !== undefined ? `${review.score}/${review.total}` : review?.pass ? 'pass' : 'fail');

class StepCapError extends Error {}

// Runs one job and yields stream events (see contract.js). Never throws: failures become trace entries.
export async function* runPipeline(input, { apiKey, fetchImpl = fetch, translate, deps, now = Date.now } = {}) {
  const job = emptyJob({ input: { ...input, questions: input.questions?.length ? input.questions : DEFAULT_QUESTIONS } });
  const started = now();
  const events = [];
  let calls = 0;
  const elapsed = () => now() - started;
  const trace = (agent, status, message) => { const entry = { t: elapsed(), agent, status, message }; job.trace.push(entry); events.push({ type: 'trace', entry }); };
  const correct = correction => { job.corrections.push(correction); events.push({ type: 'correction', correction }); };
  const review = r => { job.reviews.push(r); events.push({ type: 'review', review: r }); };
  const patch = fields => { Object.assign(job, fields); events.push({ type: 'patch', job: fields }); };
  // Counts AI agent calls against the step cap.
  const ai = async fn => { if (++calls > LIMITS.maxAgentCalls) throw new StepCapError(`Step cap of ${LIMITS.maxAgentCalls} agent calls reached`); return fn(); };
  const overBudget = () => elapsed() > LIMITS.runBudgetMs;
  const flush = function* () { while (events.length) yield events.shift(); };

  try {
    deps = deps || await defaultDeps();
    const ctx = { apiKey, fetchImpl };

    // Planner
    trace('Planner', 'start', `Planning a pack for ${job.input.learners.join(', ')} learners`);
    yield* flush();
    try {
      const plan = await ai(() => deps.plan({ input: job.input, ...ctx }));
      const wanted = versionsFor(job.input.learners);
      const versions = [...new Set([...(plan.versions || []).filter(v => wanted.includes(v)), ...wanted])];
      patch({ plan: { steps: plan.steps?.length ? plan.steps : ['Read', 'Prove', 'Design', 'Review'], versions } });
      trace('Planner', 'done', `${versions.length} versions: ${versions.join(', ')}${plan.note ? `. ${plan.note}` : ''}`);
    } catch (error) {
      if (error instanceof StepCapError) throw error;
      patch({ plan: { steps: ['Read the photo', 'Prove the maths', 'Design every version', 'Review every version'], versions: versionsFor(job.input.learners) } });
      trace('Planner', 'fail', `Planner unavailable (${error.message.slice(0, 80)}); using the standard plan`);
    }
    yield* flush();

    // Reader
    trace('Reader', 'start', 'Reading the photo');
    yield* flush();
    let reading;
    try {
      if (!job.input.imageBase64) throw new Error('no photo sent');
      reading = await ai(() => deps.readGraph({ imageBase64: job.input.imageBase64, mimeType: job.input.mimeType, equationHint: job.input.equationHint, ...ctx }));
      const tp = reading.turningPoint ? ` turning point read as (${reading.turningPoint.x}, ${reading.turningPoint.y})` : '';
      trace('Reader', 'done', `${reading.type === 'bar' ? 'Bar chart' : `Graph ${reading.equation || '(no equation seen)'}`};${tp} confidence ${Math.round((reading.confidence ?? 0) * 100)}%`);
    } catch (error) {
      if (error instanceof StepCapError) throw error;
      if (!job.input.equationHint) { trace('Reader', 'fail', `Could not read the photo: ${error.message.slice(0, 120)}`); throw new Error('The photo could not be read and no equation was typed.'); }
      reading = { type: 'function', equation: job.input.equationHint, confidence: 0 };
      trace('Reader', 'fail', `Could not read the photo (${error.message.slice(0, 80)}); continuing from the typed equation`);
    }
    patch({ reading });
    yield* flush();

    // Prover (pure algebra, overrules the Reader)
    trace('Prover', 'start', 'Checking the maths with algebra');
    yield* flush();
    const { proof, corrections } = deps.prove(reading, { equationHint: job.input.equationHint, questions: job.input.questions });
    patch({ proof });
    corrections.forEach(correct);
    const readerChecked = reading.type !== 'bar' && (reading.turningPoint || reading.roots);
    if (readerChecked) review({ agent: 'Reviewer', check: 'reader-vs-prover', pass: !corrections.length, before: corrections[0]?.before, after: corrections[0]?.after, reason: corrections.length ? `${corrections.length} value${corrections.length > 1 ? 's' : ''} read from the drawing disagreed with the algebra; the Prover's values win` : 'The Reader agreed with the algebra' });
    const facts = proof.bars?.length ? `${proof.bars.length} bars checked` : `roots ${proof.roots.length ? proof.roots.join(' and ') : 'none'}${proof.turningPoint ? `, turning point (${proof.turningPoint.x}, ${proof.turningPoint.y})` : ''}`;
    trace('Prover', 'done', `${facts}${corrections.length ? `. Overruled the Reader on ${corrections.map(c => c.field.replace('reading.', '')).join(', ')}` : ''}`);
    yield* flush();

    // Designer ∥ Explainer, Sonifier
    trace('Designer', 'start', 'Drawing the tactile print');
    trace('Explainer', 'start', 'Writing the audio description and the Deaf solution');
    yield* flush();
    const type = reading.type === 'bar' ? 'bar' : 'function';
    const explaining = ai(() => deps.explain({ proof, reading, translate, ...ctx }));
    explaining.catch(() => {});
    let tactile = deps.designTactile(proof, { type });
    (tactile.corrections || []).forEach(correct);
    patch({ tactile: { svg: tactile.svg, warnings: tactile.warnings || [], ruleChecks: tactile.ruleChecks || [] } });
    const failedRules = (tactile.ruleChecks || []).filter(r => !r.pass);
    trace('Designer', failedRules.length ? 'fail' : 'done', `${(tactile.ruleChecks || []).length - failedRules.length}/${(tactile.ruleChecks || []).length} print rules pass${tactile.corrections?.length ? `, ${tactile.corrections.length} label${tactile.corrections.length > 1 ? 's' : ''} moved` : ''}`);
    trace('Sonifier', 'start', 'Mapping the curve to sound');
    const sound = deps.sonify(proof);
    patch({ sound });
    trace('Sonifier', 'done', `${sound.keyPoints.length} key points will click and vibrate`);
    yield* flush();
    let { description, deafSolution } = await explaining;
    patch({ description, deafSolution });
    trace('Explainer', 'done', `Description written${description.zu ? ' in English and isiZulu' : ' in English (isiZulu failed)'}; ${deafSolution.steps.length} Deaf solution steps`);
    yield* flush();

    // Reviewer 1: fresh eyes on the tactile print
    for (let attempt = 0; attempt <= LIMITS.maxRetries; attempt++) {
      if (overBudget()) { trace('Reviewer', 'fail', 'Out of time for the fresh-eyes check; escalated to the teacher'); break; }
      trace('Reviewer', 'start', attempt ? `Fresh eyes again after the fix (try ${attempt + 1})` : 'Fresh eyes: reading the tactile print without the photo');
      yield* flush();
      try {
        const result = await ai(() => deps.freshEyes({ svg: job.tactile.svg, proof, ...ctx }));
        review({ ...result.review, attempt });
        if (result.review.pass) { trace('Reviewer', 'done', `Fresh eyes agree with the proof: ${result.review.reason}`); break; }
        if (attempt === LIMITS.maxRetries) { trace('Reviewer', 'fail', `Fresh eyes still disagree after ${attempt} fixes; escalated to the teacher`); break; }
        trace('Reviewer', 'retry', `Fresh eyes disagree: ${result.review.reason}. Sending back to the Designer`);
        yield* flush();
        const fixed = deps.fixTactile(proof, tactile, result.review.feedback || result.review);
        (fixed.corrections || []).forEach(correct);
        tactile = fixed;
        patch({ tactile: { svg: fixed.svg, warnings: fixed.warnings || [], ruleChecks: fixed.ruleChecks || [] } });
        trace('Designer', 'done', 'Tactile print regenerated with clearer labels');
      } catch (error) {
        if (error instanceof StepCapError) throw error;
        trace('Reviewer', 'fail', `Fresh-eyes check failed to run: ${error.message.slice(0, 100)}`);
        break;
      }
      yield* flush();
    }
    yield* flush();

    // Reviewer 2 and 3: access tests (audio description, Deaf solution) with meaning checks
    for (const version of ['audio', 'deaf']) {
      if (version === 'audio' && !job.plan.versions.includes('audio-description')) continue;
      if (version === 'deaf' && !job.plan.versions.includes('deaf-solution')) continue;
      const label = version === 'audio' ? 'audio description' : 'Deaf solution';
      let first = null;
      for (let attempt = 0; attempt <= LIMITS.maxRetries; attempt++) {
        if (overBudget()) { trace('Reviewer', 'fail', `Out of time testing the ${label}; escalated to the teacher`); break; }
        const text = version === 'audio' ? job.description.en : deafText(job.deafSolution);
        trace('Reviewer', 'start', `Answering the worksheet using only the ${label}${attempt ? ` (try ${attempt + 1})` : ''}`);
        yield* flush();
        let result;
        try { result = await ai(() => deps.accessTest({ version, text, proof, questions: job.input.questions, ...ctx })); }
        catch (error) { if (error instanceof StepCapError) throw error; trace('Reviewer', 'fail', `Access test failed to run: ${error.message.slice(0, 100)}`); break; }
        const meaning = deps.meaningCheck(text, proof);
        first = first || result;
        const pass = result.pass && meaning.pass;
        review({ ...result, pass, attempt, before: attempt ? scoreText(first) : undefined, after: attempt ? scoreText(result) : undefined, meaning });
        if (pass) { trace('Reviewer', 'done', `${label}: ${scoreText(result)}${attempt ? ` (was ${scoreText(first)})` : ''}, every number matches the proof`); break; }
        const why = [!result.pass && `${scoreText(result)} questions answered`, !meaning.pass && `${meaning.problems.length} sentence${meaning.problems.length > 1 ? 's' : ''} disagree with the proof`].filter(Boolean).join('; ');
        if (attempt === LIMITS.maxRetries) { trace('Reviewer', 'fail', `${label} still fails after ${attempt} rewrites (${why}); escalated to the teacher`); break; }
        trace('Reviewer', 'retry', `${label} fails: ${why}. Sending back to the Explainer`);
        trace('Explainer', 'start', `Rewriting the ${label} with the Reviewer's feedback`);
        yield* flush();
        const feedback = [...deps.feedbackFrom(result), ...meaning.problems.map(p => `This sentence disagrees with the proof (${p.reason}): ${p.sentence}`)];
        try {
          const rewritten = await ai(() => deps.explain({ proof, reading, feedback, translate, ...ctx }));
          const before = version === 'audio' ? job.description.en : deafText(job.deafSolution);
          if (version === 'audio') patch({ description: rewritten.description });
          else patch({ deafSolution: rewritten.deafSolution });
          correct({ agent: 'Explainer', field: version === 'audio' ? 'description.en' : 'deafSolution', before, after: version === 'audio' ? rewritten.description.en : deafText(rewritten.deafSolution), reason: why });
          trace('Explainer', 'done', `${label} rewritten`);
        } catch (error) { if (error instanceof StepCapError) throw error; trace('Explainer', 'fail', `Rewrite failed: ${error.message.slice(0, 100)}`); break; }
        yield* flush();
      }
      yield* flush();
    }

    const open = job.reviews.filter(r => !r.pass && r.check !== 'reader-vs-prover');
    const lastByCheck = Object.values(Object.fromEntries(job.reviews.map(r => [r.check, r])));
    const unresolved = lastByCheck.filter(r => !r.pass && r.check !== 'reader-vs-prover');
    trace('Teacher', 'start', unresolved.length ? `Ready for review: ${unresolved.length} check${unresolved.length > 1 ? 's' : ''} need the teacher's eye` : `Ready for approval: every check passes (${open.length} fixed along the way)`);
    yield* flush();
    yield { type: 'done', job: { ...job, input: { ...job.input, imageBase64: '' }, calls, ms: elapsed() } };
  } catch (error) {
    trace('Reviewer', 'fail', error.message);
    yield* flush();
    yield { type: 'error', message: error.message, job: { ...job, input: { ...job.input, imageBase64: '' } } };
  }
}
