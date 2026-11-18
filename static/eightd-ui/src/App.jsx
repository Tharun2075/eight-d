import React, { Suspense, lazy, useEffect, useState } from 'react';
import { invoke, view, router } from '@forge/bridge';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import DynamicTable from '@atlaskit/dynamic-table';
import EmptyState from '@atlaskit/empty-state';
import ArrowLeftIcon from '@atlaskit/icon/core/arrow-left';
import { paretoGeometry, emptyOverviewText } from '../../../src/lib/overview.js';
import { Loading, ErrorMsg, Empty, ContainmentClock } from './ui.jsx';
import { STEPS, progress, currentStep } from '../../../src/lib/eightd.js';

// Our logo beside the page title; served from the resource's public/icons (same file the manifest icons use).
const TitleMark = () => <img className="ed-mark" src="./icons/logo-tile.svg" alt="Eight-D" width="24" height="24" />;

// The full 8D form (tabs, editors, assist cards) is its own chunk; the overview and panel load without it.
const Workspace = lazy(() => import('./Workspace.jsx'));
const SeedCard = lazy(() => import('./Admin.jsx'));

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
      <h1 className="ed-title ed-heading"><TitleMark />{issueKey}{summary ? ` · ${summary}` : ''}</h1>
      <Suspense fallback={<Loading label="Loading 8D" />}>
        <Workspace issueKey={issueKey} onSummary={setSummary} />
      </Suspense>
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
          {i.issueKey ? <a href="#" className="ed-key" onClick={(e) => { e.preventDefault(); open(i.issueKey); }}>{i.issueKey}</a> : i.issueId}
          {i.summary && <span className="ed-summary" title={i.summary}>{i.summary}</span>}
        </div>
      ) },
      { key: 's', content: <span className="ed-row">{i.current}{i.lateOnD5 ? <Lozenge appearance="removed">Late on D5</Lozenge> : i.late ? <Lozenge appearance="removed">Late on {i.late}</Lozenge> : null}</span> },
      { key: 'c', content: i.containment ? <ContainmentClock clock={i.containment} /> : '' },
      { key: 'l', content: <Deadlines list={i.deadlines ?? []} /> },
      { key: 'd', content: i.daysOpen ?? '' },
      { key: 'p', content: (
        <div className="ed-pct" title={`${i.percent}% of D-steps approved`}>
          <div className="ed-progress"><div style={{ width: `${i.percent}%` }} /></div>
          <span>{i.percent}%</span>
        </div>
      ) },
    ],
  }));
  return (
    <div className="ed-page ed-col">
      <h1 className="ed-heading"><TitleMark />Open 8Ds</h1>
      <div className="ed-table">
        <DynamicTable head={head} rows={rows}
          emptyView={<EmptyState {...emptyOverviewText(data.canLoadDemo)} />} />
      </div>
      <h2>Root causes (Pareto)</h2>
      <Pareto rows={pareto} />
      <Suspense fallback={null}><SeedCard /></Suspense>
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
  const right = g.plot.x + g.plot.w;
  const small = g.slot < 84;
  return (
    <svg className="ed-pareto" viewBox={`0 0 ${g.width} ${g.height}`} width={g.width} height={g.height} role="img"
      aria-label={rows.map((r) => `${r.category} ${r.count}, cumulative ${r.cumulative}%`).join('; ')}>
      <g className="ed-pareto-legend">
        <rect x={g.plot.x} y={6} width={12} height={12} className="ed-pareto-bar" />
        <text x={g.plot.x + 18} y={16} className="ed-pareto-text">count</text>
        <line x1={g.plot.x + 76} y1={12} x2={g.plot.x + 96} y2={12} className="ed-pareto-line" />
        <circle cx={g.plot.x + 86} cy={12} r={3} className="ed-pareto-dot" />
        <text x={g.plot.x + 102} y={16} className="ed-pareto-text">cumulative %</text>
      </g>
      {g.yTicks.map((t) => (
        <g key={t.value}>
          <line x1={g.plot.x} y1={t.y} x2={right} y2={t.y} className="ed-pareto-grid" />
          <text x={g.plot.x - 6} y={t.y + 4} textAnchor="end" className="ed-pareto-muted">{t.value}</text>
        </g>
      ))}
      {[0, 50, 100].map((p) => (
        <text key={p} x={right + 6} y={g.base - (p / 100) * g.plot.h + 4} className="ed-pareto-muted">{p}%</text>
      ))}
      <line x1={g.plot.x} y1={g.base} x2={right} y2={g.base} className="ed-pareto-axis" />
      {g.bars.map((b) => (
        <g key={b.category}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} className="ed-pareto-bar"><title>{`${b.category}: ${b.count}`}</title></rect>
          <text x={b.cx} y={b.h > 18 ? b.y + 14 : b.y - 4} textAnchor="middle" className={b.h > 18 ? 'ed-pareto-inbar' : 'ed-pareto-text'}>{b.count}</text>
          <text x={b.cx} y={g.base + 16} textAnchor="middle" className="ed-pareto-text" fontSize={small ? 10 : undefined}>{b.category}<title>{b.category}</title></text>
        </g>
      ))}
      <polyline points={g.line} className="ed-pareto-line" />
      {g.points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} className="ed-pareto-dot" />
          {/* The last point sits at the right edge, so its label reads leftwards to stay inside the viewBox. */}
          <text x={i === g.points.length - 1 ? p.x - 6 : p.x + 6} y={Math.max(12, p.y - 6)}
            textAnchor={i === g.points.length - 1 ? 'end' : 'start'} className="ed-pareto-pct">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}
