// MCP tools run in the Confluence installation (no 8Ds in its app storage), so open 8Ds are read
// back from the Jira issue property mirror. The mirror must give the same overview, and hold no text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mirrorOf, fromMirror, normalize, MIRROR_KEY } from '../src/lib/eightd.js';
import { overviewRow, paretoCauses } from '../src/lib/overview.js';
import { listMirrored } from '../src/services.js';
import { demoCases } from '../src/lib/seed.js';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const records = () => demoCases(NOW).map((c, i) => normalize({ ...c.state, issueId: String(100 + i), issueKey: `SQ-${i + 1}` }, String(100 + i), `SQ-${i + 1}`));

test('mirror round trip keeps every overview row and the Pareto', () => {
  const states = records();
  assert.ok(states.length > 0);
  const back = states.map((s) => fromMirror(JSON.parse(JSON.stringify(mirrorOf(s))), s.issueId, s.issueKey));
  assert.deepEqual(back.map((s) => overviewRow(s, NOW)), states.map((s) => overviewRow(s, NOW)));
  assert.deepEqual(paretoCauses(back), paretoCauses(states));
});

test('mirror holds no step text and no people', () => {
  for (const s of records()) {
    const m = JSON.stringify(mirrorOf(s));
    for (const step of Object.values(s.steps)) {
      if (step.approvedBy) assert.ok(!m.includes(step.approvedBy), 'approver id leaked');
      for (const [f, v] of Object.entries(step.fields ?? {})) {
        if (f !== 'causeCategory' && typeof v === 'string' && v.length > 12) assert.ok(!m.includes(v), 'step text leaked');
      }
    }
  }
});

test('listMirrored pages the property JQL and rebuilds records', async () => {
  const s = records().find((r) => !r.closed);
  const calls = [];
  const pages = [
    { issues: [{ id: '1', key: 'SQ-1', properties: { [MIRROR_KEY]: mirrorOf(s) } }, { id: '2', key: 'SQ-2', properties: {} }], nextPageToken: 't2' },
    { issues: [{ id: '3', key: 'SQ-3', properties: { [MIRROR_KEY]: mirrorOf({ ...s, closed: true }) } }] },
  ];
  const io = { jira: async (m, p, b) => { calls.push(b); return pages[calls.length - 1]; } };
  const out = await listMirrored(io);
  assert.deepEqual(out.map((r) => [r.issueKey, r.closed]), [['SQ-1', false], ['SQ-3', true]]);
  assert.equal(calls[0].jql, 'issue.property[eightd].v = 1');
  assert.equal(calls[1].nextPageToken, 't2');
});
