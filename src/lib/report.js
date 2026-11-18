// Customer 8D report as Confluence storage format (XHTML). Only APPROVED steps are written;
// unapproved steps show "Not approved yet" and none of their draft text.
import { STEPS } from './eightd.js';

export const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const LABELS = {
  roles: 'Team roles', champion: 'Champion', what: 'What', where: 'Where', when: 'When', who: 'Who detects',
  why: 'Why it matters', how: 'How', howMany: 'How many', actions: 'Actions', verification: 'Verification',
  fiveWhys: '5 Whys', causeCategory: 'Cause category', escapePoint: 'Escape point', evidence: 'Evidence',
  implementation: 'Implementation', validation: 'Validation', systemChanges: 'System changes',
  lessons: 'Lessons learned', closure: 'Closure', recognition: 'Team recognition',
};

const para = (text) => esc(text).split('\n').join('<br/>');

export function reportTitle(state, summary = '') {
  return `8D report ${state.issueKey ?? state.issueId}${summary ? `: ${summary}` : ''}`.slice(0, 255);
}

// issueUrl links back to the Jira work item. Returns { title, body, approvedSteps }.
export function buildReport(state, { summary = '', issueUrl = '' } = {}) {
  const approvedSteps = STEPS.filter((s) => state.steps[s.id]?.approvedBy).map((s) => s.id);
  const parts = [
    `<p>Work item: <a href="${esc(issueUrl)}">${esc(state.issueKey ?? state.issueId)}</a>. `
      + `Approved steps: ${approvedSteps.length} of ${STEPS.length}. Every section below was approved by a team member.</p>`,
  ];
  for (const s of STEPS) {
    const step = state.steps[s.id];
    parts.push(`<h2>${esc(s.id)}: ${esc(s.title)}</h2>`);
    if (!step?.approvedBy) { parts.push('<p><em>Not approved yet.</em></p>'); continue; }
    for (const f of s.fields) {
      const v = step.fields[f];
      if (v) parts.push(`<p><strong>${esc(LABELS[f] ?? f)}:</strong> ${para(v)}</p>`);
    }
    parts.push(`<p><em>Approved ${esc(String(step.approvedAt ?? '').slice(0, 10))}.</em></p>`);
  }
  return { title: reportTitle(state, summary), body: parts.join('\n'), approvedSteps };
}
