// Teamwork Graph connector: pushes part, machine, supplier-lot and 8D status objects, and reads
// related work items back. Behind TG_ENABLED (on unless set to 'false').
//
// @forge/teamwork-graph is not a dependency (its npm licence is UNLICENSED). The client is either
// injected (tests) or loaded with a guarded dynamic import that yields null when the package is
// absent; null means "skip the push" and services.js falls back to Jira links + Confluence search.
import { progress, currentStep } from './lib/eightd.js';
import { PART_FAMILY, MACHINES, LOTS } from './lib/seed.js';

export const BATCH = 100; // connector ingest limit per request (PITFALLS 9)
export const KINDS = ['part', 'machine', 'supplier-lot', '8d-status'];

export const tgEnabled = (env = process.env) => env.TG_ENABLED !== 'false';
// Status objects name work item keys site-wide, so they are pushed only when an admin opts in.
export const statusPublic = (env = process.env) => env.TG_STATUS_PUBLIC === 'true';

export async function loadClient(injected) {
  if (injected !== undefined) return injected;
  const name = '@forge/teamwork-graph'; // a variable keeps the bundler from requiring the package
  const mod = await import(name).catch(() => null);
  return mod?.graph ?? mod?.default ?? null;
}

// Every object is an atlassian:document (the connector accepts only atlassian:* types); the real
// kind lives in attributes.kind.
export function buildQualityObject({ kind, id, name, description = '', url = '', attributes = {} }) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown kind ${kind}`);
  return {
    schemaVersion: '1.0',
    id: `${kind}:${id}`,
    displayName: name,
    description,
    url,
    'atlassian:document': { type: { category: 'document' }, content: { mimeType: 'text/plain', text: `${kind}: ${name}` } },
    attributes: { kind, ...attributes },
  };
}

export function referenceObjects(baseUrl = '') {
  return [
    buildQualityObject({ kind: 'part', id: PART_FAMILY, name: `Part family ${PART_FAMILY}`, url: `${baseUrl}/issues/?jql=labels%3D${PART_FAMILY}` }),
    ...MACHINES.map((m) => buildQualityObject({ kind: 'machine', id: m.id, name: m.name, attributes: { label: m.label } })),
    ...LOTS.map((l) => buildQualityObject({ kind: 'supplier-lot', id: l.id, name: `${l.id} from ${l.supplier}`, attributes: { label: l.label } })),
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
