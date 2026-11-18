// Pure logic for corrective actions: parse the APPROVED D5/D6 text into Jira work item drafts.
// Line format (one action per line), owner and due are optional:
//   Replace punch die on press PR-3 | owner: Quality engineer | due: 2026-12-01
import { hashText } from './hash.js';

const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;

function parseLine(raw) {
  const parts = raw.split('|').map((p) => p.trim());
  const out = { summary: parts[0].replace(/^\s*(\d+[.)]|[-*])\s*/, '').trim(), owner: null, due: null };
  for (const p of parts.slice(1)) {
    const m = p.match(/^(owner|assignee|due)\s*:\s*(.+)$/i);
    if (!m) continue;
    if (m[1].toLowerCase() === 'due') out.due = m[2].match(DATE_RE)?.[1] ?? null;
    else out.owner = m[2].trim();
  }
  return out;
}

// state: the 8D record. Only approved steps are read; returns { drafts, error }.
export function correctiveActionDrafts(state) {
  const d5 = state?.steps?.D5;
  if (!d5?.approvedBy) return { drafts: [], error: 'Approve D5 first: actions are created only from approved text.' };
  const d6 = state.steps.D6;
  const d6Lines = d6?.approvedBy ? String(d6.fields.implementation ?? '').split('\n') : [];
  const lines = String(d5.fields.actions ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const drafts = lines.map((line, i) => {
    const a = parseLine(line);
    // A due date in the matching approved D6 line fills a gap in D5.
    if (!a.due) a.due = d6Lines[i]?.match(DATE_RE)?.[1] ?? null;
    return { ...a, ref: hashText(a.summary) };
  }).filter((a) => a.summary);
  const done = new Set((state.correctiveActions ?? []).map((c) => c.ref));
  return { drafts: drafts.filter((d) => !done.has(d.ref)), error: null };
}

// Jira create payload for one draft. The parent link is added after create (issue link API).
export function buildIssuePayload(draft, { projectId, issueTypeName = 'Task', parentKey, accountId = null }) {
  const fields = {
    project: { id: String(projectId) },
    issuetype: { name: issueTypeName },
    summary: `[8D ${parentKey}] ${draft.summary}`.slice(0, 254),
    labels: ['8d-corrective-action'],
    description: {
      type: 'doc', version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `Corrective action from the approved D5 of ${parentKey}.${draft.owner && !accountId ? ` Owner (not matched to a user): ${draft.owner}.` : ''}` }] }],
    },
  };
  if (accountId) fields.assignee = { accountId };
  if (draft.due) fields.duedate = draft.due;
  return { fields };
}

export const buildLinkPayload = (parentKey, childKey) => ({
  type: { name: 'Relates' }, inwardIssue: { key: parentKey }, outwardIssue: { key: childKey },
});
