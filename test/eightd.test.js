import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState, reducer, progress, currentStep, isSafetyRelated, draft5W2H, STEPS, containmentClock, customerDeadlines,
} from '../src/lib/eightd.js';
import { fillGates } from './mock-io.js';

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
  assert.equal(d.why, 'Found at final inspection.');
  assert.match(d.how, /unknown/);
  assert.match(d.note, /Approve/);
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
