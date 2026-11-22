import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';
import './styles.css';
import App from './App.jsx';
import { refreshSession } from './learnbridge/accounts.js';

// Check the saved sign-in against the server first, so a session that has ended is not shown as signed in.
// Never wait more than 2 s: a slow network should not hold up the landing page.
const checked = Promise.race([refreshSession(), new Promise(resolve => setTimeout(resolve, 2000))]);
checked.finally(() => createRoot(document.getElementById('root')).render(<App />));
