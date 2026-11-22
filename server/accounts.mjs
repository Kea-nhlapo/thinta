// SA Educate accounts: sign up, sign in, sign out, the signed-in person, their profile, and a teacher's learners.
//
//   POST /api/auth/signup    { name, email, password, role, needs, language }  -> 201 { account, profile }
//   POST /api/auth/signin    { email, password }                               -> { account, profile }
//   POST /api/auth/signout                                                     -> { ok }
//   GET  /api/auth/me                                                          -> { account, profile } or 401
//   PUT  /api/auth/profile   { profile }        (learners)                     -> { profile }
//   GET  /api/auth/learners                     (teachers)                     -> { learners }
//
// Passwords are hashed with scrypt and a random salt per account. A session is a random token in an httpOnly
// cookie; only its SHA-256 is stored, so a leaked sessions table cannot be used to sign in.
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ALREADY_EXISTS, WRONG_DETAILS, accountProblem, cleanEmail, cleanProfile, profileFromNeeds } from '../src/learnbridge/account-rules.js';
import { createAccountStore } from './accounts/store.mjs';

const scrypt = promisify(scryptCallback);
const COOKIE = 'sae_session';
const SESSION_DAYS = 30;
const MAX_BODY = 16 * 1024;
// scrypt cost: about 50 ms per hash on a small server. Stored with each hash so it can be raised later.
const COST = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
// Wrong passwords per email and address before a short wait, to slow down guessing.
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

// Demo accounts for presentations. They are created in the store on first use, hashed like any other account.
export const SEED_ACCOUNTS = [
  { email: 'teacher@saeducate.test', password: 'Teach2026!', name: 'Demo Teacher', role: 'teacher' },
  { email: 'learner1@saeducate.test', password: 'Learn2026!', name: 'Thabo', role: 'learner', needs: ['blind'] },
  { email: 'learner2@saeducate.test', password: 'Learn2026!', name: 'Lerato', role: 'learner', needs: ['deaf'] },
  { email: 'learner3@saeducate.test', password: 'Learn2026!', name: 'Sipho', role: 'learner', needs: ['low-vision'] },
  { email: 'learner4@saeducate.test', password: 'Learn2026!', name: 'Naledi', role: 'learner', needs: ['hard-of-hearing'], language: 'zu' },
  { email: 'learner5@saeducate.test', password: 'Learn2026!', name: 'Ayanda', role: 'learner', needs: [], language: 'nso' },
];

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(String(password), salt, KEY_LENGTH, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, expected] = String(stored || '').split('$');
  if (kind !== 'scrypt') return false;
  const wanted = Buffer.from(expected, 'base64');
  const key = await scrypt(String(password), Buffer.from(salt, 'base64'), wanted.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(key, wanted);
}

const sha256 = text => createHash('sha256').update(text).digest('hex');
const publicAccount = ({ email, name, role }) => ({ email, name, role });
const profileOf = user => user.role === 'learner' ? user.profile || profileFromNeeds() : null;
const signedIn = user => ({ account: publicAccount(user), profile: profileOf(user) });
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
const problem = (message, status) => json({ error: message }, status);

function cookieFrom(request) {
  const match = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match ? match[1] : '';
}

