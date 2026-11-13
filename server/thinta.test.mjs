import test from 'node:test';
import assert from 'node:assert/strict';
import { handleThinta } from './thinta.mjs';
import { fakeFikaDeps } from './thinta/fika-fakes.mjs';
import { createStore } from './thinta/store.mjs';

// Each test file gets its own in-memory store, so nothing leaks between runs.
const store = await createStore({ file: null });
import { EXAMPLE_PARABOLA_JOB, EXAMPLE_BAR_JOB, validateJob, validateDispatch, emptyJob } from '../src/thinta/contract.js';

const post = (path, body) => new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const readEvents = async response => (await response.text()).trim().split('\n').map(line => JSON.parse(line));

test('example jobs and an empty job follow the contract', () => {
  assert.deepEqual(validateJob(EXAMPLE_PARABOLA_JOB), []);
  assert.deepEqual(validateJob(EXAMPLE_BAR_JOB), []);
  assert.deepEqual(validateJob(emptyJob()), []);
  assert.deepEqual(EXAMPLE_PARABOLA_JOB.proof.turningPoint, { x: 1, y: -9 });
});

// Minimal agents that replay the example job's values, enough to exercise the HTTP streaming.
const ex = EXAMPLE_PARABOLA_JOB;
const thintaDeps = {
  plan: async () => ex.plan, readGraph: async () => ex.reading, prove: () => ({ proof: ex.proof, corrections: ex.corrections }),
  designTactile: () => ({ ...ex.tactile, corrections: [] }), fixTactile: () => ex.tactile, sonify: () => ex.sound,
  freshEyes: async () => ({ review: { agent: 'Reviewer', check: 'fresh-eyes', pass: true, reason: 'match' } }),
  explain: async () => ({ description: ex.description, deafSolution: ex.deafSolution }),
  accessTest: async () => ({ agent: 'Reviewer', check: 'access', pass: true, score: 5, total: 5, failed: [] }),
  meaningCheck: () => ({ pass: true, problems: [] }), feedbackFrom: () => [],
};

test('run without a key says to use Replay', async () => {
  const response = await handleThinta(post('/api/thinta/run', { equationHint: 'y = x^2 - 2x - 8' }), { store });
  assert.equal(response.status, 501);
});

test('run streams trace events and ends with a GraphJob', async () => {
  const response = await handleThinta(post('/api/thinta/run', { imageBase64: 'data:image/jpeg;base64,abcd', equationHint: 'y = x^2 - 2x - 8' }), { GEMINI_API_KEY: 'test', thintaDeps, store });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /ndjson/);
  const events = await readEvents(response);
  assert.equal(events.at(-1).type, 'done');
  assert.deepEqual(validateJob(events.at(-1).job), []);
  assert.ok(events.some(e => e.type === 'trace'));
  assert.ok(events.some(e => e.type === 'correction'));
  assert.ok(events.some(e => e.type === 'patch' && e.job.proof));
});

test('approve records who approved and when', async () => {
  const response = await handleThinta(post('/api/thinta/approve', { jobId: 'example-parabola', by: 'Ms Dlamini' }), { store });
  const data = await response.json();
  assert.equal(data.approval.approved, true);
  assert.equal(data.approval.by, 'Ms Dlamini');
});

test('rejects GET, foreign origins and oversized photos', async () => {
  assert.equal((await handleThinta(new Request('http://localhost/api/thinta/run'), { store })).status, 405);
  const foreign = new Request('http://localhost/api/thinta/run', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' });
  assert.equal((await handleThinta(foreign, {})).status, 403);
  assert.equal((await handleThinta(post('/api/thinta/run', { imageBase64: 'a'.repeat(3_600_000) }), { store })).status, 413);
});

const fikaDeps = fakeFikaDeps();

test('Fika: dispatch needs approval, streams a plan, replans on events and reports status', async () => {
  assert.equal((await handleThinta(post('/api/thinta/dispatch', { graphJobId: 'g-1', schoolId: 'demo-school' }), { store })).status, 409);
  const events = await readEvents(await handleThinta(post('/api/thinta/dispatch', { graphJobId: 'g-1', schoolId: 'demo-school', approved: true }), { fikaDeps, store }));
  assert.equal(events.at(-1).type, 'done');
  assert.deepEqual(validateDispatch(events.at(-1).dispatch), []);
  const replan = await (await handleThinta(post('/api/thinta/dispatch/event', { graphJobId: 'g-1', kind: 'machine-offline', machineId: 'embosser-1' }), { fikaDeps, store })).json();
  assert.deepEqual(validateDispatch(replan.dispatch), []);
  assert.equal((await handleThinta(post('/api/thinta/dispatch/event', { graphJobId: 'g-1', kind: 'explode' }), { store })).status, 400);
  const status = await handleThinta(new Request('http://localhost/api/thinta/dispatch/g-1'), { store });
  assert.equal(status.status, 200);
  assert.equal((await handleThinta(new Request('http://localhost/api/thinta/dispatch/nope'), { store })).status, 404);
});

test('behind an https proxy, the app itself passes the origin check (Railway regression)', async () => {
  const { thintaMiddleware } = await import('./thinta.mjs');
  const { Readable } = await import('node:stream');
  const call = headers => new Promise(resolve => {
    const req = Object.assign(Readable.from([Buffer.from('{}')]), { method: 'POST', url: '/api/thinta/run', headers: { host: 'thinta.example', 'content-type': 'application/json', ...headers } });
    const res = { headersSent: false, statusCode: 200, writeHead(status) { this.statusCode = status; }, write() {}, end() { resolve(this.statusCode); } };
    thintaMiddleware(() => ({ store }))(req, res, () => resolve('next'));
  });
  // 501 = past the origin check (no key in tests); 403 = refused as a foreign site.
  assert.equal(await call({ origin: 'https://thinta.example', 'x-forwarded-proto': 'https' }), 501);
  assert.equal(await call({ origin: 'https://evil.example', 'x-forwarded-proto': 'https' }), 403);
  assert.equal(await call({ origin: 'http://thinta.example' }), 501);
});
