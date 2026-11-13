// Stand-in Fika agents for tests (no Gemini, no real scheduler).
import { ITEM_MACHINES, ITEM_PAGES } from '../../src/thinta/contract.js';

const hour = 3600_000;
const iso = ms => new Date(ms).toISOString();

// A tiny stand-in scheduler: each tactile job goes to the first online machine that can make it, one hour per job
// after that machine's queue. Enough to exercise the pipeline's check loop and replans with real moves.
export function fakeFikaDeps({ checkFailsFirst = 0 } = {}) {
  let checks = 0;
  const schedule = (jobs, school, { clock, machines }) => {
    const free = Object.fromEntries(machines.map(m => [m.id, Date.parse(clock) + m.queue.reduce((s, q) => s + q.pages, 0) / m.pagesPerHour * hour]));
    const out = jobs.map(job => {
      if (!ITEM_MACHINES[job.item].length) return job;
      const machine = machines.find(m => m.online && ITEM_MACHINES[job.item].includes(m.kind));
      if (!machine) return { ...job, machineId: undefined, eta: undefined, status: 'late', lateReason: 'No tactile machine is online' };
      const start = free[machine.id]; free[machine.id] += hour;
      return { ...job, machineId: machine.id, start: iso(start), eta: iso(start + hour), status: start + hour <= Date.parse(job.deadline) ? 'queued' : 'late', ...(start + hour > Date.parse(job.deadline) ? { lateReason: 'Busy' } : {}) };
    });
    return { jobs: out, notes: ['Scheduled by deadline'] };
  };
  return {
    planJobs: (school, graphJobId, deadline) => school.learners.flatMap(l => l.needs.map(item => ({ id: `${graphJobId}-${l.id}-${item}`, graphJobId, learnerId: l.id, item, pages: ITEM_PAGES[item], deadline, status: ITEM_MACHINES[item].length ? 'queued' : 'delivered', ...(ITEM_MACHINES[item].length ? {} : { eta: school.clockStart }) }))),
    schedule,
    replan: (dispatch, school, event) => {
      const machines = school.machines.map(m => ({ ...m, online: m.id === event.machineId ? event.kind === 'machine-online' : m.online }));
      const { jobs } = schedule(dispatch.jobs, school, { clock: dispatch.clock, machines });
      const corrections = jobs.filter((j, i) => j.eta !== dispatch.jobs[i].eta || j.machineId !== dispatch.jobs[i].machineId)
        .map((j, i) => ({ agent: 'Dispatcher', field: `dispatch.jobs.${j.id}.eta`, before: dispatch.jobs.find(d => d.id === j.id).eta, after: j.eta, reason: `${event.machineId} went offline` }));
      return { jobs, corrections, notes: [] };
    },
    checkSchedule: dispatch => {
      const fail = ++checks <= checkFailsFirst;
      const problems = fail ? [{ rule: 'capacity', reason: 'Embosser double-booked' }] : [];
      return { pass: !fail, checks: [{ rule: 'capacity', pass: !fail, detail: '' }, { rule: 'deadlines', pass: true, detail: '' }], problems };
    },
    advance: (dispatch, school, { toClock }) => ({ dispatch: { ...dispatch, clock: toClock, jobs: dispatch.jobs.map(j => j.eta && Date.parse(j.eta) <= Date.parse(toClock) && j.status === 'queued' ? { ...j, status: 'ready' } : j) }, events: [] }),
    notify: async ({ dispatch }) => ({ summary: { en: 'Summary', zu: '', ready: dispatch.jobs.filter(j => ['ready', 'delivered'].includes(j.status)).length, late: dispatch.jobs.filter(j => j.status === 'late').length }, numberCheck: { pass: true, problems: [] }, warnings: [] }),
  };
}
