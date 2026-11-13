// Go/no-go smoke test for sub-agent A, against real Gemini. Never prints the key.
//   node server/thinta/smoke-a.mjs [photo.jpg|png] ["y = x^2 - 2x - 8"]
// With no photo it renders a test parabola (with the equation written beside it) to PNG and reads that.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGraph } from './reader.mjs';
import { prove } from './prover.mjs';
import { freshEyes, rasteriseSvg } from './fresh-eyes.mjs';

for (const file of ['.env.local', '.env']) if (existsSync(file))
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.log('blocked: no GEMINI_API_KEY in the environment or .env.local'); process.exit(2); }

const [photo, hint = 'y = x^2 - 2x - 8'] = process.argv.slice(2);

// A rough, slightly off hand-style parabola so the Reader has to read the drawing, not a perfect plot.
function testParabolaSvg() {
  const X = x => 60 + (x + 4) * 50, Y = y => 60 + (16 - y) * 22;
  const pts = []; for (let x = -3.8; x <= 5.8; x += 0.2) pts.push(`${X(x).toFixed(1)},${Y(x * x - 2 * x - 8 + 0.3 * Math.sin(x * 2)).toFixed(1)}`);
  const ticks = [...Array(11)].map((_, i) => i - 4).map(x => `<line x1="${X(x)}" y1="${Y(0) - 5}" x2="${X(x)}" y2="${Y(0) + 5}" stroke="#333"/><text x="${X(x) - 5}" y="${Y(0) + 22}" font-size="16">${x}</text>`).join('');
  const yt = [-10, -8, -6, -4, -2, 2, 4, 6, 8, 10, 12, 14, 16].map(y => `<line x1="${X(0) - 5}" y1="${Y(y)}" x2="${X(0) + 5}" y2="${Y(y)}" stroke="#333"/><text x="${X(0) - 34}" y="${Y(y) + 5}" font-size="14">${y}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="700"><rect width="700" height="700" fill="#fdfaf0"/>
<line x1="40" y1="${Y(0)}" x2="640" y2="${Y(0)}" stroke="#333" stroke-width="2"/><line x1="${X(0)}" y1="40" x2="${X(0)}" y2="660" stroke="#333" stroke-width="2"/>${ticks}${yt}
<polyline points="${pts.join(' ')}" fill="none" stroke="#1a3a9a" stroke-width="3"/>
<text x="420" y="120" font-size="28" font-family="Comic Sans MS, cursive" fill="#1a3a9a">y = x² − 2x − 8</text></svg>`;
}

let imageBase64, mimeType;
if (photo) { imageBase64 = readFileSync(photo).toString('base64'); mimeType = /\.png$/i.test(photo) ? 'image/png' : 'image/jpeg'; }
else {
  imageBase64 = await rasteriseSvg(testParabolaSvg()); mimeType = 'image/png';
  if (!imageBase64) { console.log('no photo given and rasterising failed; pass a photo path'); process.exit(2); }
  const out = join(tmpdir(), 'smoke-a-test-parabola.png');
  writeFileSync(out, Buffer.from(imageBase64, 'base64')); console.log(`Test image: ${out}`);
}

// Returns an exit code instead of calling process.exit, which trips a libuv assertion on Windows with fetch timers open.
async function main() {
  let t = Date.now();
  const reading = await readGraph({ imageBase64, mimeType, equationHint: hint, apiKey }).catch(error => console.log(`Reader failed: ${error.message}`));
  if (!reading) return 1;
  console.log(`\nReader (${Date.now() - t} ms):`, JSON.stringify(reading, null, 1));
  const { proof, corrections } = prove(reading, { equationHint: hint });
  console.log('\nProver:', JSON.stringify({ roots: proof.roots, turningPoint: proof.turningPoint, yIntercept: proof.yIntercept, domain: proof.domain }));
  console.log('Corrections:', JSON.stringify(corrections, null, 1));

  let svg;
  try { svg = (await import('../../src/thinta/tactile/index.js')).designTactile(proof).svg; }
  catch (error) { console.log(`\n(tactile designer not loadable: ${error.message}; skipping fresh eyes)`); return 0; }
  t = Date.now();
  const fresh = await freshEyes({ svg, proof, apiKey }).catch(error => console.log(`Fresh eyes failed: ${error.message}`));
  if (!fresh) return 1;
  console.log(`\nFresh eyes (${Date.now() - t} ms):`, JSON.stringify({ reading: { ...fresh.reading, geometry: undefined }, review: fresh.review, feedback: fresh.feedback }, null, 1));
  return 0;
}
process.exitCode = await main();
