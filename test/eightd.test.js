import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState, reducer, progress, currentStep, isSafetyRelated, draft5W2H, STEPS,
} from '../src/lib/eightd.js';

const at = '2026-11-18T00:00:00.000Z';
const approveAll = (s) => STEPS.reduce((acc, st) => reducer(acc, { type: 'approve', stepId: st.id, accountId: 'u1', at }), s);

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
