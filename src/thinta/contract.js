// Thinta's shared contract: every agent reads and writes one GraphJob. Frozen after +0:30; only the
// orchestrator changes it, and changes are announced in THINTA_STATUS.md. Pure data, no imports, so it
// runs in the browser, on the server and under `node --test`.

/**
 * @typedef {{x:number, y:number}} Point
 * @typedef {'Planner'|'Reader'|'Prover'|'Designer'|'Sonifier'|'Explainer'|'Reviewer'|'Teacher'|'Dispatcher'} AgentName
 * @typedef {{t:number, agent:AgentName, status:'start'|'done'|'fail'|'retry', message:string}} TraceEntry
 * @typedef {{agent:AgentName, field:string, before:any, after:any, reason:string}} Correction
 * @typedef {{agent:AgentName, check:string, pass:boolean, before?:any, after?:any, reason:string}} Review
 *
 * @typedef {Object} GraphJob
 * @property {string} id
 * @property {string} createdAt ISO time
 * @property {'live'|'replay'} mode
 * @property {{imageBase64:string, equationHint?:string, questions?:string[], learners:('blind'|'deaf'|'sighted')[]}} input
 * @property {{steps:string[], versions:('tactile'|'sound'|'audio-description'|'deaf-solution')[]}} plan
 * @property {{type:'function'|'bar', equation?:string, points?:Point[], axes?:{x?:{min:number,max:number,label?:string}, y?:{min:number,max:number,label?:string}}, labels?:string[], questions?:string[], turningPoint?:Point, roots?:number[], bars?:{label:string, value:number}[], confidence:number}} reading
 *   What the Reader saw in the photo. turningPoint/roots are its own reads, kept so the Prover can overrule them.
 * @property {{equation:string, coefficients?:{a:number,b:number,c:number}, roots:number[], turningPoint?:Point, yIntercept?:number, domain:[number,number], range?:[number,number], samples:Point[], bars?:{label:string, value:number}[], answers?:{question:string, answer:string}[]}} proof
 *   Ground truth from algebra, never from AI. `answers` are the Prover-derived answers the Reviewer grades against.
 * @property {{svg:string, warnings:string[], ruleChecks:{rule:string, pass:boolean, detail:string}[]}} tactile
 * @property {{samples:Point[], keyPoints:{x:number, y:number, kind:'root'|'turning-point'|'y-intercept'|'bar'}[]}} sound
 * @property {{en:string, zu:string, audioUrls?:{en?:string, zu?:string}}} description
 * @property {{steps:{text:string, visual:string}[], keyTerms:string[]}} deafSolution
 *   `visual` is a short instruction for the step's picture (e.g. "highlight the roots on the x-axis"), never sign language.
 * @property {Review[]} reviews
 * @property {Correction[]} corrections Drives the strike-through UI.
 * @property {{approved:boolean, by?:string, at?:string}} approval
 * @property {TraceEntry[]} trace
 */

export const AGENTS = ['Planner', 'Reader', 'Prover', 'Designer', 'Sonifier', 'Explainer', 'Reviewer', 'Teacher'];

// Pass rules from the brief (section 4.4).
export const LIMITS = {
  maxAgentCalls: 20,
  maxRetries: 2,
  valueTolerance: 0.25,       // Reader vs Prover, fresh eyes vs Prover
  minLabelGapMm: 3.2,         // label to curve, at print scale
  accessPassMark: 4,          // out of 5 questions
  maxImageBytes: 3_500_000,   // base64 length, same limit as /api/describe-images
  runBudgetMs: 100_000,       // whole run, under Vercel's 120 s
};

// Streamed from POST /api/thinta/run as newline-delimited JSON, one event per line:
//   {type:'trace', entry:TraceEntry}
//   {type:'correction', correction:Correction}
//   {type:'review', review:Review}
//   {type:'patch', job:Partial<GraphJob>}   the fields an agent just filled in
//   {type:'done', job:GraphJob}
//   {type:'error', message:string, job?:GraphJob}
export const STREAM_CONTENT_TYPE = 'application/x-ndjson';

export const DEFAULT_QUESTIONS = [
  'Where does the graph cross the x-axis?',
  'What is the turning point of the graph?',
  'Is the turning point a minimum or a maximum?',
  'Where does the graph cross the y-axis?',
  'For which values of x is y less than 0?',
];

export function emptyJob({ id = `job-${Date.now().toString(36)}`, mode = 'live', input = {} } = {}) {
  return {
    id, createdAt: new Date().toISOString(), mode,
    input: { imageBase64: '', learners: ['blind', 'deaf', 'sighted'], ...input },
    plan: { steps: [], versions: [] },
    reading: null, proof: null, tactile: null, sound: null, description: null, deafSolution: null,
    reviews: [], corrections: [], approval: { approved: false }, trace: [],
  };
}

