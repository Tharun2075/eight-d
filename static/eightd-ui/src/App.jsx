import React, { useEffect, useState } from 'react';
import { invoke, view } from '@forge/bridge';
import { paretoGeometry } from '../../../src/lib/overview.js';
import { SimilarCard, FiveWhyCard, CorrectiveActionsCard, ReportCard } from './Assist.jsx';
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
      {['D2', 'D3', 'D4'].includes(active) && <SimilarCard />}
      {active === 'D4' && <FiveWhyCard approved={approved} onState={setState} />}
      {(active === 'D5' || active === 'D6') && (
        <CorrectiveActionsCard state={state} onReopen={() => dispatch({ type: 'reopen', stepId: 'D5' })}
          onState={() => invoke('getState').then((r) => setState(r.state)).catch(() => {})} />
      )}
      {active === 'D8' && <ReportCard state={state} />}
      <p className="ed-muted">Assistive tool: a person reviews and approves every step.</p>
    </div>
  );
}

function Overview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { invoke('overview').then(setData).catch((e) => setError(e.message)); }, []);
  if (error) return <p className="ed-wrap ed-error">{error}</p>;
  if (!data) return <p className="ed-wrap ed-muted">Loading...</p>;
  const { items, pareto } = data;
  return (
    <div className="ed-wrap">
      <h2>Open 8Ds</h2>
      {items.length === 0 ? <p className="ed-muted">No open 8D reports.</p> : (
        <table className="ed-table">
          <thead><tr><th>Work item</th><th>Current step</th><th>Days open</th><th>Progress</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.issueId}>
                <td>{i.issueKey ?? i.issueId}</td>
                <td>{i.current}{i.lateOnD5 ? <span className="ed-late">Late on D5</span> : i.late ? <span className="ed-late">Late on {i.late}</span> : null}</td>
                <td>{i.daysOpen ?? ''}</td>
                <td>{i.percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Root causes (Pareto)</h2>
      <Pareto rows={pareto} />
      <SeedCard />
    </div>
  );
}

// Plain SVG Pareto: bars per approved D4 cause category, line for the cumulative share.
function Pareto({ rows }) {
  if (!rows.length) return <p className="ed-muted">No approved root causes yet.</p>;
  const g = paretoGeometry(rows);
  const base = g.height - g.pad;
  return (
    <svg className="ed-pareto" viewBox={`0 0 ${g.width} ${g.height + 28}`} role="img"
      aria-label={rows.map((r) => `${r.category} ${r.count}`).join(', ')}>
      <line x1={g.pad} y1={base} x2={g.width - g.pad} y2={base} className="ed-pareto-axis" />
      {g.bars.map((b) => (
        <g key={b.category}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} className="ed-pareto-bar"><title>{`${b.category}: ${b.count}`}</title></rect>
          <text x={b.cx} y={b.y - 4} textAnchor="middle" className="ed-pareto-text">{b.count}</text>
          <text x={b.cx} y={base + 14} textAnchor="middle" className="ed-pareto-text">{b.category}</text>
          <text x={b.cx} y={base + 26} textAnchor="middle" className="ed-pareto-muted">{b.cumulative}%</text>
        </g>
      ))}
      <polyline points={g.line} className="ed-pareto-line" />
    </svg>
  );
}

// Admin-only: loads the synthetic BRKT-200 demo (8 work items, 6 root-cause pages). Hidden for others.
function SeedCard() {
  const [admin, setAdmin] = useState(false);
  const [spaces, setSpaces] = useState([]);
  const [projectKey, setProjectKey] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    invoke('isAdmin').then((r) => {
      setAdmin(r.admin);
      if (r.admin) invoke('listSpaces').then((s) => setSpaces(s.spaces)).catch(() => {});
    }).catch(() => {});
  }, []);
  if (!admin) return null;
  const seed = async () => {
    setBusy(true);
    try {
      const r = await invoke('seedDemo', { projectKey: projectKey.trim().toUpperCase(), spaceId });
      setMsg(r.error ?? `Demo ready: ${r.created.issues} work items and ${r.created.pages} root-cause pages added (${r.keys.join(', ')}).`);
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  return (
    <section className="ed-card" aria-label="Demo data">
      <h4>Demo data (admins only)</h4>
      <p className="ed-muted">Adds 6 closed and 2 open 8Ds for the synthetic part BRKT-200. Safe to press again.</p>
      <div className="ed-row">
        <input aria-label="Project key" placeholder="Project key" value={projectKey} onChange={(e) => setProjectKey(e.target.value)} />
        <select aria-label="Confluence space" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
          <option value="">No root-cause pages</option>
          {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button type="button" disabled={busy || !projectKey.trim()} onClick={seed}>{busy ? 'Loading...' : 'Load demo data'}</button>
      </div>
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}
