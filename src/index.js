// Eight-D Forge backend: resolver for the Custom UI, Rovo actions, connector stub.
// Data stays in Forge hosted storage (KVS). No external egress.
import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import {
  initialState, reducer, storageKey, isSafetyRelated, progress, currentStep, draft5W2H, SAFETY_MESSAGE,
} from './lib/eightd.js';

const ISSUE_FIELDS = 'summary,description,labels,components,created,reporter';

// Always read as the signed-in user, so nobody sees a work item Jira would hide from them.
async function readIssue(issueIdOrKey) {
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}?fields=${ISSUE_FIELDS}`);
  if (!res.ok) throw new Error(`Jira returned ${res.status} for ${issueIdOrKey}`);
  return res.json();
}

async function loadState(issueId, issueKey) {
  return (await kvs.get(storageKey(issueId))) ?? initialState(issueId, issueKey);
}

// Keeps only the work items the signed-in user may browse (JQL search runs as the user).
async function visibleIds(ids) {
  const visible = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql: `id in (${ids.slice(i, i + 100).map(Number).join(',')})`, fields: ['id'], maxResults: 100 }),
    });
    if (res.ok) for (const it of (await res.json()).issues ?? []) visible.add(String(it.id));
  }
  return visible;
}

async function listOpen() {
  const out = [];
  let cursor;
  do {
    const page = await kvs.query().where('key', WhereConditions.beginsWith('8d:')).limit(50).cursor(cursor).getMany();
    for (const { value } of page.results) {
      if (!value.closed) out.push({ issueKey: value.issueKey, issueId: value.issueId, current: currentStep(value), ...progress(value) });
    }
    cursor = page.nextCursor;
  } while (cursor);
  const visible = await visibleIds(out.map((o) => o.issueId));
  return out.filter((o) => visible.has(String(o.issueId)));
}

async function canEdit(issueId) {
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?issueId=${issueId}&permissions=EDIT_ISSUES`);
  return res.ok && Boolean((await res.json()).permissions?.EDIT_ISSUES?.havePermission);
}

const resolver = new Resolver();

resolver.define('getState', async ({ context }) => {
  const { id, key } = context.extension.issue;
  const issue = await readIssue(id);
  return { state: await loadState(id, key), safety: isSafetyRelated(issue.fields?.labels) };
});

// One reducer action per call. Only known fields pass; the approver is always the
// signed-in human and the timestamp is set here, never by the browser.
resolver.define('dispatch', async ({ payload, context }) => {
  const { id, key } = context.extension.issue;
  const { type, stepId, field, value } = payload?.action ?? {};
  if (!['setField', 'approve', 'reopen'].includes(type)) throw new Error(`Unknown action ${type}`);
  if (!(await canEdit(id))) throw new Error('You need edit permission on this work item');
  const action = { type, stepId, field, value, accountId: context.accountId, at: new Date().toISOString() };
  const next = reducer(await loadState(id, key), action);
  await kvs.set(storageKey(id), next);
  return { state: next };
});

// Fills D2 with a 5W2H draft; fields are only set, never approved.
resolver.define('draftD2', async ({ context }) => {
  const { id, key } = context.extension.issue;
  if (!(await canEdit(id))) throw new Error('You need edit permission on this work item');
  const issue = await readIssue(id);
  if (isSafetyRelated(issue.fields?.labels)) throw new Error(SAFETY_MESSAGE);
  const draft = draft5W2H(issue);
  let state = await loadState(id, key);
  for (const field of Object.keys(state.steps.D2.fields)) {
    state = reducer(state, { type: 'setField', stepId: 'D2', field, value: draft[field] });
  }
  await kvs.set(storageKey(id), state);
  return { state };
});

resolver.define('listOpen', async () => ({ items: await listOpen() }));

export const handler = resolver.getDefinitions();

// Rovo action: read the work item, return a 5W2H draft for human approval.
export async function draftProblemStatement(payload) {
  const issueKey = payload?.issueKey ?? payload?.context?.jira?.issueKey;
  if (!issueKey) return { error: 'Give a Jira work item key, for example QA-12.' };
  const issue = await readIssue(issueKey);
  if (isSafetyRelated(issue.fields?.labels)) return { safety: true, message: SAFETY_MESSAGE };
  return { issueKey, draft: draft5W2H(issue), approval: 'A human must review this draft and press Approve on D2 in the 8D panel.' };
}

// Rovo action and MCP tool: open 8Ds with progress.
export async function listOpen8Ds() {
  return { items: await listOpen() };
}

// Teamwork Graph connector stub: no external source yet, so connections are accepted
// and nothing is synced. buildQualityObject shows the object shape for later work.
export async function onConnectionChange() {
  return { success: true };
}

export function buildQualityObject({ kind, id, name, description = '', url = '' }) {
  if (!['part', 'machine', 'supplier-lot'].includes(kind)) throw new Error(`Unknown kind ${kind}`);
  return {
    schemaVersion: '1.0',
    id: `${kind}:${id}`,
    displayName: name,
    description,
    url,
    'atlassian:document': { type: { category: 'document' }, content: { mimeType: 'text/plain', text: `${kind}: ${name}` } },
    attributes: { kind },
  };
}
