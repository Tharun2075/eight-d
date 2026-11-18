// In-memory stand-in for the `io` object (see src/services.js). Jira search only returns work
// items whose project is in `visibleProjects`, the way Jira filters search for a restricted user.
import { storageKey } from '../src/lib/eightd.js';

export function mockIo({ issues = [], pages = [], visibleProjects = null, perms = { EDIT_ISSUES: true }, users = {}, graph } = {}) {
  const store = new Map();
  const calls = [];
  const visible = (it) => !visibleProjects || visibleProjects.includes(it.fields.project.key);
  const byKey = (k) => issues.find((i) => i.key === k || i.id === k);
  let next = 900;
  let nextPage = 554;
  const jira = async (method, path, body) => {
    calls.push({ product: 'jira', method, path, body });
    const p = path.split('?')[0];
    if (method === 'GET' && p.startsWith('/rest/api/3/issue/')) {
      const it = byKey(decodeURIComponent(p.split('/')[5]));
      if (!it || !visible(it)) throw Object.assign(new Error('404'), { status: 404 });
      return it;
    }
    if (p === '/rest/api/3/search/jql') {
      const keyIn = body.jql.match(/key in \(([^)]*)\)/);
      const labelIn = body.jql.match(/labels in \(([^)]*)\)/);
      const pick = (s) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      let found = issues.filter(visible);
      if (keyIn) found = found.filter((i) => pick(keyIn[1]).includes(i.key));
      const idIn = body.jql.match(/^id in \(([^)]*)\)/);
      if (idIn) found = found.filter((i) => idIn[1].split(',').includes(String(i.id)));
      if (labelIn) found = found.filter((i) => (i.fields.labels ?? []).some((l) => pick(labelIn[1]).includes(l)));
      return { issues: found };
    }
    if (p === '/rest/api/3/mypermissions') {
      const perm = new URLSearchParams(path.split('?')[1]).get('permissions');
      return { permissions: { [perm]: { havePermission: Boolean(perms[perm]) } } };
    }
    if (p === '/rest/api/3/user/search') return users[new URLSearchParams(path.split('?')[1]).get('query')] ?? [];
    if (method === 'POST' && p === '/rest/api/3/issue') { next += 1; return { id: String(next), key: `QA-${next}` }; }
    if (method === 'GET' && p.startsWith('/rest/api/3/project/')) return { id: `p-${p.split('/')[5]}`, key: p.split('/')[5] };
    if (method === 'POST') return {};
    throw new Error(`mock jira: no route for ${method} ${p}`);
  };
  const confluence = async (method, path, body) => {
    calls.push({ product: 'confluence', method, path, body });
    if (path.startsWith('/wiki/rest/api/search')) return { results: pages };
    if (method === 'POST' && path === '/wiki/api/v2/pages') { nextPage += 1; return { id: String(nextPage), _links: { webui: `/spaces/QA/pages/${nextPage}` }, version: { number: 1 } }; }
    if (method === 'POST' && path.endsWith('/label')) return { results: body };
    if (method === 'GET' && path.startsWith('/wiki/api/v2/pages/')) return { id: '555', version: { number: 1 } };
    if (method === 'PUT') return { id: '555', _links: { webui: '/spaces/QA/pages/555' } };
    throw new Error(`mock confluence: no route for ${method} ${path}`);
  };
  return {
    calls,
    store: {
      get: async (k) => store.get(k),
      set: async (k, v) => { store.set(k, v); },
      list: async (prefix) => [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v),
    },
    jira, confluence, graph, baseUrl: 'https://example.atlassian.net',
    put: (issueId, state) => store.set(storageKey(issueId), state),
  };
}

export const issue = (id, key, project, summary, labels = [], status = 'Done') => ({
  id: String(id), key, fields: { summary, labels, components: [], status: { name: status }, project: { id: `p-${project}`, key: project }, issuelinks: [] },
});
