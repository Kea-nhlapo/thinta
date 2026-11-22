// Rules shared by the browser and the account server, so both give the same messages and build the same
// accessibility profile. No browser or Node APIs here.

export const NEEDS = [
  ['blind', 'I am blind'], ['low-vision', 'I have low vision'], ['deaf', 'I am Deaf'], ['hard-of-hearing', 'I am hard of hearing'],
];
export const LANGUAGE_CODES = ['en', 'zu', 'nso'];
const PROFILE_FLAGS = ['voiceAnswers', 'readAloud', 'largeText', 'highContrast', 'signedHelp'];

export const cleanEmail = email => String(email || '').trim().toLowerCase();

// Accessibility profile: what a learner needs, and the settings that follow from it.
export function profileFromNeeds(needs = [], language = 'en') {
  const has = need => needs.includes(need);
  return {
    needs: NEEDS.map(([id]) => id).filter(has), language: LANGUAGE_CODES.includes(language) ? language : 'en',
    voiceAnswers: has('blind'), readAloud: has('blind') || has('low-vision'),
    largeText: has('low-vision'), highContrast: has('low-vision'),
    signedHelp: has('deaf') || has('hard-of-hearing'),
  };
}

// A profile as saved from the settings page: only known needs, a known language and true/false settings.
export function cleanProfile(profile = {}) {
  const base = profileFromNeeds(Array.isArray(profile.needs) ? profile.needs : [], profile.language);
  for (const flag of PROFILE_FLAGS) if (typeof profile[flag] === 'boolean') base[flag] = profile[flag];
  return base;
}

// The first problem with a new account's details, or '' if there is none.
export function accountProblem({ name, email, password, role }) {
  if (!String(name || '').trim()) return 'Enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(email))) return 'Enter a valid email address.';
  if (String(password || '').length < 6) return 'Use a password of at least 6 characters.';
  if (!['learner', 'teacher'].includes(role)) return 'Choose learner or teacher.';
  return '';
}

export const WRONG_DETAILS = 'That email and password do not match an account.';
export const ALREADY_EXISTS = 'An account with that email already exists. Sign in instead.';
