// Fika's Dispatcher: deterministic earliest-deadline-first scheduling of tactile prints across the school's machines.
// Pure JS, no DOM and no Node APIs, so the server and the phone run the same maths.
import { ITEM_MACHINES, ITEM_PAGES } from '../contract.js';
import { addWorkingMs, formatEta, formatGap, nextWorkingMs, printMinutes, toIso, toMs } from './time.js';

const ITEM_LABEL = { tactile: 'tactile print', 'phone-blind': 'phone pack', 'deaf-solution': 'Deaf solution' };
const PINNED = ['ready', 'delivered'];
export const isPhoneItem = item => !(ITEM_MACHINES[item] || []).length;

const learnerName = (school, id) => school.learners.find(l => l.id === id)?.name || id;
const machineName = (school, id) => school.machines.find(m => m.id === id)?.name || id;
const lower = name => name.charAt(0).toLowerCase() + name.slice(1);
const what = (school, job) => `${learnerName(school, job.learnerId)}'s ${job.urgent ? 'urgent ' : ''}${ITEM_LABEL[job.item] || job.item}`;

// One job per learner per need. Phone items arrive the moment the plan is made.
export function planJobs(school, graphJobId, deadline, clock = school.clockStart) {
  return school.learners.flatMap(learner => learner.needs.map(item => {
    const job = { id: `${graphJobId}-${learner.id}-${item}`, graphJobId, learnerId: learner.id, item, pages: ITEM_PAGES[item] ?? 0, deadline };
    return isPhoneItem(item) ? { ...job, eta: toIso(toMs(clock)), status: 'delivered' } : { ...job, status: 'queued' };
  }));
}

// Availability as Fika sees it: the school's machines with `online` overridden by [{id, online}].
export function machineView(school, machines) {
  const online = new Map((machines || []).map(m => [m.id, m.online]));
  return school.machines.map(m => ({ ...m, online: online.has(m.id) ? online.get(m.id) : m.online !== false }));
}

/**
 * schedule(jobs, school, {clock, machines?, avoid?, queueFrom?}) → {jobs, notes}
 * - `machines`: [{id, online}] availability overrides (Dispatch.machines).
 * - `avoid`: [{jobId?, machineId}] from the Schedule Checker's problems: that job (or, without jobId, every job) stays
 *   off that machine. `avoidFromProblems(problems)` in checker.js builds it.
 * - `queueFrom`: when other classes' queued work started (default school.clockStart): that work runs first.
 * Ready and delivered jobs never move; a printing job stays put unless its machine is offline.
 */
export function schedule(jobs, school, { clock = school.clockStart, machines, avoid = [], queueFrom = school.clockStart } = {}) {
  const now = toMs(clock);
  const notes = [];
  const view = machineView(school, machines);
  const avoided = (jobId, machineId) => avoid.some(a => a.machineId === machineId && (!a.jobId || a.jobId === jobId));
  // Each machine is free once its other-class queue and anything of ours already printing are done.
  const free = new Map(view.map(m => {
    const queuePages = (m.queue || []).reduce((s, q) => s + (q.pages || 0), 0);
    const queueEnd = addWorkingMs(toMs(queueFrom), (queuePages * 60) / m.pagesPerHour, school.hours);
    return [m.id, Math.max(now, queueEnd)];
  }));
  const out = jobs.map(j => ({ ...j }));
  const byOnline = id => view.find(m => m.id === id)?.online;
  for (const j of out) {
    if (j.status === 'printing' && byOnline(j.machineId) && j.eta) free.set(j.machineId, Math.max(free.get(j.machineId), toMs(j.eta)));
  }

  const pending = [];
  out.forEach((j, i) => {
    if (isPhoneItem(j.item)) { Object.assign(j, { status: 'delivered', eta: j.eta || toIso(now) }); delete j.lateReason; return; }
    if (PINNED.includes(j.status)) return;
    if (j.status === 'printing' && byOnline(j.machineId)) return;
    if (j.status === 'printing') notes.push(`${what(school, j)} stopped printing: the ${lower(machineName(school, j.machineId))} is offline.`);
    pending.push({ j, i });
  });
  // Earliest deadline first; ties keep the plan's order so the result is stable.
  pending.sort((a, b) => toMs(a.j.deadline) - toMs(b.j.deadline) || a.i - b.i);

  for (const { j } of pending) {
    const kinds = ITEM_MACHINES[j.item] || [];
    const able = view.filter(m => kinds.includes(m.kind));
    const options = able.filter(m => m.online && !avoided(j.id, m.id)).map(m => {
      const start = nextWorkingMs(free.get(m.id), school.hours);
      return { m, start, eta: addWorkingMs(start, printMinutes(j.pages, m.pagesPerHour), school.hours) };
    }).sort((a, b) => a.eta - b.eta);
    delete j.lateReason;
    if (!options.length) {
      delete j.machineId; delete j.start; delete j.eta;
      j.status = 'late';
      j.lateReason = able.some(m => m.online) ? `No ${j.item} machine can take it` : `No ${j.item} machine is online`;
      notes.push(`${what(school, j)} can't be scheduled: ${lower(j.lateReason)}. Flagged for the teacher.`);
      continue;
    }
    const best = options[0];
    free.set(best.m.id, best.eta);
    Object.assign(j, { machineId: best.m.id, start: toIso(best.start), eta: toIso(best.eta) });
    const alt = options[1] ? ` (${formatGap((options[1].eta - best.eta) / 60_000)} earlier than the ${lower(options[1].m.name)})` : '';
    if (best.eta <= toMs(j.deadline)) {
      j.status = 'queued';
      notes.push(`${what(school, j)} goes on the ${lower(best.m.name)}: ready ${formatEta(j.eta)}${alt}.`);
    } else {
      j.status = 'late';
      j.lateReason = lateReason(school, view, j, options, avoided);
      notes.push(`${what(school, j)} can't make ${formatEta(j.deadline)}: ${lower(j.lateReason)}. Earliest is ${formatEta(j.eta)} on the ${lower(best.m.name)}.`);
    }
  }
  return { jobs: out, notes };
}

