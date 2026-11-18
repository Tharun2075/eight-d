import React from 'react';
import Spinner from '@atlaskit/spinner';
import SectionMessage from '@atlaskit/section-message';
import Lozenge from '@atlaskit/lozenge';
import { containmentClock } from '../../../src/lib/eightd.js';

// Shared view states: every view shows loading, error, empty and saved, never a blank box.
export const Loading = ({ label = 'Loading' }) => (
  <div className="ed-state" role="status"><Spinner size="small" label={label} /><span>{label}...</span></div>
);
export const ErrorMsg = ({ error }) => (error ? (
  <SectionMessage appearance="error" title="That did not work"><p>{error}</p></SectionMessage>
) : null);
export const Saved = ({ at }) => (at ? <span role="status"><Lozenge appearance="success">Saved {at.slice(11, 16)}</Lozenge></span> : null);
export const Empty = ({ children }) => <p className="ed-muted">{children}</p>;
export const opts = (list) => list.map((v) => (typeof v === 'string' ? { label: v, value: v } : v));

// [lozenge appearance, short lozenge text, long explanation shown under it and as the tooltip]
const CLOCK = {
  'not-started': ['default', 'Not started', 'Containment clock not started'],
  'on-time': ['inprogress', 'Open', 'Containment due within 24 h'],
  'at-risk': ['moved', 'At risk', 'Containment past the 24 h target'],
  late: ['removed', 'Late', 'Containment late (over 48 h)'],
  'contained-on-time': ['success', 'Met', 'Contained within 24 h'],
  'contained-at-risk': ['moved', 'Met late', 'Contained, past the 24 h target'],
  'contained-late': ['removed', 'Late', 'Contained late (over 48 h)'],
};

export function ContainmentClock({ state, clock }) {
  const c = clock ?? containmentClock(state);
  const [appearance, short, long] = CLOCK[c.status] ?? CLOCK['not-started'];
  return (
    <span className="ed-clock" title={long}>
      <Lozenge appearance={appearance}>{c.hours === null ? short : `${short} · ${c.hours} h`}</Lozenge>
      <span className="ed-clock-note">{long}</span>
    </span>
  );
}
