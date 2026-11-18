import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reducer, STEPS } from '../src/lib/eightd.js';
import { buildSimilarJql, buildRootCauseCql, rankSimilar, partFamilies } from '../src/lib/similar.js';
import { scaffoldFiveWhy, pickWhy, formatFiveWhy, WHY_LEVELS } from '../src/lib/fivewhy.js';
import { correctiveActionDrafts, buildIssuePayload } from '../src/lib/actions.js';
import { buildReport } from '../src/lib/report.js';
import * as svc from '../src/services.js';
import { mockIo, issue } from './mock-io.js';

const at = '2026-11-18T00:00:00.000Z';
const set = (s, stepId, field, value) => reducer(s, { type: 'setField', stepId, field, value });
const approve = (s, stepId) => reducer(s, { type: 'approve', stepId, accountId: 'u1', at });
const approveTo = (s, last) => STEPS.slice(0, STEPS.findIndex((x) => x.id === last) + 1).reduce((a, x) => approve(a, x.id), s);
const CHAIN = '1. Burr on bracket edge\n2. Punch die worn\n3. Die change interval too long\n4. Interval not tied to stroke count\n5. PM plan never reviewed';

function world() {
  const open = issue(1, 'QA-1', 'QA', 'Burr on BRKT-200 bracket edge', ['BRKT-200'], 'Open');
  const past = [2, 3, 4, 5].map((n) => issue(n, `QA-${n}`, 'QA', `Past bracket defect ${n}`, ['BRKT-200']));
  const other = issue(9, 'QA-9', 'QA', 'Paint run on panel', ['PNL-100']);
  const secret = issue(50, 'SEC-1', 'SEC', 'Restricted BRKT-200 nonconformance', ['BRKT-200']);
  const pages = [{ content: { title: 'Root cause QA-2: worn punch die', _links: { webui: '/spaces/QA/pages/1' }, metadata: { labels: { results: [{ name: 'root-cause' }, { name: 'brkt-200' }] } } }, excerpt: 'die' }];
  return { open, past, other, secret, pages, issues: [open, ...past, other, secret] };
}

test('similar: JQL uses the part family and excludes the work item itself; CQL looks for root-cause pages', () => {
  const { open } = world();
  assert.deepEqual(partFamilies(open), ['BRKT-200']);
  assert.match(buildSimilarJql(open), /labels in \("BRKT-200"\) AND key != "QA-1"/);
  assert.match(buildRootCauseCql(open), /label = "root-cause"/);
  assert.match(buildRootCauseCql(open), /brkt-200/);
});

test('findSimilarNonconformances returns 3 rows with Jira and Confluence citations', async () => {
  const w = world();
  const io = mockIo({ issues: w.issues, pages: w.pages, visibleProjects: ['QA'] });
  io.put('2', approveTo(set(initialState('2', 'QA-2'), 'D4', 'fiveWhys', CHAIN), 'D4'));
  const res = await svc.findSimilar(io, 'QA-1');
  assert.equal(res.rows.length, 3);
  assert.equal(res.source, 'jira');
  for (const r of res.rows) {
    assert.ok(r.citations.length >= 1);
    assert.match(r.citations[0].url, /\/browse\/QA-\d$/);
    assert.notEqual(r.key, 'QA-1');
    assert.notEqual(r.key, 'QA-9');
  }
  const qa2 = res.rows.find((r) => r.key === 'QA-2');
  assert.ok(qa2, 'QA-2 is among the rows');
  assert.equal(qa2.rootCause, CHAIN);
  assert.ok(qa2.citations.some((c) => c.url.includes('/wiki/spaces/QA/pages/1')));
});

test('findSimilar: a root cause that is only a draft (D4 not approved) is not shown', async () => {
  const w = world();
  const io = mockIo({ issues: w.issues, visibleProjects: ['QA'] });
  io.put('2', set(initialState('2', 'QA-2'), 'D4', 'fiveWhys', CHAIN));
  const res = await svc.findSimilar(io, 'QA-1');
  assert.ok(res.rows.every((r) => r.rootCause === 'not recorded'));
});

test('findSimilar: Confluence failure still returns rows; graph failure falls back to Jira', async () => {
  const w = world();
  const io = mockIo({ issues: w.issues, visibleProjects: ['QA'], graph: { related: async () => { throw new Error('graph down'); } } });
  io.confluence = async () => { throw new Error('no confluence'); };
  const res = await svc.findSimilar(io, 'QA-1');
  assert.equal(res.source, 'jira');
  assert.equal(res.rows.length, 3);
});

test('rankSimilar prefers same family and caps at 3', () => {
  const w = world();
  const rows = rankSimilar(w.open, [w.other, ...w.past], [], {}, '');
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.key !== 'QA-9'));
});

test('5-Why scaffold: five levels, candidates from past causes, nothing picked', () => {
  const s = scaffoldFiveWhy('Burr on bracket', [{ key: 'QA-2', rootCause: CHAIN }, { key: 'QA-3', rootCause: 'not recorded' }]);
  assert.equal(s.levels.length, WHY_LEVELS);
  assert.equal(s.status, 'draft');
  assert.ok(s.levels.every((l) => l.picked === null));
  assert.deepEqual(s.levels[1].candidates, [{ text: 'Punch die worn', source: 'QA-2' }]);
  const picked = pickWhy(s, 1, 'Burr on bracket edge');
  assert.match(formatFiveWhy(picked), /^1\. Burr on bracket edge\n2\. \(not answered yet\)/);
  assert.throws(() => pickWhy(s, 6, 'x'));
});