// Samples of y = f(x) over [min, max], rounded so fixtures stay readable.
export function sampleCurve(f, [min, max], step = 0.25) {
  const out = [];
  for (let x = min; x <= max + 1e-9; x += step) out.push({ x: +x.toFixed(4), y: +f(x).toFixed(4) });
  return out;
}

// Light structural check used by tests and by the UI before rendering a job (live, replayed or streamed).
export function validateJob(job) {
  const problems = [];
  if (!job || typeof job !== 'object') return ['job is not an object'];
  for (const key of ['id', 'createdAt', 'mode', 'input', 'plan', 'reviews', 'corrections', 'approval', 'trace']) if (!(key in job)) problems.push(`missing ${key}`);
  if (job.mode && !['live', 'replay'].includes(job.mode)) problems.push('mode must be live or replay');
  if (job.proof) {
    if (!Array.isArray(job.proof.roots)) problems.push('proof.roots must be an array');
    if (!Array.isArray(job.proof.samples) || !job.proof.samples.length) problems.push('proof.samples must be a non-empty array');
  }
  if (job.tactile && typeof job.tactile.svg !== 'string') problems.push('tactile.svg must be a string');
  for (const entry of job.trace || []) if (!AGENTS.includes(entry.agent) && entry.agent !== 'Dispatcher') problems.push(`unknown agent ${entry.agent}`);
  for (const c of job.corrections || []) if (!c.agent || !c.field || !c.reason) problems.push('correction needs agent, field and reason');
  return problems;
}

const parabola = x => x * x - 2 * x - 8;

// Example 1: the demo parabola. Values here are fixture data for building against, not a recorded run.
export const EXAMPLE_PARABOLA_JOB = {
  id: 'example-parabola', createdAt: '2026-11-13T18:00:00.000Z', mode: 'replay',
  input: { imageBase64: '', equationHint: 'y = x^2 - 2x - 8', questions: DEFAULT_QUESTIONS, learners: ['blind', 'deaf', 'sighted'] },
  plan: { steps: ['Read the photo', 'Prove the maths', 'Design tactile, sound, description and Deaf solution', 'Review every version'], versions: ['tactile', 'sound', 'audio-description', 'deaf-solution'] },
  reading: {
    type: 'function', equation: 'y = x^2 - 2x - 8',
    points: [{ x: -2, y: 0 }, { x: 4, y: 0 }, { x: 0, y: -8 }],
    axes: { x: { min: -4, max: 6, label: 'x' }, y: { min: -10, max: 8, label: 'y' } },
    labels: ['y = x² − 2x − 8'], questions: [], turningPoint: { x: 1, y: -8.5 }, roots: [-2, 4], confidence: 0.7,
  },
  proof: {
    equation: 'y = x^2 - 2x - 8', coefficients: { a: 1, b: -2, c: -8 },
    roots: [-2, 4], turningPoint: { x: 1, y: -9 }, yIntercept: -8, domain: [-4, 6], range: [-9, 16],
    samples: sampleCurve(parabola, [-4, 6]),
    answers: [
      { question: DEFAULT_QUESTIONS[0], answer: 'x = -2 and x = 4' },
      { question: DEFAULT_QUESTIONS[1], answer: '(1, -9)' },
      { question: DEFAULT_QUESTIONS[2], answer: 'minimum' },
      { question: DEFAULT_QUESTIONS[3], answer: 'y = -8, at (0, -8)' },
      { question: DEFAULT_QUESTIONS[4], answer: '-2 < x < 4' },
    ],
  },
  tactile: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 200"><title>Placeholder tactile graph</title></svg>', warnings: [], ruleChecks: [{ rule: 'label-gap', pass: true, detail: 'All labels at least 3.2 mm from the curve' }] },
  sound: { samples: sampleCurve(parabola, [-4, 6]), keyPoints: [{ x: -2, y: 0, kind: 'root' }, { x: 4, y: 0, kind: 'root' }, { x: 1, y: -9, kind: 'turning-point' }, { x: 0, y: -8, kind: 'y-intercept' }] },
  description: {
    en: 'A U-shaped curve, the graph of y equals x squared minus 2x minus 8. It crosses the x-axis at x equals negative 2 and at x equals 4. Its lowest point, the turning point, is at 1, negative 9. It crosses the y-axis at negative 8. Between x equals negative 2 and x equals 4 the curve is below the x-axis, so y is less than 0 there.',
    zu: 'Ijika elimise okwe-U, igrafu ka-y ilingana no-x sikwele susa u-2x susa u-8. Liwela i-eksisi ka-x lapho u-x elingana no-2 negethivu nalapho u-x elingana no-4. Iphuzu lalo eliphansi kakhulu lise-1, negethivu 9. Liwela i-eksisi ka-y ku-negethivu 8.',
  },
  deafSolution: {
    steps: [
      { text: 'The equation is y = x² − 2x − 8.', visual: 'show the equation large' },
      { text: 'Find the roots: set y = 0. x² − 2x − 8 = 0 becomes (x − 4)(x + 2) = 0, so x = 4 or x = −2.', visual: 'mark −2 and 4 on the x-axis' },
      { text: 'Find the turning point: x = −b ÷ 2a = 2 ÷ 2 = 1. Put x = 1 in: y = 1 − 2 − 8 = −9. The turning point is (1, −9).', visual: 'mark (1, −9) at the bottom of the curve' },
      { text: 'Find the y-intercept: put x = 0 in. y = −8.', visual: 'mark (0, −8) on the y-axis' },
      { text: 'a = 1 is positive, so the curve opens upwards and (1, −9) is a minimum.', visual: 'draw an arrow up both arms of the U' },
    ],
    keyTerms: ['ROOT', 'TURNING POINT', 'MINIMUM', 'Y-INTERCEPT'],
  },
  reviews: [
    { agent: 'Reviewer', check: 'reader-vs-prover', pass: false, before: { x: 1, y: -8.5 }, after: { x: 1, y: -9 }, reason: 'Turning point read from the drawing is 0.5 away from the algebra' },
    { agent: 'Reviewer', check: 'fresh-eyes', pass: true, reason: 'Re-read roots and turning point match the proof' },
    { agent: 'Reviewer', check: 'access-audio', pass: true, before: '3/5', after: '5/5', reason: 'Rewritten description answers all 5 questions' },
  ],
  corrections: [
    { agent: 'Prover', field: 'reading.turningPoint', before: { x: 1, y: -8.5 }, after: { x: 1, y: -9 }, reason: 'Algebra: x = -b/2a = 1, y = 1 - 2 - 8 = -9' },
  ],
  approval: { approved: false },
  trace: [
    { t: 0, agent: 'Planner', status: 'start', message: 'Planning a pack for blind, Deaf and sighted learners' },
    { t: 400, agent: 'Planner', status: 'done', message: '4 versions: tactile, sound, audio description, Deaf solution' },
    { t: 500, agent: 'Reader', status: 'start', message: 'Reading the photo' },
    { t: 4200, agent: 'Reader', status: 'done', message: 'Parabola y = x^2 - 2x - 8, turning point about (1, -8.5)' },
    { t: 4300, agent: 'Prover', status: 'start', message: 'Solving the equation' },
    { t: 4310, agent: 'Prover', status: 'done', message: 'Roots -2 and 4, turning point (1, -9). Overruled the Reader' },
  ],
};

