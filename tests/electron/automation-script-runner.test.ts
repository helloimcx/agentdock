import assert from 'node:assert/strict';
import test from 'node:test';

import type { AutomationScriptVersion } from '../../packages/contracts/src/automations.js';
import {
  ScriptProtocolError,
  ScriptProtocolRunner,
} from '../../services/local-ai-core/src/automation/scripts/script-protocol-runner.js';
import type { SandboxRunInput, SandboxRunResult, SandboxRunner } from '../../services/local-ai-core/src/automation/scripts/sandbox-runner.js';
import { SandboxUnavailableError } from '../../services/local-ai-core/src/automation/scripts/anthropic-sandbox-runner.js';

class FakeSandbox implements SandboxRunner {
  input?: SandboxRunInput;
  result: SandboxRunResult = { exitCode: 0, signal: null, stdout: '{"protocolVersion":1,"matched":true,"summary":"ok","nextState":{"cursor":2}}', stderr: 'diagnostic\u0001' };
  async probe() { return { available: true, platform: 'test', missing: [] }; }
  async run(input: SandboxRunInput) {
    this.input = input;
    if (input.command.endsWith(' --version')) return { exitCode: 0, signal: null, stdout: 'sh 1.0', stderr: '' };
    return this.result;
  }
}

function version(overrides: Partial<AutomationScriptVersion> = {}): AutomationScriptVersion {
  const packageSha256 = overrides.packageSha256 || 'a'.repeat(64);
  return {
    id: 'version-1', scriptId: 'script-1', status: 'approved', packageSha256, packagePath: `/packages/${packageSha256}`,
    shebang: '#!/bin/sh', interpreterPath: '/bin/sh', interpreterVersion: 'sh 1.0', capabilities: {}, config: { threshold: 2 }, configSchema: {},
    networkMode: 'none', internalAccess: false, allowedReadDirs: [], secretRefs: [], env: [],
    limits: { timeoutMs: 30_000, stdoutBytes: 1024, stderrBytes: 1024, payloadBytes: 256, stateBytes: 256 },
    staticCheck: {}, testPlan: {}, createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z', ...overrides,
  };
}

function runner(sandbox = new FakeSandbox(), current = version()) {
  return {
    sandbox,
    runner: new ScriptProtocolRunner({
      sandbox,
      getVersion: () => current,
      verifyPackage: () => undefined,
      entrypointFor: () => 'run.sh',
    }),
  };
}

test('sends the exact v1 request and accepts exactly one v1 JSON response', async () => {
  const { sandbox, runner: subject } = runner();
  const result = await subject.run({ scriptId: 'script-1', approvedVersionId: 'version-1', evaluationId: 'evaluation-1', triggeredAt: '2026-07-12T01:02:03.000Z', previousState: { cursor: 1 } });
  assert.deepEqual(JSON.parse(sandbox.input?.stdin || ''), {
    protocolVersion: 1, evaluationId: 'evaluation-1', triggeredAt: '2026-07-12T01:02:03.000Z', config: { threshold: 2 }, previousState: { cursor: 1 },
  });
  assert.equal(sandbox.input?.timeoutMs, 30_000);
  assert.equal(sandbox.input?.stdoutBytes, 1024);
  assert.equal(sandbox.input?.stderrBytes, 1024);
  assert.equal(result.matched, true);
  assert.deepEqual(result.nextState, { cursor: 2 });
  assert.equal(result.stderr, 'diagnostic');
});

test('rejects non-single JSON stdout, failed exits, and oversized response fields', async () => {
  const { sandbox, runner: subject } = runner();
  sandbox.result = { exitCode: 0, signal: null, stdout: '{"protocolVersion":1,"matched":false}\n{}', stderr: '' };
  await assert.rejects(subject.run({ scriptId: 'script-1', approvedVersionId: 'version-1', evaluationId: 'e', triggeredAt: '2026-07-12T00:00:00.000Z', previousState: {} }), /exactly one JSON/i);
  sandbox.result = { exitCode: 1, signal: null, stdout: '', stderr: 'failure' };
  await assert.rejects(subject.run({ scriptId: 'script-1', approvedVersionId: 'version-1', evaluationId: 'e', triggeredAt: '2026-07-12T00:00:00.000Z', previousState: {} }), /exit code 1/i);
  sandbox.result = { exitCode: 0, signal: null, stdout: '{"protocolVersion":1,"matched":true,"payload":{"long":"'.concat('x'.repeat(300), '"}}'), stderr: '' };
  await assert.rejects(subject.run({ scriptId: 'script-1', approvedVersionId: 'version-1', evaluationId: 'e', triggeredAt: '2026-07-12T00:00:00.000Z', previousState: {} }), /payload exceeds/i);
  sandbox.result = { exitCode: 0, signal: null, stdout: '{"protocolVersion":1,"matched":true,"extra":1}', stderr: '' };
  await assert.rejects(subject.run({ scriptId: 'script-1', approvedVersionId: 'version-1', evaluationId: 'e', triggeredAt: '2026-07-12T00:00:00.000Z', previousState: {} }), /unsupported field/i);
});

