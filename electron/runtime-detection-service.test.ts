import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RuntimeDetectionService } from '../services/local-ai-core/src/runtime/runtime-detection-service.js';
import type { InstalledAgentRuntime } from '../packages/contracts/src/index.js';

test('runtime detection service returns unknown results before first detection', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'runtime-detection-service-'));
  try {
    const service = new RuntimeDetectionService({
      userDataPath,
      readConfig: async () => null,
      detect: () => [],
    });

    const runtimes = service.list();
    const opencode = runtimes.find((runtime) => runtime.runtimeId === 'opencode');

    assert.equal(opencode?.status, 'unknown');
    assert.equal(opencode?.installed, false);
    assert.equal(runtimes.find((runtime) => runtime.runtimeId === 'localcore-acp')?.status, 'installed');
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('runtime detection service refresh persists latest results', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'runtime-detection-service-persist-'));
  try {
    const detectedAt = '2026-04-27T00:00:00.000Z';
    const result = runtimeResult({ detectedAt, version: '1.2.3' });
    const service = new RuntimeDetectionService({
      userDataPath,
      readConfig: async () => null,
      detect: () => [result],
    });

    assert.deepEqual(await service.refresh(), [result]);

    const nextService = new RuntimeDetectionService({
      userDataPath,
      readConfig: async () => null,
      detect: () => [],
    });
    assert.equal(nextService.list()[0]?.version, '1.2.3');
    assert.match(readFileSync(join(userDataPath, 'runtime', 'runtime-detection.json'), 'utf8'), /"version": "1.2.3"/);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('runtime detection service ignores corrupted persisted state', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'runtime-detection-service-corrupt-'));
  try {
    const statePath = join(userDataPath, 'runtime', 'runtime-detection.json');
    mkdirSync(join(userDataPath, 'runtime'), { recursive: true });
    writeFileSync(statePath, '{not-json', 'utf8');
    const service = new RuntimeDetectionService({
      userDataPath,
      readConfig: async () => null,
      detect: () => [],
    });

    assert.equal(service.list().find((runtime) => runtime.runtimeId === 'opencode')?.status, 'unknown');
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('runtime detection service emits detection events and filters single runtime refresh response', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'runtime-detection-service-events-'));
  try {
    const events: string[] = [];
    const service = new RuntimeDetectionService({
      userDataPath,
      readConfig: async () => null,
      detect: () => [
        runtimeResult({ runtimeId: 'opencode', agentType: 'opencode' }),
        runtimeResult({ runtimeId: 'codex', agentType: 'codex' }),
      ],
      emit: (event) => {
        events.push(event.type);
      },
    });

    const refreshed = await service.refresh('codex');

    assert.deepEqual(refreshed.map((runtime) => runtime.runtimeId), ['codex']);
    assert.deepEqual(events, [
      'runtime.detect.started',
      'runtime.detect.completed',
      'runtime.status.changed',
      'runtime.status.changed',
    ]);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

function runtimeResult(input: Partial<InstalledAgentRuntime> = {}): InstalledAgentRuntime {
  return {
    agentType: input.agentType || 'opencode',
    runtimeId: input.runtimeId || input.agentType || 'opencode',
    displayName: input.displayName || 'OpenCode',
    status: input.status || 'installed',
    installed: input.installed ?? true,
    command: input.command || '/tmp/opencode',
    binaryPath: input.binaryPath || input.command || '/tmp/opencode',
    version: input.version,
    detectedAt: input.detectedAt || '2026-04-27T00:00:00.000Z',
    summary: input.summary || 'OpenCode is installed.',
    details: input.details,
    issues: input.issues || [],
    recommendedActions: input.recommendedActions || [],
    source: input.source || 'path',
    error: input.error,
  };
}
