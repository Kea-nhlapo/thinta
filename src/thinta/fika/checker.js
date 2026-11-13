// Fika's Schedule Checker: re-derives every number from the school's machines and hours instead of trusting the
// Dispatcher. Deterministic and pure, so the same check runs on the server and the phone.
import { ITEM_MACHINES } from '../contract.js';
import { addWorkingMs, formatEta, inWorkingHours, toMs, workingMinutesBetween } from './time.js';

const ON_MACHINE = ['queued', 'printing', 'late'];
const EPS_MIN = 1e-6;
const isPhone = item => !(ITEM_MACHINES[item] || []).length;

/**
 * checkSchedule(dispatch, school) → {pass, checks:[{rule, pass, detail}], problems:[{rule, jobId?, machineId?, reason}], late:[jobId]}
 * Late jobs with a reason pass `deadlines` (they are flagged honestly, not hidden); `late` lists them for the teacher.
 * Feed failures back with schedule(jobs, school, {..., avoid: avoidFromProblems(problems)}).
 */
export function checkSchedule(dispatch, school) {
  const problems = [];
  const add = (rule, reason, ids = {}) => problems.push({ rule, ...ids, reason });
  const online = new Map(school.machines.map(m => [m.id, m.online !== false]));
  for (const m of dispatch.machines || []) online.set(m.id, m.online);
  const machines = new Map(school.machines.map(m => [m.id, m]));
  const jobs = dispatch.jobs || [];
  const queueFrom = toMs(dispatch.queueFrom || school.clockStart || dispatch.clock);
  const onMachine = jobs.filter(j => j.machineId && !isPhone(j.item));

  // capacity: rate, queue order and no double-booking, per machine.
  for (const [id, m] of machines) {
    const mine = onMachine.filter(j => j.machineId === id);
    if (!mine.length) continue;
    const queuePages = (m.queue || []).reduce((s, q) => s + (q.pages || 0), 0);
    const queueEnd = addWorkingMs(queueFrom, (queuePages * 60) / m.pagesPerHour, school.hours);
    for (const j of mine) {
      if (!j.start || !j.eta) { add('capacity', `${j.id} is on the ${m.name} without a start and ETA`, { jobId: j.id, machineId: id }); continue; }
      const need = (j.pages * 60) / m.pagesPerHour;
      const have = workingMinutesBetween(j.start, j.eta, school.hours);
      if (have + EPS_MIN < need) add('capacity', `${j.id}: ${j.pages} pages need ${need.toFixed(1)} min on the ${m.name} (${m.pagesPerHour}/h) but get ${have.toFixed(1)}`, { jobId: j.id, machineId: id });
      if (j.status !== 'ready' && toMs(j.start) < queueEnd) add('capacity', `${j.id} starts ${formatEta(j.start)}, before the ${m.name}'s queued work ends at ${formatEta(new Date(queueEnd).toISOString())}`, { jobId: j.id, machineId: id });
    }
    const timed = mine.filter(j => j.start && j.eta).sort((a, b) => toMs(a.start) - toMs(b.start));
    for (let i = 1; i < timed.length; i++) {
      if (toMs(timed[i].start) < toMs(timed[i - 1].eta)) add('capacity', `${timed[i].id} and ${timed[i - 1].id} overlap on the ${m.name}`, { jobId: timed[i].id, machineId: id });
    }
  }
  for (const j of onMachine) if (!machines.has(j.machineId)) add('capacity', `${j.id} is on unknown machine ${j.machineId}`, { jobId: j.id, machineId: j.machineId });
  for (const j of onMachine) {
    const kind = machines.get(j.machineId)?.kind;
    if (kind && !(ITEM_MACHINES[j.item] || []).includes(kind)) add('capacity', `${j.id}: a ${kind} can't make ${j.item}`, { jobId: j.id, machineId: j.machineId });
  }

  // offline: nothing waiting or printing on a machine that is down.
  for (const j of onMachine) {
    if (ON_MACHINE.includes(j.status) && online.get(j.machineId) === false) add('offline', `${j.id} is ${j.status} on the offline ${machines.get(j.machineId)?.name || j.machineId}`, { jobId: j.id, machineId: j.machineId });
  }

  // deadlines: on time, or late with a reason the teacher can read.
  const late = [];
  for (const j of jobs) {
    if (j.status === 'late') { late.push(j.id); if (!j.lateReason) add('deadlines', `${j.id} is late without a reason`, { jobId: j.id }); continue; }
    if (!j.eta) add('deadlines', `${j.id} has no ETA`, { jobId: j.id });
    else if (toMs(j.eta) > toMs(j.deadline)) add('deadlines', `${j.id} is ready ${formatEta(j.eta)}, after its deadline ${formatEta(j.deadline)}, but is not marked late`, { jobId: j.id, ...(j.machineId ? { machineId: j.machineId } : {}) });
  }

  // coverage: every learner gets every item they need.
  for (const l of school.learners) for (const item of l.needs) {
    if (!jobs.some(j => j.learnerId === l.id && j.item === item)) add('coverage', `${l.name} has no ${item} job`, {});
  }

  // phone-first: phone packs never wait for a machine.
  for (const j of jobs) if (isPhone(j.item) && j.status !== 'delivered') add('phone-first', `${j.id} (${j.item}) is ${j.status}, not delivered`, { jobId: j.id });

  // working-hours: machines only run while the school is open.
  for (const j of onMachine) {
    for (const f of ['start', 'eta']) if (j[f] && !inWorkingHours(j[f], school.hours)) add('working-hours', `${j.id} ${f} ${formatEta(j[f])} is outside school hours`, { jobId: j.id, machineId: j.machineId });
  }

  const RULES = {
    capacity: 'No machine is booked faster than its pages per hour, after its queued work, or double-booked',
    offline: 'No job is waiting or printing on an offline machine',
    deadlines: late.length ? `Every item is on time or flagged: ${late.length} late with a reason` : 'Every item is ready before its deadline',
    coverage: 'Every learner has every item they need',
    'phone-first': 'Every phone pack is delivered',
    'working-hours': 'Every print starts and finishes in school hours',
  };
  const checks = Object.entries(RULES).map(([rule, ok]) => {
    const mine = problems.filter(p => p.rule === rule);
    return { rule, pass: !mine.length, detail: mine.length ? mine.map(p => p.reason).join('; ') : ok };
  });
  return { pass: checks.every(c => c.pass), checks, problems, late };
}

// Turns checker problems into schedule() `avoid` entries: keep that job off that machine on the retry.
export function avoidFromProblems(problems) {
  const seen = new Set();
  return problems.filter(p => p.machineId && p.jobId).map(p => ({ jobId: p.jobId, machineId: p.machineId }))
    .filter(a => !seen.has(`${a.jobId}|${a.machineId}`) && seen.add(`${a.jobId}|${a.machineId}`));
}
