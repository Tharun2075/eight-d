import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demoCases, PART_FAMILY, HERO_PART } from '../src/lib/seed.js';
import { gateProblems, containmentClock } from '../src/lib/eightd.js';
import { correctiveActionDrafts } from '../src/lib/actions.js';
import * as svc from '../src/services.js';
import { mockIo } from './mock-io.js';

// Real carmakers, suppliers and trade names that must never appear in the demo data.
const REAL_NAMES = /\b(toyota|honda|nissan|mazda|subaru|suzuki|ford|gm\b|general motors|chevrolet|chrysler|stellantis|jeep|tesla|bmw|mercedes|daimler|audi|volkswagen|vw\b|porsche|volvo|renault|peugeot|citroen|fiat|ferrari|hyundai|kia|tata|mahindra|bosch|continental|denso|magna|aisin|zf\b|valeo|faurecia|lear|aptiv|delphi|schaeffler|thyssenkrupp|arcelor|nippon steel|posco|boeing|airbus|siemens|fanuc|kuka|abb\b|trumpf|amada)\b/i;

test('seed data: no OEM or real company names (grep)', () => {
  const src = readFileSync(new URL('../src/lib/seed.js', import.meta.url), 'utf8').replace(/^\/\/.*$/gm, '');
  assert.equal(src.match(REAL_NAMES), null);
  assert.equal(JSON.stringify(demoCases(Date.parse('2026-11-18'))).match(REAL_NAMES), null);
});

test('seed data: 6 closed with approved D4, 3 open, all on BRKT-200 or the hero part', () => {
  const cases = demoCases(Date.parse('2026-11-18'));
  assert.equal(cases.length, 9);
  const closed = cases.filter((c) => c.closed);
  assert.equal(closed.length, 6);
  for (const c of closed) {
    assert.ok(c.state.steps.D4.approvedBy && c.state.steps.D4.fields.fiveWhys.includes('5.'));
    assert.ok(c.state.steps.D8.approvedBy);
    assert.equal(correctiveActionDrafts(c.state).drafts.length, 1);
    for (const step of ['D4', 'D7', 'D8']) assert.deepEqual(gateProblems(c.state, step), [], `${c.summary} ${step}`);
  }
  assert.ok(cases.every((c) => c.labels.includes(PART_FAMILY) || c.labels.includes(HERO_PART)));
  assert.ok(new Set(closed.map((c) => c.state.steps.D4.fields.causeCategory)).size >= 4); // Pareto needs a spread
});

test('seedDemo: non-admin is refused and nothing is written', async () => {
  const io = mockIo({ perms: { ADMINISTER: false } });
  await assert.rejects(svc.seedDemo(io, { projectKey: 'QA', spaceId: '7' }), /admin/);
  assert.equal(io.calls.filter((c) => c.method === 'POST').length, 0);
});

test('seed hero: BR-4417 lot L-2291 with killed and confirmed causes, contained in 24 h, D7 ready', () => {
  const hero = demoCases(Date.parse('2026-11-18')).find((c) => c.ref === 'demo-hero');
  assert.ok(hero.labels.includes(HERO_PART) && hero.summary.includes('L-2291') && hero.summary.includes('Northfield Stamping'));
  const causes = hero.state.data.causes;
  assert.equal(causes.filter((c) => c.status === 'killed').length, 2);
  assert.deepEqual(causes.filter((c) => c.status === 'confirmed').map((c) => c.kind).sort(), ['escape', 'occurrence']);
  assert.match(hero.state.steps.D3.fields.actions, /640.*310.*41/);
  assert.equal(containmentClock(hero.state).status, 'contained-on-time');
  assert.ok(hero.state.steps.D6.approvedBy && !hero.state.steps.D7.approvedBy && !hero.closed);
  assert.deepEqual(gateProblems(hero.state, 'D7'), []);
  assert.deepEqual(gateProblems(hero.state, 'D8'), []);
});

test('seedDemo: admin creates 9 work items and 6 labelled root-cause pages; rerun creates nothing', async () => {
  const io = mockIo({ perms: { ADMINISTER: true } });
  const r = await svc.seedDemo(io, { projectKey: 'QA', spaceId: '7', now: Date.parse('2026-11-18') });
  assert.deepEqual(r.created, { issues: 9, pages: 6 });
  const pages = io.calls.filter((c) => c.method === 'POST' && c.path === '/wiki/api/v2/pages');
  assert.ok(pages.every((p, i) => p.body.title.startsWith(`Root cause ${r.keys[i]}`)));
  const labels = io.calls.filter((c) => c.path.endsWith('/label'));
  assert.ok(labels.every((l) => l.body.some((x) => x.name === 'root-cause') && l.body.some((x) => x.name === 'brkt-200')));
  const before = io.calls.length;
  const again = await svc.seedDemo(io, { projectKey: 'QA', spaceId: '7' });
  assert.deepEqual(again.created, { issues: 0, pages: 0 });
  assert.equal(io.calls.slice(before).filter((c) => c.method === 'POST' && !c.path.includes('mypermissions')).length, 0);
});
