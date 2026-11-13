// Replay fixtures. A real recorded run (recorded-*.json) wins; the contract example is the labelled fallback.
import { EXAMPLE_PARABOLA_JOB } from '../contract.js';

const recorded = import.meta.glob('./recorded-*.json');

// Returns {recording, label, isExample}. Never touches the network.
export async function loadReplay() {
  const key = Object.keys(recorded).sort().find(path => path.includes('parabola')) || Object.keys(recorded).sort()[0];
  if (key) {
    try {
      const module = await recorded[key]();
      const recording = module.default ?? module;
      const when = recording.recordedAt ? new Date(recording.recordedAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : '';
      return { recording, label: `Recorded live run${when ? ` from ${when}` : ''}${recording.source ? `, ${recording.source}` : ''}`, isExample: false };
    } catch { /* fall through to the example */ }
  }
  return { recording: EXAMPLE_PARABOLA_JOB, label: 'Example data from the contract, not a recorded run', isExample: true };
}
