// The live agent trace: pipeline chips that light up, then a readable log with strike-through corrections.
import React from 'react';
import { PIPELINE, agentStates } from './job.js';
import { formatValue, fieldLabel, prettyMaths } from './format.js';
import { headlines, groupLog, tidyMessage } from './highlights.js';

// Icon + words for every state, so nothing depends on colour.
export const STATE_LABELS = {
  waiting: ['○', 'Waiting'], working: ['◐', 'Working'], done: ['✓', 'Done'],
  retry: ['↻', 'Retrying'], failed: ['✕', 'Failed'], skipped: ['–', 'Not run'],
};

// A compact two-column grid in pipeline order: one line per agent, state shown by icon, word and border.
export function PipelineChips({ job, status }) {
  const states = agentStates(job, status);
  return <ol className="th-pipeline th-pipeline-grid" aria-label="Agent team, in order">
    {PIPELINE.flat().map(agent => {
      const [icon, label] = STATE_LABELS[states[agent]];
      return <li key={agent} className={`th-chip th-chip-${states[agent]}`}>
        <span className="th-chip-icon" aria-hidden="true">{icon}</span>
        <span className="th-chip-name">{agent}</span>
        <span className="th-chip-state">{label}</span>
      </li>;
    })}
  </ol>;
}

const TRACE_ICON = { start: ['◐', 'started'], done: ['✓', 'done'], fail: ['✕', 'failed'], retry: ['↻', 'retrying'] };

export function Correction({ item }) {
  return <p className="th-correction">
    <b>{item.agent} corrected the {fieldLabel(item.field)}:</b>{' '}
    <span className="th-sr">was</span> <del>{formatValue(item.before)}</del>{' '}
    <span aria-hidden="true">→</span> <span className="th-sr">now</span> <ins>{formatValue(item.after)}</ins>
    {item.reason && <span className="th-reason">Why: {prettyMaths(item.reason)}</span>}
  </p>;
}

// "3/5 → 5/5" when a retry changed the score, else the score itself.
export function reviewScore(review) {
  if (review.before != null && review.after != null) return `${formatValue(review.before)} → ${formatValue(review.after)}`;
  if (Number.isFinite(review.score) && Number.isFinite(review.total)) return `${review.score}/${review.total}`;
  return '';
}

export function Review({ item }) {
  const score = reviewScore(item);
  return <p className={`th-review ${item.pass ? 'th-pass' : 'th-fail'}`}>
    <b><span aria-hidden="true">{item.pass ? '✓ ' : '✕ '}</span>{item.pass ? 'Passed' : 'Failed'}: {checkName(item.check)}</b>
    {score && <span className="th-score"> {score}</span>}
    {item.attempt > 1 && <span> (attempt {item.attempt})</span>}
    {item.reason && <span className="th-reason">{prettyMaths(item.reason)}</span>}
  </p>;
}

const CHECK_NAMES = { 'reader-vs-prover': 'Reader vs Prover', 'fresh-eyes': 'Fresh eyes re-read', 'access-audio': 'Access test, audio description', 'access-deaf': 'Access test, Deaf solution', 'meaning': 'Meaning check', 'label-gap': 'Label spacing' };
export const checkName = check => CHECK_NAMES[check] || String(check || 'Check').replace(/-/g, ' ');

function TraceLine({ item }) {
  return <p>
    <span className="th-log-icon" aria-hidden="true">{TRACE_ICON[item.status]?.[0] || '•'}</span>
    <b>{item.agent}</b> <span className="th-sr">{TRACE_ICON[item.status]?.[1]}</span> {prettyMaths(tidyMessage(item.message))}
  </p>;
}

// "tactile.labels.tickX_6" → "the x = 6 tick", "root2" → "a root".
const labelName = field => {
  const name = String(field).split('.').pop();
  const tick = name.match(/^tick([XY])_(-?[\d.]+)$/);
  return tick ? `the ${tick[1].toLowerCase()} = ${formatValue(+tick[2])} tick` : /^root\d*$/.test(name) ? 'a root' : `the ${fieldLabel(name)}`;
};

// Many small label nudges read as one line, with the detail one tap away.
function LabelMoves({ items }) {
  const count = new Set(items.map(c => c.field)).size;
  const names = [...new Set(items.map(c => labelName(c.field)))].map(n => (n === 'a root' && items.filter(c => /root\d*$/.test(c.field)).length > 1 ? 'the roots' : n));
  return <details className="th-moves">
    <summary><b>Designer</b> moved {count} label{count === 1 ? '' : 's'} clear of the curve: {names.join(', ')}</summary>
    <ul className="th-plain">{items.map((c, i) => <li key={i}><Correction item={c} /></li>)}</ul>
  </details>;
}

export function TraceLog({ log, live = false }) {
  if (!log.length) return <p className="th-muted">No trace yet.</p>;
  return <ol className="th-log" {...(live ? { role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' } : {})}>
    {groupLog(log).map((item, i) => <li key={i} className={`th-log-${item.kind}`}>
      {item.kind === 'trace' && <TraceLine item={item} />}
      {item.kind === 'correction' && <Correction item={item} />}
      {item.kind === 'review' && <Review item={item} />}
      {item.kind === 'label-moves' && <LabelMoves items={item.items} />}
    </li>)}
  </ol>;
}

// The newest trace line, announced politely; the full log stays folded away.
export function LatestStep({ log }) {
  const last = [...log].reverse().find(item => item.kind === 'trace');
  return <div className="th-latest" role="status" aria-live="polite">
    <span className="th-latest-tag">Now</span>
    {last ? <TraceLine item={last} /> : <p>Starting the team…</p>}
  </div>;
}

const TONES = { fixed: ['↻', 'Caught and fixed'], open: ['⚠', 'Needs you'], pass: ['✓', 'Passed first time'] };

// The self-corrections a teacher (or a judge) should see first, each with its before and after.
export function Highlights({ job, title = 'What the team caught' }) {
  const lines = headlines(job);
  if (!lines.length) return null;
  const count = tone => lines.filter(l => l.tone === tone).length;
  return <section className="th-highlights" aria-labelledby="th-hl-title">
    <h3 id="th-hl-title">{title}</h3>
    <p className="th-hl-count">{[count('fixed') && `${count('fixed')} caught and fixed`, count('open') && `${count('open')} need${count('open') === 1 ? 's' : ''} you`, count('pass') && `${count('pass')} passed first time`].filter(Boolean).join(' · ')}</p>
    <ul>
      {lines.map((line, i) => <li key={i} className={`th-hl th-hl-${line.tone}`}>
        <span className="th-hl-tag"><span aria-hidden="true">{TONES[line.tone][0]} </span>{TONES[line.tone][1]}</span>
        <p className="th-hl-title">{line.title}</p>
        {line.before && line.after && <p className="th-hl-change">
          {line.what && <span className="th-hl-what">{line.what}: </span>}
          <span className="th-sr">was</span> <del>{line.before}</del> <span aria-hidden="true">→</span> <span className="th-sr">now</span> <ins>{line.after}</ins>
        </p>}
        <p className="th-hl-detail">{line.detail}</p>
      </li>)}
    </ul>
  </section>;
}
