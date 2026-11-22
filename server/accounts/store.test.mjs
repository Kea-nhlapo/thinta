// Runs the account routes against the Postgres store, with pg-mem (an in-memory Postgres) standing in for the
// database, so the SQL itself is tested: the tables, the unique email, sessions and their expiry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { createAccounts } from '../accounts.mjs';
import { createAccountStore } from './store.mjs';

async function postgresSetup() {
  const { Pool } = newDb().adapters.createPg();
  const store = await createAccountStore({ databaseUrl: 'postgres://pg-mem/test', Pool });
  const handle = createAccounts({ store });
  const browser = () => {
    let cookie = '';
    return async (method, path, body) => {
      const response = await handle(new Request(`http://localhost${path}`, {
        method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
      }));
      const set = response.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: response.status, body: await response.json() };
    };
  };
  return { store, browser };
}

test('postgres: sign up, sign in elsewhere, duplicate email, wrong password, sign out', async () => {
  const { store, browser } = await postgresSetup();
  assert.equal(store.kind, 'postgres');
  const phone = browser();
  const created = await phone('POST', '/api/auth/signup', { name: 'Zanele', email: 'zanele@example.org', password: 'secret12', role: 'learner', needs: ['deaf'] });
  assert.equal(created.status, 201);
  assert.equal(created.body.profile.signedHelp, true);

  const laptop = browser();
  assert.equal((await laptop('POST', '/api/auth/signin', { email: 'zanele@example.org', password: 'nope1234' })).status, 401);
  assert.equal((await laptop('POST', '/api/auth/signin', { email: 'zanele@example.org', password: 'secret12' })).status, 200);
  assert.equal((await laptop('GET', '/api/auth/me')).body.profile.signedHelp, true);

  assert.equal((await browser()('POST', '/api/auth/signup', { name: 'Z', email: 'ZANELE@example.org', password: 'secret12', role: 'teacher' })).status, 409);

  await laptop('POST', '/api/auth/signout');
  assert.equal((await laptop('GET', '/api/auth/me')).status, 401);
  assert.equal((await phone('GET', '/api/auth/me')).status, 200, 'signing out on one device leaves the other signed in');
});

test('postgres: demo accounts are created once, profiles save, teachers list learners', async () => {
  const { store, browser } = await postgresSetup();
  const learner = browser();
  assert.equal((await learner('POST', '/api/auth/signin', { email: 'learner3@saeducate.test', password: 'Learn2026!' })).status, 200);
  assert.equal((await learner('PUT', '/api/auth/profile', { profile: { needs: ['low-vision'], highContrast: false } })).body.profile.highContrast, false);
  // A second server process on the same database does not duplicate the demo accounts.
  const again = createAccounts({ store });
  assert.equal((await again(new Request('http://localhost/api/auth/signin', { method: 'POST', body: JSON.stringify({ email: 'teacher@saeducate.test', password: 'Teach2026!' }) }))).status, 200);
  const teacher = browser();
  await teacher('POST', '/api/auth/signin', { email: 'teacher@saeducate.test', password: 'Teach2026!' });
  const { body } = await teacher('GET', '/api/auth/learners');
  assert.equal(body.learners.length, 5);
  assert.equal(body.learners.find(l => l.name === 'Sipho').profile.highContrast, false);
  const stored = await store.getUser('learner3@saeducate.test');
  assert.match(stored.passwordHash, /^scrypt\$/);
});
