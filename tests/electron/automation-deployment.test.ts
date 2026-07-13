import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { automationSandboxDiagnosticChecks } from '../../services/local-ai-core/src/runtime/deployment-diagnostics.js';

test('Linux automation diagnostics report every sandbox prerequisite independently', () => {
  const checks = automationSandboxDiagnosticChecks({
    available: false,
    platform: 'linux',
    missing: ['bwrap', 'socat', 'rg', 'apparmor.userns', 'network.namespace', 'seccomp'],
  });

  assert.deepEqual(checks.map((check) => check.id), [
    'automation.sandbox',
    'automation.linux.bwrap',
    'automation.linux.socat',
    'automation.linux.rg',
    'automation.linux.userns-apparmor',
    'automation.linux.network-namespace',
    'automation.linux.seccomp',
  ]);
  assert.equal(checks[0]?.status, 'pass', 'the runtime and its host prerequisites are separate checks');
  assert.ok(checks.slice(1).every((check) => check.status === 'fail'));
});

test('macOS automation diagnostics distinguish runtime, sandbox-exec, and rg', () => {
  const checks = automationSandboxDiagnosticChecks({
    available: false,
    platform: 'macos',
    missing: ['sandbox_runtime', 'sandbox-exec', 'rg'],
  });

  assert.deepEqual(checks.map((check) => check.id), [
    'automation.sandbox',
    'automation.macos.sandbox-exec',
    'automation.macos.rg',
  ]);
  assert.ok(checks.every((check) => check.status === 'fail'));
});

test('Windows automation diagnostics fail closed as unsupported', () => {
  const checks = automationSandboxDiagnosticChecks({
    available: false,
    platform: 'windows',
    missing: ['sandbox_unavailable'],
  });

  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.id, 'automation.sandbox');
  assert.equal(checks[0]?.status, 'fail');
  assert.match(checks[0]?.summary || '', /unsupported|fail-closed/i);
});

test('Linux core image installs conditional automation sandbox dependencies', () => {
  const dockerfile = readFileSync(join(process.cwd(), 'docker', 'agentdock', 'core.Dockerfile'), 'utf8');
  assert.match(dockerfile, /apt-get\s+update/);
  for (const dependency of ['bubblewrap', 'socat', 'ripgrep']) {
    assert.match(dockerfile, new RegExp(`\\b${dependency}\\b`));
  }
  assert.match(dockerfile, /rm -rf \/var\/lib\/apt\/lists\/\*/);
});
