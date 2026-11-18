// Offline manifest check with the Forge CLI's own validator (no login, no network).
// Usage: node scripts/validate-manifest.cjs   -> prints errors/warnings, exit 1 on any error.
const path = require('path');
const { execSync } = require('child_process');

// Prefer the validator bundled with the installed Forge CLI (it knows the newest modules,
// e.g. rovo:mcp); fall back to the project's own @forge/manifest.
// Global roots tried in order: NPM_ROOT_G, next to node, the usual Homebrew/usr-local roots, `npm root -g`.
function globalRoots() {
  const roots = [process.env.NPM_ROOT_G, path.join(path.dirname(process.execPath), '../lib/node_modules'), '/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules'];
  try { roots.push(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch { /* npm unavailable */ }
  return roots.filter(Boolean);
}

function loadProcessor() {
  for (const root of globalRoots()) {
    try {
      return require(path.join(root, '@forge/cli/node_modules/@forge/manifest/out/processor/full-validation-processor')).FullValidationProcessor;
    } catch { /* try the next root */ }
  }
  return require('@forge/manifest/out/processor/full-validation-processor').FullValidationProcessor;
}
const FullValidationProcessor = loadProcessor();

(async () => {
  const file = path.join(__dirname, '..', 'manifest.yml');
  const res = await new FullValidationProcessor({}).process(file);
  const errors = (res.errors ?? []).filter((e) => e.level !== 'warning');
  const warnings = (res.errors ?? []).filter((e) => e.level === 'warning');
  for (const e of res.errors ?? []) console.log(`${e.level ?? 'error'}: ${e.message}${e.reference ? ` (${e.reference})` : ''}`);
  console.log(`success=${res.success} errors=${errors.length} warnings=${warnings.length}`);
  process.exit(res.success && !errors.length ? 0 : 1);
})();
