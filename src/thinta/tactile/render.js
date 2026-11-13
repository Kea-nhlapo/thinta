// Layout to print-ready SVG, 1 user unit = 1 mm. Only absolute <line>, <polyline>, <polygon>, <rect>,
// <circle> and <text> (no transforms, no patterns) so svgToPdf can redraw it without a full SVG parser.
// Braille is drawn as real dots at standard spacing, not a font, so it embosses and rasterises the same.
import { brailleDots, brailleWidth, BRAILLE } from './braille.js';
import { STROKES } from './layout.js';

const f = v => +v.toFixed(2);
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FONT = 'Arial, Helvetica, sans-serif';
const line = ([a, b], w, cls) => `<line class="${cls}" x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="#000" stroke-width="${w}" stroke-linecap="round"/>`;

function marker(m) {
  const attrs = `class="key-point" data-kind="${m.kind}" data-x="${m.value.x}" data-y="${m.value.y}" data-key="${m.key}" data-name="${m.name}"`;
  let shape;
  if (m.shape === 'square') shape = `<rect x="${f(m.x - 1.8)}" y="${f(m.y - 1.8)}" width="3.6" height="3.6" fill="#000"/>`;
  else if (m.shape === 'triangle') shape = `<polygon points="${f(m.x)},${f(m.y - 2.4)} ${f(m.x + 2.2)},${f(m.y + 1.6)} ${f(m.x - 2.2)},${f(m.y + 1.6)}" fill="#000"/>`;
  else shape = `<circle cx="${f(m.x)}" cy="${f(m.y)}" r="${m.r}" fill="#000"/>`;
  return `<g ${attrs}><title>${esc(`${m.key}: ${m.kind} (${m.value.x}, ${m.value.y})`)}</title>${shape}</g>`;
}

function label(l) {
  const parts = [];
  const bw = brailleWidth(l.braille);
  let textX = l.x, textY = l.y + l.printSize * 0.95;
  if (l.braille) {
    const by = l.mode === 'row' ? l.y + (l.h - BRAILLE.cellH) / 2 : l.y;
    for (const d of brailleDots(l.braille, l.x, by)) parts.push(`<circle cx="${f(d.x)}" cy="${f(d.y)}" r="${BRAILLE.dotR}" fill="#000"/>`);
    if (l.mode === 'row') { textX = l.x + bw + 2; textY = l.y + l.h / 2 + l.printSize * 0.35; } else textY = l.y + BRAILLE.cellH + 1.5 + l.printSize * 0.95;
  }
  if (l.print) parts.push(`<text x="${f(textX)}" y="${f(textY)}" font-family="${FONT}" font-size="${l.printSize}" fill="#000">${esc(l.print)}</text>`);
  return `<g class="label" data-name="${esc(l.name)}" data-role="${l.role}" data-braille="${esc(l.braille)}" data-print="${esc(l.print)}">${parts.join('')}</g>`;
}

function bar(b) {
  const r = b.rect;
  const tex = [...b.texture.lines.map(s => line(s, STROKES.texture, 'texture')), ...b.texture.dots.map(d => `<circle cx="${f(d.x)}" cy="${f(d.y)}" r="0.7" fill="#000"/>`)];
  return `<g class="bar" data-kind="bar" data-x="${b.index}" data-y="${b.value}" data-label="${esc(b.label)}" data-texture="${b.texture.kind}">${tex.join('')}<rect x="${f(r.x)}" y="${f(r.y)}" width="${f(r.w)}" height="${f(r.h)}" fill="none" stroke="#000" stroke-width="${STROKES.bar}"/></g>`;
}

export function renderSvg(layout) {
  const { page, plot } = layout;
  const plotAttrs = Object.entries(plot).map(([k, v]) => `data-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${f(v)}"`).join(' ');
  const data = layout.kind === 'function'
    ? `<polyline id="curve" class="curve" data-kind="curve" points="${layout.dataLines[0].map(p => `${f(p.x)},${f(p.y)}`).join(' ')}" fill="none" stroke="#000" stroke-width="${layout.strokes.data}" stroke-linejoin="round" stroke-linecap="round"/>`
    : layout.bars.map(bar).join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.w}mm" height="${page.h}mm" viewBox="0 0 ${page.w} ${page.h}" role="img" aria-labelledby="thinta-title thinta-desc" data-thinta="tactile-v1" data-type="${layout.kind}" data-units="mm">`,
    `<title id="thinta-title">${esc(layout.title)}</title>`,
    `<desc id="thinta-desc">${esc(layout.desc)}</desc>`,
    `<rect class="paper" x="0" y="0" width="${page.w}" height="${page.h}" fill="#fff"/>`,
    `<g id="plot" ${plotAttrs}>`,
    `<g id="axes">${layout.axes.map(s => line(s, layout.strokes.axis, 'axis')).join('')}${(layout.ticks || []).map(t => line(t.seg, STROKES.tick, 'tick')).join('')}</g>`,
    `<g id="data">${data}</g>`,
    `<g id="key-points">${layout.markers.map(marker).join('')}</g>`,
    '</g>',
    `<g id="labels">${layout.labels.map(label).join('')}</g>`,
    '</svg>',
  ].join('\n');
}
