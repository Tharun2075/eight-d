import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLateOnD5, lateStep, paretoCauses, paretoGeometry, overviewRow } from '../src/lib/overview.js';
import { demoCases } from '../src/lib/seed.js';
import { normalize, storageKey } from '../src/lib/eightd.js';
import { overview } from '../src/services.js';
import { mockIo } from './mock-io.js';

const NOW = Date.parse('2026-11-18T00:00:00Z');
const cases = demoCases(NOW);

test('late on D5: open case waiting on D5 past 30 days; fresh case is not', () => {
  const nut = cases.find((c) => /weld nut/i.test(c.summary)).state;
  const fresh = cases.find((c) => /scratch/i.test(c.summary)).state;
  assert.equal(isLateOnD5(normalize(nut), NOW), true);
  assert.equal(isLateOnD5(normalize(fresh), NOW), false);
  assert.equal(lateStep(normalize(fresh), NOW), 'D3'); // D3 due day 2, started 6 days ago
  assert.equal(isLateOnD5(normalize(nut), Date.parse(nut.startedAt) + 10 * 86400000), false);
});

test('pareto counts approved D4 causes only, sorted, cumulative ends at 100', () => {
  const states = cases.map((c) => normalize(c.state));
  const rows = paretoCauses(states);
  assert.equal(rows.reduce((a, r) => a + r.count, 0), 8); // 6 closed + the open case approved to D4 + the hero
  assert.equal(rows[0].category, 'Machine');
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].count >= rows[i].count);
  assert.equal(rows.at(-1).cumulative, 100);
  const unapproved = normalize(cases[0].state);
  unapproved.steps.D4.approvedBy = null;
  assert.equal(paretoCauses([unapproved]).length, 0);
});

test('pareto geometry: tallest bar first, line points match bars', () => {
  const g = paretoGeometry(paretoCauses(cases.map((c) => normalize(c.state))));
  assert.equal(g.bars[0].h, Math.max(...g.bars.map((b) => b.h)));
  assert.equal(g.line.split(' ').length, g.bars.length);
  assert.deepEqual(paretoGeometry([]).bars, []);
});

test('overview service returns only visible records with late flags and pareto', async () => {
  const issues = cases.map((c, i) => ({ id: String(100 + i), key: `QA-${i + 1}`, fields: { summary: c.summary, labels: c.labels, project: { key: 'QA' } } }));
  const io = mockIo({ issues });
  cases.forEach((c, i) => io.store.set(storageKey(String(100 + i)), { ...c.state, issueId: String(100 + i), issueKey: `QA-${i + 1}` }));
  const r = await overview(io, NOW);
  assert.equal(r.items.length, 3);
  assert.equal(r.items.filter((x) => x.lateOnD5).length, 1);
  assert.equal(r.pareto[0].category, 'Machine');
});

test('overview row carries the D3 containment clock and the 24h / 5d / 30d customer deadlines', () => {
  const start = Date.parse('2026-11-01T00:00:00Z');
  const s = { ...normalize({ steps: {} }, '5', 'QA-5'), startedAt: new Date(start).toISOString() };
  const row = overviewRow(s, start + 60 * 3600000);
  assert.equal(row.containment.status, 'late');
  assert.deepEqual(row.deadlines.map((d) => d.id), ['24h', '5d', '30d']);
  assert.deepEqual(row.deadlines.map((d) => d.late), [true, false, false]);
});
