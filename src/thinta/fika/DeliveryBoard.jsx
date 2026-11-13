// Fika's Delivery tab: after approval, plan delivery, show each learner's items, live replans and honest failures.
import React, { useEffect, useReducer, useRef, useState } from 'react';
import { TraceLog, Review, STATE_LABELS } from '../ui/Trace.jsx';
import { readNdjson } from '../ui/stream.js';
import { replayDelays } from '../ui/job.js';
import { EXAMPLE_DISPATCH, FIKA_AGENTS } from '../contract.js';
import { DEMO_SCHOOL, DEMO_SCHOOLS } from '../fika-demo-school.js';
import {
  initialBoard, applyFikaEvent, applyEventResult, latestEtaCorrections, groupByLearner, lateTactileJobs, uniqueReasons, phoneFallbacks,
  machineOnline, eventBody, fikaAgentStates, readableLog, replayPlan, itemLabel, statusLabel, formatClock, weekdayName,
} from './ui/board.js';
import './delivery-board.css';

// H's formatEta ('Thu 15:10') when time.js is present; our own formatter otherwise or on bad input.
const timeModule = Object.values(import.meta.glob('./time.js', { eager: true }))[0];
const formatEta = iso => { try { return timeModule?.formatEta ? timeModule.formatEta(iso) : formatClock(iso); } catch { return formatClock(iso); } };

