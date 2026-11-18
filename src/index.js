// Eight-D Forge backend: resolver for the Custom UI, Rovo actions, connector stub.
// Data stays in Forge hosted storage (KVS). No external egress.
import Resolver from '@forge/resolver';
import api, { route, assumeTrustedRoute } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import * as svc from './services.js';
import {
  normalize, reducer, storageKey, isSafetyRelated, progress, currentStep, draft5W2H, SAFETY_MESSAGE,
} from './lib/eightd.js';

const ISSUE_FIELDS = 'summary,description,labels,components,created,reporter';

// Always read as the signed-in user, so nobody sees a work item Jira would hide from them.
async function readIssue(issueIdOrKey) {
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}?fields=${ISSUE_FIELDS}`);
  if (!res.ok) throw new Error(`Jira returned ${res.status} for ${issueIdOrKey}`);
  return res.json();
}

async function loadState(issueId, issueKey) {
  return normalize(await kvs.get(storageKey(issueId)), issueId, issueKey);
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

// The io object for services.js: every request runs as the signed-in user (asUser).
// Paths are built in services.js with encodeURIComponent on every variable part.
async function call(product, method, path, body) {
  const req = product === 'jira' ? api.asUser().requestJira : api.asUser().requestConfluence;
  const res = await req(assumeTrustedRoute(path), body === undefined ? { method } : {
    method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`${product} returned ${res.status} for ${method} ${path.split('?')[0]}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? {} : res.json();
}

async function siteUrl() {
  try { return (await call('jira', 'GET', '/rest/api/3/serverInfo')).baseUrl ?? ''; } catch { return ''; }
}

async function makeIo() {
  return {
    jira: (m, p, b) => call('jira', m, p, b),
    confluence: (m, p, b) => call('confluence', m, p, b),
    store: {
      get: (k) => kvs.get(k),
      set: (k, v) => kvs.set(k, v),
      async list(prefix) {
        const out = [];
        let cursor;
        do {
          const page = await kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(50).cursor(cursor).getMany();
          out.push(...page.results.map((r) => r.value));
          cursor = page.nextCursor;
        } while (cursor);
        return out;
      },
    },
    graph: await graphReader(),
    baseUrl: await siteUrl(),
  };
}

// Teamwork Graph reader: filled in by the graph feature; null means "use the Jira fallback".
async function graphReader() { return null; }

const issueOf = (context) => context.extension.issue;

resolver.define('findSimilar', async ({ context }) => svc.findSimilar(await makeIo(), issueOf(context).key));
resolver.define('scaffoldFiveWhy', async ({ context }) => svc.scaffoldWhy(await makeIo(), issueOf(context).key));
resolver.define('saveFiveWhy', async ({ payload, context }) => {
  const { id, key } = issueOf(context);
  return { state: await svc.saveFiveWhy(await makeIo(), id, key, String(payload?.text ?? '')) };
});
resolver.define('previewCorrectiveActions', async ({ context }) => svc.previewCorrectiveActions(await makeIo(), issueOf(context).key));
resolver.define('createCorrectiveActions', async ({ context }) => svc.createCorrectiveActions(await makeIo(), issueOf(context).key));
resolver.define('previewReport', async ({ context }) => svc.previewReport(await makeIo(), issueOf(context).key));
resolver.define('listSpaces', async () => {
  const io = await makeIo();
  const res = await io.confluence('GET', '/wiki/api/v2/spaces?limit=50&type=global').catch(() => ({ results: [] }));
  return { spaces: (res.results ?? []).map((s) => ({ id: s.id, key: s.key, name: s.name })) };
});
resolver.define('isAdmin', async () => ({ admin: await svc.hasPermission(await makeIo(), 'ADMINISTER') }));
resolver.define('seedDemo', async ({ payload }) => svc.seedDemo(await makeIo(), { projectKey: payload?.projectKey, spaceId: payload?.spaceId }));
resolver.define('generateReport', async ({ payload, context }) => svc.generateReport(await makeIo(), issueOf(context).key, payload?.spaceId));

export const handler = resolver.getDefinitions();

// Rovo action: read the work item, return a 5W2H draft for human approval.
export async function draftProblemStatement(payload) {
  const issueKey = payload?.issueKey ?? payload?.context?.jira?.issueKey;
  if (!issueKey) return { error: 'Give a Jira work item key, for example QA-12.' };
  const issue = await readIssue(issueKey);
  if (isSafetyRelated(issue.fields?.labels)) return { safety: true, message: SAFETY_MESSAGE };
  return { issueKey, draft: draft5W2H(issue), approval: 'A human must review this draft and press Approve on D2 in the 8D panel.' };
}

// Work item key from the action input, or from the Jira page the user has open (payload.context).
const keyFrom = (payload) => payload?.issueKey || payload?.context?.jira?.issueKey;
const NEED_KEY = { error: 'Give a Jira work item key, for example QA-12.' };

// Rovo actions below are read-only (actionVerb GET, see PITFALLS 14). Writes happen only when a
// human presses the button in the 8D panel; the action result says so.
export async function findSimilarNonconformances(payload) {
  const key = keyFrom(payload);
  return key ? svc.findSimilar(await makeIo(), key) : NEED_KEY;
}

export async function scaffoldFiveWhyAction(payload) {
  const key = keyFrom(payload);
  if (!key) return NEED_KEY;
  return { ...(await svc.scaffoldWhy(await makeIo(), key)), approval: 'Draft only: pick each answer in the D4 step of the 8D panel, then press Approve.' };
}

export async function createCorrectiveActionsAction(payload) {
  const key = keyFrom(payload);
  if (!key) return NEED_KEY;
  return { ...(await svc.previewCorrectiveActions(await makeIo(), key)), approval: 'Preview only: press "Create corrective actions" in the 8D panel to create these linked work items.' };
}

export async function generateReportAction(payload) {
  const key = keyFrom(payload);
  if (!key) return NEED_KEY;
  const r = await svc.previewReport(await makeIo(), key);
  return { issueKey: r.issueKey, title: r.title, approvedSteps: r.approvedSteps, approval: 'Preview only: press "Generate customer report" at D8 in the 8D panel to publish the Confluence page.' };
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
