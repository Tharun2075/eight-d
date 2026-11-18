// I/O layer for Eight-D. Every Jira and Confluence call goes through `io`, which index.js builds
// on api.asUser(): reads and writes always run with the signed-in user's own permissions.
// Tests pass a mock `io` (see test/services.test.js), so no Forge runtime is needed.
//
// io = {
//   jira(method, path, body?)        -> parsed JSON, throws { status } on HTTP error
//   confluence(method, path, body?)  -> same, for Confluence
//   store: { get(key), set(key, value), list(prefix) -> [value] }   (Forge KVS)
//   graph?: { related(families) -> [issueKey] }  (Teamwork Graph reader, may throw)
//   baseUrl: 'https://site.atlassian.net'
// }
import { normalize, storageKey, reducer } from './lib/eightd.js';
import { buildSimilarJql, buildRootCauseCql, rankSimilar, normalizePages, partFamilies, jqlString } from './lib/similar.js';
import { scaffoldFiveWhy } from './lib/fivewhy.js';
import { correctiveActionDrafts, buildIssuePayload, buildLinkPayload } from './lib/actions.js';
import { buildReport } from './lib/report.js';

const ISSUE_FIELDS = 'summary,description,labels,components,created,reporter,status,project,issuelinks';
const q = encodeURIComponent;

export async function readIssue(io, idOrKey) {
  return io.jira('GET', `/rest/api/3/issue/${q(idOrKey)}?fields=${ISSUE_FIELDS}`);
}

export async function loadState(io, issueId, issueKey) {
  return normalize(await io.store.get(storageKey(issueId)), issueId, issueKey);
}

export async function searchJql(io, jql, fields = ['summary', 'labels', 'components', 'status', 'updated', 'project'], max = 50) {
  const res = await io.jira('POST', '/rest/api/3/search/jql', { jql, fields, maxResults: max });
  return res.issues ?? [];
}

export async function hasPermission(io, perm, issueId) {
  const path = issueId
    ? `/rest/api/3/mypermissions?issueId=${q(issueId)}&permissions=${perm}`
    : `/rest/api/3/mypermissions?permissions=${perm}`;
  const res = await io.jira('GET', path).catch(() => null);
  return Boolean(res?.permissions?.[perm]?.havePermission);
}

async function requireEdit(io, issueId) {
  if (!(await hasPermission(io, 'EDIT_ISSUES', issueId))) throw new Error('You need edit permission on this work item');
}

// Root causes come only from APPROVED D4 steps of work items the user could already see.
async function rootCausesFor(io, issues) {
  const out = {};
  for (const it of issues) {
    const st = await io.store.get(storageKey(it.id));
    if (st?.steps?.D4?.approvedBy && st.steps.D4.fields?.fiveWhys) out[it.key] = st.steps.D4.fields.fiveWhys;
  }
  return out;
}

// Candidate work items: Teamwork Graph first (when present), then the Jira fallback: JQL on the
// same part family / labels plus the work item's own issue links.
async function candidates(io, issue) {
  const families = partFamilies(issue);
  let source = 'jira';
  let keys = null;
  if (io.graph && families.length) {
    try {
      keys = await io.graph.related(families);
      source = 'teamwork-graph';
    } catch { keys = null; }
  }
  if (keys?.length) {
    // Keys from the graph are re-read through Jira as the user, so permissions still apply.
    return { source, issues: await searchJql(io, `key in (${keys.map(jqlString).join(', ')})`) };
  }
  const jql = buildSimilarJql(issue);
  const found = jql ? await searchJql(io, jql) : [];
  const linked = (issue.fields?.issuelinks ?? []).map((l) => l.inwardIssue ?? l.outwardIssue).filter(Boolean);
  const seen = new Set(found.map((f) => f.key));
  return { source: 'jira', issues: [...found, ...linked.filter((l) => !seen.has(l.key))] };
}

export async function findSimilar(io, issueKey) {
  const issue = await readIssue(io, issueKey);
  const { source, issues } = await candidates(io, issue);
  let pages = [];
  try {
    const cql = buildRootCauseCql(issue);
    pages = normalizePages(await io.confluence('GET', `/wiki/rest/api/search?cql=${q(cql)}&limit=25&expand=content.metadata.labels`), io.baseUrl);
  } catch { pages = []; } // No Confluence or no access: rows still cite their Jira work items.
  const rows = rankSimilar(issue, issues, pages, await rootCausesFor(io, issues), io.baseUrl ?? '');
  return { issueKey: issue.key, source, rows };
}

