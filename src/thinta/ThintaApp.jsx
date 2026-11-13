// Thinta on the phone: snap a graph, watch the agent team work, then check and approve the pack.
import React, { useEffect, useReducer, useRef, useState } from 'react';
import Brand from '../Brand.jsx';
import { DEFAULT_QUESTIONS, emptyJob } from './contract.js';
import { initialRun, applyEvent, timelineFromRecording, replayDelays, agentStates } from './ui/job.js';
import { readNdjson } from './ui/stream.js';
import { prettyMaths } from './ui/format.js';
import { downscaleImage } from './ui/image.js';
import { PipelineChips, TraceLog, LatestStep, Highlights } from './ui/Trace.jsx';
import Results from './ui/Results.jsx';
import { loadReplay } from './replay/index.js';
import './thinta.css';

const EXAMPLE_EQUATION = 'y = x^2 - 2x - 8';

function runReducer(state, action) {
  if (action.type === 'reset') return initialRun(action.job);
  if (action.type === 'approval') return { ...state, job: { ...state.job, approval: action.approval } };
  // A saved pack opens finished: its trace, corrections and reviews rebuilt from the stored job in one go.
  if (action.type === 'load') return timelineFromRecording(action.job).reduce((state, { event }) => applyEvent(state, event), initialRun());
  return applyEvent(state, action.event);
}

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function ThintaApp() {
  const [photo, setPhoto] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [equation, setEquation] = useState('');
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS.join('\n'));
  const [replayMode, setReplayMode] = useState(false);
  const [replayInfo, setReplayInfo] = useState(null);
  const [run, dispatch] = useReducer(runReducer, undefined, () => initialRun());
  const [source, setSource] = useState(null); // 'live' | 'replay' once a run starts
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState('');
  const [saved, setSaved] = useState({ packs: [], storage: null, error: '' }); // packs kept in the database
  const [opening, setOpening] = useState('');
  const control = useRef(null);
  const resultsHeading = useRef(null);
  const traceHeading = useRef(null);

  useEffect(() => () => control.current?.abort(), []);
  useEffect(() => { document.title = 'Thinta · SA Educate'; }, []);
  // The saved packs list refreshes each time the snap screen shows. Offline, it just stays empty.
  useEffect(() => {
    if (source !== null) return undefined;
    const abort = new AbortController();
    fetch('/api/thinta/packs', { signal: abort.signal }).then(r => (r.ok ? r.json() : null))
      .then(data => data && setSaved({ packs: data.packs || [], storage: data.storage, error: '' })).catch(() => {});
    return () => abort.abort();
  }, [source]);
  // Focus moves to the results once the team finishes, so screen readers land there.
  useEffect(() => { if (run.status === 'done') resultsHeading.current?.focus(); }, [run.status]);

  const choosePhoto = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPhotoError('');
    try { setPhoto(await downscaleImage(file)); } catch (error) { setPhoto(null); setPhotoError(error.message || 'Could not open that picture.'); }
  };

  const begin = mode => {
    control.current?.abort();
    control.current = new AbortController();
    setSource(mode);
    setApproveError('');
    dispatch({ type: 'reset', job: emptyJob({ mode, input: { equationHint: equation.trim() || undefined, questions: questionList(questions) } }) });
    setTimeout(() => traceHeading.current?.focus(), 0);
    return control.current.signal;
  };

  const startLive = async () => {
    if (!photo) { setPhotoError('Take or choose a photo of the graph first.'); return; }
    const signal = begin('live');
    let finished = false;
    const onEvent = event => { if (event.type === 'done' || event.type === 'error') finished = true; dispatch({ event }); };
    try {
      const response = await fetch('/api/thinta/run', {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: photo.base64, mimeType: photo.mimeType, equationHint: equation.trim() || undefined, questions: questionList(questions), learners: ['blind', 'deaf', 'sighted'] }),
      });
      if (!response.ok || !/ndjson/.test(response.headers.get('content-type') || '')) {
        const data = await response.json().catch(() => ({}));
        throw Error(data.error || `Thinta could not start (error ${response.status}).`);
      }
      await readNdjson(response, onEvent);
      if (!finished) throw Error('The connection closed before the team finished.');
    } catch (error) {
      if (signal.aborted) return;
      dispatch({ event: { type: 'error', message: friendlyError(error) } });
    }
  };

  // Replays a saved run with its original timing (sped up), fully offline.
  const startReplay = async () => {
    const signal = begin('replay');
    const info = await loadReplay();
    setReplayInfo(info);
    const timeline = timelineFromRecording(info.recording);
    const delays = replayDelays(timeline, { speed: prefersReducedMotion() ? 8 : 4 });
    for (let i = 0; i < timeline.length; i++) {
      await new Promise(resolve => setTimeout(resolve, delays[i]));
      if (signal.aborted) return;
      let { event } = timeline[i];
      // The replayed pack waits for this teacher's approval, like a live one.
      if (event.type === 'done' && event.job) event = { ...event, job: { ...event.job, mode: 'replay', approval: { approved: false } } };
      dispatch({ event });
    }
  };

  const approve = async by => {
    setApproveError('');
    if (source === 'replay') { dispatch({ type: 'approval', approval: { approved: true, by, at: new Date().toISOString() } }); return; }
    setApproving(true);
    try {
      const response = await fetch('/api/thinta/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: run.job.id, by }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.approval) throw Error(data.error || 'Approval was not saved.');
      dispatch({ type: 'approval', approval: data.approval });
    } catch (error) { setApproveError(`${error.message} Try again.`); } finally { setApproving(false); }
  };

  const openPack = async id => {
    setOpening(id);
    try {
      const response = await fetch(`/api/thinta/packs/${encodeURIComponent(id)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.job) throw Error(data.error || 'That pack could not be opened.');
      control.current?.abort();
      setSource('saved'); setApproveError('');
      dispatch({ type: 'load', job: data.job });
    } catch (error) { setSaved(current => ({ ...current, error: friendlyError(error) })); } finally { setOpening(''); }
  };

  const restart = () => { control.current?.abort(); setSource(null); dispatch({ type: 'reset' }); };

  const isReplay = source === 'replay' || run.job.mode === 'replay';
  const started = source !== null;

  return <div className="thinta">
    {isReplay && started && <p className="th-badge" role="status"><span aria-hidden="true">⟲ </span><b>Replay</b> · a saved run, not live</p>}
    {/* Once a run starts the header shrinks to one line, so the phone shows the team's work, not the title. */}
    <header className={`th-header${started ? ' th-header-compact' : ''}`}>
      <Brand href="/" />
      <h1>Thinta <span>touch the maths</span></h1>
      {!started && <p>Photograph a graph. A team of agents builds a checked version for blind and Deaf learners.</p>}
    </header>

    <main>
      {!started && <section className="th-card" aria-labelledby="th-snap">
        <h2 id="th-snap">1. Snap the graph</h2>
        <label className="th-replay-toggle">
          <input type="checkbox" checked={replayMode} onChange={e => setReplayMode(e.target.checked)} />
          <span>Replay a recorded run <small>(works offline, no photo needed)</small></span>
        </label>
        {!replayMode && <>
          <div className="th-photo-buttons">
            <label className="th-button th-button-big th-file">
              <span aria-hidden="true">📷 </span>Take a photo
              <input type="file" accept="image/*" capture="environment" onChange={choosePhoto} />
            </label>
            <label className="th-button th-button-outline th-file">
              <span aria-hidden="true">🖼 </span>Choose a picture
              <input type="file" accept="image/*" onChange={choosePhoto} />
            </label>
          </div>
          {photoError && <p className="th-error" role="alert">{photoError}</p>}
          {photo && <figure className="th-preview">
            <img src={photo.dataUrl} alt="Your photo of the graph" />
            <figcaption>{photo.width} × {photo.height}, {sizeText(photo.base64.length)} to send</figcaption>
          </figure>}
          <label className="th-field">Equation (optional)
            <input value={equation} onChange={e => setEquation(e.target.value)} placeholder={EXAMPLE_EQUATION} inputMode="text" autoCapitalize="off" autoCorrect="off" spellCheck="false" />
          </label>
          {!equation && <button type="button" className="th-link" onClick={() => setEquation(EXAMPLE_EQUATION)}>Use the example equation</button>}
          <details className="th-details">
            <summary>Worksheet questions ({questionList(questions).length})</summary>
            <label className="th-field">One question per line
              <textarea rows={6} value={questions} onChange={e => setQuestions(e.target.value)} />
            </label>
            <button type="button" className="th-link" onClick={() => setQuestions(DEFAULT_QUESTIONS.join('\n'))}>Reset to the default questions</button>
          </details>
        </>}
        <button type="button" className="th-button th-button-big th-start" onClick={replayMode ? startReplay : startLive}>
          {replayMode ? 'Play the recorded run' : 'Start the team'}
        </button>
      </section>}

      {!started && (saved.packs.length > 0 || saved.error) && <SavedPacks saved={saved} opening={opening} onOpen={openPack} />}

      {started && <section className="th-card" aria-labelledby="th-trace">
        <h2 id="th-trace" ref={traceHeading} tabIndex={-1}>2. Watch the team work</h2>
        {source === 'saved' && <p className="th-notice th-saved-note"><span aria-hidden="true">🗄 </span>A saved pack, reopened from the {saved.storage === 'postgres' ? 'database' : 'server'}. Made {formatWhen(run.job.createdAt)}.</p>}
        {isReplay && <p className="th-notice th-replay-note"><span aria-hidden="true">⟲ </span>Replay: {replayInfo?.label || (source === 'replay' ? 'loading the recorded run…' : 'the server sent saved example data, not a live run')}.</p>}
        <p className="th-status" role={run.status === 'running' ? undefined : 'status'}>{statusText(run.status)}</p>
        {run.status === 'done' ? <TeamFinished job={run.job} /> : <PipelineChips job={run.job} status={run.status} />}
        {run.status === 'running' && <LatestStep log={run.log} />}
        <Highlights job={run.job} />
        {run.log.length > 0 && <details className="th-details th-all-steps">
          <summary>Every step the team took ({run.log.filter(item => item.kind === 'trace').length})</summary>
          <TraceLog log={run.log} />
        </details>}
        {run.status === 'error' && <div className="th-error-box" role="alert">
          <p><b>Thinta stopped:</b> {run.error}</p>
          <button type="button" className="th-button" onClick={() => { setReplayMode(true); startReplay(); }}>Replay a recorded run</button>
        </div>}
        <button type="button" className="th-button th-button-outline" onClick={restart}>{run.status === 'running' ? 'Stop and start again' : 'Start again'}</button>
      </section>}

      {run.status === 'done' && <section className="th-card" aria-labelledby="th-results">
        <h2 id="th-results" ref={resultsHeading} tabIndex={-1}>3. The checked pack</h2>
        {!run.job.approval?.approved && <p className="th-notice"><span aria-hidden="true">⏸ </span>Waiting for teacher approval. Nothing is ready for learners yet.</p>}
        <Results job={run.job} log={run.log} replay={isReplay} onApprove={approve} approving={approving} approveError={approveError} />
      </section>}
    </main>
  </div>;
}

const formatWhen = iso => (iso ? new Date(iso).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

// Packs the team made before, kept on the server: tap one to reopen it as it was left.
function SavedPacks({ saved, opening, onOpen }) {
  return <section className="th-card" aria-labelledby="th-saved">
    <h2 id="th-saved">Saved packs</h2>
    <p className="th-muted">{saved.storage === 'postgres' ? 'Kept in the database, so they survive restarts.' : 'Kept on this server.'}</p>
    {saved.error && <p className="th-error" role="alert">{saved.error}</p>}
    <ul className="th-saved-list">
      {saved.packs.map(pack => <li key={pack.id}>
        <button type="button" className="th-saved-pack" onClick={() => onOpen(pack.id)} disabled={Boolean(opening)}>
          <b>{prettyMaths(pack.equation || 'Graph pack')}</b>
          <span>{formatWhen(pack.createdAt)}</span>
          <span className={pack.approved ? 'th-saved-approved' : 'th-saved-waiting'}>
            <span aria-hidden="true">{pack.approved ? '✓ ' : '⏸ '}</span>{pack.approved ? `Approved by ${pack.approvedBy}` : 'Waiting for approval'}
          </span>
          {opening === pack.id && <span role="status">Opening…</span>}
        </button>
      </li>)}
    </ul>
  </section>;
}

// After the run, the chips fold into one line; the headlines below carry the story.
function TeamFinished({ job }) {
  const states = Object.values(agentStates(job, 'done'));
  const done = states.filter(s => s === 'done').length;
  const facts = [Number.isFinite(job.ms) && `${Math.round(job.ms / 1000)} s`, Number.isFinite(job.calls) && `${job.calls} agent calls`].filter(Boolean).join(', ');
  return <p className="th-finished"><span aria-hidden="true">✓ </span>{done === states.length ? `All ${done} agents finished` : `${done} of ${states.length} agents finished`}{facts ? ` in ${facts}` : ''}.</p>;
}

// Browser network failures say "Failed to fetch" or "network error"; say what happened instead.
const friendlyError = error => error instanceof TypeError ? 'The connection to Thinta dropped. Check the network, or replay a recorded run.' : error.message;
const sizeText = bytes => bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
const questionList = text => text.split('\n').map(q => q.trim()).filter(Boolean).slice(0, 10);

function statusText(status) {
  return { idle: 'Starting…', running: 'The team is working…', done: 'Done. The pack is ready for the teacher to check.', error: 'Stopped with an error.' }[status];
}
