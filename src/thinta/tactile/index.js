// Thinta Tactile Designer. Shared by the server pipeline and the browser: no DOM or Node-only APIs.
import { barLayout, functionLayout } from './layout.js';
import { autoFix, checkRules } from './rules.js';
import { renderSvg } from './render.js';

export { toBraille, cellDots, brailleDots, BRAILLE } from './braille.js';
export { checkRules, autoFix, labelProblems, RULES } from './rules.js';
export { functionLayout, barLayout, PAGE, BETA_NOTE } from './layout.js';
export { renderSvg } from './render.js';
export { svgToPdf, svgToPdfDataUrl } from './pdf.js';

const typeOf = proof => (proof?.bars?.length ? 'bar' : 'function');

// proof -> {svg, warnings, ruleChecks, corrections}. Labels start at their natural spot; the rule checker
// moves any that break a rule and every move becomes a Designer correction.
export function designTactile(proof, { type = typeOf(proof), title, yLabel, emphasize = [] } = {}) {
  if (!proof) throw new Error('designTactile needs a proof');
  const draft = type === 'bar' ? barLayout(proof, { title, yLabel, emphasize }) : functionLayout(proof, { title, emphasize });
  const initialChecks = checkRules(draft);
  const { layout, corrections, warnings } = autoFix(draft);
  const ruleChecks = checkRules(layout);
  const fixedRules = initialChecks.filter(c => !c.pass).map(c => c.rule);
  if (fixedRules.length) ruleChecks.forEach(c => { if (fixedRules.includes(c.rule) && c.pass) c.detail += ' (after auto-fix)'; });
  return { svg: renderSvg(layout), warnings: [...draft.warnings, ...warnings], ruleChecks, corrections, layout, initialChecks, options: { type, title, yLabel, emphasize } };
}

const FEEDBACK_KEYS = ['roots', 'turningPoint', 'yIntercept', 'bars'];

// Fresh-eyes feedback ({missing:[...], unclear:[...]}) -> regenerated tactile with those labels made
// larger and explicit (coordinates in braille at the point, kind and coordinates in larger print), then re-checked.
export function fixTactile(proof, tactile = {}, feedback = {}) {
  const asked = [...new Set([...(feedback.missing || []), ...(feedback.unclear || [])])];
  const prev = tactile.options || {};
  const emphasize = [...new Set([...(prev.emphasize || []), ...asked.filter(k => FEEDBACK_KEYS.includes(k))])];
  const next = designTactile(proof, { ...prev, type: prev.type || typeOf(proof), emphasize });
  const unknown = asked.filter(k => !FEEDBACK_KEYS.includes(k));
  if (unknown.length) next.warnings.push(`No tactile label for feedback item(s): ${unknown.join(', ')}`);
  const before = new Map((tactile.layout?.labels || []).map(l => [l.name, l]));
  const fresh = asked.filter(k => FEEDBACK_KEYS.includes(k)).flatMap(k => next.layout.labels.filter(l => l.role !== 'key' && labelGroup(l.name) === k));
  const emph = fresh.map(l => ({
    agent: 'Designer', field: `tactile.labels.${l.name}`,
    before: before.has(l.name) ? { braille: before.get(l.name).braille, print: before.get(l.name).print, printSize: before.get(l.name).printSize } : null,
    after: { braille: l.braille, print: l.print, printSize: l.printSize },
    reason: `Fresh eyes reported ${l.name} ${(feedback.missing || []).includes(labelGroup(l.name)) ? 'missing' : 'unclear'}; label made larger with full coordinates`,
  }));
  return { ...next, corrections: [...emph, ...next.corrections] };
}

function labelGroup(name) {
  if (/^root\d/.test(name)) return 'roots';
  if (/^(value|category)\d/.test(name)) return 'bars';
  return name;
}

// Browser-safe data URL for downloads and <img> previews.
export const svgToDataUrl = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
