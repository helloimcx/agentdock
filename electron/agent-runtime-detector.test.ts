import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectInstalledAgentRuntimes } from '../services/local-ai-core/src/runtime/agent-runtime-detector.js';

test('agent runtime detector only marks commands present on PATH as installed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-detector-'));
  try {
    const opencode = join(dir, 'opencode');
    writeFileSync(opencode, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(opencode, 0o755);

    const runtimes = detectInstalledAgentRuntimes({
      env: { PATH: dir },
    });
    const byType = new Map(runtimes.map((runtime) => [runtime.agentType, runtime]));

    assert.equal(byType.get('opencode')?.installed, true);
    assert.equal(byType.get('opencode')?.source, 'path');
    assert.equal(byType.get('opencode')?.command, opencode);
    assert.equal(byType.get('codex')?.installed, false);
    assert.equal(byType.get('localcore-acp')?.installed, true);
    assert.equal(byType.get('localcore-acp')?.source, 'builtin');
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
    assert.equal(codex?.source, 'config');
    assert.equal(codex?.command, customCodex);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
