// Dev-only page for sub-agent C: /src/thinta/sound/dev.html?job=bar shows the bar chart, otherwise the parabola.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { EXAMPLE_PARABOLA_JOB, EXAMPLE_BAR_JOB } from '../contract.js';
import TouchGraph from './TouchGraph.jsx';

const job = new URLSearchParams(location.search).get('job') === 'bar' ? EXAMPLE_BAR_JOB : EXAMPLE_PARABOLA_JOB;
createRoot(document.getElementById('root')).render(<TouchGraph job={job} />);
