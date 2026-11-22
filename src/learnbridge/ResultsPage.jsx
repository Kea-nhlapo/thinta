// Teacher results: how each learner is doing, which questions were hardest, and which supports were used.
// Results are kept on this device for now; example results can be added for demonstrations.
import React, { useEffect, useMemo, useState } from 'react';
import Brand from '../Brand.jsx';
import { currentAccount, allLearners, fetchLearners, NEEDS } from './accounts.js';
import { allResults, summarise, addDemoResults, clearDemoResults, hasDemoResults } from './results.js';
import { capsLabel } from './caps.js';
import './results-page.css';

const NEED_LABEL = { blind: 'Blind', 'low-vision': 'Low vision', deaf: 'Deaf', 'hard-of-hearing': 'Hard of hearing' };
const DEMO_LESSONS = [
  { id: 'demo-water-cycle', title: 'The water cycle', caps: { grade: 7, subject: 'Social Sciences (Geography)', topic: 'The water cycle' }, questions: ['What provides the energy that drives the water cycle?', 'What is evaporation?', 'How do clouds form?', 'What is run-off?'] },
  { id: 'demo-human-eye', title: 'The human eye', caps: { grade: 12, subject: 'Life Sciences', topic: 'The human eye' }, questions: ['What does the iris control?', 'Where is the image formed?', 'What is accommodation?', 'What causes astigmatism?'] },
  { id: 'demo-fractions', title: 'Fractions and equivalent fractions', caps: { grade: 7, subject: 'Mathematics', topic: 'Common fractions' }, questions: ['What is the numerator of 3/4?', 'Which fraction equals 1/2?', 'Simplify 6/8.', 'Which is bigger: 2/3 or 3/5?'] },
  { id: 'demo-circuits', title: 'Electric circuits', caps: { grade: 9, subject: 'Natural Sciences', topic: 'Electric circuits' }, questions: ['What does a switch do?', 'What is a series circuit?', 'What happens if one bulb in series breaks?'] },
].map(l => ({ ...l, questions: l.questions.map((prompt, i) => ({ id: `q-${i + 1}`, prompt })) }));
const when = at => at ? new Date(at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '—';
const Bar = ({ value }) => <span className="lb-res-bar" aria-hidden="true"><span style={{ width: `${value}%` }} className={value < 50 ? 'low' : value < 75 ? 'mid' : 'high'} /></span>;

function toCsv(results) {
  const cols = ['learnerName', 'learner', 'lessonTitle', 'prompt', 'firstTry', 'attempts', 'helpUsed', 'voiceUsed', 'at', 'demo'];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...results.map(r => cols.map(c => cell(c === 'at' ? new Date(r.at).toISOString() : r[c])).join(','))].join('\n');
}

