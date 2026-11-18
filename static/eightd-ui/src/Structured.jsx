// Structured 8D editors (D2 IS / IS NOT, D4 causes, D6 before/after, D7 look-across) and the D3 clock.
// Each editor edits a local copy and saves the whole value with one setData dispatch.
import React, { useEffect, useState } from 'react';
import Button from '@atlaskit/button/new';
import Textfield from '@atlaskit/textfield';
import TextArea from '@atlaskit/textarea';
import Select from '@atlaskit/select';
import Lozenge from '@atlaskit/lozenge';
import DynamicTable from '@atlaskit/dynamic-table';
import SectionMessage from '@atlaskit/section-message';
import { CAUSE_KINDS, CAUSE_STATUSES, containmentClock, gateProblems } from '../../../src/lib/eightd.js';
import { opts } from './ui.jsx';

// [lozenge appearance, short lozenge text, long explanation shown under it and as the tooltip]
const CLOCK = {
  'not-started': ['default', 'Not started', 'Containment clock not started'],
  'on-time': ['inprogress', 'Open', 'Containment due within 24 h'],
  'at-risk': ['moved', 'At risk', 'Containment past the 24 h target'],
  late: ['removed', 'Late', 'Containment late (over 48 h)'],
  'contained-on-time': ['success', 'Met', 'Contained within 24 h'],
  'contained-at-risk': ['moved', 'Met late', 'Contained, past the 24 h target'],
  'contained-late': ['removed', 'Late', 'Contained late (over 48 h)'],
};

export function ContainmentClock({ state, clock }) {
  const c = clock ?? containmentClock(state);
  const [appearance, short, long] = CLOCK[c.status] ?? CLOCK['not-started'];
  return (
    <span className="ed-clock" title={long}>
      <Lozenge appearance={appearance}>{c.hours === null ? short : `${short} · ${c.hours} h`}</Lozenge>
      <span className="ed-clock-note">{long}</span>
    </span>
  );
}

// Shows what still blocks Approve; the Approve button stays off while this list is not empty.
export function GateMessage({ state, stepId }) {
  const problems = gateProblems(state, stepId);
  if (!problems.length || state.steps[stepId].approvedBy) return null;
  return (
    <SectionMessage appearance="information" title={`Before ${stepId} can be approved`}>
      <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
    </SectionMessage>
  );
}

function useDraft(value) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [JSON.stringify(value)]);
  return [draft, setDraft, JSON.stringify(draft) !== JSON.stringify(value)];
}

function SaveBar({ dirty, disabled, onSave, onUndo }) {
  return (
    <div className="ed-row">
      <Button appearance="primary" isDisabled={!dirty || disabled} onClick={onSave}>Save</Button>
      <Button appearance="subtle" isDisabled={!dirty || disabled} onClick={onUndo}>Undo changes</Button>
    </div>
  );
}

export function IsIsNotEditor({ value, disabled, onSave }) {
  const [rows, setRows, dirty] = useDraft(value);
  const edit = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const cell = (i, k, label) => <Textfield aria-label={label} value={rows[i][k]} isDisabled={disabled} onChange={(e) => edit(i, k, e.target.value)} />;
  const head = { cells: ['Dimension', 'IS', 'IS NOT'].map((c) => ({ key: c, content: c })) };
  const tableRows = rows.map((r, i) => ({
    key: String(i),
    cells: [{ key: 'd', content: r.dimension }, { key: 'i', content: cell(i, 'is', `${r.dimension} is`) }, { key: 'n', content: cell(i, 'isNot', `${r.dimension} is not`) }],
  }));
  return (
    <section className="ed-col">
      <h4>IS / IS NOT</h4>
      <DynamicTable head={head} rows={tableRows} />
      <SaveBar dirty={dirty} disabled={disabled} onSave={() => onSave(rows)} onUndo={() => setRows(value)} />
    </section>
  );
}

const STATUS_LOOK = { hypothesis: 'default', confirmed: 'success', killed: 'removed' };
const KIND_LABEL = { occurrence: 'Occurrence (why it happened)', escape: 'Escape (why it was not caught)' };

