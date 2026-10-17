import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();

test('bin CLI entrypoints are valid executable Node scripts that resolve compiled modules without MODULE_NOT_FOUND', () => {
  const scripts = [
    { name: 'agentdock', script: 'bin/agentdock.mjs', args: ['--help'], expectedOutput: 'Usage:' },
    { name: 'agentdock-node', script: 'bin/agentdock-node.mjs', args: ['--help'], expectedOutput: 'AgentDock Mesh' },
    { name: 'mobile-apps', script: 'bin/mobile-apps.mjs', args: ['help'], expectedOutput: 'mobile-apps:' },
    { name: 'mobile-ui', script: 'bin/mobile-ui.mjs', args: ['--help'], expectedOutput: 'AgentDock Mobile UI Bridge' },
  ];

  for (const { name, script, args, expectedOutput } of scripts) {
    const fullPath = path.join(rootDir, script);
    assert.ok(existsSync(fullPath), `${script} must exist`);

    const result = spawnSync(process.execPath, [fullPath, ...args], {
      cwd: rootDir,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
    });

    assert.equal(
      result.status,
      0,
      `${name} (${script}) failed with status ${result.status}.\nStderr: ${result.stderr}\nStdout: ${result.stdout}`,
    );
    assert.match(
      result.stdout,
      new RegExp(expectedOutput),
      `${name} (${script}) output should contain "${expectedOutput}"`,
    );
  }
});
