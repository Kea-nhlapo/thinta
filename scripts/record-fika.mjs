// Records a real Fika run for Replay: approve → embosser offline → swell heater offline → embosser back → clock on 2 hours.
// Runs through the same route handler as the app and saves it where the Delivery tab's Replay looks for it.
//   node scripts/record-fika.mjs            (uses GEMINI_API_KEY from .env.local: about 6–10 Gemini calls)
//   node scripts/record-fika.mjs --no-ai    (template summaries, no Gemini calls)
//   node scripts/record-fika.mjs --out <file>
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleThinta } from '../server/thinta.mjs';

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : new URL('../src/thinta/fika/replay/recorded-fika.json', import.meta.url);
const env = {};
if (!args.includes('--no-ai') && existsSync('.env.local'))
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = line.match(/^(GEMINI_API_KEY|HF_TOKEN)=(.+)$/); if (m) env[m[1]] = m[2].trim(); }

const graphJobId = `fika-recording-${Date.now().toString(36)}`;
const post = (path, body) => handleThinta(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);

const started = Date.now();
const events = [];
let buffer = '';
const response = await post('/api/thinta/dispatch', { graphJobId, schoolId: 'demo-school', approved: true });
if (!response.ok) { console.error('Dispatch failed:', response.status, await response.text()); process.exit(1); }
for await (const chunk of response.body) {
  buffer += new TextDecoder().decode(chunk);
  for (let i; (i = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(i + 1)) {
    const line = buffer.slice(0, i).trim();
    if (!line) continue;
    const event = JSON.parse(line);
    events.push({ t: Date.now() - started, event });
    if (event.type === 'trace') console.log(`${event.entry.agent}: ${event.entry.message}`);
    if (event.type === 'error') { console.error('ERROR', event.message); process.exit(1); }
  }
}
let dispatch = events.at(-1).event.dispatch;

const actions = [];
for (const [kind, machineId] of [['machine-offline', 'embosser-1'], ['machine-offline', 'swell-1'], ['machine-online', 'embosser-1'], ['tick'], ['tick']]) {
  const reply = await post('/api/thinta/dispatch/event', { graphJobId, kind, machineId, dispatch });
  if (!reply.ok) { console.error(`${kind} failed:`, reply.status, await reply.text()); process.exit(1); }
  const result = await reply.json();
  dispatch = result.dispatch;
  actions.push({ kind, ...(machineId ? { machineId } : {}), result });
  console.log(`\n${kind}${machineId ? ` ${machineId}` : ''}: ${result.corrections.length} changes`);
  result.trace.forEach(t => console.log(`  ${t.agent}: ${t.message}`));
}

mkdirSync(dirname(out instanceof URL ? fileURLToPath(out) : out), { recursive: true });
writeFileSync(out, JSON.stringify({ recordedAt: new Date().toISOString(), source: env.GEMINI_API_KEY ? 'live run, Gemini summaries' : 'live run, template summaries', events, actions }, null, 1));
console.log(`\nSaved ${out instanceof URL ? out.pathname : out}`);
