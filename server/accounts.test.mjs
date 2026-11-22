import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts, hashPassword, verifyPassword, SEED_ACCOUNTS } from './accounts.mjs';
import { createAccountStore } from './accounts/store.mjs';

// A fresh account server on an in-memory store, plus a tiny client that keeps the session cookie like a browser.
async function setup({ now } = {}) {
  const store = await createAccountStore({ databaseUrl: '' });
  const handle = createAccounts({ store, now });
  const browser = (headers = {}) => {
    let cookie = '';
    return async (method, path, body, extra = {}) => {
      const response = await handle(new Request(`http://localhost${path}`, {
        method, headers: { ...headers, ...extra, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }));
      const set = response.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: response.status, body: await response.json(), setCookie: set };
    };
  };
  return { store, browser };
}

const NEW_LEARNER = { name: ' Zanele ', email: 'Zanele@Example.org ', password: 'secret12', role: 'learner', needs: ['low-vision', 'unknown'], language: 'zu' };

test('passwords are hashed with scrypt and a salt, and checked correctly', async () => {
  const one = await hashPassword('secret12');
  const two = await hashPassword('secret12');
  assert.match(one, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(one, two);
  assert.doesNotMatch(one, /secret12/);
  assert.equal(await verifyPassword('secret12', one), true);
  assert.equal(await verifyPassword('secret13', one), false);
  assert.equal(await verifyPassword('secret12', 'not-a-hash'), false);
});

test('sign up creates the account and signs the person in with an httpOnly cookie', async () => {
  const { store, browser } = await setup();
  const phone = browser();
  const created = await phone('POST', '/api/auth/signup', NEW_LEARNER);
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.account, { email: 'zanele@example.org', name: 'Zanele', role: 'learner' });
  assert.deepEqual(created.body.profile.needs, ['low-vision']);
  assert.equal(created.body.profile.language, 'zu');
  assert.equal(created.body.profile.largeText, true);
  assert.match(created.setCookie, /^sae_session=[\w-]{40,}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/);
  const stored = await store.getUser('zanele@example.org');
  assert.doesNotMatch(JSON.stringify(stored), /secret12/);
  assert.equal((await phone('GET', '/api/auth/me')).body.account.name, 'Zanele');
});

test('an account made on one device signs in on another', async () => {
  const { browser } = await setup();
  await browser()('POST', '/api/auth/signup', NEW_LEARNER);
  const laptop = browser();
  assert.equal((await laptop('GET', '/api/auth/me')).status, 401);
  const signedIn = await laptop('POST', '/api/auth/signin', { email: 'ZANELE@example.org', password: 'secret12' });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.profile.language, 'zu');
  assert.equal((await laptop('GET', '/api/auth/me')).body.account.email, 'zanele@example.org');
});

