import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectInstalledAgentRuntimes } from '../services/local-ai-core/src/runtime/agent-runtime-detector.js';
import { resolveAgentRuntimeDefinition } from '../services/local-ai-core/src/agents/index.js';

test('agent runtime definitions own runtime detection metadata', () => {
  assert.deepEqual(resolveAgentRuntimeDefinition('hermes')?.detection?.commandCandidates, ['hermes']);
  assert.deepEqual(resolveAgentRuntimeDefinition('codex')?.detection?.bundledRuntimes?.[0], {
    packageName: '@zed-industries/codex-acp',
    candidates: ['bin/codex-acp.js'],
  });
  assert.equal(resolveAgentRuntimeDefinition('localcore-acp')?.detection?.builtin, true);
});

test('agent runtime detector only marks commands present on PATH as installed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-detector-'));
  try {
    const opencode = join(dir, 'opencode');
    writeFileSync(opencode, '#!/bin/sh\nexit 0\n', 'utf8');
    writeFileSync(join(dir, 'package.json'), '{}\n', 'utf8');
    chmodSync(opencode, 0o755);

    const runtimes = detectInstalledAgentRuntimes({
      env: { PATH: dir },
      requireFrom: join(dir, 'package.json'),
    });
    const byType = new Map(runtimes.map((runtime) => [runtime.agentType, runtime]));

    assert.equal(byType.get('opencode')?.installed, true);
    assert.equal(byType.get('opencode')?.status, 'installed');
    assert.equal(byType.get('opencode')?.source, 'path');
    assert.equal(byType.get('opencode')?.command, opencode);
    assert.equal(byType.get('opencode')?.binaryPath, opencode);
    assert.equal(byType.get('pi')?.installed, false);
    assert.equal(byType.get('pi')?.status, 'not_installed');
    assert.equal(byType.get('codex')?.installed, false);
    assert.equal(byType.get('codex')?.status, 'not_installed');
    assert.equal(byType.get('hermes')?.installed, false);
    assert.equal(byType.get('hermes')?.status, 'not_installed');
    assert.equal(byType.get('localcore-acp')?.installed, true);
    assert.equal(byType.get('localcore-acp')?.status, 'installed');
    assert.equal(byType.get('localcore-acp')?.source, 'builtin');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent runtime detector reports bundled pi coding agent when available', () => {
  const pi = detectInstalledAgentRuntimes({
    env: { PATH: '' },
  }).find((runtime) => runtime.agentType === 'pi');

  assert.equal(pi?.installed, true);
  assert.equal(pi?.status, 'installed');
  assert.equal(pi?.source, 'bundled');
  assert.match(pi?.command || '', /@mariozechner[/\\]pi-coding-agent[/\\]dist[/\\]cli\.js$/);
});

test('agent runtime detector reports bundled codex ACP when available', () => {
  const codex = detectInstalledAgentRuntimes({
    env: { PATH: '' },
  }).find((runtime) => runtime.agentType === 'codex');

  assert.equal(codex?.installed, true);
  assert.equal(codex?.status, 'installed');
  assert.equal(codex?.source, 'bundled');
  assert.match(codex?.command || '', /@zed-industries[/\\]codex-acp[/\\]bin[/\\]codex-acp\.js$/);
});