export function CausesEditor({ value, disabled, onSave }) {
  const [causes, setCauses, dirty] = useDraft(value);
  const edit = (i, k, v) => setCauses(causes.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const add = (kind) => setCauses([...causes, { id: `c${Date.now()}`, kind, text: '', status: 'hypothesis', evidence: '' }]);
  return (
    <section className="ed-col">
      <h4>Causes</h4>
      <p className="ed-muted">Every new cause starts as a hypothesis. Mark it confirmed or killed only with evidence. D4 needs one confirmed occurrence cause and one confirmed escape cause.</p>
      {CAUSE_KINDS.map((kind) => (
        <div key={kind} className="ed-col">
          <h5>{KIND_LABEL[kind]}</h5>
          {causes.map((c, i) => c.kind !== kind ? null : (
            <div key={c.id} className="ed-cause">
              <div className="ed-row">
                <Lozenge appearance={STATUS_LOOK[c.status]}>{c.status}</Lozenge>
                <div className="ed-grow"><Textfield aria-label="Cause" placeholder="Cause" value={c.text} isDisabled={disabled} onChange={(e) => edit(i, 'text', e.target.value)} /></div>
                <div className="ed-select"><Select aria-label="Status" options={opts(CAUSE_STATUSES)} value={{ label: c.status, value: c.status }} isDisabled={disabled} onChange={(o) => edit(i, 'status', o.value)} /></div>
                <Button appearance="subtle" isDisabled={disabled} onClick={() => setCauses(causes.filter((_, j) => j !== i))}>Remove</Button>
              </div>
              <TextArea aria-label="Evidence" placeholder="Evidence (test, measurement, trial)" value={c.evidence} isDisabled={disabled} minimumRows={1} onChange={(e) => edit(i, 'evidence', e.target.value)} />
            </div>
          ))}
          <div><Button isDisabled={disabled} onClick={() => add(kind)}>Add {kind} cause</Button></div>
        </div>
      ))}
      <SaveBar dirty={dirty} disabled={disabled} onSave={() => onSave(causes)} onUndo={() => setCauses(value)} />
    </section>
  );
}

export function VerificationEditor({ value, disabled, onSave }) {
  const [v, setV, dirty] = useDraft(value);
  return (
    <section className="ed-col">
      <h4>Before / after verification (needed before D8)</h4>
      <label className="ed-field"><span>Before the fix</span><TextArea value={v.before} isDisabled={disabled} minimumRows={2} onChange={(e) => setV({ ...v, before: e.target.value })} /></label>
      <label className="ed-field"><span>After the fix</span><TextArea value={v.after} isDisabled={disabled} minimumRows={2} onChange={(e) => setV({ ...v, after: e.target.value })} /></label>
      <SaveBar dirty={dirty} disabled={disabled} onSave={() => onSave(v)} onUndo={() => setV(value)} />
    </section>
  );
}

export function LookAcrossEditor({ list, fmeaRef, disabled, onSave }) {
  const value = { text: list.join('\n'), fmeaRef };
  const [v, setV, dirty] = useDraft(value);
  return (
    <section className="ed-col">
      <h4>Look-across and FMEA (needed before D7)</h4>
      <label className="ed-field"><span>Look-across: other parts, dies or lines checked (one per line)</span>
        <TextArea value={v.text} isDisabled={disabled} minimumRows={3} onChange={(e) => setV({ ...v, text: e.target.value })} /></label>
      <label className="ed-field"><span>FMEA / control plan reference</span>
        <Textfield value={v.fmeaRef} isDisabled={disabled} onChange={(e) => setV({ ...v, fmeaRef: e.target.value })} /></label>
      <SaveBar dirty={dirty} disabled={disabled} onUndo={() => setV(value)}
        onSave={() => onSave({ lookAcross: v.text.split('\n').map((s) => s.trim()).filter(Boolean), fmeaRef: v.fmeaRef })} />
    </section>
  );
}