// A recorded Fika run (recorded-*.json) wins; the contract example is the labelled fallback.
const recorded = import.meta.glob('./replay/recorded-*.json');
async function loadFikaReplay() {
  const key = Object.keys(recorded).sort()[0];
  if (key) {
    try {
      const module = await recorded[key]();
      const recording = module.default ?? module;
      const when = recording.recordedAt ? new Date(recording.recordedAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : '';
      return { plan: replayPlan(recording), label: `Recorded Fika run${when ? ` from ${when}` : ''}`, isExample: false };
    } catch { /* fall through to the example */ }
  }
  return { plan: replayPlan(structuredClone(EXAMPLE_DISPATCH)), label: 'Example data, not a recorded run', isExample: true };
}

// Board state survives switching tabs: one entry per approved pack.
const sessions = new Map();

function reducer(state, action) {
  if (action.type === 'reset') return action.state || initialBoard();
  if (action.type === 'result') return applyEventResult(state, action.result);
  return applyFikaEvent(state, action.event);
}

const KIND_WORDS = { 'machine-offline': 'taken offline', 'machine-online': 'brought back online', urgent: 'Urgent pack added', tick: 'Clock moved on' };
const SHORT_NAMES = { embosser: 'embosser', swell: 'swell-paper heater' };
const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function DeliveryBoard({ job, replay = false }) {
  const key = `${job.id}|${job.approval?.at || ''}|${replay ? 'replay' : 'live'}`;
  const saved = sessions.get(key);
  const [state, dispatch] = useReducer(reducer, undefined, () => saved?.state || initialBoard());
  const [source, setSource] = useState(saved?.source || null); // {label, isExample} in replay
  const [actions, setActions] = useState(saved?.actions || []); // recorded replans still to play
  const [busy, setBusy] = useState(false);
  const [eventError, setEventError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [lastUpdate, setLastUpdate] = useState(saved?.lastUpdate || ''); // what the last demo event changed
  const [attempt, setAttempt] = useState(0);
  const control = useRef(null);

  useEffect(() => { sessions.set(key, { state, source, actions, lastUpdate }); }, [key, state, source, actions, lastUpdate]);

  // Start once per pack: replay never touches the network.
  useEffect(() => {
    if (saved?.state?.status === 'done' && attempt === 0) return undefined;
    control.current?.abort();
    const abort = new AbortController();
    control.current = abort;
    const { signal } = abort;
    dispatch({ type: 'reset' });
    setAnnouncement(''); setLastUpdate('');
    (replay ? playReplay : startLive)(signal).catch(error => {
      if (!signal.aborted) dispatch({ event: { type: 'error', message: friendlyError(error) } });
    });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  async function startLive(signal) {
    let finished = false;
    const response = await fetch('/api/thinta/dispatch', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphJobId: job.id, schoolId: 'demo-school', approved: true }),
    });
    if (!response.ok || !/ndjson/.test(response.headers.get('content-type') || '')) {
      const data = await response.json().catch(() => ({}));
      throw Error(data.error || `Fika could not start (error ${response.status}).`);
    }
    await readNdjson(response, event => {
      if (signal.aborted) return;
      if (event.type === 'done' || event.type === 'error') finished = true;
      if (event.type === 'done') setAnnouncement(readyText(event.dispatch));
      dispatch({ event });
    });
    if (!finished && !signal.aborted) throw Error('The connection closed before Fika finished.');
  }

  async function playReplay(signal) {
    const info = await loadFikaReplay();
    if (signal.aborted) return;
    setSource({ label: info.label, isExample: info.isExample });
    setActions(info.plan.actions);
    const { timeline } = info.plan;
    const delays = replayDelays(timeline, { speed: prefersReducedMotion() ? 8 : 4 });
    for (let i = 0; i < timeline.length; i++) {
      await new Promise(resolve => setTimeout(resolve, delays[i]));
      if (signal.aborted) return;
      const { event } = timeline[i];
      if (event.type === 'done') setAnnouncement(readyText(event.dispatch));
      dispatch({ event });
    }
  }

  // Demo control: tell the server what happened and show its replan.
  async function sendEvent(kind, machineId) {
    setBusy(true); setEventError('');
    try {
      const response = await fetch('/api/thinta/dispatch/event', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventBody({ graphJobId: job.id, kind, machineId, dispatch: state.dispatch })),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.dispatch) throw Error(data.error || `Fika could not replan (error ${response.status}).`);
      showResult(kind, machineId, data);
    } catch (error) { setEventError(`${friendlyError(error)} Try again.`); } finally { setBusy(false); }
  }

  function showResult(kind, machineId, result) {
    dispatch({ type: 'result', result });
    const etaChanges = latestEtaCorrections(result.corrections || []).size;
    const text = `${eventText(kind, machineId)}. ${etaChanges ? `${etaChanges} ETA${etaChanges === 1 ? '' : 's'} changed. ` : 'No ETA changed. '}${readyText(result.dispatch)}`;
    setAnnouncement(text); setLastUpdate(text);
  }

  // Replay: step through the recorded replans instead of calling the server.
  function playRecordedAction() {
    const [next, ...rest] = actions;
    if (!next) return;
    setActions(rest);
    showResult(next.kind, next.machineId, next.result);
  }

  const d = state.dispatch;
  const school = DEMO_SCHOOLS[d?.schoolId] || DEMO_SCHOOL;
  const machines = Object.fromEntries(school.machines.map(m => [m.id, m]));
  const corrections = latestEtaCorrections(state.corrections);
  const late = lateTactileJobs(d);
  const ready = state.status === 'done' && d;

  return <div className="fk-board">
    <h3>Delivery</h3>
    <p className="th-notice fk-honest"><span aria-hidden="true">ⓘ </span>Machine capacities are demo values. Fika does not control real printers yet; it makes the schedule and the print files.</p>
    {replay && <p className="th-notice th-replay-note"><span aria-hidden="true">⟲ </span>Replay: {source?.label || 'loading the recorded delivery run…'}.</p>}
    {d?.clock && <p className="fk-clock"><span aria-hidden="true">🕐 </span>Demo clock: <b>{formatEta(d.clock)}</b></p>}
    <p className="th-sr" role="status" aria-live="polite">{announcement}</p>

    {state.status !== 'done' && <section aria-labelledby="fk-progress">
      <h4 id="fk-progress">{state.status === 'error' ? 'Fika stopped' : 'Planning delivery…'}</h4>
      {state.status === 'error' && <div className="th-error-box" role="alert">
        <p><b>Fika stopped:</b> {state.error}</p>
        {!replay && <button type="button" className="th-button" onClick={() => setAttempt(n => n + 1)}>Try again</button>}
      </div>}
    </section>}

    {ready && late.length > 0 && <HonestFailure dispatch={d} late={late} school={school} />}
    {ready && <Summary summary={d.summary} />}

    {ready && <section aria-labelledby="fk-learners">
      <h4 id="fk-learners">Each learner's items</h4>
      <ul className="fk-learners">
        {groupByLearner(d.jobs, school.learners).map(({ learner, jobs }) => <li key={learner.id} className="fk-learner">
          <h5>{learner.name}</h5>
          <ul className="fk-items">{jobs.map(item => <Item key={item.id} item={item} machine={machines[item.machineId]} correction={corrections.get(item.id)} />)}</ul>
        </li>)}
      </ul>
    </section>}

    {ready && <DemoControls school={school} dispatch={d} replay={replay} busy={busy} onEvent={sendEvent}
      actions={actions} onPlayRecorded={playRecordedAction} lastUpdate={lastUpdate} error={eventError} />}

    {ready && <Checker checks={d.checks || []} reviews={state.reviews} />}
    {ready && <Machines school={school} dispatch={d} />}

    <section aria-labelledby="fk-trace">
      <h4 id="fk-trace">What Fika's agents did</h4>
      <FikaChips log={state.log} status={state.status} />
      <TraceLog log={readableLog(state.log, formatEta, Object.fromEntries(school.machines.map(m => [m.id, m.name])))} live />
    </section>
  </div>;
}