// Example 2: a textbook bar chart.
export const EXAMPLE_BAR_JOB = {
  id: 'example-bar', createdAt: '2026-11-13T18:00:00.000Z', mode: 'replay',
  input: { imageBase64: '', questions: ['Which month had the most rain?', 'How much rain fell in March?'], learners: ['blind', 'deaf', 'sighted'] },
  plan: { steps: ['Read the photo', 'Check the values', 'Design tactile, sound and description', 'Review'], versions: ['tactile', 'sound', 'audio-description', 'deaf-solution'] },
  reading: { type: 'bar', bars: [{ label: 'Jan', value: 120 }, { label: 'Feb', value: 95 }, { label: 'Mar', value: 80 }], axes: { y: { min: 0, max: 150, label: 'Rainfall (mm)' } }, labels: ['Rainfall in Johannesburg'], questions: [], confidence: 0.8 },
  proof: {
    equation: '', roots: [], domain: [0, 2], bars: [{ label: 'Jan', value: 120 }, { label: 'Feb', value: 95 }, { label: 'Mar', value: 80 }],
    samples: [{ x: 0, y: 120 }, { x: 1, y: 95 }, { x: 2, y: 80 }],
    answers: [{ question: 'Which month had the most rain?', answer: 'January' }, { question: 'How much rain fell in March?', answer: '80 mm' }],
  },
  tactile: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 200"><title>Placeholder tactile bar chart</title></svg>', warnings: [], ruleChecks: [] },
  sound: { samples: [{ x: 0, y: 120 }, { x: 1, y: 95 }, { x: 2, y: 80 }], keyPoints: [{ x: 0, y: 120, kind: 'bar' }, { x: 1, y: 95, kind: 'bar' }, { x: 2, y: 80, kind: 'bar' }] },
  description: { en: 'A bar chart of rainfall in Johannesburg. January 120 millimetres, February 95, March 80. January had the most rain.', zu: 'Ishadi lemvula eGoli. NgoJanuwari amamilimitha ayi-120, ngoFebhuwari ayi-95, ngoMashi ayi-80.' },
  deafSolution: { steps: [{ text: 'Each bar is one month. Taller bar = more rain.', visual: 'point to each bar in turn' }, { text: 'January is tallest: 120 mm.', visual: 'highlight the January bar' }], keyTerms: ['BAR', 'RAINFALL'] },
  reviews: [], corrections: [], approval: { approved: false },
  trace: [{ t: 0, agent: 'Planner', status: 'done', message: 'Bar chart pack' }],
};
