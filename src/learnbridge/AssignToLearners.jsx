// A teacher picks learners and assigns one item: an approved Thinta pack ({ packId }) or a generated lesson
// ({ lesson }). The server checks the teacher, the learners and the item, and keeps the assignment.
import React, { useEffect, useState } from 'react';
import { fetchLearners, allLearners } from './accounts.js';
import './assign-to-learners.css';

const NEED_LABEL = { blind: 'blind', 'low-vision': 'low vision', deaf: 'Deaf', 'hard-of-hearing': 'hard of hearing' };
const needsText = learner => (learner.profile?.needs || []).map(n => NEED_LABEL[n] || n).join(', ') || 'standard lesson';

export default function AssignToLearners({ item, onAssigned }) {
  const [learners, setLearners] = useState(allLearners);
  const [chosen, setChosen] = useState([]);
  const [state, setState] = useState({ busy: false, error: '', done: null });
  useEffect(() => { fetchLearners().then(setLearners, error => setState(s => ({ ...s, error: error.message }))); }, []);
  const toggle = email => setChosen(list => list.includes(email) ? list.filter(e => e !== email) : [...list, email]);

  const assign = async event => {
    event.preventDefault();
    setState({ busy: true, error: '', done: null });
    try {
      const response = await fetch('/api/assignments', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...item, learners: chosen }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || 'Could not assign it. Please try again.');
      setState({ busy: false, error: '', done: data.assigned });
      onAssigned?.(data.assigned);
    } catch (error) { setState({ busy: false, error: error.message, done: null }); }
  };

  return <form className="sae-assign" onSubmit={assign}>
    <fieldset>
      <legend>Assign to learners</legend>
      <p className="sae-assign-hint">Each learner gets the version their settings need: read aloud and touch graph, signed help, or the standard lesson.</p>
      {learners.length === 0 ? <p className="sae-assign-hint">No learner accounts yet. Learners appear here once they create an account.</p>
        : <ul>{learners.map(learner => <li key={learner.email}><label>
            <input type="checkbox" aria-label={`${learner.name} (${needsText(learner)})`} checked={chosen.includes(learner.email)} onChange={() => toggle(learner.email)} />
            <span>{learner.name}</span><small>{needsText(learner)}</small>
          </label></li>)}</ul>}
    </fieldset>
    <button type="submit" className="sae-assign-button" disabled={state.busy || chosen.length === 0}>{state.busy ? 'Assigning…' : chosen.length ? `Assign to ${chosen.length} learner${chosen.length === 1 ? '' : 's'}` : 'Choose learners first'}</button>
    {state.done && <p role="status" className="sae-assign-done">✓ Assigned “{state.done.title}” to {state.done.learners.length} learner{state.done.learners.length === 1 ? '' : 's'}. It is on their learning page now.</p>}
    {state.error && <p role="alert" className="sae-assign-error">{state.error}</p>}
  </form>;
}
