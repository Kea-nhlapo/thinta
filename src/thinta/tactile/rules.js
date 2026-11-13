// Tactile rule checker and auto-fixer. Everything is measured from the layout geometry in mm, so a
// correction only exists when a label really sits too close to the curve, another label or the page edge.
import { LIMITS } from '../contract.js';
import { pointRectDist, rectInside, rectRectDist, segRectDist, toSegments } from './geometry.js';

export const RULES = {
  minLabelGapMm: LIMITS.minLabelGapMm, // label to curve (or bar outline), from the edge of the stroke
  minAxisGapMm: 1.5,                   // labels must not sit on an axis line, or a finger reads them as one
  minLabelSpaceMm: 1.5,                // label to label and label to marker
};

const r1 = v => Math.round(v * 10) / 10;
const rectOf = (l, at = l) => ({ x: at.x, y: at.y, w: l.w, h: l.h });
const centre = l => ({ x: r1(l.x + l.w / 2), y: r1(l.y + l.h / 2) });

const dataSegs = layout => layout.dataLines.flatMap(toSegments);
const axisSegs = layout => [...layout.axes, ...(layout.ticks || []).map(t => t.seg)];
const minDist = (segs, rect, halfStroke) => segs.reduce((m, [a, b]) => Math.min(m, segRectDist(a, b, rect) - halfStroke), Infinity);
const contentBox = ({ page }) => ({ x: page.margin, y: page.margin, w: page.w - 2 * page.margin, h: page.h - 2 * page.margin });

// Every way a label at `rect` breaks a rule, given everything else on the sheet.
export function labelProblems(layout, label, rect = rectOf(label), { ignoreOptional = false } = {}) {
  const curveGap = minDist(dataSegs(layout), rect, layout.strokes.data / 2);
  const axisGap = minDist(axisSegs(layout), rect, layout.strokes.axis / 2);
  const overlaps = [
    ...layout.labels.filter(o => o !== label && !(ignoreOptional && o.optional) && rectRectDist(rect, o) < RULES.minLabelSpaceMm).map(o => o.name),
    ...layout.markers.filter(m => pointRectDist(m, rect) - m.r < RULES.minLabelSpaceMm).map(m => `marker ${m.name}`),
  ];
  const inPage = rectInside(rect, contentBox(layout));
  return {
    curveGap, axisGap, overlaps, inPage,
    hard: curveGap >= RULES.minLabelGapMm && !overlaps.length && inPage,
    ok: curveGap >= RULES.minLabelGapMm && !overlaps.length && inPage && axisGap >= RULES.minAxisGapMm,
  };
}

const fmt = v => (Number.isFinite(v) ? `${r1(Math.max(v, 0))} mm` : 'clear');

export function checkRules(layout) {
  const per = layout.labels.map(l => [l, labelProblems(layout, l)]);
  const failing = test => per.filter(([, p]) => test(p)).map(([l]) => l.name);
  const gapFail = failing(p => p.curveGap < RULES.minLabelGapMm);
  const overlapFail = failing(p => p.overlaps.length);
  const pageFail = failing(p => !p.inPage);
  const axisFail = failing(p => p.axisGap < RULES.minAxisGapMm);
  const closest = Math.min(...per.map(([, p]) => p.curveGap));
  const { data, axis } = layout.strokes;
  return [
    { rule: 'label-gap', pass: !gapFail.length, labels: gapFail, detail: gapFail.length ? `${gapFail.join(', ')} closer than ${RULES.minLabelGapMm} mm to the ${layout.dataName}` : `All ${per.length} labels at least ${RULES.minLabelGapMm} mm from the ${layout.dataName} (closest ${fmt(closest)})` },
    { rule: 'stroke-hierarchy', pass: data > axis, detail: `${layout.dataName} ${data} mm vs axes ${axis} mm` },
    { rule: 'label-overlap', pass: !overlapFail.length, labels: overlapFail, detail: overlapFail.length ? `${overlapFail.join(', ')} overlap another label or marker` : `No labels overlap (min space ${RULES.minLabelSpaceMm} mm)` },
    { rule: 'label-in-page', pass: !pageFail.length, labels: pageFail, detail: pageFail.length ? `${pageFail.join(', ')} outside the printable area` : 'All labels inside the printable area' },
    { rule: 'label-axis-gap', pass: !axisFail.length, labels: axisFail, detail: axisFail.length ? `${axisFail.join(', ')} touch an axis line` : `All labels at least ${RULES.minAxisGapMm} mm from the axes` },
  ];
}

