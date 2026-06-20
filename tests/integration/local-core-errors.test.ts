import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalCoreError,
  formatLogError,
  toLocalCoreErrorInfo,
} from '../../services/local-ai-core/src/kernel/local-core-errors.js';

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
