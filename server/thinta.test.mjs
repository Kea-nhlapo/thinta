import test from 'node:test';
import assert from 'node:assert/strict';
import { handleThinta } from './thinta.mjs';
import { EXAMPLE_PARABOLA_JOB, EXAMPLE_BAR_JOB, validateJob, emptyJob } from '../src/thinta/contract.js';

const post = (path, body) => new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const readEvents = async response => (await response.text()).trim().split('\n').map(line => JSON.parse(line));

test('example jobs and an empty job follow the contract', () => {
  assert.deepEqual(validateJob(EXAMPLE_PARABOLA_JOB), []);
  assert.deepEqual(validateJob(EXAMPLE_BAR_JOB), []);
  assert.deepEqual(validateJob(emptyJob()), []);
  assert.deepEqual(EXAMPLE_PARABOLA_JOB.proof.turningPoint, { x: 1, y: -9 });
});

test('run streams trace events and ends with a GraphJob', async () => {
  const response = await handleThinta(post('/api/thinta/run', { imageBase64: '', equationHint: 'y = x^2 - 2x - 8' }), {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /ndjson/);
  const events = await readEvents(response);
  assert.equal(events.at(-1).type, 'done');
  assert.deepEqual(validateJob(events.at(-1).job), []);
  assert.ok(events.some(e => e.type === 'trace'));
});

test('approve records who approved and when', async () => {
  const response = await handleThinta(post('/api/thinta/approve', { jobId: 'example-parabola', by: 'Ms Dlamini' }), {});
  const data = await response.json();
  assert.equal(data.approval.approved, true);
  assert.equal(data.approval.by, 'Ms Dlamini');
});

test('rejects GET, foreign origins and oversized photos', async () => {
  assert.equal((await handleThinta(new Request('http://localhost/api/thinta/run'), {})).status, 405);
  const foreign = new Request('http://localhost/api/thinta/run', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' });
  assert.equal((await handleThinta(foreign, {})).status, 403);
  assert.equal((await handleThinta(post('/api/thinta/run', { imageBase64: 'a'.repeat(3_600_000) }), {})).status, 413);
});
