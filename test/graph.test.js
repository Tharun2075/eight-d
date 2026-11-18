import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, reducer, STEPS } from '../src/lib/eightd.js';
import {
  buildQualityObject, referenceObjects, statusObject, pushObjects, syncConnector, makeGraphReader, loadClient, tgEnabled, BATCH, graphCheck, CHECK_ID,
} from '../src/graph.js';
import * as svc from '../src/services.js';
import { mockIo, issue, fillGates } from './mock-io.js';

const approve = (s, id) => reducer(fillGates(s), { type: 'approve', stepId: id, accountId: 'u1', at: '2026-11-18T00:00:00.000Z' });
const fakeClient = () => {
  const sent = [];
  return { sent, async setObjects({ objects, connectionId }) { sent.push({ n: objects.length, connectionId }); return { results: { accepted: objects.length, rejected: [] } }; } };
};

test('graph objects: part, 3 machines, lots and 8D status are atlassian:document with a kind', () => {
  const objs = referenceObjects('https://x.atlassian.net');
  const kinds = objs.map((o) => o.attributes.kind);
  assert.equal(kinds.filter((k) => k === 'part').length, 1);
  assert.deepEqual(objs.filter((o) => o.attributes.kind === 'machine').map((o) => o.id), ['machine:PR-3', 'machine:LC-1', 'machine:WR-2']);
  assert.ok(kinds.filter((k) => k === 'supplier-lot').length >= 3);
  for (const o of objs) {
    assert.equal(o.schemaVersion, '1.0');
    assert.ok(o['atlassian:document']);
  }
  let s = initialState('7', 'QA-7');
  s = { ...reducer(s, { type: 'setField', stepId: 'D2', field: 'what', value: 'DRAFT SECRET' }) };
  s = approve(approve(s, 'D1'), 'D2');
  const st = statusObject(s, 'https://x.atlassian.net');
  assert.equal(st.id, '8d-status:7');
  assert.deepEqual([st.attributes.step, st.attributes.approved, st.attributes.closed], ['D3', 2, false]);
  assert.equal(st.url, 'https://x.atlassian.net/browse/QA-7');
  assert.doesNotMatch(JSON.stringify(st), /DRAFT SECRET/, 'status objects carry no step text');
  assert.throws(() => buildQualityObject({ kind: 'customer', id: 1, name: 'x' }));
});

test('graph push: batches of 100 with the connection id', async () => {
  const c = fakeClient();
  const objs = Array.from({ length: 250 }, (_, i) => buildQualityObject({ kind: 'part', id: i, name: `P${i}` }));
  const r = await pushObjects(c, objs, 'conn-1');
  assert.equal(BATCH, 100);
  assert.deepEqual(c.sent.map((b) => b.n), [100, 100, 50]);
  assert.ok(c.sent.every((b) => b.connectionId === 'conn-1'));
  assert.deepEqual([r.sent, r.batches, r.rejected.length], [250, 3, 0]);
});

test('graph sync: on by default, status only with TG_STATUS_PUBLIC, TG_ENABLED=false pushes nothing, no client skips', async () => {
  assert.equal(tgEnabled({}), true);
  assert.equal(tgEnabled({ TG_ENABLED: 'false' }), false);
  const records = [approve(initialState('1', 'QA-1'), 'D1')];
  const on = fakeClient();
  const r = await syncConnector({ client: on, records, connectionId: 'c', env: {} });
  assert.equal(r.sent, referenceObjects().length, 'no work item keys leave by default');
  const pub = await syncConnector({ client: fakeClient(), records, connectionId: 'c', env: { TG_STATUS_PUBLIC: 'true' } });
  assert.equal(pub.sent, referenceObjects().length + 1);
  const off = fakeClient();
  assert.match((await syncConnector({ client: off, records, env: { TG_ENABLED: 'false' } })).skipped, /TG_ENABLED/);
  assert.equal(off.sent.length, 0);
  assert.match((await syncConnector({ client: null, records, env: {} })).skipped, /not available/);
  assert.equal(typeof (await loadClient()).setObjects, 'function', 'static import gives the real client (default ?? module)');
});

test('graph check: pushes one test document, reads it back, reports raw outcome; no connection skips', async () => {
  const sent = [];
  const client = {
    setObjects: async (r) => { sent.push(r); return { success: true, results: { accepted: [{ externalId: CHECK_ID }], rejected: [] } }; },
    getObjectByExternalId: async (r) => ({ success: r.externalId === CHECK_ID && r.connectionId === 'c1', object: { id: CHECK_ID } }),
  };
  const r = await graphCheck({ client, connectionId: 'c1', env: {} });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].objects.length, 1);
  assert.deepEqual([r.push.success, r.push.accepted, r.read.success, r.read.found], [true, 1, true, true]);
  const bad = { setObjects: async () => ({ success: false, error: 'Forbidden', originalError: { status: 403 } }), getObjectByExternalId: async () => { throw new Error('nope'); } };
  const b = await graphCheck({ client: bad, connectionId: 'c1', env: {} });
  assert.deepEqual([b.push.status, b.push.error, b.read.success, b.read.error], [403, 'Forbidden', false, 'nope']);
  assert.match((await graphCheck({ client, connectionId: '', env: {} })).skipped, /No connection/);
});

test('graph read: keys come back through Jira as the user; a failure falls back to Jira links + Confluence', async () => {
  const open = issue(1, 'QA-1', 'QA', 'Burr on BRKT-200', ['BRKT-200'], 'Open');
  const linked = issue(3, 'QA-3', 'QA', 'Linked bracket defect', ['OTHER']);
  open.fields.issuelinks = [{ outwardIssue: linked }];
  const past = issue(2, 'QA-2', 'QA', 'Past BRKT-200 defect', ['BRKT-200']);
  const pages = [{ content: { title: 'Root cause QA-2', _links: { webui: '/spaces/QA/pages/1' }, metadata: { labels: { results: [{ name: 'root-cause' }] } } }, excerpt: '' }];
  const issues = [open, past, linked];

  const ok = makeGraphReader(async () => ({ data: { eightd_relatedIssues: { issueSearch: { edges: [{ node: { key: 'QA-2' } }] } } } }), {});
  const viaGraph = await svc.findSimilar(mockIo({ issues, pages, graph: ok }), 'QA-1');
  assert.equal(viaGraph.source, 'teamwork-graph');
  assert.deepEqual(viaGraph.rows.map((r) => r.key), ['QA-2']);

  for (const bad of [async () => { throw new Error('403'); }, async () => ({ errors: [{ message: 'not allowlisted' }] }), async () => ({ data: {} })]) {
    const io = mockIo({ issues, pages, graph: makeGraphReader(bad, {}) });
    const res = await svc.findSimilar(io, 'QA-1');
    assert.equal(res.source, 'jira');
    assert.ok(res.rows.some((r) => r.key === 'QA-3'), 'issue link used');
    assert.ok(io.calls.some((c) => c.product === 'confluence' && c.path.includes('cql=')), 'Confluence search used');
  }
  assert.equal(makeGraphReader(async () => ({}), { TG_ENABLED: 'false' }), null);
});

test('manifest: connector declared, no external permissions, teamwork-graph is the real dependency', () => {
  const m = readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8');
  assert.match(m, /graph:connector:/);
  assert.doesNotMatch(m, /permissions:[\s\S]*external/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.dependencies['@forge/teamwork-graph'], /^\^?5\./);
  assert.equal(STEPS.length, 8);
});
