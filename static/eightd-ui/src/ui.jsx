import React from 'react';
import Spinner from '@atlaskit/spinner';
import SectionMessage from '@atlaskit/section-message';
import Lozenge from '@atlaskit/lozenge';

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