function Item({ item, machine, correction }) {
  const [icon, word] = statusLabel(item.status);
  const phone = !item.machineId && item.pages === 0;
  return <li className={`fk-item fk-item-${item.status}`}>
    <p className="fk-item-name"><b>{itemLabel(item.item)}</b></p>
    <span className={`fk-status fk-status-${item.status}`}><span aria-hidden="true">{icon} </span>{word}</span>
    <p className="fk-machine">{machine ? <>On the {machine.name}</> : phone ? 'Sent to the phone, no machine needed' : item.machineId ? `On ${item.machineId}` : item.status === 'late' ? 'No machine available' : 'No machine yet'}</p>
    {correction
      ? <p className="fk-eta th-correction">
          <b>{item.status === 'delivered' ? 'Delivered' : 'ETA'}</b>{' '}
          <span className="th-sr">was</span> <del>{formatEta(correction.before)}</del>{' '}
          <span aria-hidden="true">→</span> <span className="th-sr">now</span> <ins>{correction.after ? formatEta(correction.after) : 'no time yet'}</ins>
          {correction.reason && <span className="th-reason">Why: {correction.reason}</span>}
        </p>
      : item.eta && <p className="fk-eta"><b>{item.status === 'delivered' ? 'Delivered' : 'ETA'}</b> {formatEta(item.eta)}</p>}
    {item.status !== 'delivered' && item.deadline && <p className="fk-deadline">Needed by {formatEta(item.deadline)}</p>}
    {item.status === 'late' && item.lateReason && <p className="fk-late-reason"><span aria-hidden="true">⚠ </span>Late: {item.lateReason}</p>}
  </li>;
}

function HonestFailure({ dispatch, late, school }) {
  const day = weekdayName(school.lesson?.at);
  const fallbacks = phoneFallbacks(dispatch);
  return <section className="fk-failure" role="alert" aria-live="assertive" aria-labelledby="fk-failure-title">
    <h4 id="fk-failure-title"><span aria-hidden="true">⚠ </span>Can't meet {day ? `${day}'s` : 'the'} lesson. Flagged for the teacher</h4>
    <p>{late.length} tactile print{late.length === 1 ? '' : 's'} will not be ready in time.</p>
    <ul>{uniqueReasons(late).map(reason => <li key={reason}>{reason}</li>)}</ul>
    {fallbacks.length > 0
      ? <p><span aria-hidden="true">📬 </span>The phone pack was delivered as the fallback to {fallbacks.length} of these learner{fallbacks.length === 1 ? '' : 's'}, so they can start today.</p>
      : <p>No phone pack has been delivered to these learners yet.</p>}
  </section>;
}

function Summary({ summary }) {
  const [lang, setLang] = useState('en');
  if (!summary) return null;
  const hasZu = Boolean(summary.zu);
  const shown = lang === 'zu' && hasZu ? 'zu' : 'en';
  return <section className="fk-summary" aria-labelledby="fk-summary-title">
    <h4 id="fk-summary-title">For the teacher</h4>
    <ul className="fk-counts">
      <li><span aria-hidden="true">✓ </span><b>{summary.ready ?? 0}</b> ready</li>
      <li><span aria-hidden="true">⚠ </span><b>{summary.late ?? 0}</b> late</li>
    </ul>
    {hasZu && <div className="fk-lang" role="group" aria-label="Summary language">
      <button type="button" aria-pressed={shown === 'en'} onClick={() => setLang('en')}>English</button>
      <button type="button" aria-pressed={shown === 'zu'} onClick={() => setLang('zu')}>isiZulu</button>
    </div>}
    <p lang={shown} className="fk-summary-text">{summary[shown] || 'No summary yet.'}</p>
  </section>;
}

const RULE_NAMES = { capacity: 'Capacity', deadlines: 'Deadlines', 'double-booking': 'No machine double-booked', 'offline-machines': 'No job on an offline machine', 'every-item': 'Every learner has every item' };
const ruleName = rule => RULE_NAMES[rule] || String(rule || 'Check').replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());

function Checker({ checks, reviews }) {
  const failed = checks.filter(c => !c.pass);
  return <section className="fk-checker" aria-labelledby="fk-checker-title">
    <h4 id="fk-checker-title">Schedule Checker</h4>
    <p><b>{checks.length - failed.length} of {checks.length}</b> checks passed{failed.length ? `, ${failed.length} failed` : ''}.</p>
    <ul className="th-plain">{checks.map((c, i) => <li key={i}>
      <p className={`th-review ${c.pass ? 'th-pass' : 'th-fail'}`}><b><span aria-hidden="true">{c.pass ? '✓ ' : '✕ '}</span>{c.pass ? 'Passed' : 'Failed'}: {ruleName(c.rule)}</b><span className="th-reason">{c.detail}</span></p>
    </li>)}</ul>
    {failed.length > 0 && <><h5>Problems</h5><ul>{failed.map((c, i) => <li key={i}>{c.detail}</li>)}</ul></>}
    {reviews.length > 0 && <><h5>Checker reviews</h5><ul className="th-plain">{reviews.map((r, i) => <li key={i}><Review item={r} /></li>)}</ul></>}
  </section>;
}

function Machines({ school, dispatch }) {
  return <section aria-labelledby="fk-machines">
    <h4 id="fk-machines">Machines <small>(demo values)</small></h4>
    <ul className="fk-machines">{school.machines.map(m => {
      const online = machineOnline(dispatch, m.id, school);
      return <li key={m.id}>
        <b>{m.name}</b>{' '}
        <span className={`fk-status ${online ? 'fk-online' : 'fk-offline'}`}><span aria-hidden="true">{online ? '● ' : '○ '}</span>{online ? 'Online' : 'Offline'}</span>
        <span className="fk-muted">{m.pagesPerHour} pages per hour (demo value){m.queue?.length ? `, ${m.queue.reduce((n, q) => n + q.pages, 0)} pages of other classes' work already waiting` : ''}</span>
      </li>;
    })}</ul>
  </section>;
}

