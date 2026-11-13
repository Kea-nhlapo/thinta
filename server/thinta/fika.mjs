// Fika: after the teacher approves a Thinta pack, plan delivery, schedule the tactile prints, check the schedule,
// track it and tell the teacher. STUB until H (scheduler, checker) and I (tracker, notifier) land: it returns the
// contract's example dispatch so the Delivery tab can be built against it.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXAMPLE_DISPATCH } from '../../src/thinta/contract.js';

// State lives in memory per graph job; locally it is also written to a JSON file so a dev-server restart keeps it.
// On Vercel, instances do not share memory, so callers may send their last copy of the dispatch with each event.
const FILE = join(tmpdir(), 'thinta-dispatch.json');
const store = new Map(Object.entries((() => { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return {}; } })()));
const save = () => { try { writeFileSync(FILE, JSON.stringify(Object.fromEntries(store))); } catch { /* read-only file system on Vercel */ } };

export const getDispatch = graphJobId => store.get(graphJobId) || null;
export function putDispatch(dispatch) { store.set(dispatch.graphJobId, dispatch); save(); return dispatch; }

// Yields the same stream events as a Thinta run and ends with {type:'done', dispatch}.
export async function* runDispatch({ graphJobId, schoolId }) {
  const dispatch = putDispatch({ ...structuredClone(EXAMPLE_DISPATCH), graphJobId, schoolId });
  yield { type: 'trace', entry: { t: 0, agent: 'Dispatcher', status: 'done', message: 'Example schedule (stub)' } };
  yield { type: 'done', dispatch };
}

// Replans after an event ({kind, machineId}) and returns {dispatch, corrections, trace}.
export async function dispatchEvent({ graphJobId, kind, machineId, dispatch }) {
  const current = getDispatch(graphJobId) || dispatch;
  if (!current) return null;
  const next = { ...current, events: [...current.events, { t: current.clock, kind, machineId, detail: `${kind}${machineId ? ` ${machineId}` : ''} (stub)` }] };
  return { dispatch: putDispatch(next), corrections: [], trace: [] };
}
