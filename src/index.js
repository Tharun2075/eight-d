// Eight-D Forge backend: resolver for the Custom UI, Rovo actions, connector stub.
// Data stays in Forge hosted storage (KVS). No external egress.
import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import {
  initialState, reducer, storageKey, isSafetyRelated, progress, currentStep, draft5W2H, SAFETY_MESSAGE,
} from './lib/eightd.js';

const ISSUE_FIELDS = 'summary,description,labels,components,created,reporter';

async function readIssue(issueIdOrKey, asUser) {
  const client = asUser ? api.asUser() : api.asApp();
  const res = await client.requestJira(route`/rest/api/3/issue/${issueIdOrKey}?fields=${ISSUE_FIELDS}`);
  if (!res.ok) throw new Error(`Jira returned ${res.status} for ${issueIdOrKey}`);
  return res.json();
}

async function loadState(issueId, issueKey) {
  return (await kvs.get(storageKey(issueId))) ?? initialState(issueId, issueKey);
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
  return out;
}

const resolver = new Resolver();

resolver.define('getState', async ({ context }) => {
  const { id, key } = context.extension.issue;
  const issue = await readIssue(id, true);
  return { state: await loadState(id, key), safety: isSafetyRelated(issue.fields?.labels) };
});

// One reducer action per call; the approver is always the signed-in human.
resolver.define('dispatch', async ({ payload, context }) => {
  const { id, key } = context.extension.issue;
  const action = { ...payload.action, accountId: context.accountId };
  const next = reducer(await loadState(id, key), action);
  await kvs.set(storageKey(id), next);
  return { state: next };
});

// Fills D2 with a 5W2H draft; fields are only set, never approved.
resolver.define('draftD2', async ({ context }) => {
  const { id, key } = context.extension.issue;
  const issue = await readIssue(id, true);
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
  const issue = await readIssue(issueKey, false);
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
