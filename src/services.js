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
import { demoCases, rootCausePage } from './lib/seed.js';
import { overviewRow, paretoCauses } from './lib/overview.js';

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

// Admin-only resync to Teamwork Graph: io.graphSync pushes reference + status objects, raw result back.
export async function graphSync(io) {
  if (!(await hasPermission(io, 'ADMINISTER'))) throw new Error('Only a Jira admin can sync to Teamwork Graph');
  if (!io.graphSync) return { skipped: 'Teamwork Graph sync not available' };
  return io.graphSync();
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

// Finds a current page by exact title in a space (a rerun after a part-way seed reuses it).
async function findPageByTitle(io, spaceId, title) {
  const res = await io.confluence('GET', `/wiki/api/v2/spaces/${q(spaceId)}/pages?title=${q(title)}&status=current&limit=5`);
  return (res.results ?? []).find((p) => p.title === title) ?? null;
}

// Creates the page, or reuses the one with the same title when Confluence says it already exists.
async function createOrReusePage(io, spaceId, title, value) {
  try {
    return await io.confluence('POST', '/wiki/api/v2/pages', { spaceId: String(spaceId), status: 'current', title, body: { representation: 'storage', value } });
  } catch (e) {
    if (e.status !== 400) throw e;
    const found = await findPageByTitle(io, spaceId, title);
    if (!found) throw e;
    return { ...found, reused: true };
  }
}

// Admin-only demo data: 6 closed and 2 open 8Ds on BRKT-200 plus the BR-4417 hero, with root-cause
// pages for the closed ones. Progress is saved after each step under 'seed:demo', so a rerun
// continues and never duplicates; an existing page with the same title is reused. Forge stops a
// resolver at 25 s, so after budgetMs no new case starts and the result says more: true; the UI calls again.
// Bump when the seeded complaint texts change (2: labelled 5W2H lines for the 8D Coach).
const DESCRIPTION_VERSION = 2;

// Finds a work item in the project whose summary equals the demo case's exactly; null on none or on any search error.
async function findDemoIssue(io, projectId, c) {
  try {
    const label = c.labels?.[0];
    const jql = `project = ${projectId} AND summary ~ ${jqlString(c.summary)}${label ? ` AND labels = ${jqlString(label)}` : ''} ORDER BY created ASC`;
    const found = await searchJql(io, jql, ['summary'], 5);
    return found.find((it) => it.fields?.summary === c.summary) ?? null;
  } catch { return null; }
}

export async function seedDemo(io, { projectKey, spaceId, now = Date.now(), clock = Date.now, budgetMs = 15000 } = {}) {
  const start = clock();
  if (!(await hasPermission(io, 'ADMINISTER'))) throw new Error('Only a Jira admin can load the demo data');
  if (!projectKey) return { error: 'Choose a Jira project for the demo work items.' };
  const project = await io.jira('GET', `/rest/api/3/project/${q(projectKey)}`);
  const done = (await io.store.get('seed:demo')) ?? { cases: {} };
  const created = { issues: 0, pages: 0 };
  const labelErrors = [];
  const cases = demoCases(now);
  // `described` and `status` were added later: items from an older seed get them on the next press.
  // `described` holds the description text version, so a rewritten complaint reaches existing items too.
  const isDone = (c) => {
    const r = done.cases[c.ref];
    return !!r?.key && r.described === DESCRIPTION_VERSION && (!c.closed || !!r.status) && (!c.rootCause || !spaceId || (!!r.pageId && !!r.labelled));
  };
  let more = false;
  for (const c of cases) {
    if (isDone(c)) continue;
    if (clock() - start > budgetMs) { more = true; break; }
    const rec = done.cases[c.ref] ?? {};
    if (!rec.key) {
      // Forge storage is per install: adopt a work item another install already seeded instead of duplicating it.
      const existing = await findDemoIssue(io, project.id, c);
      if (existing) {
        Object.assign(rec, { id: String(existing.id), key: existing.key, described: 0 });
        await io.store.set(storageKey(rec.id), { ...c.state, issueId: rec.id, issueKey: rec.key });
      }
    }
    if (!rec.key) {
      const res = await io.jira('POST', '/rest/api/3/issue', {
        fields: { project: { id: String(project.id) }, issuetype: { name: 'Task' }, summary: c.summary, description: c.description, labels: c.labels },
      });
      Object.assign(rec, { id: String(res.id), key: res.key, described: DESCRIPTION_VERSION });
      await io.store.set(storageKey(rec.id), { ...c.state, issueId: rec.id, issueKey: rec.key });
      created.issues += 1;
    }
    done.cases[c.ref] = rec;
    await io.store.set('seed:demo', done);
    if (rec.described !== DESCRIPTION_VERSION) {
      await io.jira('PUT', `/rest/api/3/issue/${q(rec.key)}`, { fields: { description: c.description } });
      rec.described = DESCRIPTION_VERSION;
      await io.store.set('seed:demo', done);
    }
    if (c.closed && !rec.status) {
      rec.status = await moveToDone(io, rec.key);
      await io.store.set('seed:demo', done);
    }
    if (c.rootCause && spaceId) {
      const pg = rootCausePage(rec.key, c);
      if (!rec.pageId) {
        const page = await createOrReusePage(io, spaceId, pg.title, pg.body);
        rec.pageId = String(page.id);
        if (!page.reused) created.pages += 1;
        await io.store.set('seed:demo', done); // page id saved before labels, so a label failure loses nothing
      }
      if (!rec.labelled) {
        try {
          await io.confluence('POST', `/wiki/rest/api/content/${q(rec.pageId)}/label`, pg.labels.map((name) => ({ prefix: 'global', name })));
          rec.labelled = true;
          await io.store.set('seed:demo', done);
        } catch (e) { labelErrors.push(`${rec.key}: ${e.message}`); }
      }
    }
  }
  const keys = Object.values(done.cases).map((r) => r.key).filter(Boolean);
  const noDone = Object.values(done.cases).filter((r) => r.status === 'none').map((r) => r.key);
  const warnings = [
    labelErrors.length ? `Pages saved, but labels could not be added (${labelErrors[0]})` : '',
    noDone.length ? `No transition to a Done status in this project's workflow, so ${noDone.join(', ')} stay open in Jira (the 8D itself is closed).` : '',
  ].filter(Boolean);
  // Finished: push the records to Teamwork Graph when a connection exists (best effort, never fails the seed).
  let graph = null;
  if (!more && io.graphSync) graph = await io.graphSync().catch((e) => ({ error: e.message }));
  return {
    more, created, keys, done: cases.filter((c) => done.cases[c.ref]?.key).length, total: cases.length, error: null,
    warning: warnings.join(' ') || null, graph,
  };
}

// Moves a work item to a status in the Done category with the first transition that leads there.
// Returns 'moved', 'already' (it is in Done) or 'none' (the workflow has no such transition).
export async function moveToDone(io, key) {
  const { transitions = [] } = await io.jira('GET', `/rest/api/3/issue/${q(key)}/transitions`);
  const t = transitions.find((x) => x.to?.statusCategory?.key === 'done');
  if (t) {
    await io.jira('POST', `/rest/api/3/issue/${q(key)}/transitions`, { transition: { id: String(t.id) } });
    return 'moved';
  }
  const it = await io.jira('GET', `/rest/api/3/issue/${q(key)}?fields=status`);
  return it.fields?.status?.statusCategory?.key === 'done' ? 'already' : 'none';
}

// Keeps only the records whose work item the signed-in user may browse (the JQL runs as the user).
// A failed search is an error, never an empty list; only a 400 (bad or deleted ids in the batch) reads as nothing visible.
export async function visibleRecords(io, records, summaries = new Map()) {
  const visible = new Set();
  const ids = records.map((r) => Number(r.issueId)).filter(Number.isFinite);
  for (let i = 0; i < ids.length; i += 100) {
    const found = await searchJql(io, `id in (${ids.slice(i, i + 100).join(',')})`, ['id', 'summary'], 100).catch((e) => { if (e.status === 400) return []; throw e; });
    for (const it of found) {
      visible.add(String(it.id));
      summaries.set(String(it.id), it.fields?.summary ?? '');
    }
  }
  return records.filter((r) => visible.has(String(r.issueId)));
}

// Overview: open 8Ds with late flags, plus the Pareto of approved root causes (closed and open).
export async function overview(io, now = Date.now()) {
  const summaries = new Map();
  const records = await visibleRecords(io, (await io.store.list('8d:')).map((r) => normalize(r)), summaries);
  const items = records.filter((r) => !r.closed).map((r) => ({ ...overviewRow(r, now), summary: summaries.get(String(r.issueId)) ?? '' }));
  return { items, pareto: paretoCauses(records), closedCount: records.filter((r) => r.closed).length };
}
