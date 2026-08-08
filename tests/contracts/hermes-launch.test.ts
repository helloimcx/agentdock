import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DesktopProjectConfig, RuntimeConfigState } from '@cc/superai-contracts';
import {
  buildHermesLaunchConfig,
  resolveHermesModel,
} from '../../services/local-ai-core/src/agents/hermes/launch.js';

function makeConfigState(): RuntimeConfigState & { __tmpDir: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'hermes-launch-'));
  return {
    storage: 'sqlite',
    databasePath: join(tmpDir, 'local-core.db'),
    baseDir: tmpDir,
    config: { projects: [] },
    updatedAt: new Date().toISOString(),
    __tmpDir: tmpDir,
  } as RuntimeConfigState & { __tmpDir: string };
}

function makeProject(overrides: Partial<DesktopProjectConfig> = {}): DesktopProjectConfig {
  return {
    workspace_id: 'workspace-stable',
    name: 'Obsidian-Personal',
    agent: { type: 'hermes', options: {} },
    platforms: [],
    ...overrides,
  };
}

test('hermes launcher writes a HERMES_HOME config.yaml derived from the resolved provider', () => {
  const configState = makeConfigState();
  try {
    const launch = buildHermesLaunchConfig({
      configState,
      project: makeProject(),
      agentType: 'hermes',
      providers: [{
        name: 'opencode go',
        base_url: 'https://opencode.ai/zen/go/v1',
        api_key: 'sk-test-123',
        model: 'glm-5.2',
      }],
      model: 'glm-5.2',
    });

    assert.equal(launch.command, 'hermes');
    assert.deepEqual(launch.args, ['acp']);
    const env = launch.env || {};
    assert.equal(env.HERMES_YOLO_MODE, '1');
    const hermesHome = env.HERMES_HOME;
    assert.ok(hermesHome, 'HERMES_HOME is set when provider is configured');

    const configYaml = readFileSync(join(hermesHome!, 'config.yaml'), 'utf8');
    assert.match(configYaml, /default: "glm-5.2"/);
    assert.match(configYaml, /provider: custom/);
    assert.match(configYaml, /base_url: "https:\/\/opencode\.ai\/zen\/go\/v1"/);
    assert.match(configYaml, /api_key: "sk-test-123"/);
    assert.match(configYaml, /- hermes-cli/);
  } finally {
    rmSync((configState as any).__tmpDir, { recursive: true, force: true });
  }
});

test('hermes launcher leaves HERMES_HOME unset when project has no provider so hermes reads its own config', () => {
  const configState = makeConfigState();
  try {
    const launch = buildHermesLaunchConfig({
      configState,
      project: makeProject(),
      agentType: 'hermes',
      providers: [],
      model: '',
    });
    const env = launch.env || {};
    assert.equal(env.HERMES_HOME, undefined, 'no provider => no HERMES_HOME override');
    assert.equal(env.HERMES_YOLO_MODE, '1');
  } finally {
    rmSync((configState as any).__tmpDir, { recursive: true, force: true });
  }
});

test('hermes launcher is idempotent across calls with the same provider', () => {
  const configState = makeConfigState();
  try {
    const input = {
      configState,
      project: makeProject(),
      agentType: 'hermes',
      providers: [{
        name: 'opencode go',
        base_url: 'https://opencode.ai/zen/go/v1',
        api_key: 'sk-test-123',
        model: 'glm-5.2',
      }],
      model: 'glm-5.2',
    };
    const first = buildHermesLaunchConfig(input).env?.HERMES_HOME;
    const second = buildHermesLaunchConfig(input).env?.HERMES_HOME;
    assert.equal(first, second, 'same input yields same HERMES_HOME path');
    const firstContent = readFileSync(join(first!, 'config.yaml'), 'utf8');
    const secondContent = readFileSync(join(second!, 'config.yaml'), 'utf8');
    assert.equal(firstContent, secondContent);
  } finally {
    rmSync((configState as any).__tmpDir, { recursive: true, force: true });
  }
});

test('resolveHermesModel prefers the project raw model, falls back to provider default', () => {
  assert.equal(resolveHermesModel({
    project: makeProject(),
    providers: [],
    rawModel: 'claude-opus-4.7',
    normalizedModel: 'claude-opus-4.7',
  }), 'claude-opus-4.7');

  assert.equal(resolveHermesModel({
    project: makeProject(),
    providers: [{
      name: 'opencode go',
      base_url: 'https://opencode.ai/zen/go/v1',
      api_key: 'k',
      model: 'glm-5.2',
    }],
    rawModel: '',
    normalizedModel: '',
  }), 'glm-5.2');
});
