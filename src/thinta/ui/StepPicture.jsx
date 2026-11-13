// A small drawn graph for one Deaf solution step: the curve, with only the points and stretch that step talks about
// highlighted and labelled. Drawn from the proof's own numbers, never from the photo.
import React from 'react';
import { stepFocus, focusWords } from './highlights.js';
import { formatNumber } from './format.js';

// Extra room underneath, so a label can sit below the lowest point without touching the edge.
const W = 320, H = 210, PAD = 24, PAD_BOTTOM = 42;
const SHAPES = { root: 'circle', 'turning-point': 'square', 'y-intercept': 'triangle' };

function Marker({ kind, x, y }) {
  if (SHAPES[kind] === 'square') return <rect x={x - 7} y={y - 7} width="14" height="14" className="th-pic-point" />;
  if (SHAPES[kind] === 'triangle') return <path d={`M${x} ${y - 9}L${x + 8} ${y + 6}H${x - 8}Z`} className="th-pic-point" />;
  return <circle cx={x} cy={y} r="7" className="th-pic-point" />;
}

export default function StepPicture({ step, proof }) {
  const focus = stepFocus(step, proof);
  if (!focus) return null;
  const samples = proof.samples;
  const [x0, x1] = proof.domain || [samples[0].x, samples[samples.length - 1].x];
  const ys = samples.map(p => p.y);
  const y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys);
  const sx = x => PAD + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * PAD);
  const sy = y => H - PAD_BOTTOM - ((y - y0) / (y1 - y0 || 1)) * (H - PAD - PAD_BOTTOM);
  const path = list => list.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join('');
  const inside = focus.region ? samples.filter(p => p.x >= focus.region.from - 1e-9 && p.x <= focus.region.to + 1e-9) : [];
  const axisY = sy(0), axisX = sx(0);
  // Labels sit above roots, below the turning point and beside the y-intercept, so they don't cover the curve.
  // A minimum's label goes underneath it, a maximum's above it.
  const below = p => (proof.coefficients?.a ?? 1) > 0 || p.kind !== 'turning-point';
  const labelAt = p => p.kind === 'root' ? { x: sx(p.x), y: axisY - 14, anchor: 'middle' }
    : p.kind === 'turning-point' ? { x: sx(p.x), y: below(p) ? sy(p.y) + 28 : sy(p.y) - 16, anchor: 'middle' }
    : { x: sx(p.x) - 12, y: sy(p.y) + 5, anchor: 'end' };
  return <figure className="th-pic">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={focusWords(focus)}>
      {x0 <= 0 && x1 >= 0 && <line x1={axisX} y1={PAD - 8} x2={axisX} y2={H - PAD_BOTTOM + 8} className="th-pic-axis" />}
      <line x1={PAD - 8} y1={axisY} x2={W - PAD + 8} y2={axisY} className="th-pic-axis" />
      <text x={W - PAD + 4} y={axisY - 8} className="th-pic-axis-name">x</text>
      {x0 <= 0 && x1 >= 0 && <text x={axisX + 8} y={PAD} className="th-pic-axis-name">y</text>}
      <path d={path(samples)} className={`th-pic-curve${focus.points.length || focus.region ? ' th-pic-curve-quiet' : ''}`} />
      {inside.length > 1 && <>
        <path d={path(inside)} className="th-pic-region" />
        <text x={sx((focus.region.from + focus.region.to) / 2)} y={Math.min(H - 6, axisY + 24)} textAnchor="middle" className="th-pic-label th-pic-region-label">{focus.region.words}</text>
      </>}
      {focus.points.map(p => <g key={p.key}>
        <Marker kind={p.kind} x={sx(p.x)} y={sy(p.y)} />
        {(() => { const at = labelAt(p); return <text x={at.x} y={at.y} textAnchor={at.anchor} className="th-pic-label">{p.label.replace(/-/g, '−')}</text>; })()}
      </g>)}
      {/* The x range, at the two ends of the x-axis. */}
      <text x={PAD} y={axisY + 20} textAnchor="middle" className="th-pic-axis-name">{formatNumber(x0)}</text>
      <text x={W - PAD} y={axisY + 20} textAnchor="middle" className="th-pic-axis-name">{formatNumber(x1)}</text>
    </svg>
  </figure>;
}