test('agent runtime detector honors configured pi command before bundled runtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-pi-config-'));
  try {
    const customPi = join(dir, 'custom-pi');
    writeFileSync(customPi, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(customPi, 0o755);

    const runtimes = detectInstalledAgentRuntimes({
      env: { PATH: '' },
      config: {
        projects: [
          {
            name: 'configured-pi',
            agent: {
              type: 'pi',
              options: {
                command: customPi,
              },
            },
            platforms: [],
          },
        ],
      },
    });
    const pi = runtimes.find((runtime) => runtime.agentType === 'pi');

    assert.equal(pi?.installed, true);
    assert.equal(pi?.status, 'installed');
    assert.equal(pi?.source, 'config');
    assert.equal(pi?.command, customPi);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent runtime detector honors configured project commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-config-'));
  try {
    const customCodex = join(dir, 'custom-codex');
    writeFileSync(customCodex, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(customCodex, 0o755);

    const runtimes = detectInstalledAgentRuntimes({
      env: { PATH: '' },
      config: {
        projects: [
          {
            name: 'configured-codex',
            agent: {
              type: 'codex',
              options: {
                command: customCodex,
              },
            },
            platforms: [],
          },
        ],
      },
    });
    const codex = runtimes.find((runtime) => runtime.agentType === 'codex');

    assert.equal(codex?.installed, true);
    assert.equal(codex?.status, 'installed');
    assert.equal(codex?.source, 'config');
    assert.equal(codex?.command, customCodex);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent runtime detector reports pi version when PATH command succeeds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-pi-version-'));
  try {
    const pi = join(dir, 'pi');
    writeFileSync(pi, '#!/bin/sh\necho "pi 0.72.1"\n', 'utf8');
    writeFileSync(join(dir, 'package.json'), '{}\n', 'utf8');
    chmodSync(pi, 0o755);

    const piRuntime = detectInstalledAgentRuntimes({
      env: { PATH: dir },
      requireFrom: join(dir, 'package.json'),
    }).find((runtime) => runtime.agentType === 'pi');

    assert.equal(piRuntime?.status, 'installed');
    assert.equal(piRuntime?.source, 'path');
    assert.equal(piRuntime?.version, '0.72.1');
    assert.equal(piRuntime?.issues.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent runtime detector reports version when version command succeeds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-version-'));
  try {
    const opencode = join(dir, 'opencode');
    writeFileSync(opencode, '#!/bin/sh\necho "opencode 1.2.3"\n', 'utf8');
    chmodSync(opencode, 0o755);

    const opencodeRuntime = detectInstalledAgentRuntimes({
      env: { PATH: dir },
    }).find((runtime) => runtime.agentType === 'opencode');

    assert.equal(opencodeRuntime?.status, 'installed');
    assert.equal(opencodeRuntime?.version, '1.2.3');
    assert.equal(opencodeRuntime?.issues.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent runtime detector reports Claude Code when claude command is available', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-claude-version-'));
  try {
    const claude = join(dir, 'claude');
    writeFileSync(claude, '#!/bin/sh\necho "2.1.114 (Claude Code)"\n', 'utf8');
    chmodSync(claude, 0o755);

    const claudeRuntime = detectInstalledAgentRuntimes({
      env: { PATH: dir },
      requireFrom: join(dir, 'package.json'),
    }).find((runtime) => runtime.agentType === 'claudecode');

    assert.equal(claudeRuntime?.status, 'installed');
    assert.equal(claudeRuntime?.source, 'path');
    assert.equal(claudeRuntime?.command, claude);
    assert.equal(claudeRuntime?.version, '2.1.114');
    assert.equal(claudeRuntime?.issues.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent runtime detector reports Hermes when hermes command is available', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-hermes-version-'));
  try {
    const hermes = join(dir, 'hermes');
    writeFileSync(hermes, '#!/bin/sh\necho "hermes 0.9.1"\n', 'utf8');
    chmodSync(hermes, 0o755);

    const hermesRuntime = detectInstalledAgentRuntimes({
      env: { PATH: dir },
    }).find((runtime) => runtime.agentType === 'hermes');

    assert.equal(hermesRuntime?.status, 'installed');
    assert.equal(hermesRuntime?.source, 'path');
    assert.equal(hermesRuntime?.command, hermes);
    assert.equal(hermesRuntime?.version, '0.9.1');
    assert.equal(hermesRuntime?.issues.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent runtime detector keeps runtime installed when version command fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-version-fail-'));
  try {
    const opencode = join(dir, 'opencode');
    writeFileSync(opencode, '#!/bin/sh\nexit 12\n', 'utf8');
    chmodSync(opencode, 0o755);

    const opencodeRuntime = detectInstalledAgentRuntimes({
      env: { PATH: dir },
    }).find((runtime) => runtime.agentType === 'opencode');

    assert.equal(opencodeRuntime?.status, 'installed');
    assert.equal(opencodeRuntime?.installed, true);
    assert.equal(opencodeRuntime?.issues[0]?.code, 'version_detection_failed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent runtime detector keeps runtime installed when version command times out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-version-timeout-'));
  try {
    const opencode = join(dir, 'opencode');
    writeFileSync(opencode, `#!${process.execPath}\nsetTimeout(() => {}, 2000);\n`, 'utf8');
    chmodSync(opencode, 0o755);

    const opencodeRuntime = detectInstalledAgentRuntimes({
      env: { PATH: dir },
      versionTimeoutMs: 50,
    }).find((runtime) => runtime.agentType === 'opencode');

    assert.equal(opencodeRuntime?.status, 'installed');
    assert.equal(opencodeRuntime?.installed, true);
    assert.equal(opencodeRuntime?.issues[0]?.code, 'version_detection_timeout');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
