// A learner's home: the material their teachers assigned, each shown in the version the learner's settings need.
// Learners never see the agents that made it. Blind and low-vision learners get the read-aloud and touch graph;
// Deaf and hard-of-hearing learners get the step-by-step picture solution and sign-to-speech; everyone else
// gets the standard version. Any learner can open the other versions too.
import React, { useEffect, useState } from 'react';
import Brand from '../Brand.jsx';
import { currentAccount, getProfile, signOut, redirectFor } from './accounts.js';
import { BlindTab, DeafTab } from '../thinta/ui/Results.jsx';
import { prettyMaths } from '../thinta/ui/format.js';
import { openAssignedLesson } from './assigned-lesson.js';
import { formatFor } from './learner-format.js';
import '../thinta/thinta.css';
import './learner-home.css';

const VERSIONS = [['listen', 'Listen and touch'], ['see', 'Step by step with pictures'], ['standard', 'Standard']];

function StandardPack({ job, language }) {
  const text = job.description?.[language] || job.description?.en;
  return <>
    {text && <p className="sae-learn-description">{prettyMaths(text)}</p>}
    <DeafTab job={job} saslNote={false} />
  </>;
}

function Pack({ item, profile }) {
  const [version, setVersion] = useState(() => formatFor(profile));
  const job = item.content;
  return <article className="sae-learn-item">
    <h2>{prettyMaths(item.title)}</h2>
    <p className="sae-learn-meta">Assigned {new Date(item.assignedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' })}</p>
    <div className="sae-learn-versions" role="group" aria-label="Versions">
      {VERSIONS.map(([id, label]) => <button key={id} type="button" aria-pressed={version === id} onClick={() => setVersion(id)}>{label}</button>)}
    </div>
    <div className="th-panel">
      {version === 'listen' && <BlindTab job={job} />}
      {version === 'see' && <DeafTab job={job} saslNote={false} />}
      {version === 'standard' && <StandardPack job={job} language={profile?.language || 'en'} />}
    </div>
  </article>;
}

function Lesson({ item }) {
  const start = () => { openAssignedLesson(item.content); window.location.href = '/app?screen=path'; };
  return <article className="sae-learn-item">
    <h2>{item.title}</h2>
    <p className="sae-learn-meta">{item.content.questions?.length || 0} questions · assigned {new Date(item.assignedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' })}</p>
    <button type="button" className="sae-learn-start" onClick={start}>Start the lesson</button>
  </article>;
}

export default function LearnerHome() {
  const account = currentAccount();
  const away = redirectFor(['learner'], account);
  const [state, setState] = useState({ loading: true, items: [], error: '' });
  useEffect(() => {
    if (away) { window.location.replace(away); return; }
    document.title = 'My lessons · SA Educate';
    fetch('/api/my-assignments', { credentials: 'same-origin' })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) { signOut(); window.location.replace('/app?screen=login'); return; }
        if (!response.ok) throw Error(data.error || 'Your lessons could not be loaded. Please try again.');
        setState({ loading: false, items: data.assignments || [], error: '' });
      })
      .catch(error => setState({ loading: false, items: [], error: error.message }));
  }, []);
  if (away) return null;

  const profile = getProfile(account.email);
  const format = formatFor(profile);
  const leave = () => { signOut(); window.location.href = '/app?screen=login'; };
  return <main className="sae-learn">
    <header><Brand href="/learn" /><span>Signed in as <b>{account.name}</b> · <a href="/profile">My settings</a> · <button type="button" onClick={leave}>Sign out</button></span></header>
    <h1>My lessons</h1>
    <p className="sae-learn-intro">{format === 'listen' ? 'Each lesson opens ready to listen to and touch.' : format === 'see' ? 'Each lesson opens step by step with pictures.' : 'Your teacher shares lessons here.'}</p>
    {format === 'see' && <p><a className="sae-learn-start outline" href="/sign-introduction">✋ Sign to speak</a></p>}
    {state.loading && <p role="status">Loading your lessons…</p>}
    {state.error && <p role="alert" className="sae-learn-error">{state.error}</p>}
    {!state.loading && !state.error && state.items.length === 0 && <p className="sae-learn-empty">Nothing assigned yet. When your teacher shares a lesson, it appears here.</p>}
    {state.items.map(item => item.kind === 'pack' ? <Pack key={item.itemId} item={item} profile={profile} /> : <Lesson key={item.itemId} item={item} />)}
  </main>;
}
