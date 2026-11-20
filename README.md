# Eight-D: 8D problem solving for Jira

Eight-D helps a quality team work through an 8D (eight disciplines) report on a
Jira work item: D1 team, D2 problem (5W2H), D3 containment, D4 root cause,
D5 corrective actions, D6 implement and validate, D7 prevent recurrence, D8 close.

Parts:
- **8D panel** on each work item: D1-D8 stepper, progress bar, text fields, Approve per step.
- **8D Overview** global page: all open 8Ds you can see.
- **8D Coach** Rovo agent, with the `draftProblemStatement` action (5W2H draft of D2)
  and `listOpen8Ds`. The same six tools are exposed through a Rovo MCP server
  (`https://mcp.atlassian.com/forge/<appId>`), so outside AI clients can call them too.
- **Rovo actions**: find similar nonconformances, 5-Why scaffold, corrective-action preview,
  customer report preview. Read-only; writes need a human click in the panel.
- **Teamwork Graph connector** (`TG_ENABLED`, on unless set to `false`): pushes part, machine and
  supplier-lot objects; 8D status objects only with `TG_STATUS_PUBLIC=true`, because connector
  objects are visible site-wide. Similar-case search reads the graph as the user and falls back
  to Jira links plus Confluence search when the graph is off, empty or fails.

## Install

Needs Node 22+, the Forge CLI (`npm i -g @forge/cli`) and an Atlassian developer account.

1. `npm install` and `npm --prefix static/eightd-ui install`
2. `npm run build` (builds the Custom UI into `static/eightd-ui/build`)
3. `npm test` (unit tests for the step reducer and the safety check)
4. `forge register` (replaces the placeholder `app.id` in `manifest.yml`)
5. `forge lint`, then `forge deploy` and `forge install --product jira`

## Assistive use: a human approves every step

Eight-D is an assistant. It never decides anything on its own:
- Every D-step is approved by a signed-in person; the approver and date are stored.
  Steps are approved in order, and reopening a step reopens every later one.
- The 8D Coach and the "Draft with 8D Coach" button only fill text fields with a
  draft. A person reviews and edits it, then presses Approve.
- Facts that are not on the work item are left as "unknown"; nothing is invented.
- It talks about processes, parts, machines and lots. It never scores or ranks people.
- **Safety:** if the work item has the label `safety`, the panel shows
  "Safety-related: notify your quality manager" and the automation buttons are
  disabled. The agent replies with the same message and drafts nothing.

## Data flow

- **Storage:** 8D state is kept in Forge hosted storage (KVS) in the customer's
  Atlassian site, one record per work item (`8d:<issueId>`). A copy of each record is kept in
  Jira Forge app properties (`eightd.<issueId>`), which only the app itself can read. MCP tool
  calls run in the app's Confluence installation, whose KVS is separate, and read the copy.
- **Reads:** work items are read through the Jira REST API as the signed-in user,
  so nobody sees an 8D for a work item Jira hides from them.
- **No egress:** the manifest declares no external fetch permissions. No data
  leaves Atlassian's Forge platform.
- **Roles:** the customer is the Data Fiduciary (data controller) for the
  content of their work items and 8D reports. Eight-D (THATCHED Ltd) acts only
  as a processor, on the customer's instructions, inside Forge.
- **Scopes:** `read:jira-work`, `write:jira-work` (corrective-action work items),
  `read:jira-user`, `search:confluence`, `read:space:confluence`, `read/write:page:confluence`
  (customer report), `read/write:label:confluence` (root-cause pages), `storage:app`, and
  `read/write:object:jira` for the Teamwork Graph connector.

## For judges

- **Install:** use the judge install link on the Devpost page: Get app, pick your site, Install
  (Jira and Confluence both say "Installation successful").
- **Project:** a new site has no Jira project; create any one (for example key `SQ`).
- **Demo data:** Apps > 8D Overview, type the project key, press **Load demo data** once.
  You see "Demo ready: 9 work items ..." and the overview lists SQ-7, SQ-8 and SQ-9 as open.
- **Panel:** open SQ-9, press the app icon under the title, then **8D**: "Open: D7 Prevent
  recurrence", "6 of 8 steps approved".
- **Rovo (if your site has Rovo):** Ask Rovo > 8D Coach > "Draft the D2 problem statement for
  this work item".
- **MCP (any client with remote MCP + OAuth):** in admin.atlassian.com > your site > Site settings >
  Connected apps > Eight-D, open "View app details" on BOTH rows (Confluence and Jira) and click
  "Enable tools" under "Expose tools to MCP-compatible apps". Add the server
  `https://mcp.atlassian.com/forge/<appId>` (the App ID is on the Devpost page), for example
  `claude mcp add --transport http eightd <url>` in Claude Code, sign in, pick your site, Accept.
  Ask "draft the problem statement for SQ-9" or "list open 8Ds". If the list is empty, open
  Apps > 8D Overview in Jira once and ask again.
- **Video:** https://youtu.be/T9lp-VFKhn8

All demo data is synthetic.

## Licence

MIT, Copyright (c) 2026 THATCHED Ltd. See LICENSE and THIRD-PARTY-LICENSES.md.
