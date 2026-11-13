// Minimal vector PDF writer for Thinta's own SVG (A4 landscape, 10 mm margins). No dependencies: it reads
// back only the absolute primitives render.js emits, so braille dots stay true-size circles.

const PT = 72 / 25.4;
const A4 = { w: 297, h: 210 };
const n = v => (+v).toFixed(3).replace(/\.?0+$/, '') || '0';
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const pts = s => s.trim().split(/\s+/).map(p => p.split(',').map(Number));

// Helvetica WinAnsi: keep Latin-1, map typographic minus to a hyphen, drop anything else.
const pdfText = s => [...unesc(s).replace(/[−–]/g, '-')].map(c => (c.charCodeAt(0) < 256 ? c : '?')).join('').replace(/[\\()]/g, '\\$&');

function circle(cx, cy, r) {
  const k = 0.5523 * r;
  return `${n(cx + r)} ${n(cy)} m ${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c ${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} c ${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c ${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} c`;
}

// Line width is graphics state, so it is set before the path starts, never inside it.
const paint = a => {
  const fill = a.fill && a.fill !== 'none' && a.fill !== '#fff';
  const stroke = a.stroke && a.stroke !== 'none';
  return path => `${stroke ? `${n(a['stroke-width'] || 1)} w ` : ''}${path} ${fill && stroke ? 'B' : fill ? 'f' : stroke ? 'S' : 'n'}`;
};

// SVG (in mm) -> PDF content stream operators.
function content(svg) {
  const vb = (svg.match(/viewBox="([^"]+)"/)?.[1] || '0 0 277 190').split(/\s+/).map(Number);
  const ox = (A4.w - vb[2]) / 2, oy = (A4.h - vb[3]) / 2;
  // Flip y and scale mm to points once; everything after is drawn in SVG coordinates.
  const ops = [`${n(PT)} 0 0 ${n(-PT)} ${n(ox * PT)} ${n((A4.h - oy) * PT)} cm`, '1 J 1 j 0 g 0 G'];
  for (const m of svg.matchAll(/<(line|polyline|polygon|rect|circle)\b([^>]*)\/>|<text\b([^>]*)>([^<]*)<\/text>/g)) {
    if (m[3] !== undefined) {
      const a = attrs(m[3]);
      ops.push(`BT /F1 ${n(a['font-size'] || 3.5)} Tf 1 0 0 -1 ${n(a.x)} ${n(a.y)} Tm (${pdfText(m[4])}) Tj ET`);
      continue;
    }
    const a = attrs(m[2]);
    if (m[1] === 'line') ops.push(`${n(a['stroke-width'] || 1)} w ${n(a.x1)} ${n(a.y1)} m ${n(a.x2)} ${n(a.y2)} l S`);
    else if (m[1] === 'circle') ops.push(paint(a)(circle(+a.cx, +a.cy, +a.r)));
    else if (m[1] === 'rect') { if (a.class !== 'paper') ops.push(paint(a)(`${n(a.x)} ${n(a.y)} ${n(a.width)} ${n(a.height)} re`)); }
    else {
      const p = pts(a.points);
      ops.push(paint(a)(`${p.map(([x, y], i) => `${n(x)} ${n(y)} ${i ? 'l' : 'm'}`).join(' ')}${m[1] === 'polygon' ? ' h' : ''}`));
    }
  }
  return ops.join('\n');
}

// Returns the PDF as a Uint8Array (Latin-1 bytes, so string length = byte length for the xref table).
export function svgToPdf(svg) {
  const stream = content(svg);
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(A4.w * PT)} ${n(A4.h * PT)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info << /Title (Thinta tactile graph) /Producer (Thinta) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, c => c.charCodeAt(0));
}

export function svgToPdfDataUrl(svg) {
  const bytes = svgToPdf(svg);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:application/pdf;base64,${btoa(bin)}`;
}
