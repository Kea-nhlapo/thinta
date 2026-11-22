import test from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { createAccounts, accountsMiddleware } from './accounts.mjs';
import { createAccountStore } from './accounts/store.mjs';
import { createAssignments, guardThinta, learnerPack, TEACHER_HEADER } from './assignments.mjs';

const PACK = {
  id: 'job-abc123', mode: 'live', input: { imageBase64: 'PHOTO', equationHint: 'y = x^2 - 4', questions: ['Where does it cross?'], learners: ['blind', 'deaf'] },
  plan: { steps: ['read'], versions: ['tactile'] }, proof: { equation: 'y = x^2 - 4', roots: [-2, 2], answers: [{ question: 'Where does it cross?', answer: 'x = -2 and x = 2' }] },
  tactile: { svg: '<svg/>', warnings: [], ruleChecks: [] }, sound: { samples: [], keyPoints: [] },
  description: { en: 'A parabola crossing at -2 and 2.', zu: 'Ipharabhola…' }, deafSolution: { steps: [{ text: 'Set y to 0.', visual: 'highlight the roots' }], keyTerms: ['root'] },
  reviews: [{ agent: 'Reviewer', check: 'x', pass: true, reason: 'ok' }], corrections: [{ agent: 'Prover', field: 'roots', before: 1, after: 2, reason: 'algebra' }],
  trace: [{ t: 0, agent: 'Planner', status: 'start', message: 'thinking' }], approval: { approved: true, by: 'Demo Teacher', at: '2026-11-22T10:00:00Z' },
};
const LESSON = {
  id: 'lesson-1', title: 'The water cycle',
  questions: [{ id: 'q1', prompt: 'What drives it?', options: [{ id: 'a', label: 'The sun' }, { id: 'b', label: 'The moon' }], correctOptionId: 'a', explanation: 'The sun heats water.', help: { id: 'h1', language: 'en', status: 'text_only' } }],
};

async function setup({ postgres = false } = {}) {
  const store = postgres
    ? await createAccountStore({ databaseUrl: 'postgres://pg-mem/test', Pool: newDb().adapters.createPg().Pool })
    : await createAccountStore({ databaseUrl: '' });
  const packs = new Map([[PACK.id, PACK], ['job-draft1', { ...PACK, id: 'job-draft1', approval: { approved: false } }]]);
  const accounts = createAccounts({ store });
  const assignments = createAssignments({ accounts, packs: async () => ({ getPack: async id => packs.get(id) || null }) });
  const handle = request => new URL(request.url).pathname.startsWith('/api/auth/') ? accounts(request) : assignments(request);
  const signedIn = async (email, password) => {
    const response = await accounts(new Request('http://localhost/api/auth/signin', { method: 'POST', body: JSON.stringify({ email, password }) }));
    const cookie = response.headers.get('set-cookie').split(';')[0];
    return async (method, path, body) => {
      const response = await handle(new Request(`http://localhost${path}`, { method, headers: { cookie }, ...(body ? { body: JSON.stringify(body) } : {}) }));
      return { status: response.status, body: await response.json() };
    };
  };
  return { accounts, signedIn, teacher: () => signedIn('teacher@saeducate.test', 'Teach2026!'), learner: n => signedIn(`learner${n}@saeducate.test`, 'Learn2026!') };
}

test('a learner pack keeps the accessible versions and drops the agents and the photo', () => {
  const pack = learnerPack(PACK);
  assert.deepEqual(pack.trace, []);
  assert.deepEqual(pack.reviews, []);
  assert.deepEqual(pack.corrections, []);
  assert.equal(pack.plan, undefined);
  assert.equal(pack.input.imageBase64, undefined);
  assert.deepEqual(pack.input.questions, ['Where does it cross?']);
  assert.equal(pack.description.en, PACK.description.en);
  assert.equal(pack.deafSolution.steps.length, 1);
  assert.equal(pack.tactile.svg, '<svg/>');
  assert.equal(pack.approval.approved, true);
});