test('runtime sandbox loss after probing blocks execution fail-closed', async () => {
  class LostSandbox extends FakeSandbox { override async run(input: SandboxRunInput) {
    if (input.command.endsWith(' --version')) return { exitCode: 0, signal: null, stdout: 'sh 1.0', stderr: '' };
    throw new SandboxUnavailableError(['sandbox_runtime']);
  } }
  const subject = runner(new LostSandbox()).runner;
  await assert.rejects(subject.run({ scriptId: 'script-1', approvedVersionId: 'version-1', evaluationId: 'e', triggeredAt: '2026-07-12T00:00:00.000Z', previousState: {} }),
    (error: unknown) => error instanceof ScriptProtocolError && error.code === 'sandbox_unavailable' && error.blockAutomation);
});

test('fails closed before execution for non-approved, changed package, or interpreter facts', async () => {
  for (const changed of [version({ status: 'tested' }), version({ packageSha256: 'b'.repeat(64), packagePath: '/packages/a' }), version({ interpreterVersion: 'different' })]) {
    const { sandbox, runner: subject } = runner(new FakeSandbox(), changed);
    await assert.rejects(
      subject.run({ scriptId: 'script-1', approvedVersionId: 'version-1', evaluationId: 'e', triggeredAt: '2026-07-12T00:00:00.000Z', previousState: {} }),
      (error: unknown) => error instanceof ScriptProtocolError && error.blockAutomation,
    );
    assert.equal(sandbox.input?.stdin, undefined);
  }
});

test('enforces a 30 second default and five minute maximum', async () => {
  const { sandbox, runner: subject } = runner(new FakeSandbox(), version({ limits: { timeoutMs: 999_999, stdoutBytes: 1024, stderrBytes: 1024, payloadBytes: 256, stateBytes: 256 } }));
  await subject.run({ scriptId: 'script-1', approvedVersionId: 'version-1', evaluationId: 'e', triggeredAt: '2026-07-12T00:00:00.000Z', previousState: {} });
  assert.equal(sandbox.input?.timeoutMs, 300_000);
});

test('validates an interpreter only through the sandbox boundary', async () => {
  const sandbox = new FakeSandbox();
  const current = version({ interpreterPath: '/untrusted/side-effect-interpreter', interpreterVersion: 'different' });
  const subject = new ScriptProtocolRunner({ sandbox, getVersion: () => current, verifyPackage: () => undefined, entrypointFor: () => 'run.sh' });
  await assert.rejects(
    subject.run({ scriptId: 'script-1', approvedVersionId: 'version-1', evaluationId: 'e', triggeredAt: '2026-07-12T00:00:00.000Z', previousState: {} }),
    (error: unknown) => error instanceof ScriptProtocolError && error.code === 'interpreter_mismatch',
  );
  assert.match(sandbox.input?.command || '', /untrusted\/side-effect-interpreter/);
  assert.equal(sandbox.input?.stdin, undefined);
});

test('injects only declared env secrets for one process and redacts them from persisted output', async () => {
  const sandbox = new FakeSandbox();
  sandbox.result = { exitCode: 0, signal: null, stdout: '{"protocolVersion":1,"matched":true,"summary":"token-value"}', stderr: 'token-value\u0002' };
  const current = version({ secretRefs: ['env://API_TOKEN'], env: ['API_TOKEN'] });
  const subject = new ScriptProtocolRunner({
    sandbox, getVersion: () => current, verifyPackage: () => undefined, entrypointFor: () => 'run.sh',
    secretResolver: { get: (name) => name === 'API_TOKEN' ? 'token-value' : undefined },
  });
  const result = await subject.run({ scriptId: 'script-1', approvedVersionId: 'version-1', evaluationId: 'e', triggeredAt: '2026-07-12T00:00:00.000Z', previousState: {} });
  assert.deepEqual(sandbox.input?.env, { API_TOKEN: 'token-value' });
  assert.deepEqual(sandbox.input?.allowedEnv, ['API_TOKEN']);
  assert.equal(result.summary, '[REDACTED]');
  assert.equal(result.stderr, '');
});

test('fails with secret_unavailable without running undeclared or unavailable secrets', async () => {
  const sandbox = new FakeSandbox();
  const current = version({ secretRefs: ['env://API_TOKEN'], env: [] });
  const subject = new ScriptProtocolRunner({
    sandbox, getVersion: () => current, verifyPackage: () => undefined, entrypointFor: () => 'run.sh',
    secretResolver: { get: () => 'must-not-read' },
  });
  await assert.rejects(
    subject.run({ scriptId: 'script-1', approvedVersionId: 'version-1', evaluationId: 'e', triggeredAt: '2026-07-12T00:00:00.000Z', previousState: {} }),
    (error: unknown) => error instanceof ScriptProtocolError && error.code === 'secret_unavailable',
  );
  assert.equal(sandbox.input?.stdin, undefined);
});
