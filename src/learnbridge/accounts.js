// SA Educate accounts in the browser. The account server (/api/auth/*, server/accounts.mjs) is the source of
// truth: it checks passwords and keeps the session in an httpOnly cookie, so an account works on any device.
// This file keeps a copy of the signed-in person and their profile in localStorage so screens can read them at
// once; refreshSession() checks that copy against the server when the app starts.
import { NEEDS, accountProblem, cleanEmail, profileFromNeeds } from './account-rules.js';

export { NEEDS, profileFromNeeds };

const SIGNED_IN_KEY = 'sae-signed-in';
const LEARNERS_KEY = 'sae-learners';
// Left over from the browser-only accounts; removed so old copies of password hashes and sessions do not linger.
const OLD_KEYS = ['sae-accounts', 'sae-session', 'sae-profiles'];
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const forget = key => { try { localStorage.removeItem(key); } catch {} };

async function call(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(Error('Could not reach SA Educate. Check your connection and try again.'), { status: 0 });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(data.error || 'Something went wrong. Please try again.'), { status: response.status });
  return data;
}

function remember({ account, profile }) {
  OLD_KEYS.forEach(forget);
  write(SIGNED_IN_KEY, { account, profile });
  return account;
}

export async function signIn(email, password) {
  return remember(await call('/api/auth/signin', { method: 'POST', body: { email: cleanEmail(email), password } }));
}

export async function createAccount({ name, email, password, role, needs = [], language = 'en' }) {
  // Checked here too, so a mistake shows at once without a round trip. The server checks again.
  const message = accountProblem({ name, email, password, role });
  if (message) throw Error(message);
  return remember(await call('/api/auth/signup', { method: 'POST', body: { name, email: cleanEmail(email), password, role, needs, language } }));
}

// Checks the saved copy against the server. A session that has ended or been signed out elsewhere is forgotten;
// if the server cannot be reached, the copy is kept so the app still works offline.
export async function refreshSession() {
  try {
    remember(await call('/api/auth/me'));
  } catch (error) {
    if (error.status === 401) forget(SIGNED_IN_KEY);
  }
  return currentAccount();
}

export function currentAccount() {
  return read(SIGNED_IN_KEY, null)?.account || null;
}

export function getProfile(email) {
  const key = cleanEmail(email);
  const signedIn = read(SIGNED_IN_KEY, null);
  if (signedIn?.account?.email === key && signedIn.profile) return signedIn.profile;
  return read(LEARNERS_KEY, []).find(learner => learner.email === key)?.profile || profileFromNeeds();
}

// Saves a learner's settings on the server, and in the saved copy straight away.
export async function saveProfile(email, profile) {
  const signedIn = read(SIGNED_IN_KEY, null);
  if (signedIn?.account?.email === cleanEmail(email)) write(SIGNED_IN_KEY, { ...signedIn, profile });
  const saved = await call('/api/auth/profile', { method: 'PUT', body: { profile } });
  const latest = read(SIGNED_IN_KEY, null);
  if (latest?.account?.email === cleanEmail(email)) write(SIGNED_IN_KEY, { ...latest, profile: saved.profile });
  return saved.profile;
}

// Teachers: every learner account and its profile, from the server. allLearners() returns the last list fetched.
export async function fetchLearners() {
  const { learners } = await call('/api/auth/learners');
  write(LEARNERS_KEY, learners);
  return learners;
}
export function allLearners() { return read(LEARNERS_KEY, []); }

// Forgets the session here at once and tells the server; keepalive lets the request finish as the page changes.
export function signOut() {
  forget(SIGNED_IN_KEY);
  forget(LEARNERS_KEY);
  try { fetch('/api/auth/signout', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {}); } catch {}
}

// Where each kind of account lands after signing in: learners start with sign-to-speech.
export const homeFor = account => account?.role === 'learner' ? '/sign-introduction' : '/app?screen=dashboard-loading';
