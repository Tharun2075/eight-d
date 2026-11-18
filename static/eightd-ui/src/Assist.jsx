import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import Button from '@atlaskit/button/new';
import TextArea from '@atlaskit/textarea';
import Select from '@atlaskit/select';
import Lozenge from '@atlaskit/lozenge';
import SectionMessage from '@atlaskit/section-message';
import { Loading, ErrorMsg, Empty } from './ui.jsx';

// Assist cards shown under the step form. Every card only shows drafts and previews; nothing is
// approved here. A human edits the text, then presses Approve on the step itself.
// `base` carries { issueKey } when the card runs on the full page instead of the issue panel.

function useCall(base = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const call = async (name, payload) => {
    setBusy(true); setError(null);
    try { return await invoke(name, { ...base, ...payload }); } catch (e) { setError(e.message); return null; } finally { setBusy(false); }
  };
  return { busy, error, call };
}

export function SimilarCard({ base }) {
  const { busy, error, call } = useCall(base);
  const [res, setRes] = useState(null);
  useEffect(() => { call('findSimilar').then(setRes); }, []);
  return (
    <section className="ed-card" aria-label="Similar past nonconformances">
      <h4>Similar past nonconformances</h4>
      {busy && <Loading label="Searching Jira and Confluence" />}
      <ErrorMsg error={error} />
      {res && res.rows.length === 0 && <Empty>No similar work items you can see.</Empty>}
      {res && res.rows.map((r) => (
        <div key={r.key} className="ed-col">
          <div className="ed-row"><strong>{r.key}</strong> {r.summary} <Lozenge>{r.status}</Lozenge></div>
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
export function FiveWhyCard({ base, approved, onState }) {
  const { busy, error, call } = useCall(base);
  const [scaffold, setScaffold] = useState(null);
  const [picks, setPicks] = useState({});
  const [saved, setSaved] = useState(false);
  const load = async () => { const r = await call('scaffoldFiveWhy'); if (r) { setScaffold(r.scaffold); setPicks({}); } };
  const text = scaffold ? scaffold.levels.map((l) => `${l.level}. ${picks[l.level]?.trim() || '(not answered yet)'}`).join('\n') : '';
  const save = async () => { const r = await call('saveFiveWhy', { text }); if (r) { onState(r.state); setSaved(true); } };
  return (
    <section className="ed-card" aria-label="5-Why helper">
      <h4>5-Why helper <Lozenge appearance="new">Hypothesis</Lozenge></h4>
      {!scaffold && <Button isLoading={busy} isDisabled={approved} onClick={load}>Start 5-Why from similar cases</Button>}
      {scaffold && scaffold.levels.map((l) => (
        <label key={l.level} className="ed-field">
          <span>{l.question}</span>
          {l.candidates.length > 0 && (
            <Select inputId={`ed-why-${l.level}`} placeholder="Pick from past cases..." isDisabled={approved} value={null}
              options={l.candidates.map((c) => ({ label: `${c.text} (${c.source})`, value: c.text }))}
              onChange={(o) => setPicks({ ...picks, [l.level]: o.value })} />
          )}
          <TextArea value={picks[l.level] ?? ''} isDisabled={approved} placeholder="Write or edit the answer"
            onChange={(e) => setPicks({ ...picks, [l.level]: e.target.value })} />
        </label>
      ))}
      {scaffold && (
        <div className="ed-row">
          <Button isLoading={busy} isDisabled={approved} onClick={save}>Use as D4 draft</Button>
          <span className="ed-muted">Draft only. Review the 5 Whys field, then press Approve D4.</span>
        </div>
      )}
      {saved && <SectionMessage appearance="success"><p>Saved to the 5 Whys field as a hypothesis.</p></SectionMessage>}
      <ErrorMsg error={error} />
    </section>
  );
}

// D5/D6: preview drafts from the approved D5 text; "Edit D5" reopens it; "Create" makes linked items.
export function CorrectiveActionsCard({ base, state, onReopen, onState }) {
  const { busy, error, call } = useCall(base);
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
      {busy && !preview && <Loading />}
      {preview?.error && <Empty>{preview.error}</Empty>}
      {preview?.drafts?.length > 0 && (
        <ul>{preview.drafts.map((d) => <li key={d.ref}>{d.summary}{d.owner ? `, owner ${d.owner}` : ''}{d.due ? `, due ${d.due}` : ''}</li>)}</ul>
      )}
      {preview && !preview.error && preview.drafts.length === 0 && <Empty>Every approved action already has a work item.</Empty>}
      <div className="ed-row">
        <Button appearance="primary" isLoading={busy} isDisabled={!preview?.drafts?.length} onClick={create}>Create corrective actions</Button>
        {state.steps.D5.approvedBy && <Button isDisabled={busy} onClick={onReopen}>Edit D5</Button>}
      </div>
      {[...done, ...(created ?? []).filter((c) => !done.some((d) => d.ref === c.ref))].map((c) => (
        <div key={c.ref} className="ed-row"><Lozenge appearance="success">{c.key}</Lozenge> {c.summary}{c.assigned ? '' : ' (owner not matched, assign by hand)'}</div>
      ))}
      <ErrorMsg error={error} />
    </section>
  );
}

// D8: preview the approved-only report, pick a space, publish. Unapproved steps never appear.
export function ReportCard({ base, state }) {
  const { busy, error, call } = useCall(base);
  const [preview, setPreview] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [space, setSpace] = useState(null);
  const [result, setResult] = useState(null);
  useEffect(() => {
    call('previewReport').then(setPreview);
    if (!state.report?.pageId) call('listSpaces').then((r) => r && setSpaces(r.spaces));
  }, []);
  const publish = async () => setResult(await call('generateReport', { spaceId: space?.value }));
  const url = result?.url ?? state.report?.url;
  return (
    <section className="ed-card" aria-label="Customer report">
      <h4>Customer report</h4>
      {busy && !preview && <Loading />}
      {preview && <p className="ed-muted">Includes approved steps only: {preview.approvedSteps.join(', ') || 'none yet'}.</p>}
      {!state.report?.pageId && (
        <Select inputId="ed-report-space" aria-label="Confluence space" placeholder="Choose a Confluence space..." value={space}
          onChange={setSpace} options={spaces.map((s) => ({ label: `${s.name} (${s.key})`, value: s.id }))} />
      )}
      <div className="ed-row">
        <Button appearance="primary" isLoading={busy} isDisabled={!preview?.approvedSteps?.length || (!state.report?.pageId && !space)}
          onClick={publish}>{state.report?.pageId ? 'Update customer report' : 'Generate customer report'}</Button>
      </div>
      <ErrorMsg error={result?.error ?? error} />
      {url && <SectionMessage appearance="success"><p><a href={url} target="_blank" rel="noreferrer">Open the report in Confluence</a></p></SectionMessage>}
    </section>
  );
}
