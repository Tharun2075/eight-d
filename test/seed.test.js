import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demoCases, PART_FAMILY, HERO_PART } from '../src/lib/seed.js';
import { gateProblems, containmentClock, storageKey } from '../src/lib/eightd.js';
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

// Wraps the mock Confluence so a test can answer some calls itself (status errors like the live site).
function withConfluence(io, handler) {
  const base = io.confluence;
  io.confluence = async (method, path, body) => {
    const out = await handler(method, path, body);
    if (out !== undefined) { io.calls.push({ product: 'confluence', method, path, body }); return out; }
    return base(method, path, body);
  };
  return io;
}
const httpError = (status, msg) => Object.assign(new Error(`confluence returned ${status}: ${msg}`), { status });

test('seedDemo: page create 400 "already exists" reuses the page found by title', async () => {
  const titles = new Map();
  const io = withConfluence(mockIo({ perms: { ADMINISTER: true } }), (method, path, body) => {
    if (method === 'POST' && path === '/wiki/api/v2/pages') {
      titles.set(body.title, `9${titles.size}`);
      throw httpError(400, 'A page with this title already exists');
    }
    if (method === 'GET' && path.startsWith('/wiki/api/v2/spaces/7/pages?title=')) {
      const title = decodeURIComponent(path.split('title=')[1].split('&')[0]);
      return { results: [{ id: titles.get(title), title }] };
    }
    return undefined;
  });
  const r = await svc.seedDemo(io, { projectKey: 'QA', spaceId: '7' });
  assert.equal(r.more, false);
  assert.deepEqual(r.created, { issues: 9, pages: 0 });
  const saved = await io.store.get('seed:demo');
  const ids = Object.values(saved.cases).filter((c) => c.pageId).map((c) => c.pageId);
  assert.deepEqual(ids, [...titles.values()]);
  assert.equal(ids.length, 6);
  assert.equal(io.calls.filter((c) => c.path.endsWith('/label')).length, 6);
});

test('seedDemo: out of time returns more:true, the next call finishes with no duplicates', async () => {
  const io = mockIo({ perms: { ADMINISTER: true } });
  let t = 0;
  const clock = () => { t += 1000; return t; }; // every check moves 1 s
  const first = await svc.seedDemo(io, { projectKey: 'QA', spaceId: '7', clock, budgetMs: 3500 });
  assert.equal(first.more, true);
  assert.ok(first.done > 0 && first.done < 9, `done ${first.done}`);
  t = 0;
  const second = await svc.seedDemo(io, { projectKey: 'QA', spaceId: '7', clock: () => 0 });
  assert.equal(second.more, false);
  assert.equal(second.done, 9);
  assert.equal(first.created.issues + second.created.issues, 9);
  assert.equal(first.created.pages + second.created.pages, 6);
  assert.equal(io.calls.filter((c) => c.method === 'POST' && c.path === '/rest/api/3/issue').length, 9);
  assert.equal(io.calls.filter((c) => c.method === 'POST' && c.path === '/wiki/api/v2/pages').length, 6);
});

test('seedDemo: label 401 still saves pageId, shows a warning, and a rerun adds only the labels', async () => {
  let deny = true;
  const io = withConfluence(mockIo({ perms: { ADMINISTER: true } }), (method, path) => {
    if (deny && path.endsWith('/label')) throw httpError(401, 'scope does not match');
    return undefined;
  });
  const r = await svc.seedDemo(io, { projectKey: 'QA', spaceId: '7' });
  assert.deepEqual(r.created, { issues: 9, pages: 6 });
  assert.match(r.warning, /labels could not be added.*401/);
  const saved = await io.store.get('seed:demo');
  assert.equal(Object.values(saved.cases).filter((c) => c.pageId).length, 6);
  deny = false;
  const before = io.calls.length;
  const again = await svc.seedDemo(io, { projectKey: 'QA', spaceId: '7' });
  assert.deepEqual(again.created, { issues: 0, pages: 0 });
  assert.equal(again.warning, null);
  const posts = io.calls.slice(before).filter((c) => c.method === 'POST' && !c.path.includes('mypermissions'));
  assert.equal(posts.length, 6);
  assert.ok(posts.every((c) => c.path.endsWith('/label')));
});

test('seed: every work item gets an ADF complaint description (who, how many, lot, date)', () => {
  const now = Date.parse('2026-11-18');
  for (const c of demoCases(now)) {
    assert.equal(c.description.type, 'doc');
    assert.equal(c.description.version, 1);
    const text = c.description.content.map((p) => p.content[0].text).join(' ');
    assert.ok(c.description.content.length >= 3, c.ref);
    assert.match(text, /complaint received \d{4}-\d{2}-\d{2}/);
    assert.match(text, /lot L-\d{4}/);
    assert.match(text, /\d+ (affected parts|cracked)/);
    assert.match(text, /Northfield Stamping/);
  }
});

