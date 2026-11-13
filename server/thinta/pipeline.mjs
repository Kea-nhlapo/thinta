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
    explain: explainer.explain, accessTest: reviewer.accessTest, meaningCheck: reviewer.meaningCheck, feedbackFrom: reviewer.feedbackFrom, deafText: reviewer.deafText,
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
const joinSteps = deafSolution => (deafSolution?.steps || []).map(s => s.text).join('\n');
const scoreText = review => (review?.score !== undefined ? `${review.score}/${review.total}` : review?.pass ? 'pass' : 'fail');

class StepCapError extends Error {}

// Runs one job and yields stream events (see contract.js). Never throws: failures become trace entries.
export async function* runPipeline(input, { apiKey, fetchImpl = fetch, translate, deps, now = Date.now } = {}) {
  let deafText = joinSteps;
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

  // Yields events while a promise runs, so agents working at the same time stream their trace as they go.
  const pump = async function* (promise) {
    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });
    while (!settled) { yield* flush(); await Promise.race([promise.catch(() => {}), new Promise(resolve => setTimeout(resolve, 150))]); }
    yield* flush();
    return promise;
  };

  try {
    deps = deps || await defaultDeps();
    deafText = deps.deafText || joinSteps;
    const ctx = { apiKey, fetchImpl };

    // Planner ∥ Reader: the Reader does not need the plan, so neither waits for the other.
    const planning = (async () => {
      trace('Planner', 'start', `Planning a pack for ${job.input.learners.join(', ')} learners`);
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
    })();
    const reading = (async () => {
      trace('Reader', 'start', 'Reading the photo');
      try {
        if (!job.input.imageBase64) throw new Error('no photo sent');
        const read = await ai(() => deps.readGraph({ imageBase64: job.input.imageBase64, mimeType: job.input.mimeType, equationHint: job.input.equationHint, ...ctx }));
        const tp = read.turningPoint ? ` turning point read as (${read.turningPoint.x}, ${read.turningPoint.y})` : '';
        trace('Reader', 'done', `${read.type === 'bar' ? 'Bar chart' : `Graph ${read.equation || '(no equation seen)'}`};${tp} confidence ${Math.round((read.confidence ?? 0) * 100)}%`);
        return read;
      } catch (error) {
        if (error instanceof StepCapError) throw error;
        if (!job.input.equationHint) { trace('Reader', 'fail', `Could not read the photo: ${error.message.slice(0, 120)}`); throw new Error('The photo could not be read and no equation was typed.'); }
        trace('Reader', 'fail', `Could not read the photo (${error.message.slice(0, 80)}); continuing from the typed equation`);
        return { type: 'function', equation: job.input.equationHint, confidence: 0 };
      }
    })();
    const [, read] = yield* pump(Promise.all([planning, reading]));
    patch({ reading: read });

    // Prover (pure algebra, overrules the Reader)
    trace('Prover', 'start', 'Checking the maths with algebra');
    const { proof, corrections } = deps.prove(read, { equationHint: job.input.equationHint, questions: job.input.questions });
    patch({ proof });
    corrections.forEach(correct);
    if (read.type !== 'bar' && (read.turningPoint || read.roots)) review({ agent: 'Reviewer', check: 'reader-vs-prover', pass: !corrections.length, before: corrections[0]?.before, after: corrections[0]?.after, reason: corrections.length ? `${corrections.length} value${corrections.length > 1 ? 's' : ''} read from the drawing disagreed with the algebra; the Prover's values win` : 'The Reader agreed with the algebra' });
    const facts = proof.bars?.length ? `${proof.bars.length} bars checked` : `roots ${proof.roots.length ? proof.roots.join(' and ') : 'none'}${proof.turningPoint ? `, turning point (${proof.turningPoint.x}, ${proof.turningPoint.y})` : ''}`;
    trace('Prover', 'done', `${facts}${corrections.length ? `. Overruled the Reader on ${corrections.map(c => c.field.replace('reading.', '')).join(', ')}` : ''}`);
    yield* flush();

    // Designer and Sonifier are instant; the Explainer and the fresh-eyes check of the print run side by side.
    trace('Designer', 'start', 'Drawing the tactile print');
    let tactile = deps.designTactile(proof, { type: read.type === 'bar' ? 'bar' : 'function' });
    (tactile.corrections || []).forEach(correct);
    patch({ tactile: { svg: tactile.svg, warnings: tactile.warnings || [], ruleChecks: tactile.ruleChecks || [] } });
    const failedRules = (tactile.ruleChecks || []).filter(r => !r.pass);
    trace('Designer', failedRules.length ? 'fail' : 'done', `${(tactile.ruleChecks || []).length - failedRules.length}/${(tactile.ruleChecks || []).length} print rules pass${tactile.corrections?.length ? `, ${tactile.corrections.length} label${tactile.corrections.length > 1 ? 's' : ''} moved` : ''}`);
    trace('Sonifier', 'start', 'Mapping the curve to sound');
    const sound = deps.sonify(proof);
    patch({ sound });
    trace('Sonifier', 'done', `${sound.keyPoints.length} key points will click and vibrate`);

    // Reviewer 1: fresh eyes on the tactile print, sending it back to the Designer when they disagree.
    const freshEyes = (async () => {
      for (let attempt = 0; attempt <= LIMITS.maxRetries; attempt++) {
        if (overBudget()) { trace('Reviewer', 'fail', 'Out of time for the fresh-eyes check; escalated to the teacher'); return; }
        trace('Reviewer', 'start', attempt ? `Fresh eyes again after the fix (try ${attempt + 1})` : 'Fresh eyes: reading the tactile print without the photo');
        try {
          const result = await ai(() => deps.freshEyes({ svg: job.tactile.svg, proof, ...ctx }));
          review({ ...result.review, attempt });
          if (result.review.pass) { trace('Reviewer', 'done', `Fresh eyes agree with the proof: ${result.review.reason}`); return; }
          if (attempt === LIMITS.maxRetries) { trace('Reviewer', 'fail', `Fresh eyes still disagree after ${attempt} fixes; escalated to the teacher`); return; }
          trace('Reviewer', 'retry', `Fresh eyes disagree: ${result.review.reason}. Sending back to the Designer`);
          const fixed = deps.fixTactile(proof, tactile, result.feedback || { missing: [], unclear: ['roots', 'turningPoint', 'yIntercept'] });
          (fixed.corrections || []).forEach(correct);
          tactile = fixed;
          patch({ tactile: { svg: fixed.svg, warnings: fixed.warnings || [], ruleChecks: fixed.ruleChecks || [] } });
          trace('Designer', 'done', 'Tactile print regenerated with clearer labels');
        } catch (error) {
          if (error instanceof StepCapError) throw error;
          trace('Reviewer', 'fail', `Fresh-eyes check failed to run: ${error.message.slice(0, 100)}`);
          return;
        }
      }
    })();
    freshEyes.catch(() => {});

    trace('Explainer', 'start', 'Writing the audio description and the Deaf solution');
    const explained = yield* pump(ai(() => deps.explain({ proof, reading: read, translate, ...ctx })));
    patch({ description: explained.description, deafSolution: explained.deafSolution });
    (explained.warnings || []).forEach(warning => trace('Explainer', 'fail', warning));
    trace('Explainer', 'done', `Description written${explained.description.zu ? ' in English and isiZulu' : ' in English (isiZulu failed)'}; ${explained.deafSolution.steps.length} Deaf solution steps`);

    // Reviewer 2 and 3: answer the worksheet from each version alone, plus a meaning check; both versions in parallel.
    const accessLoop = async version => {
      const label = version === 'audio' ? 'audio description' : 'Deaf solution';
      let first = null;
      for (let attempt = 0; attempt <= LIMITS.maxRetries; attempt++) {
        if (overBudget()) { trace('Reviewer', 'fail', `Out of time testing the ${label}; escalated to the teacher`); return; }
        const text = version === 'audio' ? job.description.en : deafText(job.deafSolution);
        trace('Reviewer', 'start', `Answering the worksheet using only the ${label}${attempt ? ` (try ${attempt + 1})` : ''}`);
        let result;
        try { result = await ai(() => deps.accessTest({ version, text, proof, questions: job.input.questions, ...ctx })); }
        catch (error) { if (error instanceof StepCapError) throw error; trace('Reviewer', 'fail', `Access test failed to run: ${error.message.slice(0, 100)}`); return; }
        const meaning = deps.meaningCheck(text, proof);
        first = first || { ...result, meaningPass: meaning.pass };
        const pass = result.pass && meaning.pass;
        const status = r => `${scoreText(r)}${r.meaningPass === false ? ' with a wrong number' : ''}`;
        review({ ...result, version, pass, attempt, before: attempt ? status(first) : undefined, after: attempt ? status({ ...result, meaningPass: meaning.pass }) : undefined, meaning });
        if (pass) { trace('Reviewer', 'done', `${label}: ${scoreText(result)}${attempt ? ` (was ${status(first)})` : ''}, every number matches the proof`); return; }
        const why = [!result.pass && `${scoreText(result)} questions answered`, !meaning.pass && `${meaning.problems.length} sentence${meaning.problems.length > 1 ? 's' : ''} disagree with the proof`].filter(Boolean).join('; ');
        if (attempt === LIMITS.maxRetries) { trace('Reviewer', 'fail', `${label} still fails after ${attempt} rewrites (${why}); escalated to the teacher`); return; }
        trace('Reviewer', 'retry', `${label} fails: ${why}. Sending back to the Explainer`);
        trace('Explainer', 'start', `Rewriting the ${label} with the Reviewer's feedback`);
        const feedback = [...deps.feedbackFrom(result), ...meaning.problems.map(p => `This sentence disagrees with the proof (${p.reason}): ${p.sentence}`)];
        try {
          const rewritten = await ai(() => deps.explain({ proof, reading: read, feedback, translate, ...ctx }));
          (rewritten.warnings || []).forEach(warning => trace('Explainer', 'fail', warning));
          const before = text;
          if (version === 'audio') patch({ description: rewritten.description });
          else patch({ deafSolution: rewritten.deafSolution });
          correct({ agent: 'Explainer', field: version === 'audio' ? 'description.en' : 'deafSolution', before, after: version === 'audio' ? rewritten.description.en : deafText(rewritten.deafSolution), reason: why });
          trace('Explainer', 'done', `${label} rewritten`);
        } catch (error) { if (error instanceof StepCapError) throw error; trace('Explainer', 'fail', `Rewrite failed: ${error.message.slice(0, 100)}`); return; }
      }
    };
    const checks = [freshEyes];
    if (job.plan.versions.includes('audio-description')) checks.push(accessLoop('audio'));
    if (job.plan.versions.includes('deaf-solution')) checks.push(accessLoop('deaf'));
    yield* pump(Promise.all(checks));

    // Every check the plan needs must have passed on its last try; a missing check counts as open.
    const needed = ['fresh-eyes', ...(job.plan.versions.includes('audio-description') ? ['access-audio'] : []), ...(job.plan.versions.includes('deaf-solution') ? ['access-deaf'] : [])];
    const last = Object.fromEntries(job.reviews.map(r => [r.check === 'access' ? `access-${r.version}` : r.check, r]));
    const open = needed.filter(check => !last[check]?.pass);
    const fixed = job.corrections.length;
    trace('Teacher', 'start', open.length ? `Ready for review: ${open.length} check${open.length > 1 ? 's need' : ' needs'} the teacher's eye (${open.join(', ')})` : `Ready for approval: every check passes (${fixed} correction${fixed === 1 ? '' : 's'} made along the way)`);
    yield* flush();
    yield { type: 'done', job: { ...job, input: { ...job.input, imageBase64: '' }, calls, ms: elapsed() } };
  } catch (error) {
    trace('Reviewer', 'fail', error.message);
    yield* flush();
    yield { type: 'error', message: error.message, job: { ...job, input: { ...job.input, imageBase64: '' } } };
  }
}
