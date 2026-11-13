import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './store.mjs';
import { handleThinta } from '../thinta.mjs';
import { EXAMPLE_PARABOLA_JOB, EXAMPLE_DISPATCH } from '../../src/thinta/contract.js';

const post = (path, body) => new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = path => new Request(`http://localhost${path}`);

test('packs are saved without the photo, listed newest first and approved in place', async () => {
  const store = await createStore({ file: null });
  await store.savePack({ ...EXAMPLE_PARABOLA_JOB, id: 'p1', input: { ...EXAMPLE_PARABOLA_JOB.input, imageBase64: 'x'.repeat(1000) } });
  await new Promise(r => setTimeout(r, 5));
  await store.savePack({ ...EXAMPLE_PARABOLA_JOB, id: 'p2' });
  assert.equal((await store.getPack('p1')).input.imageBase64, '');
  assert.deepEqual((await store.listPacks()).map(p => p.id), ['p2', 'p1']);
  assert.equal(await store.approvePack('p1', { approved: true, by: 'Ms Dlamini', at: '2026-11-14T08:00:00.000Z' }), true);
  assert.equal((await store.getPack('p1')).approval.by, 'Ms Dlamini');
  assert.equal((await store.listPacks()).find(p => p.id === 'p1').approved, true);
  assert.equal(await store.approvePack('nope', { approved: true }), false);
});

test('a file store survives a restart (a new store reading the same file)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thinta-store-'));
  const file = join(dir, 'store.json');
  try {
    const first = await createStore({ file, databaseUrl: '' });
    await first.savePack({ ...EXAMPLE_PARABOLA_JOB, id: 'kept' });
    await first.saveDispatch({ ...EXAMPLE_DISPATCH, graphJobId: 'kept' });
    const second = await createStore({ file, databaseUrl: '' });
    assert.equal((await second.getPack('kept')).id, 'kept');
    assert.equal((await second.getDispatch('kept')).graphJobId, 'kept');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('routes: approval is saved on the stored pack, packs reopen, and delivery waits for a server-side approval', async () => {
  const store = await createStore({ file: null });
  await store.savePack({ ...EXAMPLE_PARABOLA_JOB, id: 'r1', approval: { approved: false } });
  const blocked = await handleThinta(post('/api/thinta/dispatch', { graphJobId: 'r1', schoolId: 'demo-school', approved: true }), { store });
  assert.equal(blocked.status, 409);
  const approved = await (await handleThinta(post('/api/thinta/approve', { jobId: 'r1', by: 'Ms Dlamini' }), { store })).json();
  assert.equal(approved.saved, true);
  const reopened = await (await handleThinta(get('/api/thinta/packs/r1'), { store })).json();
  assert.equal(reopened.job.approval.by, 'Ms Dlamini');
  const list = await (await handleThinta(get('/api/thinta/packs'), { store })).json();
  assert.equal(list.storage, 'memory');
  assert.equal(list.packs[0].id, 'r1');
  assert.equal((await handleThinta(get('/api/thinta/packs/missing'), { store })).status, 404);
  // A replayed pack was never stored: approval still works, on the phone only.
  const replay = await (await handleThinta(post('/api/thinta/approve', { jobId: 'example-parabola' }), { store })).json();
  assert.equal(replay.saved, false);
});

test('a database outage does not block approval', async () => {
  const broken = { kind: 'postgres', approvePack: async () => { throw new Error('connection refused'); }, getPack: async () => { throw new Error('connection refused'); } };
  const original = console.error; console.error = () => {};
  try {
    const response = await handleThinta(post('/api/thinta/approve', { jobId: 'x1' }), { store: broken });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).saved, false);
  } finally { console.error = original; }
});
