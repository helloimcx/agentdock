import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SandboxRunInput, SandboxRunResult } from '../../services/local-ai-core/src/automation/scripts/sandbox-runner.js';
import {
  AnthropicSandboxRunner,
  buildSandboxRuntimeConfig,
  PRIVATE_NETWORK_DENY_HOSTS,
  isPrivateNetworkAddress,
  type SandboxManagerLike,
} from '../../services/local-ai-core/src/automation/scripts/anthropic-sandbox-runner.js';

class FakeManager implements SandboxManagerLike {
  config: unknown;
  initialized = 0;
  wrapped: string[] = [];
  wrappedArgv: string[] = [];
  dependencyErrors: string[] = [];
  dependencyWarnings: string[] = [];
  supported = true;
  initializeError?: Error;
  resetCalls = 0;

  async initialize(config: unknown): Promise<void> {
    this.initialized += 1;
    this.config = config;
    if (this.initializeError) throw this.initializeError;
  }

  async wrapWithSandbox(command: string): Promise<string> {
    this.wrapped.push(command);
    return command;
  }

  async wrapWithSandboxArgv(command: string): Promise<{ argv: string[]; env: NodeJS.ProcessEnv }> {
    this.wrappedArgv.push(command);
    return { argv: ['/bin/sh', '-c', command], env: { ...process.env } };
  }

  isSupportedPlatform() { return this.supported; }
  isSandboxingEnabled() { return this.initialized > 0; }
  checkDependencies() { return { errors: this.dependencyErrors, warnings: this.dependencyWarnings }; }
  async reset() { this.resetCalls += 1; }
  cleanupAfterCommand() {}
}

function input(root: string, overrides: Partial<SandboxRunInput> = {}): SandboxRunInput {
  return {
    command: 'printf sandbox-ok',
    cwd: root,
    packagePath: join(root, 'package'),
    tempDir: join(root, 'tmp'),
    tempRoot: root,
    network: 'none',
    ...overrides,
  };
}

test('builds read-only package and temp-only write policy', () => {
  const root = '/workspace/automation';
  const config = buildSandboxRuntimeConfig(input(root, {
    allowedReadDirs: ['/workspace/automation/fixtures'],
    denyRead: ['/workspace/automation/secret.txt'],
  }));

  assert.deepEqual(config.filesystem.allowWrite, ['/workspace/automation/tmp']);
  assert.ok(config.filesystem.denyWrite.includes('/workspace/automation/package'));
  assert.ok(config.filesystem.allowRead?.includes('/workspace/automation/package'));
  assert.ok(config.filesystem.allowRead?.includes('/workspace/automation/fixtures'));
  assert.ok(config.filesystem.denyRead.includes('/workspace/automation/secret.txt'));
  assert.ok(config.filesystem.denyWrite.includes('/tmp/claude'));
  assert.ok(config.filesystem.denyWrite.some((path) => path.endsWith('/.npm/_logs')));
});

test('rejects temp paths outside a controlled temporary root and explicit package denies win', () => {
  const root = '/workspace/automation';
  assert.throws(() => buildSandboxRuntimeConfig(input(root, {
    tempRoot: root,
    tempDir: '/tmp',
  })), /tempDir must be inside/);
  const config = buildSandboxRuntimeConfig(input(root, {
    denyRead: [join(root, 'package', 'secret.txt')],
  }));
  assert.ok(!config.filesystem.allowRead?.some((path) => path === join(root, 'package')));
});

test('generates callback-gated public egress with explicit private/local denies', () => {
  const config = buildSandboxRuntimeConfig(input('/workspace/automation', {
    network: 'public',
  }));

  assert.deepEqual(config.network.allowedDomains, []);
  assert.equal(config.network.strictAllowlist, false);
  for (const host of ['localhost', '127.0.0.1', '::1', '169.254.169.254']) {
    assert.ok(config.network.deniedDomains.includes(host));
  }
  assert.ok(PRIVATE_NETWORK_DENY_HOSTS.every((host) => config.network.deniedDomains.includes(host)));
});

