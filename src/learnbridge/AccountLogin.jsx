// The sign-in screen: sign in or create an account (checked by the account server, so it works on any device),
// then learners go to sign-to-speech and teachers to the dashboard.
import React, { useState } from 'react';
import { signIn, createAccount, homeFor, getProfile, NEEDS } from './accounts.js';
import { applyProfile, resetQuizChoices } from './learner-profile.js';
import { LANGUAGES, setQuestionLanguage } from './QuestionLanguage.jsx';
import './account-login.css';

const MailIcon = () => <span aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="m4 7 8 6 8-6"/></svg></span>;
const LockIcon = () => <span aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>;
const PersonIcon = () => <span aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg></span>;

export function AccountLogin({ Btn, Brand, onTeacher }) {
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'learner', needs: [], language: 'en' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const field = key => ({ value: form[key], onChange: event => setForm(f => ({ ...f, [key]: event.target.value })) });
  const creating = mode === 'create';

  const submit = async event => {
    event.preventDefault();
    setError(''); setBusy(true);
    try {
      const account = creating ? await createAccount(form) : await signIn(form.email, form.password);
      // A new person on this device: their profile decides the quiz settings, language, text size and contrast.
      resetQuizChoices();
      if (account.role === 'learner') { const profile = getProfile(account.email); setQuestionLanguage(profile.language); applyProfile(profile); } else applyProfile(null);
      if (account.role === 'teacher' && onTeacher) onTeacher(account);
      else window.location.href = homeFor(account);
    } catch (problem) { setError(problem.message); setBusy(false); }
  };
  const switchMode = () => { setMode(creating ? 'signin' : 'create'); setError(''); };

  return <div className="dj-login lb-account"><button type="button" className="dj-back" aria-label="Back to home" onClick={() => { window.location.href = '/'; }}>←</button><Brand href="/" />
    <section role="main"><form onSubmit={submit} noValidate>
      <h1>{creating ? 'Create an account' : 'Welcome back'}</h1>
      <p>{creating ? 'Learners start with sign-to-speech, teachers with their dashboard.' : 'Sign in to SA Educate'}</p>
      {creating && <>
        <div className="lb-role" role="radiogroup" aria-label="I am a">
          {[['learner', 'Learner'], ['teacher', 'Teacher']].map(([value, label]) =>
            <button type="button" key={value} role="radio" aria-checked={form.role === value} className={form.role === value ? 'on' : ''} onClick={() => setForm(f => ({ ...f, role: value }))}>{label}</button>)}
        </div>
        <label className="dj-field"><PersonIcon /><input aria-label="Your name" placeholder="Your name" autoComplete="name" {...field('name')} /></label>
        {form.role === 'learner' && <fieldset className="lb-account-needs"><legend>How do you learn best? (optional)</legend>
          {NEEDS.map(([id, label]) => <label key={id}><input type="checkbox" aria-label={label} checked={form.needs.includes(id)} onChange={() => setForm(f => ({ ...f, needs: f.needs.includes(id) ? f.needs.filter(n => n !== id) : [...f.needs, id] }))} />{label}</label>)}
          <label className="lb-account-language">Language<select value={form.language} onChange={event => setForm(f => ({ ...f, language: event.target.value }))}>{Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
        </fieldset>}
      </>}
      <label className="dj-field"><MailIcon /><input aria-label="Email address" placeholder="Email address" type="email" autoComplete="email" {...field('email')} /></label>
      <label className="dj-field"><LockIcon /><input aria-label="Password" placeholder="Password" type="password" autoComplete={creating ? 'new-password' : 'current-password'} {...field('password')} /></label>
      {error && <p className="lb-account-error" role="alert">{error}</p>}
      <Btn type="submit" disabled={busy}>{busy ? 'Please wait…' : creating ? 'Create account' : 'Sign in'}</Btn>
    </form>
      <small>{creating ? 'Already have an account? ' : "Don't have an account? "}<button type="button" className="lb-account-switch" onClick={switchMode}>{creating ? 'Sign in' : 'Create an account'}</button></small>
    </section></div>;
}
