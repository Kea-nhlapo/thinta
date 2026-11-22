// "My learning settings": a learner's accessibility profile. Choosing needs sets sensible settings, which
// can then be changed one by one. Teachers see their account here and a link to learner results.
import React, { useState } from 'react';
import Brand from '../Brand.jsx';
import { currentAccount, getProfile, saveProfile, profileFromNeeds, signOut, NEEDS } from './accounts.js';
import { applyProfile, resetQuizChoices } from './learner-profile.js';
import { LANGUAGES, setQuestionLanguage } from './QuestionLanguage.jsx';
import './profile-page.css';

const SETTINGS = [
  ['voiceAnswers', 'Answer questions by voice', 'Questions and answers are read aloud and you say your answer.'],
  ['readAloud', 'Read each question aloud', 'The question is read out when it appears.'],
  ['signedHelp', 'Open the signed explanation by itself', 'After a wrong answer, Nia signs the explanation straight away.'],
  ['largeText', 'Large text', 'Bigger questions, answers and lesson text.'],
  ['highContrast', 'Stronger contrast', 'Black text, solid borders and clear focus outlines.'],
];

export default function ProfilePage() {
  const account = currentAccount();
  const [profile, setProfile] = useState(() => account?.role === 'learner' ? getProfile(account.email) : null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  if (!account) {
    return <main className="lb-profile"><Brand href="/" /><h1>My settings</h1><p>Sign in to see your settings.</p><a className="lb-profile-primary" href="/app?screen=login">Sign in</a></main>;
  }
  const change = next => { setProfile(next); setSaved(false); setSaveError(''); applyProfile(next); };
  const toggleNeed = id => {
    const needs = profile.needs.includes(id) ? profile.needs.filter(n => n !== id) : [...profile.needs, id];
    change(profileFromNeeds(needs, profile.language));
  };
  const save = async () => {
    setSaveError('');
    try { await saveProfile(account.email, profile); setQuestionLanguage(profile.language); resetQuizChoices(); setSaved(true); }
    catch (problem) { setSaveError(problem.message); }
  };
  const leave = () => { signOut(); window.location.href = '/app?screen=login'; };

  return <main className="lb-profile">
    <header><Brand href="/" /><a href={account.role === 'learner' ? '/app?screen=path' : '/app?screen=dashboard'}>{account.role === 'learner' ? 'Back to my lessons →' : 'Back to dashboard →'}</a></header>
    <h1>{account.role === 'learner' ? 'My learning settings' : 'My account'}</h1>
    <p className="lb-profile-who">Signed in as <b>{account.name}</b> ({account.email}) · <button type="button" onClick={leave}>Sign out</button></p>
    {account.role === 'teacher' && <p><a className="lb-profile-primary" href="/results">📊 See learner results</a></p>}
    {profile && <>
      <fieldset><legend>How do you learn best?</legend>
        <p className="lb-profile-hint">Choose any that apply. We set things up for you, and you can change each setting below.</p>
        {NEEDS.map(([id, label]) => <label key={id} className="lb-profile-check"><input type="checkbox" checked={profile.needs.includes(id)} onChange={() => toggleNeed(id)} />{label}</label>)}
      </fieldset>
      <fieldset><legend>Settings</legend>
        {SETTINGS.map(([key, label, hint]) => <label key={key} className="lb-profile-check"><input type="checkbox" checked={!!profile[key]} onChange={() => change({ ...profile, [key]: !profile[key] })} /><span><b>{label}</b><small>{hint}</small></span></label>)}
        <label className="lb-profile-language">Language for questions and lessons
          <select value={profile.language} onChange={event => change({ ...profile, language: event.target.value })}>{Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select>
        </label>
      </fieldset>
      <div className="lb-profile-actions"><button type="button" className="lb-profile-primary" onClick={save}>Save settings</button>{saved && <span role="status">Saved. Your lessons will use these settings.</span>}{saveError && <span role="alert" className="lb-account-error">{saveError}</span>}</div>
    </>}
  </main>;
}
