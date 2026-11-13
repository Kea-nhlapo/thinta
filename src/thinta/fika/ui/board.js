// Delivery board state for the phone: applies Fika's stream and replan results to a dispatch.
// Pure and DOM-free so it runs under node --test. ETAs and corrections only ever come from the server.
import { FIKA_AGENTS } from '../../contract.js';

// Item names in words, never the contract's ids.
export const ITEM_LABELS = { tactile: 'Tactile print', 'phone-blind': 'Phone pack: sound, touch and audio', 'deaf-solution': 'Deaf step-by-step solution' };
export const itemLabel = item => ITEM_LABELS[item] || String(item || 'Item').replace(/-/g, ' ');

// Icon + word for every status, so nothing depends on colour.
export const STATUS_LABELS = { queued: ['⏳', 'Queued'], printing: ['🖨', 'Printing'], ready: ['✓', 'Ready'], delivered: ['📬', 'Delivered'], late: ['⚠', 'Late'] };
export const statusLabel = status => STATUS_LABELS[status] || ['•', String(status || 'Unknown')];

// "Thu 15:10" in the school's time zone. Fallback until H's time.js formatEta is used.
export function formatClock(iso, timeZone = 'Africa/Johannesburg') {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.weekday} ${parts.hour}:${parts.minute}`;
}

// Full weekday name of an ISO time, e.g. "Friday", for "Can't meet Friday's lesson".
export function weekdayName(iso, timeZone = 'Africa/Johannesburg') {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long' }).format(date);
}

export function initialBoard() {
  return { dispatch: null, corrections: [], reviews: [], log: [], status: 'idle', error: null };
}

const running = state => (state.status === 'idle' ? 'running' : state.status);
const patchOf = event => event.dispatch || event.job?.dispatch || null;

// One streamed event in, new board state out. Same event shapes as a Thinta run, ending {type:'done', dispatch}.
export function applyFikaEvent(state, event) {
  if (!event || typeof event !== 'object') return state;
  switch (event.type) {
    case 'trace':
      return event.entry ? { ...state, status: running(state), log: [...state.log, { kind: 'trace', ...event.entry }] } : state;
    case 'correction':
      return event.correction ? { ...state, status: running(state), corrections: [...state.corrections, event.correction], log: [...state.log, { kind: 'correction', ...event.correction }] } : state;
    case 'review':
      return event.review ? { ...state, status: running(state), reviews: [...state.reviews, event.review], log: [...state.log, { kind: 'review', ...event.review }] } : state;
    case 'patch': {
      const patch = patchOf(event);
      return patch ? { ...state, status: running(state), dispatch: { ...(state.dispatch || {}), ...patch } } : state;
    }
    case 'done': {
      const dispatch = patchOf(event);
      return { ...state, status: 'done', dispatch: dispatch ? { ...(state.dispatch || {}), ...dispatch } : state.dispatch };
    }
    case 'error':
      return { ...state, status: 'error', error: String(event.message || 'Fika stopped.') };
    default:
      return state;
  }
}

// Applies a POST /dispatch/event reply {dispatch, corrections, trace}: appends trace and corrections, swaps the dispatch.
export function applyEventResult(state, result) {
  if (!result?.dispatch) return state;
  const corrections = Array.isArray(result.corrections) ? result.corrections : [];
  const trace = Array.isArray(result.trace) ? result.trace : [];
  return {
    ...state,
    dispatch: result.dispatch,
    corrections: [...state.corrections, ...corrections],
    log: [...state.log, ...trace.map(entry => ({ kind: 'trace', ...entry })), ...corrections.map(c => ({ kind: 'correction', ...c }))],
  };
}

// Job id from an ETA correction field: "dispatch.jobs.d2.eta" (or "jobs.d2.eta") → "d2".
export function etaJobId(field) {
  const match = /^(?:dispatch\.)?jobs\.([^.]+)\.eta$/.exec(String(field || ''));
  return match ? match[1] : null;
}

// The latest ETA correction for each job, as a Map of job id → correction.
export function latestEtaCorrections(corrections = []) {
  const latest = new Map();
  for (const correction of corrections) {
    const id = etaJobId(correction?.field);
    if (id) latest.set(id, correction);
  }
  return latest;
}

// One group per learner in the school's order; jobs for unknown learners follow, named by id.
export function groupByLearner(jobs = [], learners = []) {
  const groups = new Map(learners.map(learner => [learner.id, { learner, jobs: [] }]));
  for (const job of jobs) {
    if (!groups.has(job.learnerId)) groups.set(job.learnerId, { learner: { id: job.learnerId, name: job.learnerId || 'Unknown learner' }, jobs: [] });
    groups.get(job.learnerId).jobs.push(job);
  }
  return [...groups.values()].filter(group => group.jobs.length);
}

export const lateTactileJobs = dispatch => (dispatch?.jobs || []).filter(job => job.item === 'tactile' && job.status === 'late');
export const uniqueReasons = jobs => [...new Set(jobs.map(job => job.lateReason).filter(Boolean))];

// Phone packs already delivered to the learners whose tactile print is late.
export function phoneFallbacks(dispatch) {
  const learners = new Set(lateTactileJobs(dispatch).map(job => job.learnerId));
  return (dispatch?.jobs || []).filter(job => job.item === 'phone-blind' && job.status === 'delivered' && learners.has(job.learnerId));
}

// Is this machine online as Fika last saw it? Falls back to the school's own record.
export function machineOnline(dispatch, machineId, school) {
  const seen = (dispatch?.machines || []).find(m => m.id === machineId);
  if (seen) return seen.online !== false;
  return (school?.machines || []).find(m => m.id === machineId)?.online !== false;
}

// Body for POST /api/thinta/dispatch/event. Always carries our dispatch: the server may be a fresh instance.
export function eventBody({ graphJobId, kind, machineId, dispatch, hours = 1 }) {
  const body = { graphJobId, kind, dispatch };
  if (machineId) body.machineId = machineId;
  if (kind === 'tick' && dispatch?.clock) {
    const next = new Date(new Date(dispatch.clock).getTime() + hours * 3600e3);
    if (!Number.isNaN(next.getTime())) body.toClock = next.toISOString();
  }
  return body;
}

// waiting | working | done | retry | failed for each Fika agent, from the trace lines in the log.
export function fikaAgentStates(log = [], status = 'running') {
  const states = Object.fromEntries(FIKA_AGENTS.map(agent => [agent, 'waiting']));
  for (const item of log) {
    if (item.kind !== 'trace' || !(item.agent in states)) continue;
    states[item.agent] = { start: 'working', done: 'done', fail: 'failed', retry: 'retry' }[item.status] || states[item.agent];
  }
  for (const agent of FIKA_AGENTS) {
    if (status === 'done' && states[agent] === 'working') states[agent] = 'done';
    if (status === 'done' && states[agent] === 'waiting') states[agent] = 'skipped';
    if (status === 'error' && states[agent] === 'working') states[agent] = 'failed';
  }
  return states;
}

// Log lines for the trace with ETA values shown as "Thu 15:10" instead of raw ISO times.
export function readableLog(log, format = formatClock) {
  return log.map(item => (item.kind === 'correction' && etaJobId(item.field) ? { ...item, before: format(item.before), after: format(item.after) } : item));
}

// A recorded Fika run in any shape we save: {events, actions?}, a list of events (optionally {t, event}),
// {dispatch}, or a bare dispatch. Returns {timeline:[{t, event}], actions:[{kind, machineId?, result}]}.
export function replayPlan(recording) {
  const raw = Array.isArray(recording) ? recording : Array.isArray(recording?.events) && !recording.jobs ? recording.events : null;
  const actions = Array.isArray(recording?.actions) ? recording.actions.filter(a => a?.result?.dispatch) : [];
  if (raw) {
    let t = 0;
    const timeline = raw.map(item => {
      const event = item.event || item;
      t = Number.isFinite(item.t) ? item.t : t + 300;
      return { t, event };
    });
    return { timeline, actions };
  }
  const dispatch = recording?.dispatch || (recording?.jobs ? recording : null);
  return { timeline: dispatch ? [{ t: 0, event: { type: 'done', dispatch } }] : [], actions };
}
