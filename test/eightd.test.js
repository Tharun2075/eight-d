import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState, reducer, progress, currentStep, isSafetyRelated, draft5W2H, STEPS, containmentClock, customerDeadlines,
} from '../src/lib/eightd.js';
import { fillGates } from './mock-io.js';
import { demoCases } from '../src/lib/seed.js';

const at = '2026-11-18T00:00:00.000Z';
const approveAll = (s) => STEPS.reduce((acc, st) => reducer(fillGates(acc), { type: 'approve', stepId: st.id, accountId: 'u1', at }), s);

test('initial state has eight empty, unapproved steps', () => {
  const s = initialState('10001', 'QA-1');
  assert.equal(Object.keys(s.steps).length, 8);
  assert.deepEqual(progress(s), { approved: 0, total: 8, percent: 0 });
  assert.equal(currentStep(s), 'D1');
});

test('setField updates one field without mutating the old state', () => {
  const s0 = initialState('1');
  const s1 = reducer(s0, { type: 'setField', stepId: 'D1', field: 'roles', value: 'QE lead', at });
  assert.equal(s1.steps.D1.fields.roles, 'QE lead');
  assert.equal(s0.steps.D1.fields.roles, '');
});

test('approve needs a human accountId and goes in order', () => {
  const s = initialState('1');
  assert.throws(() => reducer(s, { type: 'approve', stepId: 'D1' }), /human approver/);
  assert.throws(() => reducer(s, { type: 'approve', stepId: 'D3', accountId: 'u1' }), /Approve D1 first/);
  const s1 = reducer(s, { type: 'approve', stepId: 'D1', accountId: 'u1', at });
  assert.equal(s1.steps.D1.approvedBy, 'u1');
  assert.equal(currentStep(s1), 'D2');
  assert.equal(progress(s1).percent, 13);
});

test('approved step is locked; reopen unlocks it and every later step', () => {
  const done = approveAll(initialState('1'));
  assert.equal(done.closed, true);
  assert.equal(progress(done).percent, 100);
  assert.throws(() => reducer(done, { type: 'setField', stepId: 'D4', field: 'fiveWhys', value: 'x' }), /reopen/);
  const r = reducer(done, { type: 'reopen', stepId: 'D4', at });
  assert.equal(r.closed, false);
  assert.equal(r.steps.D3.approvedBy, 'u1');
  assert.equal(r.steps.D4.approvedBy, null);
  assert.equal(r.steps.D8.approvedBy, null);
});

test('unknown step, field or action is rejected', () => {
  const s = initialState('1');
  assert.throws(() => reducer(s, { type: 'setField', stepId: 'D9', field: 'x' }), /Unknown step/);
  assert.throws(() => reducer(s, { type: 'setField', stepId: 'D1', field: 'nope' }), /Unknown field/);
  assert.throws(() => reducer(s, { type: 'explode' }), /Unknown action/);
});

test('safety label check is case-insensitive and accepts strings or objects', () => {
  assert.equal(isSafetyRelated(['Safety']), true);
  assert.equal(isSafetyRelated([' SAFETY ']), true);
  assert.equal(isSafetyRelated([{ name: 'safety' }]), true);
  assert.equal(isSafetyRelated(['safety-review', 'quality']), false);
  assert.equal(isSafetyRelated([]), false);
  assert.equal(isSafetyRelated(undefined), false);
});

test('5W2H draft uses issue facts and marks missing ones unknown', () => {
  const d = draft5W2H({ fields: {
    summary: 'Burr on bracket 7731', created: '2026-11-10T08:00:00.000+0000',
    description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Found at final inspection.' }] }] },
  } });
  assert.equal(d.what, 'Burr on bracket 7731');
  assert.equal(d.when, 'Reported 2026-11-10');
  assert.match(d.where, /final inspection/i);
  assert.match(d.why, /unknown/);
  assert.ok(d.missing.includes('why'));
  assert.match(d.note, /Approve/);
});

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

test('5W2H: labelled lines in an ADF description fill all 7 fields', () => {
  const d = draft5W2H({ fields: { summary: 'Cracked bracket', created: '2026-11-10T08:00:00.000+0000', description: { type: 'doc', content: [
    para('What: crack on bend 2 of bracket BR-1'), para('Where found: customer incoming inspection, lot L-1'),
    para('When found: 2026-11-09'), para('Customer: OEM receiving dock'), para('How detected: dye-penetrant check'),
    para('Quantity: 6 parts'), para('Impact: the OEM stopped their line'),
  ] } } });
  assert.deepEqual(d.missing, []);
  assert.equal(d.what, 'crack on bend 2 of bracket BR-1');
  assert.equal(d.where, 'customer incoming inspection, lot L-1');
  assert.equal(d.when, '2026-11-09');
  assert.equal(d.who, 'OEM receiving dock');
  assert.equal(d.how, 'dye-penetrant check');
  assert.equal(d.howMany, '6 parts');
  assert.equal(d.why, 'the OEM stopped their line');
});

test('5W2H: free text gives how and how many', () => {
  const d = draft5W2H({ fields: { summary: 'Cracks', created: '2026-11-10', description: 'During incoming inspection we found 37 parts cracked' } });
  assert.match(d.how, /incoming inspection/i);
  assert.match(d.howMany, /^37 parts/);
});

test('5W2H: empty description lists the 5 missing fields by name', () => {
  const d = draft5W2H({ fields: { summary: 'Cracks', created: '2026-11-10', description: null } });
  assert.equal(d.missing.length, 5);
  assert.equal(d.missingNames.length, 5);
  for (const f of d.missing) assert.equal(d[f], 'unknown - please fill in');
});

