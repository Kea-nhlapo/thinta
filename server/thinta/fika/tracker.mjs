// Tracker: moves Fika's jobs through queued → printing → ready on a simulated clock. Deterministic and pure:
// it never reads the wall clock and never touches eta or machineId (that is the Dispatcher's job).

// Short machine nouns for teacher-facing events ("ready on the embosser").
const MACHINE_NOUN = { swell: 'swell-paper heater', embosser: 'embosser', printer: 'printer' };
const ITEM_NOUN = { tactile: 'tactile print', 'phone-blind': 'phone pack', 'deaf-solution': 'plain-language solution' };
const FINAL = new Set(['ready', 'delivered']);

const ms = iso => Date.parse(iso);
// Keep the clock in the same UTC offset as the dispatch ("+02:00"), so times stay readable in the school's zone.
const offsetOf = iso => (String(iso).match(/([+-]\d\d:\d\d|Z)$/) || [, 'Z'])[1];
export function isoAt(time, like) {
  const off = offsetOf(like);
  const mins = off === 'Z' ? 0 : (off[0] === '-' ? -1 : 1) * (+off.slice(1, 3) * 60 + +off.slice(4, 6));
  return new Date(time + mins * 60000).toISOString().slice(0, 19) + (off === 'Z' ? 'Z' : off);
}

// Fallback until H's time.js lands: "Thu 15:10" in the school's time zone.
export function formatEta(iso, timeZone = 'Africa/Johannesburg') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return `${parts.weekday} ${parts.hour}:${parts.minute}`;
}

const learnerName = (school, id) => school?.learners?.find(l => l.id === id)?.name || id;
const machineNoun = (school, id) => MACHINE_NOUN[school?.machines?.find(m => m.id === id)?.kind] || id;
const offline = (dispatch, id) => dispatch.machines?.some(m => m.id === id && m.online === false);

function doneDetail(job, school) {
  const base = `${learnerName(school, job.learnerId)}'s ${ITEM_NOUN[job.item] || job.item} is ready on the ${machineNoun(school, job.machineId)}`;
  return ms(job.eta) > ms(job.deadline) ? `${base}, after the deadline (${formatEta(job.deadline, school?.timezone)})` : base;
}

// Moves the clock forward to toClock (never back) and returns the new dispatch plus the job-done events, in time order.
export function advance(dispatch, school, { toClock } = {}) {
  const next = structuredClone(dispatch);
  const now = Math.max(ms(dispatch.clock), ms(toClock ?? dispatch.clock));
  const events = [];
  for (const job of next.jobs) {
    // Phone items, finished items and anything without a slot (unschedulable late jobs) stay as they are.
    if (FINAL.has(job.status) || !job.machineId || !job.start || !job.eta) continue;
    // A print cannot progress on a machine that is offline; the Dispatcher's replan gives it a new slot.
    if (offline(next, job.machineId)) continue;
    if (now >= ms(job.eta)) {
      // A late job that finishes keeps its lateReason: it is ready, but still after the deadline.
      if (job.status === 'late' || ms(job.eta) > ms(job.deadline)) job.lateNote = `Ready after the deadline: ${job.lateReason || 'the schedule ran past it'}`;
      job.status = 'ready';
      events.push({ t: job.eta, kind: 'job-done', detail: doneDetail(job, school), jobId: job.id, machineId: job.machineId });
    } else if (now >= ms(job.start) && job.status === 'queued') job.status = 'printing';
  }
  events.sort((a, b) => ms(a.t) - ms(b.t));
  next.clock = isoAt(now, dispatch.clock);
  next.events = [...(next.events || []), ...events];
  return { dispatch: next, events };
}

// Future job boundaries (starts and ETAs of unfinished prints), sorted, as ISO strings.
export function boundaries(dispatch) {
  const now = ms(dispatch.clock);
  const times = dispatch.jobs.filter(j => !FINAL.has(j.status) && j.machineId && j.start && j.eta && !offline(dispatch, j.machineId))
    .flatMap(j => [j.start, j.eta]).filter(t => ms(t) > now);
  return [...new Map(times.map(t => [ms(t), t])).entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
}

// Where the clock goes next, for the UI's speed setting:
//   {minutes: n}           step n simulated minutes;
//   {speed, realSeconds}   speed = simulated minutes per real second (a 1x..60x slider);
//   {} or {to:'boundary'}  jump to the next start or finish (null when nothing is left to happen);
//   {to:'end'}             jump to the last finish (cut order: skip the animation, show the final statuses).
export function nextClock(dispatch, { minutes, speed, realSeconds = 1, to } = {}) {
  if (minutes !== undefined || speed !== undefined) return isoAt(ms(dispatch.clock) + (minutes ?? speed * realSeconds) * 60000, dispatch.clock);
  const ahead = boundaries(dispatch);
  if (!ahead.length) return null;
  return to === 'end' ? ahead[ahead.length - 1] : ahead[0];
}

// Runs the clock to the end in one go; same result as stepping boundary by boundary.
export const finish = (dispatch, school) => advance(dispatch, school, { toClock: nextClock(dispatch, { to: 'end' }) ?? dispatch.clock });
