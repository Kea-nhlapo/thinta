// The Vercel router: Thinta refuses anyone but a teacher, and records the signed-in teacher as the approver.
import test from 'node:test';
import assert from 'node:assert/strict';

delete process.env.DATABASE_URL;
const { POST, GET } = await import('./router.js');

test('router: Thinta is teachers only, and approvals name the signed-in teacher', async () => {
  const signIn = async (email, password) => (await POST(new Request('http://localhost/api/auth/signin', { method: 'POST', body: JSON.stringify({ email, password }) }))).headers.get('set-cookie').split(';')[0];
  assert.equal((await GET(new Request('http://localhost/api/thinta/packs'))).status, 401);
  const learner = await signIn('learner1@saeducate.test', 'Learn2026!');
  assert.equal((await GET(new Request('http://localhost/api/thinta/packs', { headers: { cookie: learner } }))).status, 403);
  const teacher = await signIn('teacher@saeducate.test', 'Teach2026!');
  const approved = await POST(new Request('http://localhost/api/thinta/approve', {
    method: 'POST', headers: { cookie: teacher, 'x-sae-teacher': 'Forged', 'content-type': 'application/json' }, body: JSON.stringify({ jobId: 'job-router1', by: 'Typed Name' }), duplex: 'half',
  }));
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).approval.by, 'Demo Teacher');
  const mine = await GET(new Request('http://localhost/api/my-assignments', { headers: { cookie: learner } }));
  assert.deepEqual(await mine.json(), { assignments: [] });
});
