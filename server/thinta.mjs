// Thinta: a team of agents that turns a photo of a maths graph into a checked pack for blind, Deaf and
// sighted learners (see src/thinta/contract.js). POST /api/thinta/run streams the trace as NDJSON and ends
// with the final GraphJob; POST /api/thinta/approve records the teacher's approval.
import { LIMITS, STREAM_CONTENT_TYPE } from '../src/thinta/contract.js';
import gateway from './learnbridge-gateway.mjs';
import { runPipeline } from './thinta/pipeline.mjs';

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

export async function handleThinta(request, env = {}) {
  const url = new URL(request.url);
  if (request.method !== 'POST') return jsonError('Use POST.', 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return jsonError('Request must come from this learning workspace.', 403);
  if (url.pathname === '/api/thinta/run') {
    const data = await readJSON(request, LIMITS.maxImageBytes + 20000);
    if (!data) return jsonError('Send a photo under 3.5 MB.', 413);
    if (!env.GEMINI_API_KEY) return jsonError('Live runs need GEMINI_API_KEY on the server. Use Replay instead.', 501);
    const input = runInput(data);
    if (!input.imageBase64 && !input.equationHint) return jsonError('Send a photo or type the equation.', 400);
    return ndjson(runPipeline(input, { apiKey: env.GEMINI_API_KEY, translate: translator(env), deps: env.thintaDeps }));
  }
  if (url.pathname === '/api/thinta/approve') {
    const data = await readJSON(request, 5000);
    if (!data?.jobId) return jsonError('Say which job to approve.', 400);
    return Response.json({ jobId: data.jobId, approval: { approved: true, by: String(data.by || 'Teacher').slice(0, 80), at: new Date().toISOString() } }, { headers });
  }
  return jsonError('Not found.', 404);
}

// The same routes inside the Vite dev/preview server, streaming the response as it is produced.
export function thintaMiddleware(env) {
  return async (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/api/thinta/')) return next();
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) });
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
