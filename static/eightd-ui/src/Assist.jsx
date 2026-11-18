import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';

// Assist cards shown under the step form. Every card only shows drafts and previews; nothing is
// approved here. A human edits the text, then presses Approve on the step itself.

function useCall() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const call = async (name, payload) => {
    setBusy(true); setError(null);
    try { return await invoke(name, payload); } catch (e) { setError(e.message); return null; } finally { setBusy(false); }
  };
  return { busy, error, call };
}

export function SimilarCard() {
  const { busy, error, call } = useCall();
  const [res, setRes] = useState(null);
  useEffect(() => { call('findSimilar').then(setRes); }, []);
  return (
    <section className="ed-card" aria-label="Similar past nonconformances">
      <h4>Similar past nonconformances</h4>
      {busy && <p className="ed-muted">Searching Jira and Confluence...</p>}
      {error && <p className="ed-error">{error}</p>}
      {res && res.rows.length === 0 && <p className="ed-muted">No similar work items you can see.</p>}
      {res && res.rows.map((r) => (
        <div key={r.key} className="ed-row">
          <strong>{r.key}</strong> {r.summary} <span className="ed-muted">({r.status})</span>
          <div className="ed-muted">Root cause: {r.rootCause.split('\n')[0]}</div>
          <div className="ed-cites">
            {r.citations.map((c) => <a key={c.url} href={c.url} target="_blank" rel="noreferrer">{c.title}</a>)}
          </div>
        </div>
      ))}
      {res && <p className="ed-muted">Source: {res.source === 'teamwork-graph' ? 'Teamwork Graph' : 'Jira links and Confluence search'}.</p>}
    </section>
  );
}

// D4: pick or write each why; "Use as D4 draft" writes the 5 Whys field, approval stays manual.
export function FiveWhyCard({ approved, onState }) {
  const { busy, error, call } = useCall();
  const [scaffold, setScaffold] = useState(null);
  const [picks, setPicks] = useState({});
  const load = async () => { const r = await call('scaffoldFiveWhy'); if (r) { setScaffold(r.scaffold); setPicks({}); } };
  const text = scaffold ? scaffold.levels.map((l) => `${l.level}. ${picks[l.level]?.trim() || '(not answered yet)'}`).join('\n') : '';
  const save = async () => { const r = await call('saveFiveWhy', { text }); if (r) onState(r.state); };
  return (
    <section className="ed-card" aria-label="5-Why helper">
      <h4>5-Why helper</h4>
      {!scaffold && <button type="button" className="ed-btn ed-secondary" disabled={busy || approved} onClick={load}>Start 5-Why from similar cases</button>}
      {scaffold && scaffold.levels.map((l) => (
        <label key={l.level} className="ed-field">
          <span>{l.question}</span>
          {l.candidates.length > 0 && (
            <select value="" onChange={(e) => setPicks({ ...picks, [l.level]: e.target.value })} disabled={approved}>
              <option value="">Pick from past cases...</option>
              {l.candidates.map((c) => <option key={c.text} value={c.text}>{c.text} ({c.source})</option>)}
            </select>
          )}
          <textarea value={picks[l.level] ?? ''} disabled={approved} placeholder="Write or edit the answer"
            onChange={(e) => setPicks({ ...picks, [l.level]: e.target.value })} />
        </label>
      ))}
      {scaffold && (
        <div className="ed-actions">
          <button type="button" className="ed-btn ed-secondary" disabled={busy || approved} onClick={save}>Use as D4 draft</button>
          <span className="ed-muted">Draft only. Review the 5 Whys field, then press Approve D4.</span>
        </div>
      )}
      {error && <p className="ed-error">{error}</p>}
    </section>
  );
}

// D5/D6: preview drafts from the approved D5 text; "Edit D5" reopens it; "Create" makes linked items.
export function CorrectiveActionsCard({ state, onReopen, onState }) {
  const { busy, error, call } = useCall();
  const [preview, setPreview] = useState(null);
  const [created, setCreated] = useState(null);
  useEffect(() => { call('previewCorrectiveActions').then(setPreview); }, [state.steps.D5.approvedBy, state.steps.D6.approvedBy]);
  const create = async () => {
    const r = await call('createCorrectiveActions');
    if (r) { setCreated(r.created); setPreview(await call('previewCorrectiveActions')); onState?.(); }
  };
  const done = state.correctiveActions ?? [];
  return (
    <section className="ed-card" aria-label="Corrective actions">
      <h4>Corrective actions</h4>
      {preview?.error && <p className="ed-muted">{preview.error}</p>}
      {preview?.drafts?.length > 0 && (
        <ul>{preview.drafts.map((d) => <li key={d.ref}>{d.summary}{d.owner ? `, owner ${d.owner}` : ''}{d.due ? `, due ${d.due}` : ''}</li>)}</ul>
      )}
      {preview && !preview.error && preview.drafts.length === 0 && <p className="ed-muted">Every approved action already has a work item.</p>}
      <div className="ed-actions">
        <button type="button" className="ed-btn" disabled={busy || !preview?.drafts?.length} onClick={create}>Create corrective actions</button>
        {state.steps.D5.approvedBy && <button type="button" className="ed-btn ed-secondary" disabled={busy} onClick={onReopen}>Edit D5</button>}
      </div>
      {[...done, ...(created ?? []).filter((c) => !done.some((d) => d.ref === c.ref))].map((c) => (
        <div key={c.ref} className="ed-muted">{c.key}: {c.summary}{c.assigned ? '' : ' (owner not matched, assign by hand)'}</div>
      ))}
      {error && <p className="ed-error">{error}</p>}
    </section>
  );
}

// D8: preview the approved-only report, pick a space, publish. Unapproved steps never appear.
export function ReportCard({ state }) {
  const { busy, error, call } = useCall();
  const [preview, setPreview] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [spaceId, setSpaceId] = useState('');
  const [result, setResult] = useState(null);
  useEffect(() => {
    call('previewReport').then(setPreview);
    if (!state.report?.pageId) call('listSpaces').then((r) => r && setSpaces(r.spaces));
  }, []);
  const publish = async () => setResult(await call('generateReport', { spaceId }));
  const url = result?.url ?? state.report?.url;
  return (
    <section className="ed-card" aria-label="Customer report">
      <h4>Customer report</h4>
      {preview && <p className="ed-muted">Includes approved steps only: {preview.approvedSteps.join(', ') || 'none yet'}.</p>}
      {!state.report?.pageId && (
        <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)} aria-label="Confluence space">
          <option value="">Choose a Confluence space...</option>
          {spaces.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.key})</option>)}
        </select>
      )}
      <div className="ed-actions">
        <button type="button" className="ed-btn" disabled={busy || !preview?.approvedSteps?.length || (!state.report?.pageId && !spaceId)}
          onClick={publish}>{state.report?.pageId ? 'Update customer report' : 'Generate customer report'}</button>
      </div>
      {result?.error && <p className="ed-error">{result.error}</p>}
      {url && <p><a href={url} target="_blank" rel="noreferrer">Open the report in Confluence</a></p>}
      {error && <p className="ed-error">{error}</p>}
    </section>
  );
}