const SIDES = {
  right: [1, 0], left: [-1, 0], above: [0, -1], below: [0, 1],
  'upper-right': [1, -1], 'upper-left': [-1, -1], 'lower-right': [1, 1], 'lower-left': [-1, 1],
};
export const ALL_SIDES = Object.keys(SIDES);

// Top-left of a label placed on `side` of its anchor with `d` mm of clear space between them.
export function placeAt(label, side, d) {
  const [sx, sy] = SIDES[side];
  const diag = sx && sy ? 0.75 : 1;
  const cx = label.anchor.x + sx * (d * diag + label.w / 2);
  const cy = label.anchor.y + sy * (d * diag + label.h / 2);
  return { x: cx - label.w / 2, y: cy - label.h / 2, side, d };
}

// Nearest position that passes every rule; falls back to one that only touches an axis.
function search(layout, label) {
  const steps = [0, 2, 4, 7, 10, 14, 19, 25];
  let fallback = null;
  for (const step of steps) {
    for (const side of label.sides || ALL_SIDES) {
      const at = placeAt(label, side, label.pad + step);
      // Key labels may claim space held by optional scale labels; those move or drop afterwards.
      const p = labelProblems(layout, label, rectOf(label, at), { ignoreOptional: !label.optional });
      if (p.ok) return { at, p };
      if (p.hard && !fallback) fallback = { at, p };
    }
  }
  return fallback;
}

function describe(p, dataName = 'curve') {
  const why = [];
  if (p.curveGap < RULES.minLabelGapMm) why.push(`${fmt(p.curveGap)} from the ${dataName} (needs ${RULES.minLabelGapMm} mm)`);
  if (p.overlaps.length) why.push(`overlapped ${p.overlaps.join(', ')}`);
  if (!p.inPage) why.push('ran off the printable area');
  if (p.axisGap < RULES.minAxisGapMm) why.push(`${fmt(p.axisGap)} from an axis line`);
  return why.join('; ');
}

const clone = layout => ({ ...layout, labels: layout.labels.map(l => ({ ...l })), ticks: (layout.ticks || []).slice() });

// Move every failing label to its nearest legal spot, re-checking against the labels already placed.
export function autoFix(layout, { agent = 'Designer' } = {}) {
  const out = clone(layout);
  const corrections = [];
  const warnings = [];
  const firstSeen = new Map();
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const label of out.labels) {
      if (label.fixed) continue;
      const p = labelProblems(out, label);
      if (p.ok) continue;
      const found = search(out, label);
      if (!found || (found.at.x === label.x && found.at.y === label.y)) continue;
      if (!firstSeen.has(label.name)) firstSeen.set(label.name, { before: centre(label), why: describe(p, out.dataName) });
      Object.assign(label, { x: found.at.x, y: found.at.y, side: found.at.side });
      moved = true;
    }
    if (!moved) break;
  }
  for (const [name, { before, why }] of firstSeen) {
    const label = out.labels.find(l => l.name === name);
    const now = labelProblems(out, label);
    corrections.push({ agent, field: `tactile.labels.${name}`, before, after: centre(label), reason: `Label ${why}; moved ${label.side}, now ${fmt(now.curveGap)} from the ${out.dataName}` });
  }
  // Optional labels (scale ticks) that still break a rule are dropped with their tick, never left touching.
  for (const label of out.labels.slice()) {
    const p = labelProblems(out, label);
    if (p.ok) continue;
    if (label.optional) {
      out.labels = out.labels.filter(l => l !== label);
      out.ticks = out.ticks.filter(t => t.name !== label.name);
      warnings.push(`Dropped scale label ${label.name}: ${describe(p, out.dataName)}`);
    } else if (!p.hard) {
      warnings.push(`Could not place ${label.name}: ${describe(p, out.dataName)}`);
    }
  }
  return { layout: out, corrections, warnings };
}