function DemoControls({ school, dispatch, replay, busy, onEvent, actions, onPlayRecorded, lastUpdate, error }) {
  const tactile = school.machines.filter(m => SHORT_NAMES[m.kind]);
  const off = replay;
  return <section className="fk-demo" aria-labelledby="fk-demo-title">
    <h4 id="fk-demo-title">Demo controls</h4>
    <p className="fk-muted">For the team, to show a live replan. {replay ? 'Off in replay: nothing is sent to the server.' : 'Each tap goes to Fika, which replans for real.'}</p>
    <div className="fk-demo-buttons">
      {tactile.map(m => {
        const online = machineOnline(dispatch, m.id, school);
        return <button key={m.id} type="button" className="th-button th-button-outline" disabled={off || busy}
          onClick={() => onEvent(online ? 'machine-offline' : 'machine-online', m.id)}>
          {online ? `Take ${SHORT_NAMES[m.kind]} offline` : `Bring ${SHORT_NAMES[m.kind]} online`}
        </button>;
      })}
      <button type="button" className="th-button th-button-outline" disabled={off || busy} onClick={() => onEvent('urgent')}>Urgent pack</button>
      <button type="button" className="th-button th-button-outline" disabled={off || busy} onClick={() => onEvent('tick')}>Advance clock 1 hour</button>
    </div>
    {replay && actions.length > 0 && <button type="button" className="th-button" onClick={onPlayRecorded}>
      Play the recorded event: {actionText(actions[0], school)} ({actions.length} left)
    </button>}
    {busy && <p className="fk-muted" role="status">Fika is replanning…</p>}
    {lastUpdate && !busy && <p className="fk-last"><b>Last update:</b> {lastUpdate}</p>}
    {error && <p className="th-error" role="alert">{error}</p>}
  </section>;
}

function FikaChips({ log, status }) {
  const states = fikaAgentStates(log, status);
  return <ol className="th-pipeline" aria-label="Fika's agents">
    {FIKA_AGENTS.map((agent, i) => {
      const [icon, label] = STATE_LABELS[states[agent]];
      return <li key={agent} className="th-stage">
        <span className={`th-chip th-chip-${states[agent]}`}>
          <span className="th-chip-icon" aria-hidden="true">{icon}</span>
          <span className="th-chip-name">{agent}</span>
          <span className="th-chip-state">{label}</span>
        </span>
        {i < FIKA_AGENTS.length - 1 && <span className="th-arrow" aria-hidden="true">→</span>}
      </li>;
    })}
  </ol>;
}

const machineName = (id, school = DEMO_SCHOOL) => school.machines.find(m => m.id === id)?.name || id || 'machine';
function eventText(kind, machineId) {
  if (kind === 'machine-offline' || kind === 'machine-online') return `${machineName(machineId)} ${KIND_WORDS[kind]}`;
  return KIND_WORDS[kind] || kind;
}
function actionText(action, school) {
  if (action.kind === 'machine-offline') return `take the ${machineName(action.machineId, school)} offline`;
  if (action.kind === 'machine-online') return `bring the ${machineName(action.machineId, school)} online`;
  return { urgent: 'urgent pack', tick: 'advance the clock' }[action.kind] || action.kind;
}
function readyText(dispatch) {
  const jobs = dispatch?.jobs || [];
  const done = jobs.filter(j => j.status === 'ready' || j.status === 'delivered').length;
  const late = jobs.filter(j => j.status === 'late').length;
  return `Delivery board: ${done} of ${jobs.length} items ready or delivered${late ? `, ${late} late` : ''}.`;
}
const friendlyError = error => (error instanceof TypeError ? 'The connection to Fika dropped. Check the network.' : error.message);
