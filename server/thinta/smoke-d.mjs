// Live smoke test for the Explainer and Reviewer against the example parabola proof. Needs GEMINI_API_KEY
// (from the environment or .env.local). Shows a real "thin description fails, rewrite, re-test" loop.
// Run: node server/thinta/smoke-d.mjs
import { readFileSync } from 'node:fs';
import { explain } from './explainer.mjs';
import { accessTest, meaningCheck, feedbackFrom, deafText } from './reviewer.mjs';
import { EXAMPLE_PARABOLA_JOB, DEFAULT_QUESTIONS } from '../../src/thinta/contract.js';

let apiKey = process.env.GEMINI_API_KEY;
try { apiKey ||= readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').match(/^GEMINI_API_KEY\s*=\s*"?([^"\r\n]+)/m)?.[1]; } catch {}
if (!apiKey) { console.log('No GEMINI_API_KEY; skipping the live smoke test.'); process.exit(0); }

const { proof, reading } = EXAMPLE_PARABOLA_JOB;
const questions = DEFAULT_QUESTIONS;
const time = async (label, run) => { const t = Date.now(); const out = await run(); console.log(`${label} (${Date.now() - t} ms)`); return out; };
const show = review => `${review.score}/${review.total} ${review.pass ? 'PASS' : 'FAIL'}${review.failed.length ? ` missed: ${review.failed.map(f => `${f.question} -> "${f.got}"`).join(' | ')}` : ''}`;

// 1. A deliberately thin description, then a rewrite driven by its failures.
const thin = 'A U-shaped curve. It crosses the x-axis at x equals negative 2 and at x equals 4.';
const thinReview = await time('access test, thin description', () => accessTest({ version: 'audio', text: thin, proof, questions, apiKey }));
console.log('  thin:', show(thinReview));
const rewrite = await time('explain with feedback', () => explain({ proof, reading, feedback: feedbackFrom(thinReview), apiKey }));
console.log('  rewritten:', rewrite.description.en);
console.log('  meaning:', JSON.stringify(rewrite.meaning));
const after = await time('access test, rewrite', () => accessTest({ version: 'audio', text: rewrite.description.en, proof, questions, apiKey }));
console.log(`  loop: ${thinReview.score}/5 -> ${after.score}/5`, show(after));

// 2. The Deaf solution from the same call, tested on its own.
console.log('  deaf steps:', rewrite.deafSolution.steps.map(s => s.text).join(' / '), rewrite.deafSolution.keyTerms);
const deaf = await time('access test, Deaf solution', () => accessTest({ version: 'deaf', text: deafText(rewrite.deafSolution), proof, questions, apiKey }));
console.log('  deaf:', show(deaf), 'meaning:', meaningCheck(deafText(rewrite.deafSolution), proof).pass);
