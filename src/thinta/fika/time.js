// Working-hours time maths for Fika. Pure JS: runs on the server and in the browser.
// South African time is a fixed UTC+2 with no daylight saving, so a hard-coded +02:00 offset is exact all year.
const OFFSET_MS = 2 * 60 * 60_000;
const MIN = 60_000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = n => String(n).padStart(2, '0');

export const toMs = iso => {
  const ms = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`bad time ${iso}`);
  return ms;
};

// Local (SAST) wall-clock fields, read off a shifted UTC date.
const local = ms => new Date(ms + OFFSET_MS);

export function toIso(ms) {
  const d = local(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+02:00`;
}

// 'Thu 15:10' in school time.
export function formatEta(iso) {
  const d = local(toMs(iso));
  return `${DAY_NAMES[d.getUTCDay()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
// Midnight (local) of the day containing ms, as UTC ms.
const dayStart = ms => { const d = local(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - OFFSET_MS; };
const isWorkDay = (ms, hours) => hours.days.includes(local(ms).getUTCDay());
// Open and close of the working window on the local day containing ms.
const dayWindow = (ms, hours) => { const d0 = dayStart(ms); return [d0 + hm(hours.open) * MIN, d0 + hm(hours.close) * MIN]; };

// The first instant at or after ms when machines may run.
export function nextWorkingMs(ms, hours) {
  if (!hours?.days?.length) throw new Error('school hours have no working days');
  let t = toMs(ms);
  for (let i = 0; i < 400; i++) {
    const [open, close] = dayWindow(t, hours);
    if (isWorkDay(t, hours) && t < close) return Math.max(t, open);
    t = dayStart(t) + 26 * 60 * MIN; // lands safely inside the next local day
    t = dayStart(t);
  }
  throw new Error('no working time found within a year');
}

// Adds `minutes` of machine time, counting only school hours. Work left at closing carries over to the next open.
export function addWorkingMs(startMs, minutes, hours) {
  let t = nextWorkingMs(startMs, hours);
  let left = minutes * MIN;
  for (;;) {
    const close = dayWindow(t, hours)[1];
    if (left <= close - t) return t + left;
    left -= close - t;
    t = nextWorkingMs(close, hours);
  }
}

export const addWorkingMinutes = (isoStart, minutes, hours) => toIso(addWorkingMs(toMs(isoStart), minutes, hours));

// Working minutes between two instants (machine time actually available).
export function workingMinutesBetween(a, b, hours) {
  let t = toMs(a); const end = toMs(b);
  let total = 0;
  while (t < end) {
    const [open, close] = dayWindow(t, hours);
    if (isWorkDay(t, hours)) total += Math.max(0, Math.min(close, end) - Math.max(open, t));
    t = dayStart(dayStart(t) + 26 * 60 * MIN);
  }
  return total / MIN;
}

// True when ms is inside opening hours (open and close inclusive).
export function inWorkingHours(iso, hours) {
  const ms = toMs(iso);
  const [open, close] = dayWindow(ms, hours);
  return isWorkDay(ms, hours) && ms >= open && ms <= close;
}

// Whole minutes a machine needs for some pages; rounded up so nothing is ever faster than its rate.
export const printMinutes = (pages, pagesPerHour) => (pages > 0 ? Math.ceil((pages * 60) / pagesPerHour) : 0);

// Readable gap: '40 minutes', '1 h 5 min'.
export function formatGap(minutes) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
