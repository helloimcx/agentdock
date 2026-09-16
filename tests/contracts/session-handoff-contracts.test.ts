import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSessionHandoffStatus,
  formatSessionHandoffDelimiter,
  parseSessionHandoffDelimiter,
  normalizeMemoryCategory,
  isValidMemorySlug,
  MEMORY_CATEGORIES,
  type SessionHandoffPayload,
} from '../../packages/contracts/src/index.js';

test('normalizeSessionHandoffStatus normalizes known statuses and defaults to pending', () => {
  assert.equal(normalizeSessionHandoffStatus('PENDING'), 'pending');
  assert.equal(normalizeSessionHandoffStatus('consumed'), 'consumed');
  assert.equal(normalizeSessionHandoffStatus('superseded'), 'superseded');
  assert.equal(normalizeSessionHandoffStatus('unknown'), 'pending');
  assert.equal(normalizeSessionHandoffStatus(undefined), 'pending');
});

test('formatSessionHandoffDelimiter and parseSessionHandoffDelimiter roundtrip cleanly', () => {
  const payload: SessionHandoffPayload = {
    threadId: 'thread:123',
    runId: 'run:456',
    fromAgent: 'claudecode',
    toAgent: 'codex',
    summary: 'Refactored auth module to use session tokens',
    decisions: ['Use JWT with short expiry', 'Store refresh token in SQLite'],
    artifacts: ['src/auth/session.ts', 'src/auth/jwt.ts'],
    openQuestions: ['Should we support OAuth PKCE?'],
    nextSteps: ['Add integration tests', 'Migrate user database'],
  };

  const formatted = formatSessionHandoffDelimiter(payload);
  assert.match(formatted, /\[Session Handoff from claudecode to codex\]/);
  assert.match(formatted, /Source Run: run:456/);
  assert.match(formatted, /Key Decisions:/);
  assert.match(formatted, /- Use JWT with short expiry/);
  assert.match(formatted, /Artifacts & Modified Files:/);
  assert.match(formatted, /- src\/auth\/session\.ts/);
  assert.match(formatted, /\[\/Session Handoff\]/);

  const parsed = parseSessionHandoffDelimiter(formatted);
  assert.ok(parsed);
  assert.equal(parsed.fromAgent, 'claudecode');
  assert.equal(parsed.toAgent, 'codex');
  assert.match(parsed.body, /Refactored auth module/);
});

test('normalizeMemoryCategory validates standard categories and rejects invalid ones', () => {
  assert.equal(normalizeMemoryCategory('_rules'), '_rules');
  assert.equal(normalizeMemoryCategory('rules'), '_rules');
  assert.equal(normalizeMemoryCategory('decisions'), 'decisions');
  assert.equal(normalizeMemoryCategory('procedures'), 'procedures');
  assert.equal(normalizeMemoryCategory('gotchas'), 'gotchas');
  assert.throws(() => normalizeMemoryCategory('invalid-category'), /Invalid memory category/);
  assert.deepEqual([...MEMORY_CATEGORIES], ['_rules', 'decisions', 'procedures', 'gotchas']);
});

test('isValidMemorySlug validates safe filenames and rejects path traversal', () => {
  assert.equal(isValidMemorySlug('sqlite-wal-locking'), true);
  assert.equal(isValidMemorySlug('adr_001_initial_design'), true);
  assert.equal(isValidMemorySlug('架构设计'), true);
  assert.equal(isValidMemorySlug('../evil'), false);
  assert.equal(isValidMemorySlug('foo/bar'), false);
  assert.equal(isValidMemorySlug('foo\\bar'), false);
  assert.equal(isValidMemorySlug(''), false);
});
