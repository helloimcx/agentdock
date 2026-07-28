import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnthropicSandboxRunner } from '../../services/local-ai-core/src/automation/scripts/anthropic-sandbox-runner.js';

const root = mkdtempSync(join(tmpdir(), 'automation-sandbox-runtime-'));
const packagePath = join(root, 'package');
const tempDir = join(root, 'tmp');
const secretPath = join(root, 'fixture-secret.txt');
mkdirSync(packagePath);
mkdirSync(tempDir);
writeFileSync(join(packagePath, 'entry.js'), '#!/usr/bin/env node\n');
chmodSync(join(packagePath, 'entry.js'), 0o444);
writeFileSync(secretPath, 'fixture-secret-value');

const runner = new AnthropicSandboxRunner({ tempRoot: root });
const nodeCommand = process.execPath;
test('real Anthropic Sandbox Runtime enforces package, temp, and network policy', async (context) => {
  const capability = await runner.probe();
  const outboundUnavailable = process.env.AGENTDOCK_TEST_NO_OUTBOUND === '1';
  const skipReason = !capability.available
    ? `sandbox capability unavailable: ${capability.missing.join(', ')}`
    : outboundUnavailable
      ? 'outbound networking explicitly unavailable by AGENTDOCK_TEST_NO_OUTBOUND=1'
      : undefined;
  if (skipReason) {
    context.skip(skipReason);
    rmSync(root, { recursive: true, force: true });
    return;
  }
  try {
    const write = await runner.run({
      command: `${nodeCommand} -e ${JSON.stringify("require('fs').writeFileSync('" + tempDir + "/written.txt','ok')")}`,
      cwd: root,
      packagePath,
      tempDir,
      network: 'none',
      denyRead: [secretPath],
    });
    assert.equal(write.exitCode, 0, write.stderr);
    assert.equal(readFileSync(join(tempDir, 'written.txt'), 'utf8'), 'ok');

    const secretRead = await runner.run({
      command: `${nodeCommand} -e ${JSON.stringify("const value=require('fs').readFileSync('" + secretPath + "','utf8'); process.exit(value==='fixture-secret-value'?0:1)")}`,
      cwd: root,
      packagePath,
      tempDir,
      network: 'none',
      denyRead: [secretPath],
    });
    assert.notEqual(secretRead.exitCode, 0);

    const packageWrite = await runner.run({
      command: `${nodeCommand} -e ${JSON.stringify("require('fs').writeFileSync('" + packagePath + "/unexpected.txt','no')")}`,
      cwd: root,
      packagePath,
      tempDir,
      network: 'none',
    });
    assert.notEqual(packageWrite.exitCode, 0);

    const defaultTempWrite = await runner.run({
      command: `${nodeCommand} -e ${JSON.stringify("require('fs').writeFileSync('/tmp/claude/unexpected.txt','no')")}`,
      cwd: root,
      packagePath,
      tempDir,
      network: 'none',
    });
    assert.notEqual(defaultTempWrite.exitCode, 0);

    const publicEgress = await runner.run({
      command: 'curl -fsS https://1.1.1.1 >/dev/null',
      cwd: root,
      packagePath,
      tempDir,
      network: 'public',
    });
    assert.equal(publicEgress.exitCode, 0, publicEgress.stderr);

    const privateEgress = await runner.run({
      command: 'curl --noproxy \'\' -fsS --connect-timeout 2 http://127.0.0.1:9 >/dev/null',
      cwd: root,
      packagePath,
      tempDir,
      network: 'public',
    });
    assert.notEqual(privateEgress.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
