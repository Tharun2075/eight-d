// Offline manifest check with the Forge CLI's own validator (no login, no network).
// Usage: node scripts/validate-manifest.cjs   -> prints errors/warnings, exit 1 on any error.
const path = require('path');
const { execSync } = require('child_process');

// Prefer the validator bundled with the installed Forge CLI (it knows the newest modules,
// e.g. rovo:mcp); fall back to the project's own @forge/manifest.
function loadProcessor() {
  try {
    const cli = path.join(execSync('npm root -g').toString().trim(), '@forge/cli/node_modules/@forge/manifest/out/processor/full-validation-processor');
    return require(cli).FullValidationProcessor;
  } catch {
    return require('@forge/manifest/out/processor/full-validation-processor').FullValidationProcessor;
  }
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
