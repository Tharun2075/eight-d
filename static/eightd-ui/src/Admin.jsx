// Lazy chunk: admin-only demo seeding and Teamwork Graph tools.
import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import Button from '@atlaskit/button/new';
import Textfield from '@atlaskit/textfield';
import Select from '@atlaskit/select';
import SectionMessage from '@atlaskit/section-message';
import { Loading, ErrorMsg } from './ui.jsx';

// Admin-only: loads the synthetic demo (work items and root-cause pages). Hidden for others.
export default function SeedCard() {
  const [admin, setAdmin] = useState(false);
  const [spaces, setSpaces] = useState([]);
  const [projectKey, setProjectKey] = useState('');
  const [space, setSpace] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    invoke('isAdmin').then((r) => {
      setAdmin(r.admin);
      if (r.admin) invoke('listSpaces').then((s) => setSpaces(s.spaces)).catch(() => {});
    }).catch(() => {});
  }, []);
  if (!admin) return null;
  const seed = async () => {
    setBusy(true); setMsg(null); setProgress(null);
    try {
      // Each call stops after ~15 s (Forge limit is 25 s) and says more: true; call again until it is done.
      const total = { issues: 0, pages: 0 };
      let r;
      for (let i = 0; i < 12; i += 1) {
        r = await invoke('seedDemo', { projectKey: projectKey.trim().toUpperCase(), spaceId: space?.value ?? '' });
        if (r.error) break;
        total.issues += r.created.issues; total.pages += r.created.pages;
        setProgress(`Loading demo data: ${r.done} of ${r.total}`);
        if (!r.more) break;
      }
      if (r.error) setMsg({ error: r.error });
      else if (r.more) setMsg({ error: `Stopped at ${r.done} of ${r.total}. Press Load demo data again to continue.` });
      else setMsg({ ok: `Demo ready: ${total.issues} work items and ${total.pages} root-cause pages added (${r.keys.join(', ')}).${graphNote(r.graph)}`, warning: r.warning });
    } catch (e) { setMsg({ error: e.message }); }
    setProgress(null);
    setBusy(false);
  };
  return (
    <section className="ed-card" aria-label="Demo data">
      <h4>Demo data (admins only)</h4>
      <p className="ed-muted">Adds 6 closed 8Ds and 3 open ones for synthetic parts, including the BR-4417 bend-crack case worked through to D6. Safe to press again.</p>
      <div className="ed-row">
        <Textfield aria-label="Project key" placeholder="Project key" width="small" value={projectKey} onChange={(e) => setProjectKey(e.target.value)} />
        <div style={{ minWidth: 220 }}>
          <Select inputId="ed-seed-space" aria-label="Confluence space" placeholder="No root-cause pages" isClearable value={space}
            onChange={setSpace} options={spaces.map((s) => ({ label: s.name, value: s.id }))} />
        </div>
        <Button appearance="primary" isLoading={busy} isDisabled={!projectKey.trim()} onClick={seed}>Load demo data</Button>
      </div>
      {progress && <p className="ed-muted" role="status">{progress}</p>}
      {msg?.ok && <SectionMessage appearance="success"><p>{msg.ok}</p></SectionMessage>}
      {msg?.warning && <SectionMessage appearance="warning"><p>{msg.warning}</p></SectionMessage>}
      <ErrorMsg error={msg?.error} />
      <GraphCheck />
    </section>
  );
}

// One line for the seed message: sent count, the skip reason or the error from the connector push.
function graphNote(g) {
  if (!g) return '';
  if (g.error) return ` Graph: ${g.error}.`;
  if (g.skipped) return ` Graph: ${g.skipped}.`;
  return ` Graph: ${g.sent ?? 0} sent${g.rejected?.length ? `, ${g.rejected.length} rejected` : ''}.`;
}

// Admin-only (rendered inside SeedCard): pushes one test document to Teamwork Graph and reads it back.
function GraphCheck() {
  const [busy, setBusy] = useState(null);
  const [out, setOut] = useState(null);
  const run = async (name) => {
    setBusy(name); setOut(null);
    try { setOut({ result: await invoke(name) }); } catch (e) { setOut({ error: e.message }); }
    setBusy(null);
  };
  return (
    <div className="ed-col">
      <h4>Teamwork Graph</h4>
      <p className="ed-muted">Graph check sends one test document through the connector and reads it back. Sync pushes every 8D again. Both show the raw answer.</p>
      <div className="ed-row">
        <Button isLoading={busy === 'graphCheck'} isDisabled={Boolean(busy)} onClick={() => run('graphCheck')}>Graph check</Button>
        <Button isLoading={busy === 'graphSync'} isDisabled={Boolean(busy)} onClick={() => run('graphSync')}>Sync to Teamwork Graph</Button>
      </div>
      {out?.result && <pre className="ed-raw">{JSON.stringify(out.result, null, 2)}</pre>}
      <ErrorMsg error={out?.error} />
    </div>
  );
}
