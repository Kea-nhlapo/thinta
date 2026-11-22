import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts } from '../../server/accounts.mjs';
import { createAccountStore } from '../../server/accounts/store.mjs';

// The browser side against a real account server (in memory). fetch keeps one cookie, like a browser tab.
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) };
const handle = createAccounts({ store: await createAccountStore({ databaseUrl: '' }) });
let cookie = '';
const requests = [];
globalThis.fetch = async (path, options = {}) => {
  requests.push(`${options.method || 'GET'} ${path}`);
  const response = await handle(new Request(`http://localhost${path}`, { ...options, headers: { ...options.headers, ...(cookie ? { cookie } : {}) } }));
  const set = response.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
  return response;
};
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const newDevice = () => { storage.clear(); cookie = ''; };

const { signIn, createAccount, currentAccount, signOut, homeFor, redirectFor, refreshSession, getProfile, saveProfile, profileFromNeeds, fetchLearners, allLearners } = await import('./accounts.js');
const { formatFor } = await import('./learner-format.js');

test('demo accounts sign in through the server; learners land on their lessons, teachers on the dashboard', async () => {
  newDevice();
  const learner = await signIn('Learner1@SAEducate.test ', 'Learn2026!');
  assert.deepEqual(learner, { email: 'learner1@saeducate.test', name: 'Thabo', role: 'learner' });
  assert.equal(homeFor(learner), '/learn');
  assert.equal(currentAccount().name, 'Thabo');
  assert.equal(getProfile('learner1@saeducate.test').voiceAnswers, true);
  const teacher = await signIn('teacher@saeducate.test', 'Teach2026!');
  assert.equal(homeFor(teacher), '/app?screen=dashboard-loading');
  await assert.rejects(signIn('learner1@saeducate.test', 'wrong'), /do not match/);
  assert.ok(requests.includes('POST /api/auth/signin'));
});

test('an account created on one device signs in on another, and nothing secret is kept in the browser', async () => {
  newDevice();
  const account = await createAccount({ name: ' Zanele ', email: 'zanele@example.org', password: 'secret1', role: 'learner', needs: ['low-vision'] });
  assert.deepEqual(account, { email: 'zanele@example.org', name: 'Zanele', role: 'learner' });
  assert.doesNotMatch([...storage.values()].join(' '), /secret1/);
  assert.equal(getProfile('zanele@example.org').largeText, true);

  newDevice();
  assert.equal(currentAccount(), null);
  assert.equal((await signIn('zanele@example.org', 'secret1')).name, 'Zanele');
  assert.equal(getProfile('zanele@example.org').largeText, true);
  await assert.rejects(createAccount({ name: 'Again', email: 'ZANELE@example.org', password: 'secret1', role: 'learner' }), /already exists/);
});

test('mistakes in new account details show without asking the server', async () => {
  newDevice();
  requests.length = 0;
  await assert.rejects(createAccount({ name: 'X', email: 'bad', password: 'secret1', role: 'learner' }), /valid email/);
  await assert.rejects(createAccount({ name: 'X', email: 'x@y.org', password: '123', role: 'learner' }), /6 characters/);
  await assert.rejects(createAccount({ name: '', email: 'x@y.org', password: 'secret1', role: 'learner' }), /your name/);
  assert.deepEqual(requests, []);
});

test('signing out ends the session on the server too', async () => {
  newDevice();
  await signIn('learner2@saeducate.test', 'Learn2026!');
  signOut();
  assert.equal(currentAccount(), null);
  await settle();
  // Even if a copy were still in the browser, the server no longer accepts the session.
  storage.set('sae-signed-in', JSON.stringify({ account: { email: 'learner2@saeducate.test', name: 'Lerato', role: 'learner' } }));
  assert.equal(await refreshSession(), null);
  assert.equal(currentAccount(), null);
});

test('refreshSession keeps the copy when the server cannot be reached', async () => {
  newDevice();
  await signIn('learner3@saeducate.test', 'Learn2026!');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  try { assert.equal((await refreshSession()).name, 'Sipho'); } finally { globalThis.fetch = realFetch; }
});

test("a learner's settings are saved on the server and follow them to another device", async () => {
  newDevice();
  await signIn('learner1@saeducate.test', 'Learn2026!');
  const saved = await saveProfile('LEARNER1@saeducate.test', { ...profileFromNeeds(['blind']), largeText: true });
  assert.equal(saved.largeText, true);
  newDevice();
  await signIn('learner1@saeducate.test', 'Learn2026!');
  assert.equal(getProfile('learner1@saeducate.test').largeText, true);
});

test('teachers fetch learners from the server', async () => {
  newDevice();
  await signIn('teacher@saeducate.test', 'Teach2026!');
  assert.deepEqual(allLearners(), []);
  const learners = await fetchLearners();
  assert.ok(learners.some(l => l.name === 'Zanele'));
  assert.ok(allLearners().every(l => l.role === 'learner'));
  assert.equal(getProfile('learner4@saeducate.test').language, 'zu');
});

test('old browser-only account data is cleared on sign-in', async () => {
  newDevice();
  storage.set('sae-accounts', '[{"email":"old@example.org","passwordHash":"abc"}]');
  storage.set('sae-session', '"old@example.org"');
  await signIn('learner5@saeducate.test', 'Learn2026!');
  assert.equal(storage.has('sae-accounts'), false);
  assert.equal(storage.has('sae-session'), false);
});

test('pages for one role send everyone else to the login page or their own home', () => {
  const learner = { email: 'l@x.org', name: 'L', role: 'learner' }, teacher = { email: 't@x.org', name: 'T', role: 'teacher' };
  assert.equal(redirectFor(['teacher'], null), '/app?screen=login');
  assert.equal(redirectFor(['teacher'], learner), '/learn');
  assert.equal(redirectFor(['teacher'], teacher), null);
  assert.equal(redirectFor(['learner'], teacher), '/app?screen=dashboard-loading');
  assert.equal(redirectFor(['learner', 'teacher'], teacher), null);
});

test('each learner gets the version their needs call for', () => {
  assert.equal(formatFor(profileFromNeeds(['blind'])), 'listen');
  assert.equal(formatFor(profileFromNeeds(['low-vision'])), 'listen');
  assert.equal(formatFor(profileFromNeeds(['deaf'])), 'see');
  assert.equal(formatFor(profileFromNeeds(['hard-of-hearing'])), 'see');
  assert.equal(formatFor(profileFromNeeds([])), 'standard');
  assert.equal(formatFor(null), 'standard');
});
