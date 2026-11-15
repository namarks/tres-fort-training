import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('session writers cannot target the index removed by migration 0073', () => {
  const source = readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /ON\s+CONFLICT\s*\(\s*user_id\s*,\s*date\s*\)/i,
    'A (user_id, date) conflict target becomes invalid as soon as migration 0073 drops that index.');
});