test('5W2H: every seeded case drafts with nothing missing', () => {
  for (const c of demoCases()) {
    const d = draft5W2H({ fields: { summary: c.summary, created: '2026-11-10', description: c.description } });
    assert.deepEqual(d.missing, [], c.ref);
  }
});

test('D4 approve needs a confirmed occurrence AND a confirmed escape cause; hypotheses never count', () => {
  let s = initialState('7');
  for (const st of ['D1', 'D2', 'D3']) s = reducer(s, { type: 'approve', stepId: st, accountId: 'u1', at });
  const cause = (kind, status) => ({ kind, status, text: `${kind} cause`, evidence: 'measured' });
  s = reducer(s, { type: 'setData', key: 'causes', value: [cause('occurrence', 'confirmed'), cause('escape', 'hypothesis')] });
  assert.throws(() => reducer(s, { type: 'approve', stepId: 'D4', accountId: 'u1', at }), /confirmed escape cause/);
  s = reducer(s, { type: 'setData', key: 'causes', value: [cause('occurrence', 'killed'), cause('escape', 'confirmed')] });
  assert.throws(() => reducer(s, { type: 'approve', stepId: 'D4', accountId: 'u1', at }), /confirmed occurrence cause/);
  s = reducer(s, { type: 'setData', key: 'causes', value: [cause('occurrence', 'confirmed'), cause('escape', 'confirmed'), { text: 'AI idea', status: 'bogus' }] });
  assert.equal(s.data.causes[2].status, 'hypothesis'); // unknown status never becomes confirmed
  s = reducer(s, { type: 'approve', stepId: 'D4', accountId: 'u1', at });
  assert.equal(s.steps.D4.approvedBy, 'u1');
  assert.throws(() => reducer(s, { type: 'setData', key: 'causes', value: [] }), /D4 is approved/);
});

test('D7 needs look-across and FMEA reference; D8 needs D6 before/after verification', () => {
  let s = initialState('8');
  for (const st of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']) s = reducer(fillGates(s), { type: 'approve', stepId: st, accountId: 'u1', at });
  s = reducer(s, { type: 'setData', key: 'lookAcross', value: [] });
  assert.throws(() => reducer(s, { type: 'approve', stepId: 'D7', accountId: 'u1', at }), /look-across/);
  s = reducer(s, { type: 'setData', key: 'lookAcross', value: ['Die 4', ' '] });
  s = reducer(s, { type: 'setData', key: 'fmeaRef', value: '' });
  assert.deepEqual(s.data.lookAcross, ['Die 4']);
  assert.throws(() => reducer(s, { type: 'approve', stepId: 'D7', accountId: 'u1', at }), /FMEA/);
  s = reducer(s, { type: 'setData', key: 'fmeaRef', value: 'PFMEA line 9' });
  s = reducer(s, { type: 'approve', stepId: 'D7', accountId: 'u1', at });
  const noVerify = { ...s, data: { ...s.data, verification: { before: 'x', after: '' } } };
  assert.throws(() => reducer(noVerify, { type: 'approve', stepId: 'D8', accountId: 'u1', at }), /before\/after verification/);
  assert.equal(reducer(s, { type: 'approve', stepId: 'D8', accountId: 'u1', at }).steps.D8.approvedBy, 'u1');
});

test('D3 containment clock: on time to 24 h, at risk to 48 h, late after; stops when D3 is approved', () => {
  const start = Date.parse('2026-11-01T00:00:00Z');
  const s = { ...initialState('9'), startedAt: new Date(start).toISOString() };
  const h = (n) => start + n * 3600000;
  assert.deepEqual(containmentClock(initialState('9'), h(1)), { status: 'not-started', hours: null });
  assert.equal(containmentClock(s, h(10)).status, 'on-time');
  assert.equal(containmentClock(s, h(30)).status, 'at-risk');
  assert.deepEqual(containmentClock(s, h(49)), { status: 'late', hours: 49 });
  const done = { ...s, steps: { ...s.steps, D3: { ...s.steps.D3, approvedAt: new Date(h(20)).toISOString() } } };
  assert.deepEqual(containmentClock(done, h(500)), { status: 'contained-on-time', hours: 20 });
  const d = customerDeadlines(done, h(200));
  assert.deepEqual(d.map((x) => [x.id, x.met, x.late]), [['24h', true, false], ['5d', false, true], ['30d', false, false]]);
});

test('D4 approve is refused without evidence on the confirmed root cause and allowed with it', () => {
  let s = initialState('9');
  for (const st of ['D1', 'D2', 'D3']) s = reducer(s, { type: 'approve', stepId: st, accountId: 'u1', at });
  const causes = (evidence) => [
    { kind: 'occurrence', status: 'confirmed', text: 'Die radius worn', evidence },
    { kind: 'escape', status: 'confirmed', text: 'Sampling missed it', evidence: 'seeded parts' },
  ];
  s = reducer(s, { type: 'setData', key: 'causes', value: causes('  ') });
  assert.throws(() => reducer(s, { type: 'approve', stepId: 'D4', accountId: 'u1', at }), /evidence for the confirmed root cause \(Die radius worn\)/);
  s = reducer(s, { type: 'setData', key: 'causes', value: causes('Radius measured 0.4 mm over spec') });
  s = reducer(s, { type: 'approve', stepId: 'D4', accountId: 'u1', at });
  assert.equal(s.steps.D4.approvedBy, 'u1');
});
