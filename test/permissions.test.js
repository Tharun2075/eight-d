// Permission mock: a user who can browse only project QA must see nothing from project SEC,
// through any action, the panel helpers, the overview or the graph path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { initialState, reducer, STEPS } from '../src/lib/eightd.js';
import * as svc from '../src/services.js';
import { mockIo, issue } from './mock-io.js';

const at = '2026-11-18T00:00:00.000Z';
const SECRET = 'SECRET-CAUSE: restricted supplier deviation';
const approved = (id, key, fiveWhys, upTo = 'D8') => {
  let s = reducer(initialState(id, key), { type: 'setField', stepId: 'D4', field: 'fiveWhys', value: fiveWhys });
  s = reducer(s, { type: 'setField', stepId: 'D4', field: 'causeCategory', value: 'Material' });
  s = reducer(s, { type: 'setField', stepId: 'D5', field: 'actions', value: `${SECRET} | owner: x` });
  for (const st of STEPS.slice(0, STEPS.findIndex((x) => x.id === upTo) + 1)) s = reducer(s, { type: 'approve', stepId: st.id, accountId: 'u9', at });
  return s;
};

function setup(graph) {
  const open = issue(1, 'QA-1', 'QA', 'Burr on BRKT-200 bracket edge', ['BRKT-200'], 'Open');
  const mine = issue(2, 'QA-2', 'QA', 'Past bracket burr', ['BRKT-200']);
  const secret = issue(50, 'SEC-1', 'SEC', 'Restricted BRKT-200 nonconformance', ['BRKT-200']);
  const io = mockIo({ issues: [open, mine, secret], visibleProjects: ['QA'], graph });
  io.put('2', approved('2', 'QA-2', '1. Punch die worn'));
  io.put('50', approved('50', 'SEC-1', SECRET));
  io.put('51', { ...approved('51', 'SEC-2', SECRET, 'D4'), closed: false }); // open 8D in SEC
  return io;
}
const leaks = (obj) => /SEC-|SECRET/.test(JSON.stringify(obj));

test('restricted user: findSimilar and the 5-Why scaffold show nothing from another project', async () => {
  const io = setup();
  assert.equal(leaks(await svc.findSimilar(io, 'QA-1')), false);
  assert.equal(leaks(await svc.scaffoldWhy(io, 'QA-1')), false);
});

test('restricted user: graph keys from another project are re-read as the user and dropped', async () => {
  const io = setup({ related: async () => ['SEC-1', 'QA-2'] });
  const res = await svc.findSimilar(io, 'QA-1');
  assert.equal(res.source, 'teamwork-graph');
  assert.deepEqual(res.rows.map((r) => r.key), ['QA-2']);
});

test('restricted user: overview list and Pareto exclude another project', async () => {
  const io = setup();
  const r = await svc.overview(io);
  assert.equal(leaks(r.items), false);
  assert.deepEqual(r.pareto, [{ category: 'Material', count: 1, cumulative: 100 }]); // QA-2 only; SEC-1/SEC-2 would make 3
});

test('restricted user: actions and reports on another project fail, nothing is written', async () => {
  const io = setup();
  for (const fn of [svc.previewCorrectiveActions, svc.previewReport, svc.scaffoldWhy, svc.createCorrectiveActions]) {
    await assert.rejects(fn(io, 'SEC-1'));
  }
  await assert.rejects(svc.generateReport(io, 'SEC-1', '1'));
  assert.equal(io.calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/search/jql')).length, 0);
});

test('every product call in src runs as the signed-in user (no asApp)', () => {
  const files = ['src/index.js', 'src/services.js', ...readdirSync('src/lib').map((f) => `src/lib/${f}`)];
  for (const f of files) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /asApp\s*\(/, f);
    for (const m of src.matchAll(/\.(requestJira|requestConfluence|requestGraph)\b/g)) {
      assert.match(src.slice(Math.max(0, m.index - 12), m.index), /asUser\(\)$/, `${f}: ${m[1]} must follow asUser()`);
    }
  }
});