test('wrong password and unknown email give the same message', async () => {
  const { browser } = await setup();
  await browser()('POST', '/api/auth/signup', NEW_LEARNER);
  const wrong = await browser()('POST', '/api/auth/signin', { email: 'zanele@example.org', password: 'nope1234' });
  const unknown = await browser()('POST', '/api/auth/signin', { email: 'nobody@example.org', password: 'secret12' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.error, 'That email and password do not match an account.');
  assert.equal(unknown.body.error, wrong.body.error);
  assert.equal(wrong.setCookie, null);
});

test('a duplicate email is refused, whatever its case', async () => {
  const { browser } = await setup();
  await browser()('POST', '/api/auth/signup', NEW_LEARNER);
  const again = await browser()('POST', '/api/auth/signup', { ...NEW_LEARNER, email: 'zanele@EXAMPLE.org' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'An account with that email already exists. Sign in instead.');
  const seed = await browser()('POST', '/api/auth/signup', { ...NEW_LEARNER, email: 'learner2@saeducate.test' });
  assert.equal(seed.status, 409);
});

test('sign-up details are checked on the server too', async () => {
  const { browser } = await setup();
  const post = body => browser()('POST', '/api/auth/signup', { ...NEW_LEARNER, ...body });
  assert.equal((await post({ name: ' ' })).body.error, 'Enter your name.');
  assert.equal((await post({ email: 'bad' })).body.error, 'Enter a valid email address.');
  assert.equal((await post({ password: '123' })).body.error, 'Use a password of at least 6 characters.');
  assert.equal((await post({ role: 'admin' })).body.error, 'Choose learner or teacher.');
  const notJson = await setup().then(({ store }) => createAccounts({ store })(new Request('http://localhost/api/auth/signup', { method: 'POST', body: '{oops' })));
  assert.equal(notJson.status, 400);
});

test('signing out ends the session on the server, not just in the browser', async () => {
  const { browser } = await setup();
  const phone = browser();
  await phone('POST', '/api/auth/signup', NEW_LEARNER);
  const me = await phone('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  const out = await phone('POST', '/api/auth/signout');
  assert.equal(out.status, 200);
  assert.match(out.setCookie, /^sae_session=; .*Max-Age=0/);
  assert.equal((await phone('GET', '/api/auth/me')).status, 401);
});

test('the session cookie is Secure on https', async () => {
  const { browser } = await setup();
  const created = await browser({ 'x-forwarded-proto': 'https' })('POST', '/api/auth/signup', NEW_LEARNER);
  assert.match(created.setCookie, /; Secure$/);
});

test('sessions expire after 30 days', async () => {
  let clock = Date.parse('2026-11-01T00:00:00Z');
  const { browser } = await setup({ now: () => clock });
  const phone = browser();
  await phone('POST', '/api/auth/signup', NEW_LEARNER);
  // The memory store compares against the real clock, so move the expiry into the past by moving our clock back.
  clock -= 31 * 864e5;
  const later = browser();
  await later('POST', '/api/auth/signin', { email: NEW_LEARNER.email, password: NEW_LEARNER.password });
  assert.equal((await later('GET', '/api/auth/me')).status, 401);
});

test('the demo accounts work, with their profiles', async () => {
  const { browser } = await setup();
  for (const seed of SEED_ACCOUNTS) {
    const signedIn = await browser()('POST', '/api/auth/signin', { email: seed.email, password: seed.password });
    assert.equal(signedIn.status, 200, seed.email);
    assert.equal(signedIn.body.account.role, seed.role);
  }
  const thabo = await browser()('POST', '/api/auth/signin', { email: 'learner1@saeducate.test', password: 'Learn2026!' });
  assert.deepEqual(thabo.body.profile, { needs: ['blind'], language: 'en', voiceAnswers: true, readAloud: true, largeText: false, highContrast: false, signedHelp: false });
  const naledi = await browser()('POST', '/api/auth/signin', { email: 'learner4@saeducate.test', password: 'Learn2026!' });
  assert.equal(naledi.body.profile.language, 'zu');
  const teacher = await browser()('POST', '/api/auth/signin', { email: 'teacher@saeducate.test', password: 'Teach2026!' });
  assert.equal(teacher.body.profile, null);
});

test('learners save their settings on the server, and only known settings are kept', async () => {
  const { browser } = await setup();
  const phone = browser();
  await phone('POST', '/api/auth/signin', { email: 'learner1@saeducate.test', password: 'Learn2026!' });
  const saved = await phone('PUT', '/api/auth/profile', { profile: { needs: ['blind', 'made-up'], language: 'nso', largeText: true, admin: true } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profile.largeText, true);
  assert.equal(saved.body.profile.language, 'nso');
  assert.deepEqual(saved.body.profile.needs, ['blind']);
  assert.equal('admin' in saved.body.profile, false);
  const elsewhere = browser();
  await elsewhere('POST', '/api/auth/signin', { email: 'learner1@saeducate.test', password: 'Learn2026!' });
  assert.equal((await elsewhere('GET', '/api/auth/me')).body.profile.largeText, true);
});

test('saving settings needs a learner who is signed in', async () => {
  const { browser } = await setup();
  assert.equal((await browser()('PUT', '/api/auth/profile', { profile: {} })).status, 401);
  const teacher = browser();
  await teacher('POST', '/api/auth/signin', { email: 'teacher@saeducate.test', password: 'Teach2026!' });
  assert.equal((await teacher('PUT', '/api/auth/profile', { profile: {} })).status, 403);
});

test('only teachers can list learners, and the list includes new learners', async () => {
  const { browser } = await setup();
  await browser()('POST', '/api/auth/signup', NEW_LEARNER);
  const learner = browser();
  await learner('POST', '/api/auth/signin', { email: 'learner1@saeducate.test', password: 'Learn2026!' });
  assert.equal((await learner('GET', '/api/auth/learners')).status, 403);
  assert.equal((await browser()('GET', '/api/auth/learners')).status, 401);
  const teacher = browser();
  await teacher('POST', '/api/auth/signin', { email: 'teacher@saeducate.test', password: 'Teach2026!' });
  const { body } = await teacher('GET', '/api/auth/learners');
  assert.ok(body.learners.some(l => l.name === 'Zanele' && l.profile.largeText));
  assert.ok(body.learners.every(l => l.role === 'learner' && !('passwordHash' in l)));
});

test('too many wrong passwords from one address pause sign-in for that email', async () => {
  const { browser } = await setup();
  const attacker = browser({ 'x-forwarded-for': '203.0.113.9' });
  for (let i = 0; i < 10; i++) assert.equal((await attacker('POST', '/api/auth/signin', { email: 'learner1@saeducate.test', password: `guess${i}xx` })).status, 401);
  const blocked = await attacker('POST', '/api/auth/signin', { email: 'learner1@saeducate.test', password: 'Learn2026!' });
  assert.equal(blocked.status, 429);
  const someoneElse = browser({ 'x-forwarded-for': '198.51.100.4' });
  assert.equal((await someoneElse('POST', '/api/auth/signin', { email: 'learner1@saeducate.test', password: 'Learn2026!' })).status, 200);
});

test('unknown routes are 404', async () => {
  const { browser } = await setup();
  assert.equal((await browser()('GET', '/api/auth/nothing')).status, 404);
});
