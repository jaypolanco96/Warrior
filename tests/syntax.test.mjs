// Every script the page loads must parse. A broken one stops the whole dashboard (a stray comment once cut a line of
// watch.js in half and blanked the scorecard), and the Node tests only import the shared library, not the page scripts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('every page script parses', () => {
  for (const f of readdirSync('public/js').filter((n) => n.endsWith('.js'))) {
    const r = spawnSync(process.execPath, ['--check', `public/js/${f}`], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr.split('\n').slice(0, 4).join(' ')}`);
  }
});