// "The braille embosser is offline and the swell-paper heater is busy until Fri 09:10".
function lateReason(school, view, job, options, avoided) {
  const kinds = ITEM_MACHINES[job.item] || [];
  // Offline machines first: that is the news; then when the others are free.
  const parts = view.filter(m => kinds.includes(m.kind)).sort((a, b) => a.online - b.online).map(m => {
    if (!m.online) return `the ${lower(m.name)} is offline`;
    if (avoided(job.id, m.id)) return `the ${lower(m.name)} was ruled out by the Schedule Checker`;
    const o = options.find(x => x.m.id === m.id);
    return `the ${lower(m.name)} is busy until ${formatEta(toIso(o.start))}`;
  });
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Default deadline for an urgent pack: 16:00 on the clock's day (the next working day if that has passed).
function urgentDeadline(clock, school) {
  const d = toIso(toMs(clock)).slice(0, 10);
  let at = toMs(`${d}T16:00:00+02:00`);
  if (at <= toMs(clock)) at = toMs(`${toIso(nextWorkingMs(toMs(`${d}T23:59:00+02:00`), school.hours)).slice(0, 10)}T16:00:00+02:00`);
  return toIso(at);
}

/**
 * replan(dispatch, school, event) → {jobs, machines, clock, corrections, notes, event}
 * event: {kind:'machine-offline'|'machine-online', machineId} or
 *        {kind:'urgent', learnerId?, pages? = 4, deadline? = today 16:00, item? = 'tactile'}; any event may carry `at`
 *        (ISO, default dispatch.clock) and `avoid` (see schedule). Other kinds ('tick', 'job-done') just recompute.
 * Every job whose eta, machineId or status changed gets a Dispatcher correction per changed field.
 */
export function replan(dispatch, school, event) {
  const clock = event.at || dispatch.clock || school.clockStart;
  let machines = machineView(school, dispatch.machines).map(m => ({ id: m.id, online: m.online }));
  if (event.kind === 'machine-offline' || event.kind === 'machine-online') {
    if (!school.machines.some(m => m.id === event.machineId)) throw new Error(`unknown machine ${event.machineId}`);
    machines = machines.map(m => (m.id === event.machineId ? { ...m, online: event.kind === 'machine-online' } : m));
  }
  const before = new Map(dispatch.jobs.map(j => [j.id, j]));
  let jobs = dispatch.jobs;
  let cause;
  if (event.kind === 'urgent') {
    const learner = school.learners.find(l => l.id === event.learnerId) || school.learners.find(l => l.needs.includes('tactile')) || school.learners[0];
    const item = event.item || 'tactile';
    const n = dispatch.jobs.filter(j => j.id.includes(`-${learner.id}-urgent-`)).length + 1;
    const urgent = { id: `${dispatch.graphJobId}-${learner.id}-urgent-${n}`, graphJobId: dispatch.graphJobId, learnerId: learner.id, item, pages: event.pages ?? 4, deadline: event.deadline || urgentDeadline(clock, school), status: 'queued', urgent: true };
    jobs = [...jobs, urgent];
    cause = `An urgent ${urgent.pages}-page ${ITEM_LABEL[item] || item} for ${learner.name}, due ${formatEta(urgent.deadline)}, goes first`;
  } else if (event.kind === 'machine-offline') cause = `The ${lower(machineName(school, event.machineId))} went offline`;
  else if (event.kind === 'machine-online') cause = `The ${lower(machineName(school, event.machineId))} is back online`;
  else cause = 'Fika rechecked the schedule'; // 'tick', 'job-done': nothing changed hands, just recompute

  const { jobs: next, notes } = schedule(jobs, school, { clock, machines, avoid: event.avoid, queueFrom: dispatch.queueFrom || school.clockStart });
  const corrections = [];
  for (const j of next) {
    const old = before.get(j.id);
    if (!old) continue;
    const reason = correctionReason(school, cause, old, j);
    for (const field of ['eta', 'machineId', 'status']) {
      if ((old[field] ?? null) !== (j[field] ?? null)) corrections.push({ agent: 'Dispatcher', field: `dispatch.jobs.${j.id}.${field}`, before: old[field] ?? null, after: j[field] ?? null, reason });
    }
  }
  notes.unshift(`${cause}. ${corrections.length ? `${new Set(corrections.map(c => c.field.split('.')[2])).size} item(s) changed.` : 'Nothing else had to move.'}`);
  const eventEntry = { t: toIso(toMs(clock)), kind: event.kind, detail: cause, ...(event.machineId ? { machineId: event.machineId } : {}) };
  return { jobs: next, machines, clock: toIso(toMs(clock)), corrections, notes, event: eventEntry };
}

function correctionReason(school, cause, old, j) {
  const who = what(school, j);
  if (j.status === 'late' && !j.machineId) return `${cause}: ${who} can't be printed now. ${j.lateReason}`;
  const moved = old.machineId && j.machineId && old.machineId !== j.machineId ? ` moved to the ${lower(machineName(school, j.machineId))}` : ' was rescheduled';
  const eta = j.eta ? `, ready ${formatEta(j.eta)}${old.eta && old.eta !== j.eta ? ` instead of ${formatEta(old.eta)}` : ''}` : '';
  return `${cause}: ${who}${moved}${eta}${j.status === 'late' ? `. Late: ${j.lateReason}` : ''}`;
}
