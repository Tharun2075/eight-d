// Teamwork Graph connector: pushes part, machine, supplier-lot and 8D status objects, and reads
// related work items back. Behind TG_ENABLED (on unless set to 'false').
//
// @forge/teamwork-graph is Atlassian's platform SDK (npm says UNLICENSED; used under the Atlassian
// Developer Terms). Tests inject a client; a null client means "skip the push" and services.js
// falls back to Jira links + Confluence search.
import TgModule from '@forge/teamwork-graph';
import { progress, currentStep } from './lib/eightd.js';
import { PART_FAMILY, MACHINES, LOTS } from './lib/seed.js';

export const BATCH = 100; // connector ingest limit per request (PITFALLS 9)
export const KINDS = ['part', 'machine', 'supplier-lot', '8d-status'];

export const tgEnabled = (env = process.env) => env.TG_ENABLED !== 'false';
// Status objects name work item keys site-wide, so they are pushed only when an admin opts in.
export const statusPublic = (env = process.env) => env.TG_STATUS_PUBLIC === 'true';

// "type": "module" makes a CommonJS default import the whole exports object (PITFALLS 31).
const TG = TgModule.default ?? TgModule;

export async function loadClient(injected) {
  if (injected !== undefined) return injected;
  return TG?.setObjects ? TG : TG?.graph ?? null;
}

export const CHECK_ID = 'part:graph-check';

// Pushes ONE test document and reads it back; returns the raw outcome of both calls so an admin
// can see exactly what the connector answers (status codes included), never a summary.
export async function graphCheck({ client, connectionId, env, baseUrl = '' } = {}) {
  if (!tgEnabled(env)) return { skipped: 'TG_ENABLED is false' };
  if (!connectionId) return { skipped: 'No connection yet: an admin must connect "Eight-D quality objects" in Atlassian Administration > Connectors first' };
  const c = await loadClient(client);
  if (!c?.setObjects) return { skipped: 'Teamwork Graph client not available' };
  const raw = (r) => ({ success: r?.success ?? false, error: r?.error ?? null, status: r?.originalError?.status ?? r?.originalError?.code ?? null });
  const obj = buildQualityObject({ kind: 'part', id: 'graph-check', name: 'Eight-D graph check', description: `Test document ${new Date().toISOString()}`, url: baseUrl ? `${baseUrl}/jira/apps` : '' });
  const push = await c.setObjects({ objects: [obj], connectionId }).catch((e) => ({ success: false, error: e.message }));
  const read = await c.getObjectByExternalId({ objectType: 'atlassian:document', externalId: CHECK_ID, connectionId }).catch((e) => ({ success: false, error: e.message }));
  return {
    connectionId,
    push: { ...raw(push), accepted: push?.results?.accepted?.length ?? 0, rejected: push?.results?.rejected ?? [] },
    read: { ...raw(read), found: Boolean(read?.object) },
  };
}

// Every object is an atlassian:document (the connector accepts only atlassian:* types); the real
// kind and its details travel as document labels ("kind:part", "step:D3"). The ingest API rejects
// an object without updateSequenceNumber, url, createdAt, lastUpdatedAt or permissions, and the
// document category must be one of its upper-case enum values (live 400s, 2026-11-18).
export const WORKSPACE = { accessControls: [{ principals: [{ type: 'ATLASSIAN_WORKSPACE' }] }] };

export function buildQualityObject({ kind, id, name, description = '', url = '', attributes = {}, at = new Date().toISOString() }) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown kind ${kind}`);
  const labels = [`kind:${kind}`, ...Object.entries(attributes).map(([k, v]) => `${k}:${v}`)];
  return {
    schemaVersion: '1.0',
    id: `${kind}:${id}`,
    updateSequenceNumber: Date.parse(at),
    displayName: name,
    description,
    url: url || `https://eight-d.invalid/${kind}/${encodeURIComponent(id)}`,
    createdAt: at,
    lastUpdatedAt: at,
    permissions: WORKSPACE,
    'atlassian:document': {
      type: { category: 'DOCUMENT', mimeType: 'text/plain' },
      content: { mimeType: 'text/plain', text: [`${kind}: ${name}`, description, ...labels].filter(Boolean).join('\n') },
      labels,
    },
  };
}

// Reads a label value back ("step" -> "D3"); labels are the only place the kind and details live.
export const labelOf = (obj, key) => obj['atlassian:document'].labels.find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1);

export function referenceObjects(baseUrl = '') {
  return [
    buildQualityObject({ kind: 'part', id: PART_FAMILY, name: `Part family ${PART_FAMILY}`, url: `${baseUrl}/issues/?jql=labels%3D${PART_FAMILY}` }),
    ...MACHINES.map((m) => buildQualityObject({ kind: 'machine', id: m.id, name: m.name, url: `${baseUrl}/issues/?jql=labels%3D${m.label}`, attributes: { label: m.label } })),
    ...LOTS.map((l) => buildQualityObject({ kind: 'supplier-lot', id: l.id, name: `${l.id} from ${l.supplier}`, url: `${baseUrl}/issues/?jql=labels%3D${l.label}`, attributes: { label: l.label } })),
  ];
}

// 8D status carries only the key and step progress, never draft or approved text, because
// connector objects are visible to the whole workspace (replicatesPermissions is false).
export function statusObject(record, baseUrl = '') {
  const key = record.issueKey ?? record.issueId;
  const step = record.closed ? 'closed' : currentStep(record) ?? 'D8';
  return buildQualityObject({
    kind: '8d-status', id: record.issueId, name: `8D ${key}: ${step}`, url: `${baseUrl}/browse/${key}`,
    attributes: { issueKey: key, step, approved: progress(record).approved, closed: Boolean(record.closed) },
  });
}

export async function pushObjects(client, objects, connectionId) {
  const out = { sent: 0, batches: 0, rejected: [] };
  for (let i = 0; i < objects.length; i += BATCH) {
    const batch = objects.slice(i, i + BATCH);
    const res = await client.setObjects({ objects: batch, connectionId });
    out.batches += 1;
    out.sent += batch.length;
    out.rejected.push(...(res?.results?.rejected ?? []));
  }
  return out;
}

export async function syncConnector({ client, records = [], baseUrl = '', connectionId, env } = {}) {
  if (!tgEnabled(env)) return { skipped: 'TG_ENABLED is false' };
  const c = await loadClient(client);
  if (!c?.setObjects) return { skipped: 'Teamwork Graph client not available' };
  const status = statusPublic(env) ? records.map((r) => statusObject(r, baseUrl)) : [];
  return pushObjects(c, [...referenceObjects(baseUrl), ...status], connectionId);
}

// Reader for services.candidates(): returns work item keys linked to the part families. `query`
// runs a GraphQL request as the user (api.asUser().requestGraph). Any error or an empty answer
// throws or returns [], and services.js then uses Jira links + Confluence search instead.
export const RELATED_QUERY = `query eightd_related($labels: [String!]!) {
  eightd_relatedIssues: jira { issueSearch(labels: $labels, first: 25) { edges { node { key } } } }
}`;

export function makeGraphReader(query, env) {
  if (!tgEnabled(env) || !query) return null;
  return {
    async related(families) {
      const res = await query(RELATED_QUERY, { labels: families });
      if (res?.errors?.length) throw new Error(`Teamwork Graph: ${res.errors[0].message}`);
      const edges = res?.data?.eightd_relatedIssues?.issueSearch?.edges ?? [];
      return edges.map((e) => e?.node?.key).filter(Boolean);
    },
  };
}
