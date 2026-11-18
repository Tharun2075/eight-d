// Design rule: every colour comes from Atlassian design tokens. No hex colour may appear in the UI source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../static/eightd-ui/src/', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

test('no hex colours in static/eightd-ui/src', () => {
  const hits = walk(SRC).flatMap((f) => (readFileSync(f, 'utf8').match(/#[0-9a-f]{3,6}\b/gi) ?? []).map((m) => `${f}: ${m}`));
  assert.deepEqual(hits, []);
});

test('no position:fixed in the UI source', () => {
  const hits = walk(SRC).filter((f) => /position\s*:\s*['"]?fixed/i.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits, []);
});
