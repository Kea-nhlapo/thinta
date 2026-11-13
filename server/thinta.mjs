// Thinta: a team of agents that turns a photo of a maths graph into a checked pack for blind, Deaf and
// sighted learners (see src/thinta/contract.js). POST /api/thinta/run streams the trace as NDJSON and ends
// with the final GraphJob; POST /api/thinta/approve records the teacher's approval.
// STUB: until the pipeline lands, /run replays the contract's example job so the UI can be built against it.
import { EXAMPLE_PARABOLA_JOB, LIMITS, STREAM_CONTENT_TYPE } from '../src/thinta/contract.js';

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

async function* stubRun() {
  const job = structuredClone(EXAMPLE_PARABOLA_JOB);
  for (const entry of job.trace) yield { type: 'trace', entry };
  yield { type: 'done', job };
}

export async function handleThinta(request, env = {}) {
  const url = new URL(request.url);
  if (request.method !== 'POST') return jsonError('Use POST.', 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return jsonError('Request must come from this learning workspace.', 403);
  if (url.pathname === '/api/thinta/run') {
    const data = await readJSON(request, LIMITS.maxImageBytes + 20000);
    if (!data) return jsonError('Send a photo under 3.5 MB.', 413);
    return ndjson(stubRun(data, env));
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
