import React, { useEffect, useState } from 'react';
import { invoke, view } from '@forge/bridge';
import { STEPS, progress, currentStep, SAFETY_MESSAGE } from '../../../src/lib/eightd.js';

const LABELS = {
  roles: 'Team roles', champion: 'Champion (role)', what: 'What', where: 'Where', when: 'When',
  who: 'Who detects', why: 'Why it matters', how: 'How', howMany: 'How many', actions: 'Actions',
  verification: 'Verification', fiveWhys: '5 Whys', causeCategory: 'Cause category (6M)', escapePoint: 'Escape point', evidence: 'Evidence',
  implementation: 'Implementation', validation: 'Validation', systemChanges: 'System changes',
  lessons: 'Lessons learned', closure: 'Closure', recognition: 'Team recognition',
};

export default function App() {
  const [moduleKey, setModuleKey] = useState(null);
  useEffect(() => { view.getContext().then((c) => setModuleKey(c.moduleKey)); }, []);
  if (!moduleKey) return <p className="ed-wrap ed-muted">Loading...</p>;
  return moduleKey === 'eightd-overview' ? <Overview /> : <Panel />;
}

function Panel() {
  const [state, setState] = useState(null);
  const [safety, setSafety] = useState(false);
  const [active, setActive] = useState('D1');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invoke('getState').then((r) => {
      setState(r.state); setSafety(r.safety); setActive(currentStep(r.state) ?? 'D8');
    }).catch((e) => setError(e.message));
  }, []);

  const run = async (name, payload) => {
    setBusy(true); setError(null);
    try { setState((await invoke(name, payload)).state); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const dispatch = (action) => run('dispatch', { action });

  if (!state) return <div className="ed-wrap">{error ? <p className="ed-error">{error}</p> : <p className="ed-muted">Loading...</p>}</div>;

  const p = progress(state);
  const step = STEPS.find((s) => s.id === active);
  const data = state.steps[active];
  const approved = Boolean(data.approvedBy);

  return (
    <div className="ed-wrap">
      {safety && <div className="ed-banner" role="alert">{SAFETY_MESSAGE}</div>}
      <div className="ed-muted">{p.approved} of {p.total} steps approved ({p.percent}%)</div>
      <div className="ed-progress" role="progressbar" aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${p.percent}%` }} />
      </div>
      <ol className="ed-stepper">
        {STEPS.map((s) => (
          <li key={s.id}>
            <button type="button" aria-current={s.id === active ? 'step' : undefined}
              className={state.steps[s.id].approvedBy ? 'ed-done' : ''} onClick={() => setActive(s.id)}>{s.id}</button>
          </li>
        ))}
      </ol>
      <h3>{step.id}: {step.title}</h3>
      {step.fields.map((f) => (
        <label key={f} className="ed-field">
          <span>{LABELS[f] ?? f}</span>
          <textarea value={data.fields[f]} disabled={approved || busy}
            onChange={(e) => setState({ ...state, steps: { ...state.steps, [active]: { ...data, fields: { ...data.fields, [f]: e.target.value } } } })}
            onBlur={(e) => dispatch({ type: 'setField', stepId: active, field: f, value: e.target.value })} />
        </label>
      ))}
      {error && <p className="ed-error">{error}</p>}
      <div className="ed-actions">
        {approved ? (
          <button type="button" className="ed-btn ed-secondary" disabled={busy}
            onClick={() => dispatch({ type: 'reopen', stepId: active })}>Reopen {active}</button>
        ) : (
          <button type="button" className="ed-btn" disabled={busy || currentStep(state) !== active}
            onClick={() => dispatch({ type: 'approve', stepId: active })}>Approve {active}</button>
        )}
        {active === 'D2' && (
          // Automation button: disabled for safety-labelled work items.
          <button type="button" className="ed-btn ed-secondary" disabled={safety || approved || busy}
            title={safety ? SAFETY_MESSAGE : 'Fills D2 with a 5W2H draft for you to review'}
            onClick={() => run('draftD2')}>Draft with 8D Coach</button>
        )}
      </div>
      {approved && <p className="ed-muted">Approved {data.approvedAt?.slice(0, 10)} by a team member.</p>}
      <p className="ed-muted">Assistive tool: a person reviews and approves every step.</p>
    </div>
  );
}

function Overview() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { invoke('listOpen').then((r) => setItems(r.items)).catch((e) => setError(e.message)); }, []);
  if (error) return <p className="ed-wrap ed-error">{error}</p>;
  if (!items) return <p className="ed-wrap ed-muted">Loading...</p>;
  return (
    <div className="ed-wrap">
      <h2>Open 8Ds</h2>
      {items.length === 0 ? <p className="ed-muted">No open 8D reports.</p> : (
        <table className="ed-table">
          <thead><tr><th>Work item</th><th>Current step</th><th>Progress</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.issueId}><td>{i.issueKey ?? i.issueId}</td><td>{i.current}</td><td>{i.percent}%</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
