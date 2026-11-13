// Run state for the phone UI: applies streamed events to a GraphJob and builds replay timelines.
// Pure and DOM-free so it runs under node --test.
import { emptyJob } from '../contract.js';

export const PIPELINE = [['Planner'], ['Reader'], ['Prover'], ['Designer', 'Sonifier', 'Explainer'], ['Reviewer']];
export const PIPELINE_AGENTS = PIPELINE.flat();

// Which part of the job each agent fills in, used to light chips and to stage replays.
export const AGENT_FIELDS = { Planner: ['plan'], Reader: ['reading'], Prover: ['proof'], Designer: ['tactile'], Sonifier: ['sound'], Explainer: ['description', 'deafSolution'] };

export function initialRun(job = emptyJob()) {
  return { job, log: [], status: 'idle', error: null };
}

// One event in, new state out. `log` keeps trace, correction and review lines in arrival order.
export function applyEvent(state, event) {
  if (!event || typeof event !== 'object') return state;
  const job = state.job;
  const running = state.status === 'idle' ? 'running' : state.status;
  switch (event.type) {
    case 'trace':
      if (!event.entry) return state;
      return { ...state, status: running, job: { ...job, trace: [...job.trace, event.entry] }, log: [...state.log, { kind: 'trace', ...event.entry }] };
    case 'correction':
      if (!event.correction) return state;
      return { ...state, status: running, job: { ...job, corrections: [...job.corrections, event.correction] }, log: [...state.log, { kind: 'correction', ...event.correction }] };
    case 'review':
      if (!event.review) return state;
      return { ...state, status: running, job: { ...job, reviews: [...job.reviews, event.review] }, log: [...state.log, { kind: 'review', ...event.review }] };
    case 'patch':
      return event.job ? { ...state, status: running, job: { ...job, ...event.job } } : state;
    case 'done':
      return event.job ? { ...state, status: 'done', job: { ...job, ...event.job } } : { ...state, status: 'done' };
    case 'error':
      return { ...state, status: 'error', error: String(event.message || 'Thinta stopped.'), job: event.job ? { ...job, ...event.job } : job };
    default:
      return state;
  }
}

// An empty plan ({steps:[]}) from emptyJob does not count as the Planner's output.
const hasOutput = value => Boolean(value) && !(Array.isArray(value.steps) && !value.steps.length && Array.isArray(value.versions) && !value.versions.length);

// waiting | working | done | retry | failed | skipped for each pipeline agent.
export function agentStates(job, status = 'running') {
  const states = Object.fromEntries(PIPELINE_AGENTS.map(agent => [agent, 'waiting']));
  for (const entry of job?.trace || []) {
    if (!(entry.agent in states)) continue;
    states[entry.agent] = { start: 'working', done: 'done', fail: 'failed', retry: 'retry' }[entry.status] || states[entry.agent];
  }
  for (const agent of PIPELINE_AGENTS) {
    const filled = (AGENT_FIELDS[agent] || []).some(field => hasOutput(job?.[field]));
    if (states[agent] === 'waiting' && filled) states[agent] = 'done';
    if (agent === 'Reviewer' && states[agent] === 'waiting' && job?.reviews?.length) states[agent] = 'done';
    if (status === 'done' && (states[agent] === 'waiting' || states[agent] === 'working')) states[agent] = states[agent] === 'working' ? 'done' : 'skipped';
    if (status === 'error' && states[agent] === 'working') states[agent] = 'failed';
  }
  return states;
}

const lastIndexOf = (trace, agent) => { for (let i = trace.length - 1; i >= 0; i--) if (trace[i].agent === agent) return i; return -1; };

// Rebuilds a timed event list from a finished job, so a recorded run replays as it streamed.
// Corrections, reviews and each agent's output land right after that agent's last trace line.
export function replayTimeline(job) {
  const trace = job.trace || [];
  const after = trace.map(() => []);
  const tail = [];
  const place = (agent, event) => { const i = lastIndexOf(trace, agent); (i >= 0 ? after[i] : tail).push(event); };
  for (const [agent, fields] of Object.entries(AGENT_FIELDS)) {
    const patch = {};
    for (const field of fields) if (job[field]) patch[field] = job[field];
    if (Object.keys(patch).length) place(agent, { type: 'patch', job: patch });
  }
  for (const correction of job.corrections || []) place(correction.agent, { type: 'correction', correction });
  for (const review of job.reviews || []) place(review.agent, { type: 'review', review });
  const out = [];
  trace.forEach((entry, i) => {
    out.push({ t: Number(entry.t) || 0, event: { type: 'trace', entry } });
    for (const event of after[i]) out.push({ t: Number(entry.t) || 0, event });
  });
  const end = out.length ? out[out.length - 1].t : 0;
  for (const event of tail) out.push({ t: end, event });
  out.push({ t: end, event: { type: 'done', job } });
  return out;
}

// Accepts a recorded run in any shape we save: a list of events (optionally {t, event}), {events}, or a GraphJob.
export function timelineFromRecording(recording) {
  const events = Array.isArray(recording) ? recording : Array.isArray(recording?.events) ? recording.events : null;
  if (!events) return replayTimeline(recording);
  let t = 0;
  return events.map(item => {
    const event = item.event || item;
    t = Number.isFinite(item.t) ? item.t : t + 300;
    return { t, event };
  });
}

// Delays between steps, sped up and capped so a 60 s run replays in a few seconds per agent.
export function replayDelays(timeline, { speed = 4, maxGap = 1500, minGap = 120 } = {}) {
  let previous = timeline[0]?.t || 0;
  return timeline.map(({ t }) => {
    const gap = Math.max(0, t - previous) / speed;
    previous = t;
    return Math.min(maxGap, Math.max(minGap, gap));
  });
}
