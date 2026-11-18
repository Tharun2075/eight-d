// Pure 8D logic shared by the Forge backend and the Custom UI. No I/O here.

export const STEPS = [
  { id: 'D1', title: 'Team', fields: ['roles', 'champion'] },
  { id: 'D2', title: 'Problem description (5W2H)', fields: ['what', 'where', 'when', 'who', 'why', 'how', 'howMany'] },
  { id: 'D3', title: 'Containment', fields: ['actions', 'verification'] },
  { id: 'D4', title: 'Root cause', fields: ['fiveWhys', 'causeCategory', 'escapePoint'] },
  { id: 'D5', title: 'Permanent corrective actions', fields: ['actions', 'evidence'] },
  { id: 'D6', title: 'Implement and validate', fields: ['implementation', 'validation'] },
  { id: 'D7', title: 'Prevent recurrence', fields: ['systemChanges', 'lessons'] },
  { id: 'D8', title: 'Close and recognise the team', fields: ['closure', 'recognition'] },
];

export const SAFETY_LABEL = 'safety';
export const SAFETY_MESSAGE = 'Safety-related: notify your quality manager';

export const storageKey = (issueId) => `8d:${issueId}`;

export function initialState(issueId, issueKey = null) {
  const steps = {};
  for (const s of STEPS) {
    steps[s.id] = { fields: Object.fromEntries(s.fields.map((f) => [f, ''])), approvedBy: null, approvedAt: null };
  }
  return { issueId: String(issueId), issueKey, steps, closed: false, startedAt: null, updatedAt: null };
}

// Fills in fields added by later app versions, so older stored records keep working.
export function normalize(stored, issueId, issueKey = null) {
  const base = initialState(issueId ?? stored?.issueId, issueKey ?? stored?.issueKey ?? null);
  if (!stored) return base;
  const steps = {};
  for (const s of STEPS) {
    const old = stored.steps?.[s.id] ?? {};
    steps[s.id] = { ...base.steps[s.id], ...old, fields: { ...base.steps[s.id].fields, ...(old.fields ?? {}) } };
  }
  return { ...base, ...stored, steps, startedAt: stored.startedAt ?? stored.updatedAt ?? null };
}

// Fishbone (6M) cause categories for the Pareto chart. Processes and things, never people.
export const CAUSE_CATEGORIES = ['Method', 'Machine', 'Material', 'Measurement', 'Environment', 'Management system'];

// Labels arrive as strings (Jira REST) or objects ({ name }) depending on the caller.
export function isSafetyRelated(labels) {
  if (!Array.isArray(labels)) return false;
  return labels.some((l) => String(typeof l === 'string' ? l : l?.name ?? '').trim().toLowerCase() === SAFETY_LABEL);
}

export function progress(state) {
  const approved = STEPS.filter((s) => state.steps[s.id]?.approvedBy).length;
  return { approved, total: STEPS.length, percent: Math.round((approved / STEPS.length) * 100) };
}

// The first step that is not yet approved; null when all eight are approved.
export function currentStep(state) {
  return STEPS.find((s) => !state.steps[s.id]?.approvedBy)?.id ?? null;
}

const stepIndex = (id) => STEPS.findIndex((s) => s.id === id);

// Reducer for 8D step state. Throws on invalid actions so the resolver can report them.
export function reducer(state, action) {
  const step = action.stepId && state.steps[action.stepId];
  if (action.stepId && !step) throw new Error(`Unknown step ${action.stepId}`);
  const now = action.at ?? new Date().toISOString();

  switch (action.type) {
    case 'setField': {
      if (step.approvedBy) throw new Error(`${action.stepId} is approved; reopen it before editing`);
      if (!(action.field in step.fields)) throw new Error(`Unknown field ${action.field}`);
      const fields = { ...step.fields, [action.field]: String(action.value ?? '') };
      return { ...state, steps: { ...state.steps, [action.stepId]: { ...step, fields } }, startedAt: state.startedAt ?? now, updatedAt: now };
    }
    case 'approve': {
      if (!action.accountId) throw new Error('A human approver (accountId) is required');
      const blocked = STEPS.slice(0, stepIndex(action.stepId)).find((s) => !state.steps[s.id].approvedBy);
      if (blocked) throw new Error(`Approve ${blocked.id} first`);
      const steps = { ...state.steps, [action.stepId]: { ...step, approvedBy: action.accountId, approvedAt: now } };
      const next = { ...state, steps, startedAt: state.startedAt ?? now, updatedAt: now };
      return { ...next, closed: currentStep(next) === null };
    }
    case 'reopen': {
      // Reopening a step also reopens every later step, because they build on it.
      const steps = { ...state.steps };
      for (const s of STEPS.slice(stepIndex(action.stepId))) {
        steps[s.id] = { ...steps[s.id], approvedBy: null, approvedAt: null };
      }
      return { ...state, steps, closed: false, updatedAt: now };
    }
    default:
      throw new Error(`Unknown action ${action.type}`);
  }
}

// 5W2H draft of the D2 problem statement from Jira issue fields. A draft only:
// unknown facts stay "unknown" so the reviewer sees what is missing.
export function draft5W2H(issue) {
  const f = issue?.fields ?? {};
  const unknown = 'unknown - please fill in';
  const text = typeof f.description === 'string' ? f.description : adfToText(f.description);
  return {
    what: f.summary || unknown,
    where: f.components?.map((c) => c.name).join(', ') || unknown,
    when: f.created ? `Reported ${f.created.slice(0, 10)}` : unknown,
    who: 'Detected by: ' + (f.reporter ? 'the reporting role on this work item' : unknown),
    why: text ? text.slice(0, 500) : unknown,
    how: unknown,
    howMany: unknown,
    note: 'Draft only. Review every line and press Approve on D2 when it is right.',
  };
}

function adfToText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(adfToText).join(node.type === 'paragraph' ? '\n' : '');
}
