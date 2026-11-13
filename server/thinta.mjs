// Thinta: a team of agents that turns a photo of a maths graph into a checked pack for blind, Deaf and
// sighted learners (see src/thinta/contract.js). POST /api/thinta/run streams the trace as NDJSON and ends
// with the final GraphJob, which is saved; POST /api/thinta/approve records the teacher's approval on it, and
// GET /api/thinta/packs[/:id] lists and reopens saved packs. Fika's delivery routes follow.
import { LIMITS, STREAM_CONTENT_TYPE } from '../src/thinta/contract.js';
import gateway from './learnbridge-gateway.mjs';
import { runPipeline } from './thinta/pipeline.mjs';
import { runDispatch, dispatchEvent } from './thinta/fika.mjs';
import { defaultStore } from './thinta/store.mjs';

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const jsonError = (message, status) => Response.json({ error: message }, { status, headers });

async function readJSON(request, limit) {
  if (Number(request.headers.get('content-length') || 0) > limit) return null;
  try { const body = await request.text(); return body.length > limit ? null : JSON.parse(body); } catch { return null; }
}

// Turns an async generator of events into a streamed NDJSON response.
function ndjson(events) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async pull(controller) {
      const { value, done } = await events.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(JSON.stringify(value) + '\n'));
    },
    cancel() { events.return?.(); },
  });
  return new Response(body, { headers: { ...headers, 'content-type': STREAM_CONTENT_TYPE } });
}