export default function ResultsPage() {
  const account = currentAccount();
  const [version, setVersion] = useState(0);
  const [lessonFilter, setLessonFilter] = useState('');
  const results = useMemo(() => allResults(), [version]);
  const learners = useMemo(() => allLearners(), [version]);
  // Learner accounts live on the server; show the last list at once, then the fresh one.
  useEffect(() => { if (account?.role === 'teacher') fetchLearners().then(() => setVersion(v => v + 1), () => {}); }, []);
  const shown = lessonFilter ? results.filter(r => r.lessonId === lessonFilter) : results;
  const summary = useMemo(() => summarise(shown, learners), [shown, learners]);
  const lessonsAll = useMemo(() => summarise(results, []).lessons, [results]);
  const demo = hasDemoResults();

  if (account?.role !== 'teacher') {
    return <main className="lb-res"><Brand href="/" /><h1>Learner results</h1><p>Sign in with a teacher account to see learner results.</p><a className="lb-res-primary" href="/app?screen=login">Sign in</a></main>;
  }
  // Seeded, so the example is the same every time (one learner in "Needs support").
  const addDemo = () => { let seed = 7; addDemoResults(learners, DEMO_LESSONS, () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296); setVersion(v => v + 1); };
  const clearDemo = () => { clearDemoResults(); setLessonFilter(''); setVersion(v => v + 1); };
  const download = () => {
    const url = URL.createObjectURL(new Blob([toCsv(shown)], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: 'learner-results.csv' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const { totals } = summary;
  const support = summary.learners.filter(l => l.answered && l.score < 50);

  return <main className="lb-res">
    <header><Brand href="/" /><a href="/app?screen=dashboard">Back to dashboard →</a></header>
    <h1>Learner results</h1>
    <p className="lb-res-note">Results from learners who used SA Educate on this device{demo ? ', including example results' : ''}.</p>
    <div className="lb-res-tools">
      {lessonsAll.length > 0 && <label>Lesson <select value={lessonFilter} onChange={e => setLessonFilter(e.target.value)}><option value="">All lessons</option>{lessonsAll.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>}
      {demo ? <button type="button" onClick={clearDemo}>Remove example results</button> : <button type="button" onClick={addDemo}>Add example results</button>}
      {results.length > 0 && <button type="button" onClick={download}>⬇ Download as spreadsheet (CSV)</button>}
    </div>

    {!results.length ? <section className="lb-res-empty"><h2>No results yet</h2><p>Results appear here when learners finish questions in a lesson. To see how this page works, add example results.</p></section> : <>
      <section className="lb-res-cards" aria-label="Totals">
        <article><b>{totals.learners}</b><span>Learners active</span></article>
        <article><b>{totals.lessons}</b><span>Lessons</span></article>
        <article><b>{totals.answered}</b><span>Questions answered</span></article>
        <article><b>{totals.score}%</b><span>Right first time</span></article>
        <article><b>{totals.help}</b><span>Signed explanations watched</span></article>
      </section>

      {support.length > 0 && <section className="lb-res-alert" role="note"><h2>Needs support</h2><p>{support.map(l => `${l.name} (${l.score}% right first time)`).join(', ')}</p></section>}

      <section><h2>Learners</h2>
        <div className="lb-res-table"><table>
          <thead><tr><th scope="col">Learner</th><th scope="col">Needs</th><th scope="col">Lessons</th><th scope="col">Answered</th><th scope="col">Right first time</th><th scope="col">Signed help</th><th scope="col">Voice answers</th><th scope="col">Last active</th></tr></thead>
          <tbody>{summary.learners.map(l => <tr key={l.email} className={l.answered && l.score < 50 ? 'lb-res-low' : ''}>
            <th scope="row">{l.name}</th>
            <td>{l.profile?.needs?.length ? l.profile.needs.map(n => <span key={n} className="lb-res-need">{NEED_LABEL[n] || n}</span>) : '—'}</td>
            <td>{l.lessons}</td><td>{l.answered}</td>
            <td>{l.answered ? <><Bar value={l.score} /> {l.score}%</> : 'Not started'}</td>
            <td>{l.help}</td><td>{l.voice}</td><td>{when(l.last)}</td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <section><h2>Hardest questions</h2>
        <ol className="lb-res-questions">{summary.questions.slice(0, 8).map((q, i) => <li key={i}>
          <b>{q.prompt}</b>
          <span>{q.lessonTitle} · <Bar value={q.score} /> {q.score}% right first time · {q.learners} learner{q.learners === 1 ? '' : 's'} · {q.wrongTries} wrong tries · signed help {q.help}×</span>
        </li>)}</ol>
      </section>

      <section><h2>Lessons</h2>
        <div className="lb-res-table"><table>
          <thead><tr><th scope="col">Lesson</th><th scope="col">CAPS</th><th scope="col">Learners</th><th scope="col">Right first time</th></tr></thead>
          <tbody>{summary.lessons.map(l => <tr key={l.id}><th scope="row">{l.title}</th><td>{capsLabel(l.caps) || '—'}</td><td>{l.learners}</td><td><Bar value={l.score} /> {l.score}%</td></tr>)}</tbody>
        </table></div>
      </section>
    </>}
    <p className="lb-res-foot">Needs come from each learner's settings ({NEEDS.map(([, label]) => label.replace(/^I (am|have) /, '')).join(', ')}).</p>
  </main>;
}
