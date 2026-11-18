// Pure logic for the overview page: late flags and the root-cause Pareto (plain SVG geometry).
import { STEPS, CAUSE_CATEGORIES, currentStep, progress, containmentClock, customerDeadlines } from './eightd.js';

// Days after the 8D starts by which each step should be approved (common customer targets:
// containment in 24 h (late after 48 h), root cause in 5 days, permanent fix verified in 30 days).
export const DUE_DAYS = { D1: 1, D2: 2, D3: 2, D4: 5, D5: 20, D6: 30, D7: 45, D8: 60 };
const DAY = 86400000;

export function daysOpen(state, now = Date.now()) {
  const start = Date.parse(state.startedAt ?? '');
  return Number.isFinite(start) ? Math.floor((now - start) / DAY) : null;
}

// Late = the current step's due day has passed.
export function lateStep(state, now = Date.now()) {
  const step = currentStep(state);
  const days = daysOpen(state, now);
  return step && days !== null && days > DUE_DAYS[step] ? step : null;
}

export const isLateOnD5 = (state, now = Date.now()) => lateStep(state, now) === 'D5';

export function overviewRow(state, now = Date.now()) {
  return {
    issueKey: state.issueKey, issueId: state.issueId, current: currentStep(state), ...progress(state),
    daysOpen: daysOpen(state, now), late: lateStep(state, now), lateOnD5: isLateOnD5(state, now),
    containment: containmentClock(state, now), deadlines: customerDeadlines(state, now),
  };
}

// Counts the APPROVED D4 cause category of each record, biggest first, with the cumulative share.
export function paretoCauses(states) {
  const counts = new Map();
  for (const s of states) {
    const d4 = s?.steps?.D4;
    const cat = d4?.approvedBy ? String(d4.fields?.causeCategory ?? '').trim() : '';
    if (!cat) continue;
    const name = CAUSE_CATEGORIES.find((c) => c.toLowerCase() === cat.toLowerCase()) ?? 'Other';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  let run = 0;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => { run += count; return { category, count, cumulative: Math.round((run / total) * 100) }; });
}

// Bar and cumulative-line geometry for an SVG of width x height (no chart library).
export function paretoGeometry(rows, { width = 560, height = 240, pad = 32 } = {}) {
  if (!rows.length) return { bars: [], line: '', width, height, pad };
  const max = rows[0].count;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;
  const slot = plotW / rows.length;
  const bars = rows.map((r, i) => {
    const h = (r.count / max) * plotH;
    return { ...r, x: pad + i * slot + slot * 0.15, y: pad + plotH - h, w: slot * 0.7, h, cx: pad + i * slot + slot / 2 };
  });
  const line = bars.map((b) => `${b.cx.toFixed(1)},${(pad + plotH - (b.cumulative / 100) * plotH).toFixed(1)}`).join(' ');
  return { bars, line, width, height, pad };
}

export { STEPS };