test('seed: closed items move with the done-category transition; a rerun does not repeat it', async () => {
  const io = mockIo({ perms: { ADMINISTER: true } });
  await svc.seedDemo(io, { projectKey: 'QA', spaceId: '', now: Date.parse('2026-11-18') });
  const moves = io.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/transitions'));
  assert.equal(moves.length, 6);
  assert.ok(moves.every((m) => m.body.transition.id === '31'));
  const created = io.calls.filter((c) => c.method === 'POST' && c.path === '/rest/api/3/issue');
  assert.ok(created.every((c) => c.body.fields.description.type === 'doc'));
  const before = io.calls.length;
  await svc.seedDemo(io, { projectKey: 'QA', spaceId: '', now: Date.parse('2026-11-18') });
  assert.equal(io.calls.slice(before).filter((c) => c.path.endsWith('/transitions')).length, 0);
});

test('seed: no done-category transition skips the move and says so; older seeds get descriptions', async () => {
  const io = mockIo({ perms: { ADMINISTER: true }, transitions: [{ id: '11', to: { statusCategory: { key: 'indeterminate' } } }] });
  await io.store.set('seed:demo', { cases: { 'demo-1': { id: '901', key: 'QA-901' } } }); // seeded before descriptions existed
  const r = await svc.seedDemo(io, { projectKey: 'QA', spaceId: '', now: Date.parse('2026-11-18') });
  assert.equal(io.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/transitions')).length, 0);
  assert.match(r.warning, /No transition to a Done status/);
  const put = io.calls.find((c) => c.method === 'PUT' && c.path === '/rest/api/3/issue/QA-901');
  assert.equal(put.body.fields.description.type, 'doc');
});

test('seed: a finished seed calls graphSync once and returns its raw result; errors do not fail the seed', async () => {
  const io = mockIo({ perms: { ADMINISTER: true } });
  let n = 0;
  io.graphSync = async () => { n += 1; return { sent: 9, batches: 1, rejected: 0 }; };
  const r = await svc.seedDemo(io, { projectKey: 'QA', spaceId: '', now: Date.parse('2026-11-18') });
  assert.deepEqual(r.graph, { sent: 9, batches: 1, rejected: 0 });
  assert.equal(n, 1);
  io.graphSync = async () => { throw new Error('no connection'); };
  const r2 = await svc.seedDemo(io, { projectKey: 'QA', spaceId: '', now: Date.parse('2026-11-18') });
  assert.deepEqual(r2.graph, { error: 'no connection' });
});

test('graphSync resolver: admin only, returns the raw connector counts', async () => {
  const raw = { sent: 7, batches: 1, rejected: [] };
  let calls = 0;
  const user = mockIo({ perms: { EDIT_ISSUES: true } });
  user.graphSync = async () => { calls += 1; return raw; };
  await assert.rejects(svc.graphSync(user), /Only a Jira admin/);
  assert.equal(calls, 0);
  const admin = mockIo({ perms: { ADMINISTER: true } });
  admin.graphSync = async () => { calls += 1; return raw; };
  assert.deepEqual(await svc.graphSync(admin), raw);
  assert.equal(calls, 1);
});

test('seedDemo adopt: an exact summary match in the project is adopted, not created again', async () => {
  const now = Date.parse('2026-11-18');
  const first = demoCases(now)[0];
  const io = mockIo({ perms: { ADMINISTER: true }, issues: [{ id: '501', key: 'QA-501', fields: { summary: first.summary, labels: first.labels, project: { key: 'QA' } } }] });
  const r = await svc.seedDemo(io, { projectKey: 'QA', now });
  assert.equal(r.created.issues, 8);
  assert.equal(io.calls.filter((c) => c.method === 'POST' && c.path === '/rest/api/3/issue').length, 8);
  assert.ok(r.keys.includes('QA-501'));
  assert.equal((await io.store.get(storageKey('501'))).issueKey, 'QA-501');
  assert.ok(io.calls.some((c) => c.method === 'PUT' && c.path === '/rest/api/3/issue/QA-501'));
});

test('seedDemo adopt: a near match (different summary) is not adopted, a work item is created', async () => {
  const now = Date.parse('2026-11-18');
  const first = demoCases(now)[0];
  const io = mockIo({ perms: { ADMINISTER: true }, issues: [{ id: '501', key: 'QA-501', fields: { summary: `${first.summary} (copy)`, labels: first.labels, project: { key: 'QA' } } }] });
  const r = await svc.seedDemo(io, { projectKey: 'QA', now });
  assert.equal(r.created.issues, 9);
  assert.ok(!r.keys.includes('QA-501'));
});

test('seedDemo adopt: a failing search falls back to creating the work item', async () => {
  const io = mockIo({ perms: { ADMINISTER: true } });
  const base = io.jira;
  io.jira = async (m, p, b) => { if (p === '/rest/api/3/search/jql') throw new Error('search down'); return base(m, p, b); };
  const r = await svc.seedDemo(io, { projectKey: 'QA', now: Date.parse('2026-11-18') });
  assert.equal(r.created.issues, 9);
});
