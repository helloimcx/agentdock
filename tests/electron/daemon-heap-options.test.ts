import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDaemonHeapOptions, withDaemonHeapOptions } from '../../apps/daemon/src/kernel/daemon-heap.js';

test('daemon heap options default to a 1024MB old-space ceiling', () => {
  assert.deepEqual(resolveDaemonHeapOptions({}), { maxOldSpaceMb: 1024 });
});

test('daemon heap options apply a positive AI_WORKSTATION_DAEMON_MAX_OLD_SPACE_MB override', () => {
  assert.deepEqual(resolveDaemonHeapOptions({ AI_WORKSTATION_DAEMON_MAX_OLD_SPACE_MB: '512' }), {
    maxOldSpaceMb: 512,
  });
});

test('daemon heap options disable the ceiling when the override is 0', () => {
  assert.deepEqual(resolveDaemonHeapOptions({ AI_WORKSTATION_DAEMON_MAX_OLD_SPACE_MB: '0' }), {
    maxOldSpaceMb: null,
  });
});

test('daemon heap options fall back to the default for invalid overrides', () => {
  for (const raw of ['abc', '-5', '512.5', '   ', '0x10', '010', '1e3', '+512', '999999999999999999999']) {
    assert.deepEqual(resolveDaemonHeapOptions({ AI_WORKSTATION_DAEMON_MAX_OLD_SPACE_MB: raw }), {
      maxOldSpaceMb: 1024,
    });
  }
});

test('withDaemonHeapOptions appends the flag to an existing NODE_OPTIONS', () => {
  assert.deepEqual(withDaemonHeapOptions({ NODE_OPTIONS: '--enable-source-maps' }), {
    NODE_OPTIONS: '--enable-source-maps --max-old-space-size=1024',
  });
});

test('withDaemonHeapOptions sets NODE_OPTIONS when absent', () => {
  assert.deepEqual(withDaemonHeapOptions({ AI_WORKSTATION_DAEMON_MAX_OLD_SPACE_MB: '512' }), {
    AI_WORKSTATION_DAEMON_MAX_OLD_SPACE_MB: '512',
    NODE_OPTIONS: '--max-old-space-size=512',
  });
});

test('withDaemonHeapOptions preserves other env keys and passes through unknown ones', () => {
  const env = withDaemonHeapOptions({ PATH: '/usr/bin', HOME: '/home/u' });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/home/u');
  assert.equal(env.NODE_OPTIONS, '--max-old-space-size=1024');
});

test('withDaemonHeapOptions leaves NODE_OPTIONS untouched when the ceiling is disabled', () => {
  const env = { NODE_OPTIONS: '--enable-source-maps', AI_WORKSTATION_DAEMON_MAX_OLD_SPACE_MB: '0' };
  assert.deepEqual(withDaemonHeapOptions(env), env);
});
