// Notifier: the teacher's one-card delivery summary. Every number, time and day comes from the dispatch; Gemini
// only words them, a deterministic number check verifies the text, and a fixed template fills in when Gemini
// is unavailable or keeps getting a number wrong. isiZulu comes from the injected translate (the gateway's).
import { geminiJSON } from '../gemini.mjs';
import { parseNumbers } from '../reviewer.mjs';
import { formatEta } from '../../../src/thinta/fika/time.js';

const SCHEMA = { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ms = iso => Date.parse(iso);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
// "Friday" from time.js's "Fri 08:00", so every day name uses the same school-time maths.
const dayName = iso => DAYS.find(d => d.startsWith(formatEta(iso).slice(0, 3)));
const missed = job => job.status === 'late' || Boolean(job.lateReason) || (job.eta && ms(job.eta) > ms(job.deadline));

// The facts, worked out here so Gemini never counts or adds anything.
export function deliveryFacts(dispatch, school) {
  const name = id => school?.learners?.find(l => l.id === id)?.name || id;
  const jobs = dispatch.jobs || [];
  const phone = jobs.filter(j => j.item !== 'tactile');
  const prints = jobs.filter(j => j.item === 'tactile');
  const lessonAt = school?.lesson?.at || jobs[0]?.deadline;
  // Honest failure: no slot at all, or the slot ends after the lesson has started.
  const lost = j => j.status !== 'ready' && (!j.eta || (lessonAt && ms(j.eta) >= ms(lessonAt)));
  const late = jobs.filter(missed).map(j => ({ learner: name(j.learnerId), item: j.item, reason: j.lateReason || 'Its slot ends after the deadline', eta: j.eta ? formatEta(j.eta) : null, ready: j.status === 'ready', lost: lost(j) }));
  const lostIds = new Set(jobs.filter(j => missed(j) && lost(j)).map(j => j.learnerId));
  const onTime = prints.filter(j => !missed(j) && j.eta);
  const latest = onTime.filter(j => j.status !== 'ready').map(j => j.eta).sort((a, b) => ms(a) - ms(b)).pop();
  return {
    now: formatEta(dispatch.clock),
    phoneLearners: new Set(phone.filter(j => j.status === 'delivered').map(j => j.learnerId)).size,
    phonePacks: phone.filter(j => j.item === 'phone-blind' && j.status === 'delivered').length,
    deafSolutions: phone.filter(j => j.item === 'deaf-solution' && j.status === 'delivered').length,
    prints: prints.length,
    printsReady: prints.filter(j => j.status === 'ready').length,
    printsComing: onTime.filter(j => j.status !== 'ready').length,
    latestEta: latest ? formatEta(latest) : null,
    lesson: lessonAt ? { title: school?.lesson?.title || 'the lesson', at: formatEta(lessonAt), day: dayName(lessonAt) } : null,
    deadline: jobs[0]?.deadline ? formatEta(jobs[0].deadline) : null,
    late,
    cannotMeet: late.some(l => l.lost),
    // Learners whose print can't make the lesson but who already have their phone pack: the fallback.
    fallback: [...lostIds].filter(id => phone.some(j => j.learnerId === id && j.status === 'delivered')).map(name),
    // Ready means with the learner or collectable now; late counts every item that misses its deadline.
    ready: jobs.filter(j => j.status === 'ready' || j.status === 'delivered').length,
    lateCount: late.length,
  };
}

export function factsText(f) {
  const lines = [
    `Simulated time now: ${f.now}`,
    `Learners who already have their phone items: ${f.phoneLearners} (phone packs for blind learners: ${f.phonePacks}; plain-language solutions for Deaf learners: ${f.deafSolutions})`,
    `Tactile prints: ${f.prints} in total, ${f.printsReady} ready now, ${f.printsComing} still printing or queued and on time`,
  ];
  if (f.latestEta) lines.push(`The last on-time tactile print will be ready at ${f.latestEta}`);
  if (f.lesson) lines.push(`Lesson: "${f.lesson.title}" on ${f.lesson.at} (${f.lesson.day}); items are due by ${f.deadline}`);
  for (const l of f.late) lines.push(`LATE: ${l.learner}'s ${l.item === 'tactile' ? 'tactile print' : l.item}: ${l.reason}${l.ready ? ` (finished late, ready at ${l.eta})` : l.eta ? ` (expected ${l.eta})` : ' (no machine can make it)'}`);
  if (f.cannotMeet) lines.push(`HONEST FAILURE: say exactly "Can't meet ${f.lesson?.day || 'the'}'s lesson. Flagged for the teacher"${f.fallback.length ? ` and that the phone pack was delivered as the fallback for ${list(f.fallback)}` : ''}.`);
  return lines.join('\n');
}

export function notifyPrompt(facts, feedback = []) {
  return `You write a delivery update for a teacher at a South African school for blind and Deaf learners.

FACTS (these are the ONLY numbers, times and days you may use; write numbers and times as digits, exactly as given, e.g. "${facts.latestEta || facts.now}"; no dates, no other numbers):
${factsText(facts)}

Write "summary": one short plain-English card, 2 to 4 sentences. Say what is with the learners now, what is ready, and what is late and why. Name every late learner. Hide nothing and do not soften a late item.
${feedback.length ? `\nTHE LAST VERSION FAILED THE NUMBER CHECK. Fix every one of these:\n${feedback.map(p => `- ${p}`).join('\n')}\n` : ''}
Return JSON only.`;
}

// Times in any common form ("15:10", "15h10", "3:10 pm", "3 pm") become "HH:MM"; the rest of the text keeps its numbers.
const TIME_RE = /\b(\d{1,2})(?:[:h.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\W|$)/gi;
function extract(text) {
  const times = [];
  const rest = String(text || '').replace(TIME_RE, (whole, h, m, ap) => {
    if (m === undefined && !ap) return whole; // a bare number, not a time
    let hour = +h;
    if (ap && /p/i.test(ap) && hour < 12) hour += 12;
    if (ap && /a/i.test(ap) && hour === 12) hour = 0;
    times.push(`${String(hour).padStart(2, '0')}:${m ?? '00'}`);
    return ' ';
  });
  const days = [...rest.matchAll(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri)\b/gi)]
    .map(m => DAYS.find(d => d.toLowerCase().startsWith(m[1].toLowerCase().slice(0, 3))));
  return { times, days, numbers: parseNumbers(rest) };
}

// Deterministic: every number, time and day in the text must appear in the facts, and every late learner is named.
export function numberCheck(text, facts) {
  const allowed = extract(factsText(facts));
  const got = extract(text);
  const problems = [];
  for (const n of new Set(got.numbers)) if (!allowed.numbers.includes(n)) problems.push(`the number ${n} is not in the facts`);
  for (const t of new Set(got.times)) if (!allowed.times.includes(t)) problems.push(`the time ${t} is not in the facts`);
  for (const d of new Set(got.days)) if (!allowed.days.includes(d)) problems.push(`${d} is not a day in the facts`);
  for (const l of facts.late) if (!String(text).includes(l.learner)) problems.push(`${l.learner} is late but not named`);
  if (facts.cannotMeet && !/can(?:'|’|no)t meet/i.test(text)) problems.push(`the summary must say "Can't meet ${facts.lesson?.day}'s lesson. Flagged for the teacher"`);
  if (!String(text).trim()) problems.push('the summary is empty');
  return { pass: problems.length === 0, problems };
}

// The fixed template (brief cut order item 4): always works, no network.
export function templateSummary(f) {
  const out = [];
  if (f.phoneLearners) out.push(`Phone packs and plain-language solutions are with ${plural(f.phoneLearners, 'learner')} now.`);
  if (f.prints) {
    const coming = f.printsComing && f.latestEta ? `; ${f.printsComing === f.prints ? 'all ' : ''}${f.printsComing}${f.printsReady ? ' more' : ''} by ${f.latestEta}${f.lesson ? `, before the ${f.lesson.at} lesson` : ''}` : '';
    out.push(`Tactile prints ready: ${f.printsReady} of ${f.prints}${coming}.`);
  }
  if (f.cannotMeet) out.push(`Can't meet ${f.lesson?.day || 'the'}'s lesson. Flagged for the teacher.`);
  const byReason = new Map();
  for (const l of f.late) byReason.set(l.reason, [...(byReason.get(l.reason) || []), l]);
  for (const [reason, items] of byReason) {
    const finished = items.every(l => l.ready);
    out.push(`Late for ${list(items.map(l => l.learner))}${finished ? ` (ready at ${list([...new Set(items.map(l => l.eta))])})` : ''}: ${reason.replace(/\.$/, '')}.`);
  }
  if (f.fallback.length) out.push(`The phone pack was delivered as the fallback for ${list(f.fallback)}.`);
  return out.join(' ');
}

// Translate one text; a failure leaves '' so the caller can warn and keep the English.
async function toZulu(text, translate) {
  if (!translate || !text) return { zu: '', warning: 'isiZulu translation not available' };
  try {
    const out = await translate(text, 'en', 'zu');
    const zu = (typeof out === 'string' ? out : out?.text || '').trim();
    if (!zu) return { zu: '', warning: 'isiZulu translation came back empty' };
    // Times and counts must survive translation as digits.
    const missing = [...new Set(parseNumbers(text))].filter(n => !parseNumbers(zu).includes(n));
    return { zu, warning: missing.length ? `isiZulu summary may be missing the number(s) ${missing.join(', ')}; check before use` : '' };
  } catch (error) { return { zu: '', warning: `isiZulu translation failed: ${error.message}` }; }
}

export async function notify({ dispatch, school, apiKey, fetchImpl = fetch, translate, timeoutMs = 25000 }) {
  const facts = deliveryFacts(dispatch, school);
  const warnings = [];
  let en = '', check = { pass: false, problems: [] }, source = 'gemini';
  // Gemini words it; one retry with the check's problems as feedback, then the template.
  try {
    for (let attempt = 0; attempt < 2 && !check.pass; attempt++) {
      const out = await geminiJSON({ apiKey, parts: [{ text: notifyPrompt(facts, check.problems) }], schema: SCHEMA, temperature: 0.3, timeoutMs, fetchImpl });
      en = String(out?.summary || '').trim();
      check = numberCheck(en, facts);
    }
    if (!check.pass) warnings.push(`Summary written from a fixed template: Gemini's wording failed the number check twice (${check.problems.join('; ')})`);
  } catch (error) { warnings.push(`Summary written from a fixed template: ${error.message}`); }
  if (!check.pass) {
    source = 'template';
    en = templateSummary(facts);
    check = numberCheck(en, facts);
  }
  const { zu, warning } = await toZulu(en, translate);
  if (warning) warnings.push(warning);
  return { summary: { en, zu, ready: facts.ready, late: facts.lateCount }, numberCheck: check, warnings, source, facts };
}
