import React, { useEffect, useState } from 'react';
import { invoke, view, router } from '@forge/bridge';
import Button from '@atlaskit/button/new';
import TextArea from '@atlaskit/textarea';
import Textfield from '@atlaskit/textfield';
import Select from '@atlaskit/select';
import Lozenge from '@atlaskit/lozenge';
import DynamicTable from '@atlaskit/dynamic-table';
import Tabs, { Tab, TabList } from '@atlaskit/tabs';
import SectionMessage from '@atlaskit/section-message';
import EmptyState from '@atlaskit/empty-state';
import ArrowLeftIcon from '@atlaskit/icon/core/arrow-left';
import { paretoGeometry } from '../../../src/lib/overview.js';
import { SimilarCard, FiveWhyCard, CorrectiveActionsCard, ReportCard } from './Assist.jsx';
import { Loading, ErrorMsg, Saved, Empty } from './ui.jsx';
import { STEPS, progress, currentStep, gateProblems, SAFETY_MESSAGE } from '../../../src/lib/eightd.js';
import { ContainmentClock, GateMessage, IsIsNotEditor, CausesEditor, VerificationEditor, LookAcrossEditor } from './Structured.jsx';

const LABELS = {
  roles: 'Team roles', champion: 'Champion (role)', what: 'What', where: 'Where', when: 'When',
  who: 'Who detects', why: 'Why it matters', how: 'How', howMany: 'How many', actions: 'Actions',
  verification: 'Verification', fiveWhys: '5 Whys', causeCategory: 'Cause category (6M)', escapePoint: 'Escape point', evidence: 'Evidence',
  implementation: 'Implementation', validation: 'Validation', systemChanges: 'System changes',
  lessons: 'Lessons learned', closure: 'Closure', recognition: 'Team recognition',
};

const KEY_RE = /\/issue\/([A-Z][A-Z0-9_]*-\d+)/;

// One full-page workspace (jira:globalPage, routed /issue/<KEY>) and a compact issue panel that links to it.
export default function App() {
  const [ctx, setCtx] = useState(null);
  const [path, setPath] = useState('');
  const [history, setHistory] = useState(null);
  useEffect(() => { view.getContext().then(setCtx); }, []);
  useEffect(() => {
    if (ctx?.moduleKey !== 'eightd-overview') return undefined;
    let off = () => {};
    view.createHistory().then((h) => {
      setHistory(h); setPath(h.location.pathname);
      off = h.listen((loc) => setPath(loc.pathname));
    }).catch(() => {});
    return () => off();
  }, [ctx?.moduleKey]);
  if (!ctx) return <div className="ed-wrap"><Loading /></div>;
  if (ctx.moduleKey !== 'eightd-overview') return <Panel ctx={ctx} />;
  const key = KEY_RE.exec(path)?.[1];
  const go = (to) => (history ? history.push(to) : null);
  if (key) return <FullPage issueKey={key} back={() => go('/')} />;
  return <Overview open={(k) => go(`/issue/${k}`)} />;
}

function FullPage({ issueKey, back }) {
  const [summary, setSummary] = useState('');
  return (
    <div className="ed-page ed-col">
      <div><Button appearance="subtle" iconBefore={ArrowLeftIcon} onClick={back}>Open 8Ds</Button></div>
      <h1 className="ed-title">{issueKey}{summary ? ` · ${summary}` : ''}</h1>
      <Workspace issueKey={issueKey} onSummary={setSummary} />
    </div>
  );
}

