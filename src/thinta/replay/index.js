// Replay fixtures. A real recorded run (recorded-*.json) wins; the contract example is the labelled fallback.
import { EXAMPLE_PARABOLA_JOB } from '../contract.js';

const recorded = import.meta.glob('./recorded-*.json');

// Returns {recording, label, isExample}. Never touches the network.
export async function loadReplay() {
  const key = Object.keys(recorded).sort().find(path => path.includes('parabola')) || Object.keys(recorded).sort()[0];
  if (key) {
    try {
      const module = await recorded[key]();
      return { recording: module.default ?? module, label: `Recorded run (${key.replace('./', '')})`, isExample: false };
    } catch { /* fall through to the example */ }
  }
  return { recording: EXAMPLE_PARABOLA_JOB, label: 'Example data from the contract, not a recorded run', isExample: true };
}
