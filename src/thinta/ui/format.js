// Display helpers: real minus signs, (x, y) points and readable values for the trace.
const MINUS = '−';

export function formatNumber(n) {
  if (!Number.isFinite(n)) return String(n);
  const rounded = Math.round(n * 100) / 100;
  const text = String(Object.is(rounded, -0) ? 0 : rounded);
  return text.startsWith('-') ? MINUS + text.slice(1) : text;
}

export const formatPoint = p => `(${formatNumber(p.x)}, ${formatNumber(p.y)})`;

// Hyphen-minus before a digit or variable becomes a real minus sign; "x^2" becomes "x²".
export function prettyMaths(text) {
  return String(text)
    .replace(/\^2\b/g, '²').replace(/\^3\b/g, '³')
    .replace(/(^|[\s(=,<>])-(?=[\d.a-z(])/gi, `$1${MINUS}`)
    .replace(/(\S) - (?=\S)/g, `$1 ${MINUS} `); // no-break spaces keep "− 8" together
}

const isPoint = v => v && typeof v === 'object' && Number.isFinite(v.x) && Number.isFinite(v.y);

export function formatValue(value) {
  if (value == null) return '—';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string') return prettyMaths(value);
  if (isPoint(value)) return formatPoint(value);
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  if (typeof value === 'object') return Object.entries(value).map(([k, v]) => `${fieldLabel(k)} ${formatValue(v)}`).join('; ');
  return String(value);
}

// Short human name for a correction field such as "reading.turningPoint".
export function fieldLabel(field) {
  const last = String(field || '').split('.').pop();
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}
