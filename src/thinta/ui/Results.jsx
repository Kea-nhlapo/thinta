// Result tabs for the checked pack: Blind, Deaf and Teacher. Nothing is downloadable before approval.
import React, { useEffect, useRef, useState } from 'react';
import { TraceLog, Correction, Review } from './Trace.jsx';
import { formatPoint, formatValue, prettyMaths } from './format.js';
import { readAloud } from './speech.js';

// Sub-agent C's touch graph and sub-agent B's PDF export load only if their files exist.
const touchModules = import.meta.glob('../sound/TouchGraph.jsx');
const tactileModules = import.meta.glob('../tactile/index.js');
const touchLoader = Object.values(touchModules)[0];
const TouchGraph = touchLoader ? React.lazy(() => touchLoader().then(m => ({ default: m.default || m.TouchGraph }))) : null;

class Guard extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const TABS = [['blind', 'Blind'], ['deaf', 'Deaf'], ['teacher', 'Teacher']];

export default function Results({ job, log, replay, onApprove, approving, approveError }) {
  const [tab, setTab] = useState('blind');
  const tabRefs = useRef({});
  const onKey = event => {
    const i = TABS.findIndex(([id]) => id === tab);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const next = TABS[(i + step + TABS.length) % TABS.length][0];
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  return <div className="th-results">
    <div className="th-tabs" role="tablist" aria-label="Versions of the pack" onKeyDown={onKey}>
      {TABS.map(([id, label]) => <button key={id} ref={el => (tabRefs.current[id] = el)} role="tab" id={`th-tab-${id}`} aria-controls={`th-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    <section role="tabpanel" id={`th-panel-${tab}`} aria-labelledby={`th-tab-${tab}`} className="th-panel">
      {tab === 'blind' && <BlindTab job={job} replay={replay} />}
      {tab === 'deaf' && <DeafTab job={job} />}
      {tab === 'teacher' && <TeacherTab job={job} log={log} replay={replay} onApprove={onApprove} approving={approving} approveError={approveError} />}
    </section>
  </div>;
}

function NotReady({ children }) { return <p className="th-notice"><span aria-hidden="true">⏸ </span>{children}</p>; }

function BlindTab({ job, replay }) {
  return <>
    <h3>Touch the graph</h3>
    {TouchGraph
      ? <Guard fallback={<NotReady>Touch-the-graph could not start on this phone.</NotReady>}><React.Suspense fallback={<p>Loading touch graph…</p>}><TouchGraph job={job} /></React.Suspense></Guard>
      : <NotReady>Touch-the-graph is still being built.</NotReady>}
    <KeyPoints job={job} />
    <h3>Audio description</h3>
    {job.description ? <>
      <Description lang="en" title="English" text={job.description.en} url={job.description.audioUrls?.en} replay={replay} />
      <Description lang="zu" title="isiZulu" text={job.description.zu} url={job.description.audioUrls?.zu} replay={replay} />
    </> : <NotReady>No description in this pack.</NotReady>}
    <h3>Tactile print</h3>
    <TactilePreview job={job} />
  </>;
}

function KeyPoints({ job }) {
  const proof = job.proof;
  if (!proof?.roots) return null;
  return <ul className="th-facts" aria-label="Key points from the proof">
    {proof.equation && <li><b>Equation</b> {prettyMaths(proof.equation)}</li>}
    {proof.roots.length > 0 && <li><b>Roots</b> x = {proof.roots.map(r => formatValue(r)).join(' and x = ')}</li>}
    {proof.turningPoint && <li><b>Turning point</b> {formatPoint(proof.turningPoint)}</li>}
    {Number.isFinite(proof.yIntercept) && <li><b>y-intercept</b> {formatPoint({ x: 0, y: proof.yIntercept })}</li>}
  </ul>;
}

function Description({ lang, title, text, url, replay }) {
  const [state, setState] = useState('idle');
  const control = useRef(null);
  useEffect(() => () => control.current?.abort(), []);
  if (!text) return null;
  const play = async () => {
    if (state === 'playing') { control.current?.abort(); setState('idle'); return; }
    control.current = new AbortController();
    setState('playing');
    try {
      if (url && !replay) { const audio = new Audio(url); control.current.signal.addEventListener('abort', () => audio.pause()); await audio.play(); await new Promise(r => { audio.onended = r; }); }
      else await readAloud(text, lang, { signal: control.current.signal, offline: replay });
      setState('idle');
    } catch { setState('failed'); }
  };
  return <article className="th-description" lang={lang === 'zu' ? 'zu' : 'en'}>
    <h4>{title}</h4>
    <p>{prettyMaths(text)}</p>
    <button type="button" className="th-button th-button-outline" onClick={play} aria-pressed={state === 'playing'}>
      <span aria-hidden="true">{state === 'playing' ? '■ ' : '▶ '}</span>{state === 'playing' ? `Stop ${title}` : `Read aloud in ${title}`}
    </button>
    {state === 'failed' && <p className="th-error" role="alert">Could not read this aloud on this phone.</p>}
  </article>;
}

const svgDataUrl = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function download(href, name) {
  const link = document.createElement('a');
  link.href = href; link.download = name;
  document.body.append(link); link.click(); link.remove();
}

function TactilePreview({ job, showDownloads = false }) {
  const [pdf, setPdf] = useState(null);
  const [pdfError, setPdfError] = useState('');
  useEffect(() => {
    const load = Object.values(tactileModules)[0];
    if (load) load().then(m => typeof m.svgToPdf === 'function' && setPdf(() => m.svgToPdf)).catch(() => {});
  }, []);
  const tactile = job.tactile;
  if (!tactile?.svg) return <NotReady>No tactile print in this pack.</NotReady>;
  const approved = job.approval?.approved;
  const name = `thinta-${job.id}`;
  const downloadPdf = async () => {
    setPdfError('');
    try {
      const out = await pdf(tactile.svg);
      const blob = out instanceof Blob ? out : typeof out === 'string' ? null : new Blob([out], { type: 'application/pdf' });
      const href = blob ? URL.createObjectURL(blob) : out;
      download(href, `${name}.pdf`);
      if (blob) setTimeout(() => URL.revokeObjectURL(href), 5000);
    } catch { setPdfError('Could not make the PDF. Download the SVG instead.'); }
  };
  return <>
    <figure className="th-tactile">
      <img src={svgDataUrl(tactile.svg)} alt={`Tactile print preview. ${job.description?.en || ''}`} />
      <figcaption>Braille labels are beta: check with a transcriber before printing on swell paper or an embosser.</figcaption>
    </figure>
    {tactile.warnings?.length > 0 && <ul className="th-warnings">{tactile.warnings.map((w, i) => <li key={i}><span aria-hidden="true">⚠ </span>Warning: {w}</li>)}</ul>}
    {approved
      ? <div className="th-downloads">
          <button type="button" className="th-button" onClick={() => download(svgDataUrl(tactile.svg), `${name}.svg`)}><span aria-hidden="true">⬇ </span>Download SVG</button>
          {pdf && <button type="button" className="th-button" onClick={downloadPdf}><span aria-hidden="true">⬇ </span>Download PDF</button>}
          {pdfError && <p className="th-error" role="alert">{pdfError}</p>}
        </div>
      : !showDownloads && <NotReady>Not ready to print yet. A teacher approves the pack in the Teacher tab first.</NotReady>}
  </>;
}

function DeafTab({ job }) {
  const solution = job.deafSolution;
  return <>
    <p className="th-notice th-sasl"><span aria-hidden="true">ⓘ </span>Signs need a human SASL reviewer. Thinta does not make sign language.</p>
    <h3>Step by step</h3>
    {solution?.steps?.length ? <ol className="th-steps">
      {solution.steps.map((step, i) => <li key={i}>
        <p className="th-step-text">{prettyMaths(step.text)}</p>
        {step.visual && <p className="th-step-visual"><span aria-hidden="true">👁 </span><b>Picture:</b> {prettyMaths(step.visual)}</p>}
      </li>)}
    </ol> : <NotReady>No Deaf solution in this pack.</NotReady>}
    {solution?.keyTerms?.length > 0 && <>
      <h3>Key terms to fingerspell</h3>
      <p className="th-muted">Letters to fingerspell with the class. A human SASL reviewer checks any signs.</p>
      <ul className="th-terms">
        {solution.keyTerms.map(term => <li key={term}>
          <span className="th-term">{term}</span>
          <span className="th-letters" aria-label={`Fingerspell: ${[...term.replace(/[^a-z]/gi, '')].join(' ')}`}>
            {[...term].map((ch, i) => /[a-z]/i.test(ch) ? <span key={i} className="th-letter" aria-hidden="true">{ch.toUpperCase()}</span> : <span key={i} className="th-gap" aria-hidden="true" />)}
          </span>
        </li>)}
      </ul>
    </>}
  </>;
}

function TeacherTab({ job, log, replay, onApprove, approving, approveError }) {
  const [name, setName] = useState('Teacher');
  const reviews = job.reviews || [], corrections = job.corrections || [];
  const passed = reviews.filter(r => r.pass).length;
  const approval = job.approval || {};
  return <>
    <h3>Checks</h3>
    <ul className="th-summary">
      <li><b>{passed} of {reviews.length}</b> checks passed{reviews.length > passed ? ` (${reviews.length - passed} failed, then corrected or escalated)` : ''}</li>
      <li><b>{corrections.length}</b> correction{corrections.length === 1 ? '' : 's'} made by the team</li>
      {Number.isFinite(job.calls) && <li><b>{job.calls}</b> agent calls{Number.isFinite(job.ms) ? ` in ${(job.ms / 1000).toFixed(1)} s` : ''}</li>}
    </ul>
    {reviews.length > 0 && <><h4>Reviews</h4><ul className="th-plain">{reviews.map((r, i) => <li key={i}><Review item={r} /></li>)}</ul></>}
    {corrections.length > 0 && <><h4>Corrections</h4><ul className="th-plain">{corrections.map((c, i) => <li key={i}><Correction item={c} /></li>)}</ul></>}
    {job.tactile?.ruleChecks?.length > 0 && <><h4>Tactile rules</h4><ul className="th-plain">{job.tactile.ruleChecks.map((c, i) => <li key={i}><p className={`th-review ${c.pass ? 'th-pass' : 'th-fail'}`}><b><span aria-hidden="true">{c.pass ? '✓ ' : '✕ '}</span>{c.pass ? 'Passed' : 'Failed'}: {c.rule}</b><span className="th-reason">{c.detail}</span></p></li>)}</ul></>}
    <h3>Approve the pack</h3>
    {approval.approved
      ? <p className="th-approved" role="status"><span aria-hidden="true">✓ </span>Approved by {approval.by || 'Teacher'} at {new Date(approval.at || Date.now()).toLocaleString('en-ZA')}{replay ? ' (replay: saved on this phone only)' : ''}.</p>
      : <form className="th-approve" onSubmit={event => { event.preventDefault(); onApprove(name.trim() || 'Teacher'); }}>
          <p>Check the versions and the trace. Nothing is ready for learners until you approve.</p>
          <label>Your name<input value={name} onChange={e => setName(e.target.value)} maxLength={80} autoComplete="name" /></label>
          <button type="submit" className="th-button th-button-big" disabled={approving}>{approving ? 'Approving…' : 'Approve'}</button>
          {approveError && <p className="th-error" role="alert">{approveError}</p>}
        </form>}
    <h4>Tactile print</h4>
    <TactilePreview job={job} showDownloads />
    <h3>Full trace</h3>
    <details className="th-details"><summary>Show every step the team took</summary><TraceLog log={log} /></details>
  </>;
}