// Compact issue panel: status, current step, D3 clock and a link to the full-page workspace.
function Panel({ ctx }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { invoke('getState', {}).then((r) => setState(r.state)).catch((e) => setError(e.message)); }, []);
  if (error) return <div className="ed-wrap"><ErrorMsg error={error} /></div>;
  if (!state) return <div className="ed-wrap"><Loading label="Loading 8D" /></div>;
  const p = progress(state);
  const cur = currentStep(state);
  const key = ctx.extension?.issue?.key;
  const open = () => router.navigate(`/jira/apps/${APP_ID}/${ctx.environmentId}/issue/${key}`);
  return (
    <div className="ed-wrap ed-col">
      <div className="ed-row">
        {cur ? <Lozenge appearance="inprogress">Open: {cur} {STEPS.find((s) => s.id === cur).title}</Lozenge> : <Lozenge appearance="success">Closed</Lozenge>}
        <span className="ed-muted">{p.approved} of {p.total} steps approved</span>
      </div>
      <div className="ed-row"><ContainmentClock state={state} /></div>
      <div><Button appearance="primary" onClick={open}>Open full 8D</Button></div>
    </div>
  );
}

const APP_ID = 'f753cecd-d0ad-48d6-a7a0-58834ff31188';

// The full 8D form: D1-D8 tabs, fields, approve/reopen and the assist cards.
function Workspace({ issueKey, onSummary }) {
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

function Overview({ open }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { invoke('overview').then(setData).catch((e) => setError(e.message)); }, []);
  if (error) return <div className="ed-page"><ErrorMsg error={error} /></div>;
  if (!data) return <div className="ed-page"><Loading label="Loading open 8Ds" /></div>;
  const { items, pareto } = data;
  const head = { cells: ['Work item', 'Current step', 'D3 containment', 'Customer deadlines', 'Days open', 'Progress'].map((c) => ({ key: c, content: c })) };
  const rows = items.map((i) => ({
    key: String(i.issueId),
    cells: [
      { key: 'k', content: (
        <div className="ed-item">
          {i.issueKey ? <Button appearance="link" spacing="none" onClick={() => open(i.issueKey)}>{i.issueKey}</Button> : i.issueId}
          {i.summary && <span className="ed-summary" title={i.summary}>{i.summary}</span>}
        </div>
      ) },
      { key: 's', content: <span className="ed-row">{i.current}{i.lateOnD5 ? <Lozenge appearance="removed">Late on D5</Lozenge> : i.late ? <Lozenge appearance="removed">Late on {i.late}</Lozenge> : null}</span> },
      { key: 'c', content: i.containment ? <ContainmentClock clock={i.containment} /> : '' },
      { key: 'l', content: <Deadlines list={i.deadlines ?? []} /> },
      { key: 'd', content: i.daysOpen ?? '' },
      { key: 'p', content: `${i.percent}%` },
    ],
  }));
  return (
    <div className="ed-page ed-col">
      <h1>Open 8Ds</h1>
      <DynamicTable head={head} rows={rows}
        emptyView={<EmptyState header="No open 8D reports" description="Open a work item and start its 8D, or load the demo data below." />} />
      <h2>Root causes (Pareto)</h2>
      <Pareto rows={pareto} />
      <SeedCard />
    </div>
  );
}

// Customer deadlines 24h / 5d / 30d: green once met, red when missed or overdue.
function Deadlines({ list }) {
  return (
    <span className="ed-row">
      {list.map((d) => (
        <Lozenge key={d.id} appearance={d.late ? 'removed' : d.met ? 'success' : 'default'}>
          {d.id} {d.late ? 'late' : d.met ? 'met' : 'open'}
        </Lozenge>
      ))}
    </span>
  );
}

