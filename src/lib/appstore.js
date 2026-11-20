// Copy of each 8D record in Jira Forge app properties (/rest/forge/1/app/properties, asApp only).
// Only this app can read them, and both installations reach them through Jira REST, so the MCP
// tools (Confluence installation, empty KVS) see the same records as the panel. KVS on the Jira
// side stays the source of truth. A value is at most 32768 characters, so the record is stored
// as base64 chunks: head 'eightd.<issueId>' = { n, s }, then 'eightd.<issueId>.<i>' = { s }.
//
// request(method, path, body?) -> { status, json }  (asApp requestJira; see index.js)
export const APP_PREFIX = 'eightd.';
export const CHUNK = 24000;
const BASE = '/rest/forge/1/app/properties';

export const appKey = (issueId) => `${APP_PREFIX}${issueId}`;
const isHead = (k) => /^eightd\.\d+$/.test(k);

function fail(what, status) {
  return Object.assign(new Error(`Jira app property ${what} returned ${status}`), { status });
}

export function encodeRecord(value) {
  const b64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  const parts = [];
  for (let i = 0; i < b64.length; i += CHUNK) parts.push(b64.slice(i, i + CHUNK));
  return parts.length ? parts : [''];
}

export function decodeRecord(parts) {
  return JSON.parse(Buffer.from(parts.join(''), 'base64').toString('utf8'));
}

async function getProp(request, key) {
  const res = await request('GET', `${BASE}/${encodeURIComponent(key)}`);
  if (res.status === 404) return undefined;
  if (res.status !== 200) throw fail('read', res.status);
  const value = res.json?.value;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return undefined; } // Jira may hand the stored JSON back as text
}

// Extra chunks first, head last, so a head never points at chunks that are not written yet.
export async function putRecord(request, issueId, value) {
  const parts = encodeRecord(value);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const key = i === 0 ? appKey(issueId) : `${appKey(issueId)}.${i}`;
    const body = i === 0 ? { n: parts.length, s: parts[0] } : { s: parts[i] };
    const res = await request('PUT', `${BASE}/${encodeURIComponent(key)}`, body);
    if (res.status !== 200 && res.status !== 201) throw fail('write', res.status);
  }
}

export async function getRecord(request, issueId) {
  const head = await getProp(request, appKey(issueId));
  if (!head || typeof head.s !== 'string') return undefined;
  const parts = [head.s];
  for (let i = 1; i < (head.n ?? 1); i += 1) {
    const part = await getProp(request, `${appKey(issueId)}.${i}`);
    if (typeof part?.s !== 'string') return undefined; // half-written: treat as missing
    parts.push(part.s);
  }
  try { return decodeRecord(parts); } catch { return undefined; } // mixed head/chunk mid-save: treat as missing
}

// Every stored 8D record. The caller still filters by what the user may see (visibleRecords).
export async function listRecords(request) {
  const res = await request('GET', BASE);
  if (res.status !== 200) throw fail('list', res.status);
  const raw = Array.isArray(res.json) ? res.json : (res.json?.keys ?? []);
  const keys = raw.map((k) => (typeof k === 'string' ? k : k?.key)).filter((k) => k && isHead(k));
  const out = [];
  for (const k of keys) {
    const rec = await getRecord(request, k.slice(APP_PREFIX.length));
    if (rec) out.push(rec);
  }
  return out;
}
