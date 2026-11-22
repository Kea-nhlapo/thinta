// Vercel function for every /api/* route (vercel.json rewrites /api/<path> to /api/router?__path=<path>,
// because Vercel's file routing would not reach nested paths such as /api/lesson-jobs/script). It reuses the same server modules as the Vite dev server:
// LearnBridge's gateway (translation, voices, transcription, YouTube, ASL), lesson preparation and
// Signchat sentence reconstruction. Keys come from the Vercel project's environment variables.
import { Readable } from 'node:stream';
import gateway from '../server/learnbridge-gateway.mjs';
import { createLessonJobs } from '../server/lesson-jobs.mjs';
import { signReconstructionMiddleware } from '../server/sign-reconstruct.mjs';
import { handleThinta } from '../server/thinta.mjs';
import { createAccounts } from '../server/accounts.mjs';
import { TEACHER_HEADER, createAssignments, guardThinta } from '../server/assignments.mjs';

const GATEWAY_ROUTES = new Set(['/api/translate', '/api/speak', '/api/transcribe', '/api/youtube', '/api/asl', '/api/describe-images']);
// Serverless instances do not share memory, so lessons are generated within the request.
const lessons = createLessonJobs({ apiKey: process.env.GEMINI_API_KEY, inline: true });
const signReconstruct = signReconstructionMiddleware(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL);
const accounts = createAccounts();
const assignments = createAssignments({ accounts });
const teachersOnly = guardThinta(accounts);

// Runs a Node-style (req, res, next) middleware on a web Request and returns its web Response.
function runMiddleware(middleware, request) {
  const url = new URL(request.url);
  const req = Object.assign(request.body ? Readable.fromWeb(request.body) : Readable.from([]), {
    method: request.method,
    url: url.pathname + url.search,
    headers: Object.fromEntries(request.headers),
  });
  return new Promise(resolve => {
    const headers = new Headers();
    const res = {
      statusCode: 200,
      setHeader(name, value) { headers.set(name, value); },
      end(body) { resolve(new Response(body ?? null, { status: this.statusCode, headers })); },
    };
    Promise.resolve(middleware(req, res, () => resolve(Response.json({ message: 'Not found.' }, { status: 404 })))).catch(() =>
      resolve(Response.json({ message: 'Request failed.' }, { status: 500 })));
  });
}

// Rebuilds the original request URL (/api/<path>?…) from the rewrite's __path parameter.
function originalRequest(request) {
  const url = new URL(request.url);
  const routed = url.searchParams.get('__path');
  if (routed === null) return request;
  url.searchParams.delete('__path');
  url.pathname = '/api/' + routed.replace(/^\/+/, '');
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  return new Request(url, { method: request.method, headers: request.headers, ...(hasBody ? { body: request.body, duplex: 'half' } : {}) });
}

async function handle(incoming) {
  const request = originalRequest(incoming);
  const path = new URL(request.url).pathname;
  if (GATEWAY_ROUTES.has(path)) return gateway.fetch(request, { HF_TOKEN: process.env.HF_TOKEN, GEMINI_API_KEY: process.env.GEMINI_API_KEY });
  if (path.startsWith('/api/lesson-jobs') || path.startsWith('/api/lessons/')) return runMiddleware(lessons.handle, request);
  if (path === '/api/sign-reconstruct') return runMiddleware(signReconstruct, request);
  if (path.startsWith('/api/auth/')) return accounts(request);
  if (path === '/api/assignments' || path === '/api/my-assignments') return assignments(request);
  // Thinta streams its trace, so it answers with a web Response directly instead of going through runMiddleware.
  if (path.startsWith('/api/thinta/')) {
    // Teachers only. The checked teacher's name is passed on so approvals record who approved.
    const check = await teachersOnly(request);
    if (check.response) return check.response;
    const headers = new Headers(request.headers);
    headers.set(TEACHER_HEADER, encodeURIComponent(check.teacher.name));
    return handleThinta(new Request(request, { headers }), { HF_TOKEN: process.env.HF_TOKEN, GEMINI_API_KEY: process.env.GEMINI_API_KEY });
  }
  return Response.json({ message: 'Not found.' }, { status: 404 });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
