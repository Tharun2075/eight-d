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

// Bar and cumulative-line geometry for a fixed-size SVG (no chart library): a count axis on the
// left, a 0-100 % axis on the right, room above for the legend and below for category names.
export function paretoGeometry(rows, { width = 640, height = 240, left = 36, right = 40, top = 32, bottom = 28 } = {}) {
  const plot = { x: left, y: top, w: width - left - right, h: height - top - bottom };
  const base = plot.y + plot.h;
  if (!rows.length) return { bars: [], points: [], line: '', yTicks: [], width, height, plot, base };
  const step = Math.max(1, Math.ceil(rows[0].count / 4));
  const max = step * Math.ceil(rows[0].count / step);
  const slot = plot.w / rows.length;
  const bars = rows.map((r, i) => {
    const h = (r.count / max) * plot.h;
    return { ...r, x: plot.x + i * slot + slot * 0.2, y: base - h, w: slot * 0.6, h, cx: plot.x + i * slot + slot / 2 };
  });
  const points = bars.map((b) => ({ x: b.cx, y: base - (b.cumulative / 100) * plot.h, label: `${b.cumulative}%` }));
  const yTicks = [];
  for (let v = 0; v <= max; v += step) yTicks.push({ value: v, y: base - (v / max) * plot.h });
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return { bars, points, line, yTicks, width, height, plot, base, slot };
}

// Empty overview text: the demo-data hint only for a user who may load it (admin), plain text for everyone else.
export const emptyOverviewText = (canLoadDemo) => (canLoadDemo
  ? { header: 'No open 8D reports', description: 'Open a work item and start its 8D, or load the demo data below.' }
  : { header: 'No open 8D reports you can see.', description: 'Open a work item and start its 8D.' });

export { STEPS };
