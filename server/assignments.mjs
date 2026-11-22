// Teachers make material with the agents and assign it; learners only ever see what was assigned to them.
//
//   POST /api/assignments     { packId | lesson, learners: [email] }  (teachers)  -> 201 { assigned }
//   GET  /api/assignments                                              (teachers)  -> { assignments } (no content)
//   GET  /api/my-assignments                                           (learners)  -> { assignments } (with content)
//
// Thinta (/api/thinta/*) is teacher-only: guardThinta() checks the session before any agent runs, and passes the
// teacher's name on so an approval records who really approved it.
import { validateLesson } from '../src/lesson-integration/contract.js';
import { cleanEmail } from '../src/learnbridge/account-rules.js';
import { defaultStore as defaultPackStore } from './thinta/store.mjs';

// Set by guardThinta after it has checked the session. Anything a browser sends under this name is replaced.
export const TEACHER_HEADER = 'x-sae-teacher';
const MAX_BODY = 512 * 1024; // a generated lesson with its questions
const MAX_LEARNERS = 200;

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const problem = (message, status) => json({ error: message }, status);

// A Thinta pack as a learner gets it: the accessible versions (description, sound, tactile picture, Deaf
// solution, checked answers) and none of the agents' working (trace, reviews, corrections, plan, photo).
export function learnerPack(job) {
  const { trace, reviews, corrections, plan, input, ...pack } = job;
  return { ...pack, input: { questions: input?.questions || [], learners: input?.learners || [] }, trace: [], reviews: [], corrections: [] };
}

export function guardThinta(accounts) {
  return async request => {
    const user = await accounts.userFor(request);
    if (!user) return { response: problem('Sign in with a teacher account to use Thinta.', 401) };
    if (user.role !== 'teacher') return { response: problem('Thinta is for teachers. Your lessons are on your learning page.', 403) };
    return { teacher: user };
  };
}

async function readJSON(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(Error('That is too much to assign at once.'), { status: 413 });
  try { return text ? JSON.parse(text) : {}; } catch { throw Object.assign(Error('Send the details as JSON.'), { status: 400 }); }
}

export function createAssignments({ accounts, packs = defaultPackStore }) {
  async function assign(request, teacher) {
    const body = await readJSON(request);
    const emails = [...new Set((Array.isArray(body.learners) ? body.learners : []).map(cleanEmail))].slice(0, MAX_LEARNERS);
    if (!emails.length) return problem('Choose at least one learner.', 400);
    const store = await accounts.store();
    const learners = await Promise.all(emails.map(email => store.getUser(email)));
    const missing = emails.filter((email, i) => learners[i]?.role !== 'learner');
    if (missing.length) return problem(`Not a learner account: ${missing.join(', ')}.`, 400);

    let item;
    if (body.packId) {
      const job = await (await packs()).getPack(String(body.packId));
      if (!job) return problem('That pack was not found. It may be a replay, which is not saved.', 404);
      if (!job.approval?.approved) return problem('Approve the pack before assigning it. Nothing reaches learners until you approve.', 409);
      const equation = job.proof?.equation || job.input?.equationHint || 'graph';
      item = { itemId: `pack:${job.id}`, kind: 'pack', title: `Graph: ${equation}`, content: learnerPack(job) };
    } else if (body.lesson) {
      try { validateLesson(body.lesson); } catch (error) { return problem(`That lesson is not complete yet: ${error.message}.`, 400); }
      item = { itemId: `lesson:${body.lesson.id}`, kind: 'lesson', title: String(body.lesson.title || 'Lesson').slice(0, 200), content: body.lesson };
    } else {
      return problem('Say what to assign: a pack or a lesson.', 400);
    }
    await store.assign({ ...item, teacherEmail: teacher.email }, emails);
    return json({ assigned: { itemId: item.itemId, title: item.title, learners: emails } }, 201);
  }

  return async function handleAssignments(request) {
    const { pathname } = new URL(request.url);
    const route = `${request.method} ${pathname}`;
    if (!['POST /api/assignments', 'GET /api/assignments', 'GET /api/my-assignments'].includes(route)) return null;
    try {
      const user = await accounts.userFor(request);
      if (!user) return problem('Not signed in.', 401);
      if (route === 'GET /api/my-assignments') {
        if (user.role !== 'learner') return problem('Only learners have assigned material.', 403);
        return json({ assignments: await (await accounts.store()).learnerAssignments(user.email) });
      }
      if (user.role !== 'teacher') return problem('Only teachers can assign material.', 403);
      if (route === 'GET /api/assignments') return json({ assignments: await (await accounts.store()).teacherAssignments(user.email) });
      return await assign(request, user);
    } catch (error) {
      if (error.status) return problem(error.message, error.status);
      console.error('Assignment request failed:', error);
      return problem('Assignments are not available right now. Please try again shortly.', 503);
    }
  };
}
