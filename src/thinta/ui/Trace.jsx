// The live agent trace: pipeline chips that light up, then a readable log with strike-through corrections.
import React from 'react';
import { PIPELINE, agentStates } from './job.js';
import { formatValue, fieldLabel, prettyMaths } from './format.js';

// Icon + words for every state, so nothing depends on colour.
export const STATE_LABELS = {
  waiting: ['○', 'Waiting'], working: ['◐', 'Working'], done: ['✓', 'Done'],
  retry: ['↻', 'Retrying'], failed: ['✕', 'Failed'], skipped: ['–', 'Not run'],
};

export function PipelineChips({ job, status }) {
  const states = agentStates(job, status);
  return <ol className="th-pipeline" aria-label="Agent team">
    {PIPELINE.map((group, i) => <li key={i} className="th-stage">
      {group.map(agent => {
        const [icon, label] = STATE_LABELS[states[agent]];
        return <span key={agent} className={`th-chip th-chip-${states[agent]}`}>
          <span className="th-chip-icon" aria-hidden="true">{icon}</span>
          <span className="th-chip-name">{agent}</span>
          <span className="th-chip-state">{label}</span>
        </span>;
      })}
      {i < PIPELINE.length - 1 && <span className="th-arrow" aria-hidden="true">→</span>}
    </li>)}
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

export function TraceLog({ log, live = false }) {
  if (!log.length) return <p className="th-muted">No trace yet.</p>;
  return <ol className="th-log" {...(live ? { role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' } : {})}>
    {log.map((item, i) => <li key={i} className={`th-log-${item.kind}`}>
      {item.kind === 'trace' && <p>
        <span className="th-log-icon" aria-hidden="true">{TRACE_ICON[item.status]?.[0] || '•'}</span>
        <b>{item.agent}</b> <span className="th-sr">{TRACE_ICON[item.status]?.[1]}</span> {prettyMaths(item.message || '')}
      </p>}
      {item.kind === 'correction' && <Correction item={item} />}
      {item.kind === 'review' && <Review item={item} />}
    </li>)}
  </ol>;
}
