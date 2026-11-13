// Result tabs for the checked pack: Blind, Deaf and Teacher. Nothing is downloadable before approval.
import React, { useEffect, useRef, useState } from 'react';
import { TraceLog, Review } from './Trace.jsx';
import { checkOutcomes, outcomeSummary } from './highlights.js';
import StepPicture from './StepPicture.jsx';
import { formatPoint, formatValue, prettyMaths } from './format.js';
import { readAloud, unlockAudio } from './speech.js';

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
// Fika (J): a Delivery tab appears once the teacher approves; the board loads only when opened.
const DeliveryBoard = React.lazy(() => import('../fika/DeliveryBoard.jsx'));
const DELIVERY_TAB = ['delivery', 'Delivery'];

export default function Results({ job, log, replay, onApprove, approving, approveError }) {
  const [tab, setTab] = useState('blind');
  const tabRefs = useRef({});
  const tabs = job.approval?.approved ? [...TABS, DELIVERY_TAB] : TABS; // Fika (J)
  const onKey = event => {
    const i = tabs.findIndex(([id]) => id === tab);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const next = tabs[(i + step + tabs.length) % tabs.length][0];
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  return <div className="th-results">
    <div className="th-tabs" role="tablist" aria-label="Versions of the pack" onKeyDown={onKey} style={tabs.length > 3 ? { gridTemplateColumns: `repeat(${tabs.length}, 1fr)` } : undefined}>
      {tabs.map(([id, label]) => <button key={id} ref={el => (tabRefs.current[id] = el)} role="tab" id={`th-tab-${id}`} aria-controls={`th-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    <section role="tabpanel" id={`th-panel-${tab}`} aria-labelledby={`th-tab-${tab}`} className="th-panel">
      {tab === 'blind' && <BlindTab job={job} replay={replay} />}
      {tab === 'deaf' && <DeafTab job={job} />}
      {tab === 'teacher' && <TeacherTab job={job} log={log} replay={replay} onApprove={onApprove} approving={approving} approveError={approveError} />}
      {tab === 'delivery' && job.approval?.approved && <Guard fallback={<NotReady>The delivery board could not start on this phone.</NotReady>}><React.Suspense fallback={<p>Loading the delivery board…</p>}><DeliveryBoard job={job} replay={replay} /></React.Suspense></Guard>}
    </section>
  </div>;
}

function NotReady({ children }) { return <p className="th-notice"><span aria-hidden="true">⏸ </span>{children}</p>; }

// The Blind tab speaks one language at a time, picked by the learner. The words below are a first draft for
// isiZulu and Sepedi: check them with a first-language speaker. Maths terms stay in English, the language
// South African schools teach maths in from Grade 4.
const BLIND_LANGS = { en: 'English', zu: 'isiZulu', nso: 'Sepedi' };
const BLIND_WORDS = {
  en: { language: 'Language', touch: 'Touch the graph', description: 'Audio description', tactile: 'Tactile print', read: 'Read aloud', stop: 'Stop' },
  zu: { language: 'Ulimi', touch: 'Thinta igrafu', description: 'Incazelo yokulalelwa', tactile: 'Igrafu ethintwayo', read: 'Funda ngezwi', stop: 'Misa' },
  nso: { language: 'Polelo', touch: 'Kgoma kerafo', description: 'Tlhaloso ya go theeletšwa', tactile: 'Kerafo ya go kgongwa', read: 'Bala ka lentšu', stop: 'Emiša' },
};
const savedLang = () => { try { return BLIND_LANGS[localStorage.getItem('thinta-blind-lang')] ? localStorage.getItem('thinta-blind-lang') : 'en'; } catch { return 'en'; } };

function BlindTab({ job, replay }) {
  const [lang, setLang] = useState(savedLang);
  const choose = value => { setLang(value); try { localStorage.setItem('thinta-blind-lang', value); } catch { /* private mode */ } };
  const words = BLIND_WORDS[lang];
  const text = job.description?.[lang];
  return <div lang={lang}>
    <div className="th-blind-head">
      <h3>{words.touch}</h3>
      <label className="th-lang">
        <span>{words.language}</span>
        <select value={lang} onChange={event => choose(event.target.value)}>
          {Object.entries(BLIND_LANGS).map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>)}
        </select>
      </label>
    </div>
    {TouchGraph
      ? <Guard fallback={<NotReady>Touch-the-graph could not start on this phone.</NotReady>}><React.Suspense fallback={<p>Loading touch graph…</p>}><TouchGraph job={job} /></React.Suspense></Guard>
      : <NotReady>Touch-the-graph is still being built.</NotReady>}
    <KeyPoints job={job} />
    <h3>{words.description}</h3>
    {!job.description ? <NotReady>No description in this pack.</NotReady>
      : text ? <Description key={lang} lang={lang} text={text} url={job.description.audioUrls?.[lang]} replay={replay} words={words} />
      : <>
          {/* Older packs and replays were made before Sepedi; say so and fall back to English rather than show nothing. */}
          <NotReady>This pack has no {BLIND_LANGS[lang]} version yet, so here it is in English.</NotReady>
          <Description key="en" lang="en" text={job.description.en} url={job.description.audioUrls?.en} replay={replay} words={BLIND_WORDS.en} />
        </>}
    <h3>{words.tactile}</h3>
    <TactilePreview job={job} />
  </div>;
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

function Description({ lang, text, url, replay, words }) {
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const control = useRef(null);
  useEffect(() => () => control.current?.abort(), []);
  if (!text) return null;
  const play = async () => {
    // Unlock sound now, inside the tap: the voice arrives seconds later, after the phone stops counting the tap.
    unlockAudio();
    if (state === 'playing') { control.current?.abort(); setState('idle'); return; }
    control.current = new AbortController();
    setState('playing'); setError('');
    try {
      if (url && !replay) { const audio = new Audio(url); control.current.signal.addEventListener('abort', () => audio.pause()); await audio.play(); await new Promise(r => { audio.onended = r; }); }
      else await readAloud(text, lang, { signal: control.current.signal, offline: replay });
      setState('idle');
    } catch (failure) { setState('failed'); setError(failure?.message || 'Could not read this aloud on this phone.'); }
  };
  return <article className="th-description" lang={lang}>
    <button type="button" className="th-button th-read-aloud" onClick={play} aria-pressed={state === 'playing'}>
      <span aria-hidden="true">{state === 'playing' ? '■ ' : '▶ '}</span>{state === 'playing' ? words.stop : words.read}
    </button>
    <p>{prettyMaths(text)}</p>
    {state === 'playing' && <p className="th-muted" role="status">Getting the voice and reading. The first words can take a few seconds.</p>}
    {state === 'failed' && <p className="th-error" role="alert">{error}</p>}
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
        <StepPicture step={step} proof={job.proof} />
        {step.visual && <p className="th-step-visual"><span aria-hidden="true">👁 </span><b>Look:</b> {prettyMaths(step.visual)}</p>}
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

const RULE_NAMES = {
  'label-gap': 'Labels at least 3.2 mm from the curve', 'stroke-hierarchy': 'Curve thicker than the axes', 'label-overlap': 'No labels overlap',
  'label-in-page': 'Every label fits on the page', 'label-axis-gap': 'Labels clear of the axes', 'label-near-own-point': 'Each label beside its own point',
};
const ruleName = rule => RULE_NAMES[rule] || String(rule).replace(/-/g, ' ');
const OUTCOME = { passed: ['✓', 'Passed'], fixed: ['↻', 'Fixed by the team'], open: ['⚠', 'Needs you'] };

// How a check ended, in words: "Passed after 1 rewrite (0/5 → 5/5)".
function outcomeText(o) {
  if (o.check === 'reader-vs-prover') return o.status === 'passed' ? 'The photo and the algebra agree' : 'The algebra overruled the photo';
  const scores = o.firstScore && o.finalScore && o.firstScore !== o.finalScore ? ` (${o.firstScore} → ${o.finalScore})` : o.finalScore ? ` (${o.finalScore})` : '';
  const fixes = o.tries - 1;
  if (o.status === 'passed') return `Passed first time${scores}`;
  if (o.status === 'fixed') return `Passed after ${fixes} ${o.check === 'fresh-eyes' ? 'fix' : 'rewrite'}${fixes === 1 ? '' : 's'}${scores}`;
  const problem = o.final.meaning?.problems?.[0];
  return `${problem ? `This sentence disagrees with the proof: “${prettyMaths(problem.sentence).replace(/\.$/, '')}”` : prettyMaths(o.final.reason || 'Still failing')}. Escalated after ${fixes} ${o.check === 'fresh-eyes' ? 'fix' : 'rewrite'}${fixes === 1 ? '' : 's'}.`;
}

function TeacherTab({ job, log, replay, onApprove, approving, approveError }) {
  const [name, setName] = useState('Teacher');
  const reviews = job.reviews || [], corrections = job.corrections || [];
  const outcomes = checkOutcomes(job);
  const totals = outcomeSummary(outcomes);
  const rules = job.tactile?.ruleChecks || [];
  const approval = job.approval || {};
  return <>
    <h3>Where every check ended</h3>
    <p className="th-verdict">{[totals.passed && `${totals.passed} passed`, totals.fixed && `${totals.fixed} fixed by the team`, totals.open && `${totals.open} need${totals.open === 1 ? 's' : ''} you`].filter(Boolean).join(' · ')}</p>
    <ul className="th-outcomes">
      {outcomes.map(o => <li key={o.check} className={`th-outcome th-outcome-${o.status}`}>
        <span className="th-outcome-tag"><span aria-hidden="true">{OUTCOME[o.status][0]} </span>{OUTCOME[o.status][1]}</span>
        <b>{o.name}</b>
        <span className="th-outcome-text">{outcomeText(o)}</span>
      </li>)}
      {rules.length > 0 && <li className={`th-outcome th-outcome-${rules.every(r => r.pass) ? 'passed' : 'open'}`}>
        <span className="th-outcome-tag"><span aria-hidden="true">{rules.every(r => r.pass) ? '✓ ' : '⚠ '}</span>{rules.every(r => r.pass) ? 'Passed' : 'Needs you'}</span>
        <b>Tactile print rules</b>
        <span className="th-outcome-text">{rules.filter(r => r.pass).length} of {rules.length} rules pass</span>
      </li>}
    </ul>
    {Number.isFinite(job.calls) && <p className="th-muted">{corrections.length} correction{corrections.length === 1 ? '' : 's'} by the team, {job.calls} agent calls{Number.isFinite(job.ms) ? ` in ${(job.ms / 1000).toFixed(0)} s` : ''}.</p>}

    <h3>Approve the pack</h3>
    {approval.approved
      ? <p className="th-approved" role="status"><span aria-hidden="true">✓ </span>Approved by {approval.by || 'Teacher'} at {new Date(approval.at || Date.now()).toLocaleString('en-ZA')}{replay ? ' (replay: saved on this phone only)' : ''}. The Delivery tab is open.</p>
      : <form className="th-approve" onSubmit={event => { event.preventDefault(); onApprove(name.trim() || 'Teacher'); }}>
          <p>{totals.open ? `Look at the ${totals.open === 1 ? 'check that needs' : 'checks that need'} you first. ` : ''}Nothing reaches learners until you approve.</p>
          <label>Your name<input value={name} onChange={e => setName(e.target.value)} maxLength={80} autoComplete="name" /></label>
          <button type="submit" className="th-button th-button-big" disabled={approving}>{approving ? 'Approving…' : 'Approve the pack'}</button>
          {approveError && <p className="th-error" role="alert">{approveError}</p>}
        </form>}

    <h3>Tactile print</h3>
    <TactilePreview job={job} showDownloads />

    <h3>The detail</h3>
    <details className="th-details"><summary>Every review ({reviews.length})</summary><ul className="th-plain">{reviews.map((r, i) => <li key={i}><Review item={r} /></li>)}</ul></details>
    {rules.length > 0 && <details className="th-details"><summary>Tactile print rules ({rules.length})</summary><ul className="th-plain">{rules.map((c, i) => <li key={i}><p className={`th-review ${c.pass ? 'th-pass' : 'th-fail'}`}><b><span aria-hidden="true">{c.pass ? '✓ ' : '✕ '}</span>{ruleName(c.rule)}</b><span className="th-reason">{c.detail}</span></p></li>)}</ul></details>}
    <details className="th-details"><summary>Every step the team took ({log.filter(item => item.kind === 'trace').length})</summary><TraceLog log={log} /></details>
  </>;
}