// Plain SVG Pareto: bars per approved D4 cause category, line for the cumulative share.
function Pareto({ rows }) {
  if (!rows.length) return <Empty>No approved root causes yet.</Empty>;
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

// Admin-only: loads the synthetic demo (work items and root-cause pages). Hidden for others.
function SeedCard() {
  const [admin, setAdmin] = useState(false);
  const [spaces, setSpaces] = useState([]);
  const [projectKey, setProjectKey] = useState('');
  const [space, setSpace] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    invoke('isAdmin').then((r) => {
      setAdmin(r.admin);
      if (r.admin) invoke('listSpaces').then((s) => setSpaces(s.spaces)).catch(() => {});
    }).catch(() => {});
  }, []);
  if (!admin) return null;
  const seed = async () => {
    setBusy(true); setMsg(null); setProgress(null);
    try {
      // Each call stops after ~15 s (Forge limit is 25 s) and says more: true; call again until it is done.
      const total = { issues: 0, pages: 0 };
      let r;
      for (let i = 0; i < 12; i += 1) {
        r = await invoke('seedDemo', { projectKey: projectKey.trim().toUpperCase(), spaceId: space?.value ?? '' });
        if (r.error) break;
        total.issues += r.created.issues; total.pages += r.created.pages;
        setProgress(`Loading demo data: ${r.done} of ${r.total}`);
        if (!r.more) break;
      }
      if (r.error) setMsg({ error: r.error });
      else if (r.more) setMsg({ error: `Stopped at ${r.done} of ${r.total}. Press Load demo data again to continue.` });
      else setMsg({ ok: `Demo ready: ${total.issues} work items and ${total.pages} root-cause pages added (${r.keys.join(', ')}).${graphNote(r.graph)}`, warning: r.warning });
    } catch (e) { setMsg({ error: e.message }); }
    setProgress(null);
    setBusy(false);
  };
  return (
    <section className="ed-card" aria-label="Demo data">
      <h4>Demo data (admins only)</h4>
      <p className="ed-muted">Adds 6 closed 8Ds and 3 open ones for synthetic parts, including the BR-4417 bend-crack case worked through to D6. Safe to press again.</p>
      <div className="ed-row">
        <Textfield aria-label="Project key" placeholder="Project key" width="small" value={projectKey} onChange={(e) => setProjectKey(e.target.value)} />
        <div style={{ minWidth: 220 }}>
          <Select inputId="ed-seed-space" aria-label="Confluence space" placeholder="No root-cause pages" isClearable value={space}
            onChange={setSpace} options={spaces.map((s) => ({ label: s.name, value: s.id }))} />
        </div>
        <Button appearance="primary" isLoading={busy} isDisabled={!projectKey.trim()} onClick={seed}>Load demo data</Button>
      </div>
      {progress && <p className="ed-muted" role="status">{progress}</p>}
      {msg?.ok && <SectionMessage appearance="success"><p>{msg.ok}</p></SectionMessage>}
      {msg?.warning && <SectionMessage appearance="warning"><p>{msg.warning}</p></SectionMessage>}
      <ErrorMsg error={msg?.error} />
      <GraphCheck />
    </section>
  );
}

// Admin-only (rendered inside SeedCard): pushes one test document to Teamwork Graph and reads it back.
// One line for the seed message: sent count, the skip reason or the error from the connector push.
function graphNote(g) {
  if (!g) return '';
  if (g.error) return ` Graph: ${g.error}.`;
  if (g.skipped) return ` Graph: ${g.skipped}.`;
  return ` Graph: ${g.sent ?? 0} sent${g.rejected?.length ? `, ${g.rejected.length} rejected` : ''}.`;
}

function GraphCheck() {
  const [busy, setBusy] = useState(null);
  const [out, setOut] = useState(null);
  const run = async (name) => {
    setBusy(name); setOut(null);
    try { setOut({ result: await invoke(name) }); } catch (e) { setOut({ error: e.message }); }
    setBusy(null);
  };
  return (
    <div className="ed-col">
      <h4>Teamwork Graph</h4>
      <p className="ed-muted">Graph check sends one test document through the connector and reads it back. Sync pushes every 8D again. Both show the raw answer.</p>
      <div className="ed-row">
        <Button isLoading={busy === 'graphCheck'} isDisabled={Boolean(busy)} onClick={() => run('graphCheck')}>Graph check</Button>
        <Button isLoading={busy === 'graphSync'} isDisabled={Boolean(busy)} onClick={() => run('graphSync')}>Sync to Teamwork Graph</Button>
      </div>
      {out?.result && <pre className="ed-raw">{JSON.stringify(out.result, null, 2)}</pre>}
      <ErrorMsg error={out?.error} />
    </div>
  );
}
