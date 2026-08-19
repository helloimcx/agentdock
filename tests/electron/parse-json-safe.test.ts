import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonSafe } from '../../services/local-ai-core/src/kernel/parse-json-safe.js';

test('parseJsonSafe returns parsed values and falls back on invalid JSON', () => {
  assert.deepEqual(parseJsonSafe<Record<string, unknown>>('{"a":1}', {}), { a: 1 });
  assert.deepEqual(parseJsonSafe('[1,2]', []), [1, 2]);
  assert.deepEqual(parseJsonSafe('not json', { fallback: true }), { fallback: true });
  assert.equal(parseJsonSafe<unknown>('not json', null), null);
  assert.equal(parseJsonSafe<unknown>('', null), null);
});