// isiZulu through SA Educate's own /api/translate (NLLB, Gemini fallback), called in-process.
const translator = env => async (text, from, to) => {
  const response = await gateway.fetch(new Request('http://thinta.local/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, from, to }) }), env);
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Translation failed.');
  return (await response.json()).text;
};

const LEARNERS = ['blind', 'deaf', 'sighted'];
function runInput(data) {
  const learners = Array.isArray(data.learners) ? data.learners.filter(l => LEARNERS.includes(l)) : [];
  const questions = Array.isArray(data.questions) ? data.questions.filter(q => typeof q === 'string' && q.trim()).slice(0, 8).map(q => q.trim().slice(0, 300)) : [];
  return {
    imageBase64: typeof data.imageBase64 === 'string' ? data.imageBase64.replace(/^data:[^,]+,/, '') : '',
    mimeType: /^image\/(jpeg|png|webp)$/.test(data.mimeType) ? data.mimeType : 'image/jpeg',
    equationHint: typeof data.equationHint === 'string' ? data.equationHint.trim().slice(0, 120) : '',
    questions, learners: learners.length ? learners : LEARNERS,
  };
}

const JOB_ID = /^[\w-]{1,80}$/;
// A database hiccup must not stop a demo: approval and delivery carry on, just without saving.
const orElse = (promise, fallback) => promise.catch(error => { console.error('Thinta store:', error.message); return fallback; });

// Saves the finished pack as the stream ends, so it can be approved, reopened and delivered later.
async function* saving(events, store) {
  for await (const event of events) {
    if (event.type === 'done' && event.job) {
      try { await store.savePack(event.job); event.job.saved = true; }
      catch (error) { console.error('Thinta: could not save pack', error.message); event.job.saved = false; }
    }
    yield event;
  }
}

export async function handleThinta(request, env = {}) {
  const url = new URL(request.url);
  const store = await (env.store || defaultStore());
  if (request.method === 'GET') {
    // Saved packs: the latest ten, or one pack in full.
    if (url.pathname === '/api/thinta/packs') return Response.json({ packs: await store.listPacks(10), storage: store.kind }, { headers });
    const pack = url.pathname.match(/^\/api\/thinta\/packs\/([\w-]{1,80})$/);
    if (pack) { const job = await store.getPack(pack[1]); return job ? Response.json({ job }, { headers }) : jsonError('No saved pack with that id.', 404); }
    // Fika: the delivery board's current state.
    const status = url.pathname.match(/^\/api\/thinta\/dispatch\/([\w-]{1,80})$/);
    if (status) { const dispatch = await store.getDispatch(status[1]); return dispatch ? Response.json({ dispatch }, { headers }) : jsonError('No delivery plan for that pack yet.', 404); }
  }
  if (request.method !== 'POST') return jsonError('Use POST.', 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return jsonError('Request must come from this learning workspace.', 403);
  if (url.pathname === '/api/thinta/run') {
    const data = await readJSON(request, LIMITS.maxImageBytes + 20000);
    if (!data) return jsonError('Send a photo under 3.5 MB.', 413);
    if (!env.GEMINI_API_KEY) return jsonError('Live runs need GEMINI_API_KEY on the server. Use Replay instead.', 501);
    const input = runInput(data);
    if (!input.imageBase64 && !input.equationHint) return jsonError('Send a photo or type the equation.', 400);
    return ndjson(saving(runPipeline(input, { apiKey: env.GEMINI_API_KEY, translate: translator(env), deps: env.thintaDeps }), store));
  }
  if (url.pathname === '/api/thinta/approve') {
    const data = await readJSON(request, 5000);
    if (!JOB_ID.test(data?.jobId || '')) return jsonError('Say which job to approve.', 400);
    const approval = { approved: true, by: String(data.by || 'Teacher').slice(0, 80), at: new Date().toISOString() };
    // saved: false means the pack was never stored (e.g. a replay), so the approval lives on this phone only.
    const saved = await orElse(store.approvePack(data.jobId, approval), false);
    return Response.json({ jobId: data.jobId, approval, saved }, { headers });
  }
  // Fika: plan delivery for an approved pack (streamed), then replan on events.
  if (url.pathname === '/api/thinta/dispatch') {
    const data = await readJSON(request, 20000);
    if (!JOB_ID.test(data?.graphJobId || '') || !JOB_ID.test(data?.schoolId || '')) return jsonError('Say which pack and which school.', 400);
    // A saved pack must be approved on the server, not just on the phone.
    const pack = await orElse(store.getPack(data.graphJobId), null);
    if (!data.approved || (pack && !pack.approval?.approved)) return jsonError('The teacher must approve the pack before delivery.', 409);
    return ndjson(runDispatch({ graphJobId: data.graphJobId, schoolId: data.schoolId, apiKey: env.GEMINI_API_KEY, translate: env.GEMINI_API_KEY ? translator(env) : null, deps: env.fikaDeps, store }));
  }
  if (url.pathname === '/api/thinta/dispatch/event') {
    const data = await readJSON(request, 200000);
    if (!JOB_ID.test(data?.graphJobId || '') || !['machine-offline', 'machine-online', 'urgent', 'tick'].includes(data.kind)) return jsonError('Send a pack id and an event kind.', 400);
    const result = await dispatchEvent({ graphJobId: data.graphJobId, kind: data.kind, machineId: data.machineId, dispatch: data.dispatch, apiKey: env.GEMINI_API_KEY, translate: env.GEMINI_API_KEY ? translator(env) : null, deps: env.fikaDeps, store });
    return result ? Response.json(result, { headers }) : jsonError('No delivery plan for that pack yet.', 404);
  }
  return jsonError('Not found.', 404);
}

// Behind a hosting proxy the server sees plain http while the phone is on https; the proxy says which in
// x-forwarded-proto. Without it the origin check compared "https://site" with "http://site" and refused the app itself.
export const forwardedProto = req => (String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http');

// The same routes inside the Vite dev/preview server, streaming the response as it is produced.
export function thintaMiddleware(env) {
  return async (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/api/thinta/')) return next();
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const request = new Request(`${forwardedProto(req)}://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) });
      const response = await handleThinta(request, env());
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) return res.end();
      for await (const chunk of response.body) res.write(chunk);
      res.end();
    } catch (error) {
      if (!res.headersSent) res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Thinta request failed.' }));
    }
  };
}