test('generates restricted egress only from manifest domains', () => {
  const config = buildSandboxRuntimeConfig(input('/workspace/automation', {
    network: 'restricted',
    allowedDomains: ['api.example.com', '*.vendor.example'],
  }));

  assert.deepEqual(config.network.allowedDomains, []);
  assert.equal(config.network.strictAllowlist, false);
  assert.ok(config.network.deniedDomains.includes('localhost'));
});

test('private-address policy rejects numeric ranges and mapped IPv6 forms', async () => {
  assert.equal(await isPrivateNetworkAddress('10.0.0.2'), true);
  assert.equal(await isPrivateNetworkAddress('192.168.1.2'), true);
  assert.equal(await isPrivateNetworkAddress('::ffff:10.1.2.3'), true);
  assert.equal(await isPrivateNetworkAddress('::ffff:a01:203'), true);
  assert.equal(await isPrivateNetworkAddress('127.0.0.3'), true);
});

test('probe reports named Linux dependencies and AppArmor userns failures', async () => {
  const manager = new FakeManager();
  manager.dependencyErrors = [
    'ripgrep (rg) not found',
    'bubblewrap (bwrap) not installed',
    'socat not installed',
  ];
  manager.dependencyWarnings = [
    'seccomp not available - unix socket access not restricted',
    'network namespace not available',
  ];
  const runner = new AnthropicSandboxRunner({
    platform: 'linux',
    manager,
    appArmorUsernsAvailable: false,
  });

  const result = await runner.probe();
  assert.equal(result.available, false);
  assert.equal(result.platform, 'linux');
  assert.deepEqual(result.missing, ['bwrap', 'socat', 'rg', 'seccomp', 'network.namespace', 'apparmor.userns']);
  assert.equal(manager.initialized, 0);
});

test('probe reports macOS sandbox-exec and ripgrep capabilities', async () => {
  const runner = new AnthropicSandboxRunner({
    platform: 'macos',
    manager: new FakeManager(),
    commandExists: (command) => command === 'sandbox-exec' || command === 'rg',
  });
  const result = await runner.probe();
  assert.equal(result.available, true);
  assert.deepEqual(result.missing, []);
});

test('probe reports missing macOS ripgrep independently', async () => {
  const runner = new AnthropicSandboxRunner({
    platform: 'macos',
    manager: new FakeManager(),
    commandExists: (command) => command === 'sandbox-exec',
  });
  const result = await runner.probe();
  assert.equal(result.available, false);
  assert.deepEqual(result.missing, ['rg']);
});

test('Windows probes and runs fail closed with sandbox_unavailable', async () => {
  const manager = new FakeManager();
  const runner = new AnthropicSandboxRunner({ platform: 'win32', manager });
  const probe = await runner.probe();
  assert.equal(probe.available, false);
  assert.deepEqual(probe.missing, ['sandbox_unavailable']);

  await assert.rejects(
    runner.run(input('/workspace/automation')),
    (error: unknown) => error instanceof Error && error.message.includes('sandbox_unavailable'),
  );
  assert.equal(manager.initialized, 0);
});

