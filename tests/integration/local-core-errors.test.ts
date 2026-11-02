import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalCoreError,
  LocalCoreErrorReporter,
  formatLogError,
  toLocalCoreErrorInfo,
} from '../../apps/daemon/src/kernel/local-core-errors.js';

test('LocalCoreError coerces non-string message into a string', () => {
  const err = new LocalCoreError('internal_error', { weird: 'shape' } as unknown as string);
  assert.equal(typeof err.info.message, 'string');
  assert.equal(err.message, err.info.message);
  assert.ok(err.info.message.includes('"weird"'));
  const line = formatLogError(err.info);
  assert.ok(!line.includes('[object Object]'), `log line leaked [object Object]: ${line}`);
});

test('toLocalCoreErrorInfo stringifies Error whose message is an object', () => {
  const raw = new Error('' as unknown as string);
  raw.message = { nested: 'value' } as unknown as string;
  const info = toLocalCoreErrorInfo(raw);
  assert.equal(typeof info.message, 'string');
  const line = formatLogError(info);
  assert.ok(!line.includes('[object Object]'), `log line leaked [object Object]: ${line}`);
});

test('toLocalCoreErrorInfo preserves runtime_protocol_timeout classification for timeout string', () => {
  const info = toLocalCoreErrorInfo(new Error('Timed out waiting for ACP session/prompt after 900000ms'));
  assert.equal(info.code, 'runtime_protocol_timeout');
  assert.equal(typeof info.message, 'string');
});

test('formatLogError renders cause suffix when present', () => {
  const err = new LocalCoreError('runtime_exited', 'child crashed', { cause: 'SIGTERM' });
  const line = formatLogError(err.info);
  assert.equal(line, 'runtime_exited: child crashed cause=SIGTERM');
});

test('toLocalCoreErrorInfo carries details through LocalCoreError instances', () => {
  const base = new LocalCoreError('runtime_protocol_timeout', 'Timed out waiting for ACP session/prompt after 100ms');
  const info = toLocalCoreErrorInfo(base, 'internal_error', { threadId: 'thread-x', runtimeId: 'hermes' });
  assert.equal(info.code, 'runtime_protocol_timeout');
  assert.equal(info.details?.threadId, 'thread-x');
  assert.equal(info.details?.runtimeId, 'hermes');
});

function realisticThreadKey(index: number) {
  const hex = index.toString(16).padStart(12, '0');
  return `thread:agentdock::4f7c9a${hex.slice(0, 6)}-8b1d-4e0a-9c2f-${hex.slice(0, 12)}`;
}

test('error reporter caps distinct summaries and evicts the oldest by lastSeenAt', () => {
  const lines: string[] = [];
  const reporter = new LocalCoreErrorReporter((message) => lines.push(message));

  for (let index = 0; index < 410; index += 1) {
    reporter.report('localcore-acp', new Error(`run failed for tool batch ${index}`), {
      workspaceId: 'agentdock',
      runtimeId: 'claudecode',
      threadId: realisticThreadKey(index),
    }, 'runtime_protocol_error');
  }

  const listed = reporter.list();
  assert.equal(listed.length, 400);
  const keys = new Set(listed.map((entry) => entry.key));
  const oldestKey = ['localcore-acp', 'runtime_protocol_error', 'agentdock', 'claudecode', realisticThreadKey(0)].filter(Boolean).join(':');
  assert.ok(!keys.has(oldestKey), 'oldest summary should be evicted');
  assert.ok([...keys].some((key) => key.endsWith(realisticThreadKey(409))), 'newest summary should be retained');
});

test('error reporter keeps counting a recurring key after earlier insertions', () => {
  const lines: string[] = [];
  const reporter = new LocalCoreErrorReporter((message) => lines.push(message), 0);
  const context = { workspaceId: 'agentdock', threadId: 'thread:agentdock::4f7c9a00-8b1d-4e0a-9c2f-000000000042' };

  reporter.report('localcore-acp', new Error('session expired mid-turn'), context, 'channel_session_expired');
  const before = reporter.list().find((entry) => entry.key.includes('000000000042'));
  assert.equal(before?.count, 1);

  reporter.report('localcore-acp', new Error('session expired mid-turn'), context, 'channel_session_expired');
  const after = reporter.list().find((entry) => entry.key.includes('000000000042'));
  assert.equal(after?.count, 2);
});
