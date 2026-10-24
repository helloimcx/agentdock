import test from 'node:test';
import assert from 'node:assert/strict';
import { runChildProcess } from '../../scripts/run-child-process.mjs';

test('a child process startup failure cannot be reported as success', () => {
  const errors = [];
  const originalError = console.error;
  console.error = (message) => errors.push(message);
  try {
    const status = runChildProcess('pnpm', ['test'], {}, () => ({
      status: null,
      error: Object.assign(new Error('command not found'), { code: 'ENOENT' }),
    }));
    assert.equal(status, 1);
    assert.match(errors[0], /failed to start pnpm: command not found/i);
  } finally {
    console.error = originalError;
  }
});

test('a child process terminated by signal cannot be reported as success', () => {
  const errors = [];
  const originalError = console.error;
  console.error = (message) => errors.push(message);
  try {
    const status = runChildProcess(process.execPath, ['--test'], {}, () => ({
      status: null,
      signal: 'SIGTERM',
    }));
    assert.equal(status, 1);
    assert.match(errors[0], /terminated by SIGTERM/i);
  } finally {
    console.error = originalError;
  }
});