test('scaffoldFiveWhy action prefills from approved past causes and approves nothing', async () => {
  const w = world();
  const io = mockIo({ issues: w.issues, visibleProjects: ['QA'] });
  io.put('2', approveTo(set(initialState('2', 'QA-2'), 'D4', 'fiveWhys', CHAIN), 'D4'));
  const res = await svc.scaffoldWhy(io, 'QA-1');
  assert.equal(res.scaffold.levels[1].candidates[0].text, 'Punch die worn');
  assert.equal(await io.store.get('8d:1'), undefined, 'scaffold does not write state');
});

test('corrective actions: refused until D5 is approved; D6 fills a missing due date', () => {
  let s = set(initialState('1', 'QA-1'), 'D5', 'actions', 'Replace punch die on PR-3 | owner: Quality engineer | due: 2026-12-01\nTie die change to stroke count');
  assert.match(correctiveActionDrafts(s).error, /Approve D5/);
  s = set(s, 'D6', 'implementation', 'done\nStroke counter live by 2026-12-15');
  s = approveTo(s, 'D6');
  const { drafts, error } = correctiveActionDrafts(s);
  assert.equal(error, null);
  assert.equal(drafts.length, 2);
  assert.deepEqual([drafts[0].owner, drafts[0].due], ['Quality engineer', '2026-12-01']);
  assert.equal(drafts[1].due, '2026-12-15');
  const p = buildIssuePayload(drafts[0], { projectId: 10, parentKey: 'QA-1', accountId: 'acc-1' });
  assert.equal(p.fields.assignee.accountId, 'acc-1');
  assert.equal(p.fields.duedate, '2026-12-01');
  assert.match(p.fields.summary, /^\[8D QA-1\] Replace punch die/);
});

test('createCorrectiveActions creates linked work items as the user, once', async () => {
  const w = world();
  const io = mockIo({ issues: w.issues, visibleProjects: ['QA'], users: { 'Quality engineer': [{ accountId: 'acc-1' }] } });
  io.put('1', approveTo(set(initialState('1', 'QA-1'), 'D5', 'actions', 'Replace punch die | owner: Quality engineer | due: 2026-12-01'), 'D5'));
  const first = await svc.createCorrectiveActions(io, 'QA-1');
  assert.equal(first.created.length, 1);
  assert.equal(first.created[0].assigned, true);
  const posted = io.calls.filter((c) => c.method === 'POST' && c.path === '/rest/api/3/issue');
  assert.equal(posted[0].body.fields.assignee.accountId, 'acc-1');
  assert.ok(io.calls.some((c) => c.path === '/rest/api/3/issueLink' && c.body.outwardIssue.key === first.created[0].key));
  const second = await svc.createCorrectiveActions(io, 'QA-1');
  assert.equal(second.created.length, 0, 'second click creates nothing new');
});

test('createCorrectiveActions refuses without edit permission', async () => {
  const w = world();
  const io = mockIo({ issues: w.issues, perms: {} });
  io.put('1', approveTo(set(initialState('1', 'QA-1'), 'D5', 'actions', 'x'), 'D5'));
  await assert.rejects(svc.createCorrectiveActions(io, 'QA-1'), /edit permission/);
});

test('report: only approved steps carry text, with a link back to the work item', () => {
  let s = set(initialState('1', 'QA-1'), 'D1', 'roles', 'Quality lead, process engineer');
  s = approve(s, 'D1');
  s = set(s, 'D2', 'what', 'SECRET DRAFT TEXT');
  const r = buildReport(s, { summary: 'Burr <b>', issueUrl: 'https://example.atlassian.net/browse/QA-1' });
  assert.deepEqual(r.approvedSteps, ['D1']);
  assert.match(r.body, /Quality lead, process engineer/);
  assert.doesNotMatch(r.body, /SECRET DRAFT TEXT/);
  assert.match(r.body, /href="https:\/\/example\.atlassian\.net\/browse\/QA-1"/);
  assert.equal((r.body.match(/Not approved yet/g) ?? []).length, 7);
});

test('generateReport publishes a page, links it from the work item, then updates in place', async () => {
  const w = world();
  const io = mockIo({ issues: w.issues });
  io.put('1', approve(set(initialState('1', 'QA-1'), 'D1', 'roles', 'Quality lead'), 'D1'));
  const r = await svc.generateReport(io, 'QA-1', '42');
  assert.equal(r.error, null);
  const post = io.calls.find((c) => c.method === 'POST' && c.path === '/wiki/api/v2/pages');
  assert.equal(post.body.spaceId, '42');
  assert.equal(post.body.body.representation, 'storage');
  assert.ok(io.calls.some((c) => c.path === '/rest/api/3/issue/QA-1/remotelink'));
  await svc.generateReport(io, 'QA-1');
  assert.ok(io.calls.some((c) => c.method === 'PUT' && c.body.version.number === 2));
  assert.equal(io.calls.filter((c) => c.path.endsWith('/remotelink')).length, 1);
});

test('generateReport with nothing approved publishes nothing', async () => {
  const w = world();
  const io = mockIo({ issues: w.issues });
  const r = await svc.generateReport(io, 'QA-1', '42');
  assert.match(r.error, /nothing to report/);
  assert.ok(!io.calls.some((c) => c.product === 'confluence'));
});
