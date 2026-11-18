// Pure logic for "similar past nonconformances": query building and ranking. No I/O.

// Part families look like BRKT-200: letters, a dash, digits. Taken from labels and components.
const FAMILY_RE = /^[A-Za-z]{2,8}-\d{2,5}$/;
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'on', 'in', 'at', 'of', 'to', 'a', 'an', 'is', 'was', 'are', 'found', 'issue']);

const labelName = (l) => String(typeof l === 'string' ? l : l?.name ?? '').trim();

export function partFamilies(issue) {
  const f = issue?.fields ?? {};
  const names = [...(f.labels ?? []).map(labelName), ...(f.components ?? []).map((c) => c?.name ?? '')];
  return [...new Set(names.filter((n) => FAMILY_RE.test(n)).map((n) => n.toUpperCase()))];
}

export function keywords(text, max = 4) {
  const words = String(text ?? '').toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOP.has(w)))].slice(0, max);
}

// JQL values are always quoted and escaped; nothing from the user is pasted in raw.
export const jqlString = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
export const cqlString = jqlString;

export function buildSimilarJql(issue) {
  const families = partFamilies(issue);
  const labels = (issue?.fields?.labels ?? []).map(labelName).filter(Boolean);
  const terms = families.length ? families : labels;
  const parts = [];
  if (terms.length) parts.push(`labels in (${terms.map(jqlString).join(', ')})`);
  else {
    const kw = keywords(issue?.fields?.summary, 3);
    if (!kw.length) return null;
    parts.push(`text ~ ${jqlString(kw.join(' '))}`);
  }
  if (issue?.key) parts.push(`key != ${jqlString(issue.key)}`);
  return `${parts.join(' AND ')} ORDER BY updated DESC`;
}

// Confluence root-cause pages carry the label "root-cause" plus the part family in lower case.
export function buildRootCauseCql(issue) {
  const families = partFamilies(issue).map((f) => f.toLowerCase());
  const kw = keywords(issue?.fields?.summary, 3);
  const scope = families.length
    ? `label in (${families.map(cqlString).join(', ')})`
    : kw.length ? `text ~ ${cqlString(kw.join(' '))}` : null;
  return `type = page AND label = "root-cause"${scope ? ` AND ${scope}` : ''} ORDER BY lastmodified DESC`;
}

function score(issue, candidate) {
  const fam = new Set(partFamilies(issue));
  const lab = new Set((issue?.fields?.labels ?? []).map((l) => labelName(l).toLowerCase()));
  const kw = new Set(keywords(issue?.fields?.summary, 10));
  let s = 0;
  for (const f of partFamilies(candidate)) if (fam.has(f)) s += 5;
  for (const l of candidate?.fields?.labels ?? []) if (lab.has(labelName(l).toLowerCase())) s += 1;
  for (const w of keywords(candidate?.fields?.summary, 10)) if (kw.has(w)) s += 2;
  if (candidate?.fields?.status?.statusCategory?.key === 'done') s += 1;
  return s;
}

// Pages cite an issue when their title or excerpt names its key, or when they share the part family.
function citationsFor(candidate, pages) {
  const fams = partFamilies(candidate).map((f) => f.toLowerCase());
  return pages
    .filter((p) => (p.title ?? '').includes(candidate.key) || (p.excerpt ?? '').includes(candidate.key)
      || (fams.length && fams.some((f) => (p.labels ?? []).includes(f)) && (p.title ?? '').includes(candidate.key)))
    .map((p) => ({ title: p.title, url: p.url }));
}

// Returns at most `limit` rows: { key, summary, url, rootCause, citations[] }. Each row cites
// its Jira work item and every Confluence page that names it; nothing is made up.
export function rankSimilar(issue, candidates, pages = [], rootCauses = {}, baseUrl = '', limit = 3) {
  return (candidates ?? [])
    .filter((c) => c?.key && c.key !== issue?.key)
    .map((c) => ({ c, s: score(issue, c) }))
    .sort((a, b) => b.s - a.s || String(b.c.fields?.updated ?? '').localeCompare(String(a.c.fields?.updated ?? '')))
    .slice(0, limit)
    .map(({ c }) => {
      const issueUrl = `${baseUrl}/browse/${c.key}`;
      const pageCites = citationsFor(c, pages);
      return {
        key: c.key,
        summary: c.fields?.summary ?? '',
        status: c.fields?.status?.name ?? 'unknown',
        url: issueUrl,
        rootCause: rootCauses[c.key] || 'not recorded',
        citations: [{ title: `${c.key} (Jira)`, url: issueUrl }, ...pageCites],
      };
    });
}

// Confluence search results -> { title, url, excerpt, labels }.
export function normalizePages(searchJson, baseUrl = '') {
  return (searchJson?.results ?? []).map((r) => ({
    title: r.content?.title ?? r.title ?? '',
    url: `${baseUrl}/wiki${r.content?._links?.webui ?? r.url ?? ''}`,
    excerpt: String(r.excerpt ?? '').replace(/@@@(end)?hl@@@/g, ''),
    labels: (r.content?.metadata?.labels?.results ?? []).map((l) => l.name),
  }));
}
