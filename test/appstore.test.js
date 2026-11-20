// MCP tools run in the Confluence installation (empty app storage), so 8D records are read back from
// Jira Forge app properties (src/lib/appstore.js). They must give the same answers as the Jira side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { putRecord, getRecord, listRecords, appKey, CHUNK } from '../src/lib/appstore.js';
import { normalize, storageKey } from '../src/lib/eightd.js';
import { demoCases } from '../src/lib/seed.js';
import { overview, scaffoldWhy, previewCorrectiveActions, previewReport } from '../src/services.js';
import { mockIo } from './mock-io.js';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const BASE = '/rest/forge/1/app/properties';

// Stand-in for Jira app properties; like Jira, a GET hands the stored JSON back as a string.
function fakeAppProps() {
  const props = new Map();
  const calls = [];
  const request = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path === BASE) return { status: 200, json: { keys: [...props.keys()].map((key) => ({ key, self: `${BASE}/${key}` })) } };
    const key = decodeURIComponent(path.slice(BASE.length + 1));
    if (method === 'PUT') { const had = props.has(key); props.set(key, JSON.stringify(body)); return { status: had ? 200 : 201, json: null }; }
    if (method === 'GET') return props.has(key) ? { status: 200, json: { key, value: props.get(key) } } : { status: 404, json: null };
    throw new Error(`fake app props: ${method} ${path}`);
  };
  return { props, calls, request };
}

const cases = demoCases(NOW);
const issues = cases.map((c, i) => ({ id: String(100 + i), key: `QA-${i + 1}`, fields: { summary: c.summary, labels: c.labels, components: [], project: { key: 'QA' }, issuelinks: [] } }));
const records = () => cases.map((c, i) => normalize({ ...c.state, issueId: String(100 + i), issueKey: `QA-${i + 1}` }, String(100 + i), `QA-${i + 1}`));

// The Jira io (records in KVS) and the Confluence io (records only in app properties), as makeIo builds them.
async function twoIos() {
  const app = fakeAppProps();
  const jiraIo = mockIo({ issues });
  for (const r of records()) { await jiraIo.store.set(storageKey(r.issueId), r); await putRecord(app.request, r.issueId, r); }
  const confIo = mockIo({ issues });
  confIo.store.get = (k) => (k.startsWith('8d:') ? getRecord(app.request, k.slice(3)) : undefined);
  confIo.store.list = (prefix) => (prefix === '8d:' ? listRecords(app.request) : []);
  return { app, jiraIo, confIo };
}

test('a record over 32 KB round-trips through chunked app properties', async () => {
  const { props, request } = fakeAppProps();
  const big = { ...records()[0], note: 'é'.repeat(40000) };
  await putRecord(request, '100', big);
  assert.ok(props.size > 1, 'stored in several chunks');
  for (const v of props.values()) assert.ok(v.length <= 32768, 'every value under the Jira limit');
  assert.ok(CHUNK < 32768);
  assert.deepEqual(await getRecord(request, '100'), big);
});

test('a value Jira returns as a JSON string or as an object reads the same', async () => {
  const rec = records()[1];
  const { request, props } = fakeAppProps();
  await putRecord(request, '7', rec);
  const asObject = async (m, p) => { const r = await request(m, p); return r.json ? { ...r, json: { ...r.json, value: JSON.parse(r.json.value) } } : r; };
  assert.deepEqual(await getRecord(request, '7'), rec);
  assert.deepEqual(await getRecord(asObject, '7'), rec);
  assert.ok(props.has(appKey('7')));
});

test('Confluence read path gives the same overview, five-why, actions and report as the Jira side', async () => {
  const { jiraIo, confIo } = await twoIos();
  const want = await overview(jiraIo, NOW);
  assert.ok(want.items.length > 0);
  assert.deepEqual(await overview(confIo, NOW), want);
  for (const it of issues) {
    assert.deepEqual(await scaffoldWhy(confIo, it.key), await scaffoldWhy(jiraIo, it.key));
    assert.deepEqual(await previewReport(confIo, it.key), await previewReport(jiraIo, it.key));
    const [a, b] = await Promise.allSettled([previewCorrectiveActions(confIo, it.key), previewCorrectiveActions(jiraIo, it.key)]);
    assert.deepEqual(a, b);
  }
});

test('Confluence list still shows only work items the caller can see', async () => {
  const { app } = await twoIos();
  const hidden = mockIo({ issues, visibleProjects: [] });
  hidden.store.list = () => listRecords(app.request);
  assert.deepEqual((await overview(hidden, NOW)).items, []);
});

test('fresh install with zero 8Ds: empty list, missing record, fresh state', async () => {
  const { request } = fakeAppProps();
  assert.deepEqual(await listRecords(request), []);
  assert.equal(await getRecord(request, '555'), undefined);
  const io = mockIo({ issues });
  io.store.get = (k) => getRecord(request, k.slice(3));
  io.store.list = () => listRecords(request);
  assert.deepEqual((await overview(io, NOW)).items, []);
  const s = normalize(await getRecord(request, '555'), '555', 'QA-555');
  assert.ok(s.steps.D1 && !s.steps.D1.approvedBy);
});

test('privacy: 8D text only goes to app properties, never to an issue property', async () => {
  const { calls, request } = fakeAppProps();
  await putRecord(request, '100', records()[0]);
  assert.ok(calls.every((c) => c.path.startsWith(BASE)));
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/services.js', import.meta.url), 'utf8');
  const issueProps = [...src.matchAll(/\/properties\/[^\n]*/g)].map((m) => m[0]);
  for (const line of issueProps) assert.match(line, /method: 'DELETE'/, `issue property call that is not a cleanup DELETE: ${line}`);
  assert.doesNotMatch(readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8'), /jira:entityProperty/);
});