// Secure only over https, so the cookie still works on http://localhost in development.
function isHttps(request) {
  const forwarded = (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
  return forwarded ? forwarded === 'https' : new URL(request.url).protocol === 'https:';
}

function sessionCookie(request, token, maxAge) {
  return [`${COOKIE}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAge}`, ...(isHttps(request) ? ['Secure'] : [])].join('; ');
}

async function readJSON(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(Error('Request too large.'), { status: 413 });
  try { return text ? JSON.parse(text) : {}; } catch { throw Object.assign(Error('Send the details as JSON.'), { status: 400 }); }
}

export function createAccounts({ store: given, now = () => Date.now() } = {}) {
  let storePromise = null;
  let seeded = null;
  const failures = new Map();

  // The store is made on first use, and the demo accounts are added to it once.
  const store = async () => {
    const s = await (storePromise ||= Promise.resolve(given || createAccountStore()));
    seeded ||= Promise.all(SEED_ACCOUNTS.map(async seed => {
      if (await s.getUser(seed.email)) return;
      await s.createUser({ email: seed.email, name: seed.name, role: seed.role, passwordHash: await hashPassword(seed.password), profile: seed.role === 'learner' ? profileFromNeeds(seed.needs, seed.language) : null });
    })).catch(error => { seeded = null; throw error; });
    await seeded;
    return s;
  };

  const tooManyFailures = key => {
    const entry = failures.get(key);
    if (!entry || now() - entry.first > FAILURE_WINDOW_MS) { failures.delete(key); return false; }
    return entry.count >= MAX_FAILURES;
  };
  const recordFailure = key => {
    const entry = failures.get(key);
    if (!entry || now() - entry.first > FAILURE_WINDOW_MS) failures.set(key, { first: now(), count: 1 });
    else entry.count += 1;
  };

  async function startSession(request, s, user, status = 200) {
    const token = randomBytes(32).toString('base64url');
    await s.createSession(sha256(token), user.email, new Date(now() + SESSION_DAYS * 864e5));
    return json(signedIn(user), status, { 'set-cookie': sessionCookie(request, token, SESSION_DAYS * 86400) });
  }

  async function currentUser(request, s) {
    const token = cookieFrom(request);
    return token ? s.sessionUser(sha256(token)) : null;
  }

  // A hash to compare against when the email has no account, so a wrong email takes as long as a wrong password.
  let decoy = null;

  return async function handleAccounts(request) {
    const { pathname } = new URL(request.url);
    const route = `${request.method} ${pathname}`;
    try {
      const s = await store();
      if (route === 'POST /api/auth/signup') {
        const body = await readJSON(request);
        const details = { ...body, email: cleanEmail(body.email) };
        const message = accountProblem(details);
        if (message) return problem(message, 400);
        const user = {
          email: details.email, name: String(details.name).trim(), role: details.role, passwordHash: await hashPassword(details.password),
          profile: details.role === 'learner' ? profileFromNeeds(Array.isArray(details.needs) ? details.needs : [], details.language) : null,
        };
        if (!await s.createUser(user)) return problem(ALREADY_EXISTS, 409);
        return startSession(request, s, user, 201);
      }
      if (route === 'POST /api/auth/signin') {
        const body = await readJSON(request);
        const email = cleanEmail(body.email);
        const address = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';
        const key = `${address}|${email}`;
        if (tooManyFailures(key)) return problem('Too many wrong passwords. Wait a few minutes and try again.', 429);
        const user = await s.getUser(email);
        decoy ||= hashPassword('not a real password');
        const ok = await verifyPassword(body.password, user?.passwordHash || await decoy);
        if (!user || !ok) { recordFailure(key); return problem(WRONG_DETAILS, 401); }
        failures.delete(key);
        return startSession(request, s, user);
      }
      if (route === 'POST /api/auth/signout') {
        const token = cookieFrom(request);
        if (token) await s.deleteSession(sha256(token));
        return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
      }
      if (route === 'GET /api/auth/me') {
        const user = await currentUser(request, s);
        return user ? json(signedIn(user)) : problem('Not signed in.', 401);
      }
      if (route === 'PUT /api/auth/profile') {
        const user = await currentUser(request, s);
        if (!user) return problem('Sign in to save your settings.', 401);
        if (user.role !== 'learner') return problem('Only learner accounts have settings.', 403);
        const profile = cleanProfile((await readJSON(request)).profile);
        await s.saveProfile(user.email, profile);
        return json({ profile });
      }
      if (route === 'GET /api/auth/learners') {
        const user = await currentUser(request, s);
        if (!user) return problem('Not signed in.', 401);
        if (user.role !== 'teacher') return problem('Only teachers can see learners.', 403);
        return json({ learners: (await s.listLearners()).map(learner => ({ ...publicAccount(learner), profile: profileOf(learner) })) });
      }
      return problem('Not found.', 404);
    } catch (error) {
      if (error.status) return problem(error.message, error.status);
      console.error('Account request failed:', error);
      return problem('Accounts are not available right now. Please try again shortly.', 503);
    }
  };
}

// For the Vite dev and preview servers (and so Railway): adapts Node's req/res to the web handler above.
export function accountsMiddleware(handle = createAccounts()) {
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/auth/')) return next();
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) { res.statusCode = 413; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: 'Request too large.' })); return; }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
    const request = new Request(`${proto}://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) });
    const response = await handle(request);
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}
