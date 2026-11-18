// Lazy chunk: the full 8D form loads only when a work item is opened on the full page.
import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import Button from '@atlaskit/button/new';
import TextArea from '@atlaskit/textarea';
import Lozenge from '@atlaskit/lozenge';
import Tabs, { Tab, TabList } from '@atlaskit/tabs';
import SectionMessage from '@atlaskit/section-message';
import { SimilarCard, FiveWhyCard, CorrectiveActionsCard, ReportCard } from './Assist.jsx';
import { Loading, ErrorMsg, Saved, ContainmentClock } from './ui.jsx';
import { STEPS, progress, currentStep, gateProblems, SAFETY_MESSAGE } from '../../../src/lib/eightd.js';
import { GateMessage, IsIsNotEditor, CausesEditor, VerificationEditor, LookAcrossEditor } from './Structured.jsx';

const LABELS = {
  roles: 'Team roles', champion: 'Champion (role)', what: 'What', where: 'Where', when: 'When',
  who: 'Who detects', why: 'Why it matters', how: 'How', howMany: 'How many', actions: 'Actions',
  verification: 'Verification', fiveWhys: '5 Whys', causeCategory: 'Cause category (6M)', escapePoint: 'Escape point', evidence: 'Evidence',
  implementation: 'Implementation', validation: 'Validation', systemChanges: 'System changes',
  lessons: 'Lessons learned', closure: 'Closure', recognition: 'Team recognition',
};

// The full 8D form: D1-D8 tabs, fields, approve/reopen and the assist cards.
export default function Workspace({ issueKey, onSummary }) {
  const [state, setState] = useState(null);
  const [safety, setSafety] = useState(false);
  const [active, setActive] = useState('D1');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const base = issueKey ? { issueKey } : {};

  useEffect(() => {
    invoke('getState', base).then((r) => {
      setState(r.state); setSafety(r.safety); setActive(currentStep(r.state) ?? 'D8');
      onSummary?.(r.summary ?? '');
    }).catch((e) => setError(e.message));
  }, [issueKey]);

  const run = async (name, payload) => {
    setBusy(true); setError(null);
    try { setState((await invoke(name, { ...base, ...payload })).state); setSavedAt(new Date().toISOString()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const dispatch = (action) => run('dispatch', { action });
  const setData = (key, value) => dispatch({ type: 'setData', key, value });

  if (!state) return <div className="ed-wrap">{error ? <ErrorMsg error={error} /> : <Loading label="Loading 8D" />}</div>;

  const p = progress(state);
  const step = STEPS.find((s) => s.id === active);
  const data = state.steps[active];
  const approved = Boolean(data.approvedBy);
  const setLocal = (f, v) => setState({ ...state, steps: { ...state.steps, [active]: { ...data, fields: { ...data.fields, [f]: v } } } });

  return (
    <div className="ed-wrap">
      {safety && <SectionMessage appearance="warning" title="Safety"><p>{SAFETY_MESSAGE}</p></SectionMessage>}
      <div className="ed-row"><span className="ed-muted">{p.approved} of {p.total} steps approved ({p.percent}%)</span><Saved at={savedAt} /></div>
      <div className="ed-progress" role="progressbar" aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${p.percent}%` }} />
      </div>
      <Tabs id="ed-steps" selected={STEPS.findIndex((s) => s.id === active)} onChange={(i) => setActive(STEPS[i].id)}>
        <TabList>{STEPS.map((s) => <Tab key={s.id}>{state.steps[s.id].approvedBy ? `${s.id} ✓` : s.id}</Tab>)}</TabList>
      </Tabs>
      <div className="ed-row"><h3>{step.id}: {step.title}</h3>{approved ? <Lozenge appearance="success">Approved</Lozenge> : <Lozenge>Draft</Lozenge>}</div>
      {step.fields.map((f) => (
        <label key={f} className="ed-field">
          <span>{LABELS[f] ?? f}</span>
          <TextArea value={data.fields[f]} isDisabled={approved || busy} resize="smart" minimumRows={2}
            onChange={(e) => setLocal(f, e.target.value)}
            onBlur={(e) => dispatch({ type: 'setField', stepId: active, field: f, value: e.target.value })} />
        </label>
      ))}
      <ErrorMsg error={error} />
      <div className="ed-row">
        {approved ? (
          <Button isDisabled={busy} onClick={() => dispatch({ type: 'reopen', stepId: active })}>Reopen {active}</Button>
        ) : (
          <Button appearance="primary" isDisabled={busy || currentStep(state) !== active || gateProblems(state, active).length > 0}
            onClick={() => dispatch({ type: 'approve', stepId: active })}>Approve {active}</Button>
        )}
        {active === 'D2' && (
          // Automation button: disabled for safety-labelled work items.
          <Button isDisabled={safety || approved || busy} onClick={() => run('draftD2')}>Draft with 8D Coach</Button>
        )}
      </div>
      <GateMessage state={state} stepId={active} />
      {active === 'D3' && <div className="ed-row"><ContainmentClock state={state} /></div>}
      {active === 'D2' && <IsIsNotEditor value={state.data.isIsNot} disabled={approved || busy} onSave={(v) => setData('isIsNot', v)} />}
      {active === 'D4' && <CausesEditor value={state.data.causes} disabled={approved || busy} onSave={(v) => setData('causes', v)} />}
      {active === 'D6' && <VerificationEditor value={state.data.verification} disabled={approved || busy} onSave={(v) => setData('verification', v)} />}
      {active === 'D7' && <LookAcrossEditor list={state.data.lookAcross} fmeaRef={state.data.fmeaRef} disabled={approved || busy}
        onSave={async (v) => { await setData('lookAcross', v.lookAcross); await setData('fmeaRef', v.fmeaRef); }} />}
      {approved && <p className="ed-muted">Approved {data.approvedAt?.slice(0, 10)} by a team member.</p>}
      {['D2', 'D3', 'D4'].includes(active) && <SimilarCard base={base} />}
      {active === 'D4' && <FiveWhyCard base={base} approved={approved} onState={setState} />}
      {(active === 'D5' || active === 'D6') && (
        <CorrectiveActionsCard base={base} state={state} onReopen={() => dispatch({ type: 'reopen', stepId: 'D5' })}
          onState={() => invoke('getState', base).then((r) => setState(r.state)).catch(() => {})} />
      )}
      {active === 'D8' && <ReportCard base={base} state={state} />}
      <p className="ed-muted">Assistive tool: a person reviews and approves every step.</p>
    </div>
  );
}
