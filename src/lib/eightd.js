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
  return { issueId: String(issueId), issueKey, steps, data: emptyData(), closed: false, startedAt: null, updatedAt: null };
}

// Structured 8D data next to the free-text fields. Each key belongs to one step and is locked
// once that step is approved.
//   isIsNot: D2 rows { dimension, is, isNot }
//   causes: D4 { id, kind: occurrence|escape, text, status: hypothesis|confirmed|killed, evidence }
//   verification: D6 { before, after } measured result before and after the fix
//   lookAcross: D7 list of other parts, dies or lines checked; fmeaRef: D7 FMEA / control plan reference
export const DATA_STEP = { isIsNot: 'D2', causes: 'D4', verification: 'D6', lookAcross: 'D7', fmeaRef: 'D7' };
export const CAUSE_KINDS = ['occurrence', 'escape'];
export const CAUSE_STATUSES = ['hypothesis', 'confirmed', 'killed'];
export const IS_DIMENSIONS = ['What', 'Where', 'When', 'How many'];
const emptyData = () => ({
  isIsNot: IS_DIMENSIONS.map((dimension) => ({ dimension, is: '', isNot: '' })),
  causes: [], verification: { before: '', after: '' }, lookAcross: [], fmeaRef: '',
});

const str = (v) => String(v ?? '').trim();
// Cleans browser input; anything that is not the expected shape throws.
function cleanData(key, value) {
  switch (key) {
    case 'isIsNot':
      if (!Array.isArray(value)) throw new Error('isIsNot must be a list');
      return value.slice(0, 20).map((r) => ({ dimension: str(r?.dimension), is: str(r?.is), isNot: str(r?.isNot) }));
    case 'causes':
      if (!Array.isArray(value)) throw new Error('causes must be a list');
      return value.slice(0, 30).map((c, i) => {
        // Unknown kind/status falls back to a hypothesis: nothing becomes confirmed by accident.
        const kind = CAUSE_KINDS.includes(c?.kind) ? c.kind : 'occurrence';
        const status = CAUSE_STATUSES.includes(c?.status) ? c.status : 'hypothesis';
        return { id: str(c?.id) || `c${i + 1}`, kind, text: str(c?.text), status, evidence: str(c?.evidence) };
      });
    case 'verification':
      return { before: str(value?.before), after: str(value?.after) };
    case 'lookAcross':
      if (!Array.isArray(value)) throw new Error('lookAcross must be a list');
      return value.map(str).filter(Boolean).slice(0, 50);
    case 'fmeaRef':
      return str(value);
    default:
      throw new Error(`Unknown data ${key}`);
  }
}

// What still blocks approving a step (domain gates). Empty list = may approve.
export function gateProblems(state, stepId) {
  const d = state.data ?? emptyData();
  const out = [];
  const confirmed = (kind) => d.causes.some((c) => c.kind === kind && c.status === 'confirmed' && c.text);
  if (stepId === 'D4') {
    if (!confirmed('occurrence')) out.push('D4 needs at least one confirmed occurrence cause (why it happened)');
    if (!confirmed('escape')) out.push('D4 needs at least one confirmed escape cause (why it was not caught)');
    const noEvidence = d.causes.filter((c) => c.kind === 'occurrence' && c.status === 'confirmed' && c.text && !String(c.evidence ?? '').trim());
    if (noEvidence.length) out.push(`D4 needs evidence for the confirmed root cause (${noEvidence.map((c) => c.text).join(', ')}): add what was measured or tested`);
  }
  if (stepId === 'D7') {
    if (!d.lookAcross.length) out.push('D7 needs a look-across list (other parts, dies or lines checked)');
    if (!d.fmeaRef) out.push('D7 needs the FMEA / control plan reference');
  }
  if (stepId === 'D8' && !(d.verification.before && d.verification.after)) {
    out.push('D8 needs the D6 before/after verification');
  }
  return out;
}

// D3 containment clock: target 24 h from the 8D start, late after 48 h.
export const CONTAINMENT_TARGET_H = 24;
export const CONTAINMENT_LATE_H = 48;
export function containmentClock(state, now = Date.now()) {
  const start = Date.parse(state?.startedAt ?? '');
  if (!Number.isFinite(start)) return { status: 'not-started', hours: null };
  const doneAt = Date.parse(state.steps?.D3?.approvedAt ?? '');
  const end = Number.isFinite(doneAt) ? doneAt : now;
  const hours = Math.max(0, Math.floor((end - start) / 3600000));
  const band = hours > CONTAINMENT_LATE_H ? 'late' : hours > CONTAINMENT_TARGET_H ? 'at-risk' : 'on-time';
  return { status: Number.isFinite(doneAt) ? `contained-${band}` : band, hours };
}

// Usual customer deadlines from the 8D start: containment 24 h, root cause 5 days, closure 30 days.
export const CUSTOMER_DEADLINES = [
  { id: '24h', label: 'Containment (D3)', step: 'D3', hours: 24 },
  { id: '5d', label: 'Root cause (D4)', step: 'D4', hours: 5 * 24 },
  { id: '30d', label: 'Permanent fix verified (D6)', step: 'D6', hours: 30 * 24 },
];
export function customerDeadlines(state, now = Date.now()) {
  const start = Date.parse(state?.startedAt ?? '');
  return CUSTOMER_DEADLINES.map((d) => {
    if (!Number.isFinite(start)) return { ...d, due: null, met: false, late: false };
    const due = start + d.hours * 3600000;
    const at = Date.parse(state.steps?.[d.step]?.approvedAt ?? '');
    const met = Number.isFinite(at);
    return { ...d, due: new Date(due).toISOString(), met, late: (met ? at : now) > due };
  });
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
  const data = { ...base.data, ...(stored.data ?? {}) };
  return { ...base, ...stored, steps, data, startedAt: stored.startedAt ?? stored.updatedAt ?? null };
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
      const gates = gateProblems(state, action.stepId);
      if (gates.length) throw new Error(gates.join('; '));
      const steps = { ...state.steps, [action.stepId]: { ...step, approvedBy: action.accountId, approvedAt: now } };
      const next = { ...state, steps, startedAt: state.startedAt ?? now, updatedAt: now };
      return { ...next, closed: currentStep(next) === null };
    }
    case 'setData': {
      const owner = DATA_STEP[action.key];
      if (!owner) throw new Error(`Unknown data ${action.key}`);
      if (state.steps[owner].approvedBy) throw new Error(`${owner} is approved; reopen it before editing`);
      const data = { ...(state.data ?? emptyData()), [action.key]: cleanData(action.key, action.value) };
      return { ...state, data, startedAt: state.startedAt ?? now, updatedAt: now };
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