test('keeps wrapped shell command private to adapter and returns only execution result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'automation-sandbox-runner-'));
  try {
    const manager = new FakeManager();
    const runner = new AnthropicSandboxRunner({ platform: process.platform, manager, tempRoot: root });
    const result: SandboxRunResult = await runner.run({ ...input(root), env: { PATH: join(root, 'fake-bin') }, allowedEnv: ['PATH'] });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'sandbox-ok');
    assert.deepEqual(Object.keys(result).sort(), ['exitCode', 'signal', 'stderr', 'stdout']);
    assert.equal(manager.wrappedArgv.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('enforces streamed output ceilings before buffering unbounded output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'automation-sandbox-runner-'));
  try {
    const runner = new AnthropicSandboxRunner({ platform: process.platform, manager: new FakeManager(), tempRoot: root });
    const result = await runner.run({ ...input(root, { command: 'yes output', stdoutBytes: 64, timeoutMs: 5_000 }) });
    assert.equal(result.outputLimitExceeded, 'stdout');
    assert.ok(Buffer.byteLength(result.stdout, 'utf8') <= 64);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stream truncation respects UTF-8 byte limits without replacement characters', async () => {
  const root = mkdtempSync(join(tmpdir(), 'automation-sandbox-runner-'));
  try {
    const runner = new AnthropicSandboxRunner({ platform: process.platform, manager: new FakeManager(), tempRoot: root });
    const result = await runner.run({ ...input(root, { command: "printf '€€'", stdoutBytes: 4, timeoutMs: 5_000 }) });
    assert.equal(result.outputLimitExceeded, 'stdout');
    assert.ok(Buffer.byteLength(result.stdout, 'utf8') <= 4);
    assert.ok(!result.stdout.includes('\uFFFD'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stream truncation preserves a complete replacement character before overflow', async () => {
  const root = mkdtempSync(join(tmpdir(), 'automation-sandbox-runner-'));
  try {
    const runner = new AnthropicSandboxRunner({ platform: process.platform, manager: new FakeManager(), tempRoot: root });
    const result = await runner.run({ ...input(root, { command: "printf '�€'", stdoutBytes: 5, timeoutMs: 5_000 }) });
    assert.equal(result.stdout, '�');
    assert.equal(Buffer.byteLength(result.stdout, 'utf8'), 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('timeout terminates the sandbox command process group', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'automation-sandbox-runner-'));
  try {
    const runner = new AnthropicSandboxRunner({ platform: process.platform, manager: new FakeManager(), tempRoot: root });
    const started = Date.now();
    const result = await runner.run({ ...input(root, { command: 'sleep 3 & wait', timeoutMs: 50 }) });
    assert.ok(Date.now() - started < 2_000);
    assert.notEqual(result.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('serializes process-global SandboxManager operations across runners', async () => {
  const root = mkdtempSync(join(tmpdir(), 'automation-sandbox-lock-'));
  try {
    const manager = new FakeManager();
    const first = new AnthropicSandboxRunner({ platform: process.platform, manager, tempRoot: root });
    const second = new AnthropicSandboxRunner({ platform: process.platform, manager, tempRoot: root });
    const [left, right] = await Promise.all([
      first.run(input(root)),
      second.run(input(root)),
    ]);
    assert.equal(left.exitCode, 0);
    assert.equal(right.exitCode, 0);
    assert.equal(manager.resetCalls >= 4, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sanitizes loader/startup/proxy environment variables while preserving approved data', async () => {
  const root = mkdtempSync(join(tmpdir(), 'automation-sandbox-env-'));
  try {
    const manager = new FakeManager();
    const runner = new AnthropicSandboxRunner({ platform: process.platform, manager, tempRoot: root });
    const result = await runner.run({
      ...input(root),
      command: 'printf "%s-%s" "$TOKEN" "$BASH_ENV"',
      env: { TOKEN: 'approved', BASH_ENV: '/tmp/evil', HTTP_PROXY: 'http://evil' },
      allowedEnv: ['TOKEN', 'BASH_ENV', 'HTTP_PROXY'],
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'approved-');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps an explicit empty environment allowlist empty', async () => {
  const root = mkdtempSync(join(tmpdir(), 'automation-sandbox-empty-env-'));
  try {
    const manager = new FakeManager();
    const runner = new AnthropicSandboxRunner({ platform: process.platform, manager, tempRoot: root });
    const result = await runner.run({
      ...input(root),
      command: 'printf "%s" "$TOKEN"',
      env: { TOKEN: 'must-not-pass' },
      allowedEnv: [],
      manifest: { env: ['TOKEN'] },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
