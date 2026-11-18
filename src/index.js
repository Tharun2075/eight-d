// Eight-D Forge backend: resolver for the Custom UI, Rovo actions, Teamwork Graph connector.
// Data stays in Forge hosted storage (KVS). No external egress.
import ResolverModule from '@forge/resolver';
import api, { route, assumeTrustedRoute } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import * as svc from './services.js';
import { syncConnector, makeGraphReader, graphCheck } from './graph.js';
import {
  normalize, reducer, storageKey, isSafetyRelated, draft5W2H, SAFETY_MESSAGE,
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

async function canEdit(issueId) {
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?issueId=${issueId}&permissions=EDIT_ISSUES`);
  return res.ok && Boolean((await res.json()).permissions?.EDIT_ISSUES?.havePermission);
}

// "type": "module" makes a CommonJS default import the whole exports object; take .default.
const Resolver = ResolverModule.default ?? ResolverModule;
const resolver = new Resolver();

// The work item comes from the issue panel context, or, on the full-page workspace, from the key
// the page passes; that key is re-read as the user, so a hidden work item fails here.
async function issueOf(context, payload) {
  const ext = context?.extension?.issue;
  if (ext?.id && ext?.key) return { id: String(ext.id), key: ext.key };
  const key = String(payload?.issueKey ?? '');
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) throw new Error('Open an 8D from a work item or the 8D list');
  const issue = await readIssue(key);
  return { id: String(issue.id), key: issue.key };
}

resolver.define('getState', async ({ payload, context }) => {
  const { id, key } = await issueOf(context, payload);
  const issue = await readIssue(id);
  return { state: await loadState(id, key), safety: isSafetyRelated(issue.fields?.labels) };
});

// One reducer action per call. Only known fields pass; the approver is always the
// signed-in human and the timestamp is set here, never by the browser.
resolver.define('dispatch', async ({ payload, context }) => {
  const { id, key } = await issueOf(context, payload);
  const { type, stepId, field, key: dataKey, value } = payload?.action ?? {};
  if (!['setField', 'setData', 'approve', 'reopen'].includes(type)) throw new Error(`Unknown action ${type}`);
  if (!(await canEdit(id))) throw new Error('You need edit permission on this work item');
  const action = { type, stepId, field, key: dataKey, value, accountId: context.accountId, at: new Date().toISOString() };
  const next = reducer(await loadState(id, key), action);
  await kvs.set(storageKey(id), next);
  return { state: next };
});

// Fills D2 with a 5W2H draft; fields are only set, never approved.
resolver.define('draftD2', async ({ payload, context }) => {
  const { id, key } = await issueOf(context, payload);
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

resolver.define('overview', async () => svc.overview(await makeIo()));

// The io object for services.js: every request runs as the signed-in user (asUser).
// Paths are built in services.js with encodeURIComponent on every variable part.
async function call(product, method, path, body) {
  const req = product === 'jira' ? api.asUser().requestJira : api.asUser().requestConfluence;
  const res = await req(assumeTrustedRoute(path), body === undefined ? { method } : {
    method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    const err = new Error(`${product} returned ${res.status} for ${method} ${path.split('?')[0]}${detail ? `: ${detail}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? {} : res.json();
}

// The connector trigger runs without a user, so the site URL seen here is kept for its object links.
const SITE_KEY = 'site:baseUrl';
async function siteUrl() {
  try {
    const url = (await call('jira', 'GET', '/rest/api/3/serverInfo')).baseUrl ?? '';
    if (url && url !== (await kvs.get(SITE_KEY))) await kvs.set(SITE_KEY, url);
    return url;
  } catch { return ''; }
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

// Teamwork Graph reader as the user; null (TG_ENABLED=false) means "use the Jira fallback".
async function graphReader() {
  return makeGraphReader(async (query, variables) => {
    const res = await api.asUser().requestGraph(query, variables);
    if (!res.ok) throw new Error(`Teamwork Graph returned ${res.status}`);
    return res.json();
  });
}

resolver.define('findSimilar', async ({ payload, context }) => svc.findSimilar(await makeIo(), (await issueOf(context, payload)).key));
resolver.define('scaffoldFiveWhy', async ({ payload, context }) => svc.scaffoldWhy(await makeIo(), (await issueOf(context, payload)).key));
resolver.define('saveFiveWhy', async ({ payload, context }) => {
  const { id, key } = await issueOf(context, payload);
  return { state: await svc.saveFiveWhy(await makeIo(), id, key, String(payload?.text ?? '')) };
});
resolver.define('previewCorrectiveActions', async ({ payload, context }) => svc.previewCorrectiveActions(await makeIo(), (await issueOf(context, payload)).key));
resolver.define('createCorrectiveActions', async ({ payload, context }) => svc.createCorrectiveActions(await makeIo(), (await issueOf(context, payload)).key));
resolver.define('previewReport', async ({ payload, context }) => svc.previewReport(await makeIo(), (await issueOf(context, payload)).key));
resolver.define('listSpaces', async () => {
  const io = await makeIo();
  const res = await io.confluence('GET', '/wiki/api/v2/spaces?limit=50&type=global').catch(() => ({ results: [] }));
  return { spaces: (res.results ?? []).map((s) => ({ id: s.id, key: s.key, name: s.name })) };
});
resolver.define('isAdmin', async () => ({ admin: await svc.hasPermission(await makeIo(), 'ADMINISTER') }));
// Admin-only: one test document through the connector and back, raw outcome shown on the overview.
resolver.define('graphCheck', async () => {
  if (!(await svc.hasPermission(await makeIo(), 'ADMINISTER'))) throw new Error('Only a Jira admin can run the graph check');
  return graphCheck({ connectionId: await kvs.get(CONNECTION_KEY), baseUrl: await siteUrl() });
});
resolver.define('seedDemo', async ({ payload }) => svc.seedDemo(await makeIo(), { projectKey: payload?.projectKey, spaceId: payload?.spaceId }));
resolver.define('generateReport', async ({ payload, context }) => svc.generateReport(await makeIo(), (await issueOf(context, payload)).key, payload?.spaceId));

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
  return { items: (await svc.overview(await makeIo())).items };
}

// Teamwork Graph connector: when an admin connects, push the part, machines, supplier lots and the
// status of every 8D (status only with TG_STATUS_PUBLIC=true). Runs without a user, so it reads only app storage, never Jira content.
const CONNECTION_KEY = 'tg:connection';

export async function onConnectionChange(event) {
  if (event?.action === 'DELETED') {
    await kvs.delete(CONNECTION_KEY);
    return { success: true };
  }
  if (event?.connectionId) await kvs.set(CONNECTION_KEY, event.connectionId);
  const records = [];
  let cursor;
  do {
    const page = await kvs.query().where('key', WhereConditions.beginsWith('8d:')).limit(50).cursor(cursor).getMany();
    records.push(...page.results.map((r) => normalize(r.value)));
    cursor = page.nextCursor;
  } while (cursor);
  const result = await syncConnector({ records, connectionId: event?.connectionId, baseUrl: (await kvs.get(SITE_KEY)) ?? '' });
  return { success: true, result };
}

export { buildQualityObject } from './graph.js';