export async function scaffoldWhy(io, issueKey) {
  const { rows } = await findSimilar(io, issueKey);
  const issue = await readIssue(io, issueKey);
  return { issueKey, scaffold: scaffoldFiveWhy(issue.fields?.summary, rows), basedOn: rows.map((r) => r.key) };
}

export async function previewCorrectiveActions(io, issueKey) {
  const issue = await readIssue(io, issueKey);
  const state = await loadState(io, issue.id, issue.key);
  return { issueKey, ...correctiveActionDrafts(state) };
}

// The owner text is matched to a Jira user only when exactly one user matches.
async function findAccount(io, owner) {
  if (!owner) return null;
  const users = await io.jira('GET', `/rest/api/3/user/search?query=${q(owner)}&maxResults=2`).catch(() => []);
  return Array.isArray(users) && users.length === 1 ? users[0].accountId : null;
}

// Creates one linked work item per approved D5 action. Safe to call twice: done actions are skipped.
export async function createCorrectiveActions(io, issueKey) {
  const issue = await readIssue(io, issueKey);
  await requireEdit(io, issue.id);
  let state = await loadState(io, issue.id, issue.key);
  const { drafts, error } = correctiveActionDrafts(state);
  if (error) return { issueKey, created: [], error };
  const created = [];
  for (const d of drafts) {
    const accountId = await findAccount(io, d.owner);
    const payload = buildIssuePayload(d, { projectId: issue.fields.project.id, parentKey: issue.key, accountId });
    const res = await io.jira('POST', '/rest/api/3/issue', payload);
    await io.jira('POST', '/rest/api/3/issueLink', buildLinkPayload(issue.key, res.key));
    created.push({ ref: d.ref, key: res.key, summary: d.summary, due: d.due, assigned: Boolean(accountId) });
    state = { ...state, correctiveActions: [...(state.correctiveActions ?? []), created.at(-1)] };
    await io.store.set(storageKey(issue.id), state); // saved per item, so a failure part-way loses nothing
  }
  return { issueKey, created, error: null };
}

export async function previewReport(io, issueKey) {
  const issue = await readIssue(io, issueKey);
  const state = await loadState(io, issue.id, issue.key);
  return { issueKey, ...buildReport(state, { summary: issue.fields?.summary, issueUrl: `${io.baseUrl}/browse/${issue.key}` }) };
}

// Creates (or updates) the Confluence report page in the chosen space and links it from the work item.
export async function generateReport(io, issueKey, spaceId) {
  const issue = await readIssue(io, issueKey);
  await requireEdit(io, issue.id);
  const state = await loadState(io, issue.id, issue.key);
  const report = buildReport(state, { summary: issue.fields?.summary, issueUrl: `${io.baseUrl}/browse/${issue.key}` });
  if (!report.approvedSteps.length) return { issueKey, error: 'No step is approved yet, so there is nothing to report.' };
  const body = { representation: 'storage', value: report.body };
  let page;
  if (state.report?.pageId) {
    const old = await io.confluence('GET', `/wiki/api/v2/pages/${q(state.report.pageId)}`);
    page = await io.confluence('PUT', `/wiki/api/v2/pages/${q(state.report.pageId)}`, {
      id: state.report.pageId, status: 'current', title: report.title, body, version: { number: (old.version?.number ?? 1) + 1 },
    });
  } else {
    if (!spaceId) return { issueKey, error: 'Choose a Confluence space for the report.' };
    page = await io.confluence('POST', '/wiki/api/v2/pages', { spaceId: String(spaceId), status: 'current', title: report.title, body });
  }
  const url = `${io.baseUrl}/wiki${page._links?.webui ?? `/pages/${page.id}`}`;
  if (!state.report?.pageId) {
    await io.jira('POST', `/rest/api/3/issue/${q(issue.key)}/remotelink`, { object: { url, title: report.title } });
  }
  await io.store.set(storageKey(issue.id), { ...state, report: { pageId: page.id, url, steps: report.approvedSteps } });
  return { issueKey, url, approvedSteps: report.approvedSteps, error: null };
}

// Writes a picked 5-Why chain into D4 as a draft field; approval stays a separate human click.
export async function saveFiveWhy(io, issueId, issueKey, text) {
  await requireEdit(io, issueId);
  const next = reducer(await loadState(io, issueId, issueKey), { type: 'setField', stepId: 'D4', field: 'fiveWhys', value: text });
  await io.store.set(storageKey(issueId), next);
  return next;
}