for (const postgres of [false, true]) {
  const label = postgres ? 'postgres' : 'memory';

  test(`${label}: a teacher assigns an approved pack and only those learners see it, without the agents`, async () => {
    const { teacher, learner } = await setup({ postgres });
    const t = await teacher();
    const assigned = await t('POST', '/api/assignments', { packId: PACK.id, learners: ['Learner1@saeducate.test', 'learner2@saeducate.test'] });
    assert.equal(assigned.status, 201);
    assert.deepEqual(assigned.body.assigned, { itemId: `pack:${PACK.id}`, title: 'Graph: y = x^2 - 4', learners: ['learner1@saeducate.test', 'learner2@saeducate.test'] });

    const thabo = await (await learner(1))('GET', '/api/my-assignments');
    assert.equal(thabo.status, 200);
    assert.equal(thabo.body.assignments.length, 1);
    const [item] = thabo.body.assignments;
    assert.equal(item.kind, 'pack');
    assert.equal(item.content.description.en, PACK.description.en);
    assert.deepEqual(item.content.trace, []);
    assert.doesNotMatch(JSON.stringify(item), /PHOTO|thinking|algebra/);

    assert.deepEqual((await (await learner(3))('GET', '/api/my-assignments')).body.assignments, []);
    const list = await t('GET', '/api/assignments');
    assert.equal(list.body.assignments.length, 2);
    assert.equal('content' in list.body.assignments[0], false);
  });

  test(`${label}: assigning a lesson, and assigning again replaces the old version`, async () => {
    const { teacher, learner } = await setup({ postgres });
    const t = await teacher();
    assert.equal((await t('POST', '/api/assignments', { lesson: LESSON, learners: ['learner5@saeducate.test'] })).status, 201);
    assert.equal((await t('POST', '/api/assignments', { lesson: { ...LESSON, title: 'The water cycle (updated)' }, learners: ['learner5@saeducate.test'] })).status, 201);
    const { body } = await (await learner(5))('GET', '/api/my-assignments');
    assert.equal(body.assignments.length, 1);
    assert.equal(body.assignments[0].title, 'The water cycle (updated)');
    assert.equal(body.assignments[0].content.questions[0].correctOptionId, 'a');
  });
}

test('only teachers assign, only learners read their page, and both need to be signed in', async () => {
  const { learner, teacher, accounts } = await setup();
  const l = await learner(1);
  assert.equal((await l('POST', '/api/assignments', { packId: PACK.id, learners: ['learner1@saeducate.test'] })).status, 403);
  assert.equal((await l('GET', '/api/assignments')).status, 403);
  assert.equal((await (await teacher())('GET', '/api/my-assignments')).status, 403);
  const anonymous = await createAssignments({ accounts, packs: async () => ({ getPack: async () => null }) })(new Request('http://localhost/api/my-assignments'));
  assert.equal(anonymous.status, 401);
});

test('assigning is checked: approved packs only, real learners only, a complete lesson only', async () => {
  const { teacher } = await setup();
  const t = await teacher();
  const draft = await t('POST', '/api/assignments', { packId: 'job-draft1', learners: ['learner1@saeducate.test'] });
  assert.equal(draft.status, 409);
  assert.match(draft.body.error, /Approve the pack/);
  assert.equal((await t('POST', '/api/assignments', { packId: 'job-missing', learners: ['learner1@saeducate.test'] })).status, 404);
  assert.match((await t('POST', '/api/assignments', { packId: PACK.id, learners: [] })).body.error, /at least one learner/);
  assert.match((await t('POST', '/api/assignments', { packId: PACK.id, learners: ['teacher@saeducate.test', 'nobody@example.org'] })).body.error, /Not a learner account: teacher@saeducate.test, nobody@example.org/);
  assert.match((await t('POST', '/api/assignments', { lesson: { id: 'x', questions: [] }, learners: ['learner1@saeducate.test'] })).body.error, /not complete/);
  assert.equal((await t('POST', '/api/assignments', { learners: ['learner1@saeducate.test'] })).status, 400);
});

test('Thinta is teachers only, and the approver is the signed-in teacher', async () => {
  const { accounts } = await setup();
  const guard = guardThinta(accounts);
  const as = async (email, password) => (await accounts(new Request('http://localhost/api/auth/signin', { method: 'POST', body: JSON.stringify({ email, password }) }))).headers.get('set-cookie').split(';')[0];
  assert.equal((await guard(new Request('http://localhost/api/thinta/run'))).response.status, 401);
  const learnerCookie = await as('learner1@saeducate.test', 'Learn2026!');
  assert.equal((await guard(new Request('http://localhost/api/thinta/run', { headers: { cookie: learnerCookie } }))).response.status, 403);
  const teacherCookie = await as('teacher@saeducate.test', 'Teach2026!');
  assert.equal((await guard(new Request('http://localhost/api/thinta/run', { headers: { cookie: teacherCookie } }))).teacher.name, 'Demo Teacher');

  // Through the server middleware: refused requests never reach Thinta, and a forged teacher header is replaced.
  const middleware = accountsMiddleware(accounts);
  const run = async cookie => {
    const req = { url: '/api/thinta/approve', method: 'POST', headers: { host: 'localhost', ...(cookie ? { cookie } : {}), [TEACHER_HEADER]: 'Forged' } };
    let reached = false, status = 0;
    const res = { setHeader() {}, end() {}, set statusCode(code) { status = code; } };
    await middleware(req, res, () => { reached = true; });
    return { reached, status, header: req.headers[TEACHER_HEADER] };
  };
  assert.deepEqual(await run(learnerCookie), { reached: false, status: 403, header: undefined });
  assert.deepEqual(await run(''), { reached: false, status: 401, header: undefined });
  assert.deepEqual(await run(teacherCookie), { reached: true, status: 0, header: encodeURIComponent('Demo Teacher') });
});
