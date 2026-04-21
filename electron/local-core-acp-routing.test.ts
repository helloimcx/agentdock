import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigFileState, DesktopConnectConfig, DesktopProjectConfig } from '../packages/contracts/src/index.js';
import { DESKTOP_CLAUDECODE_ACP_PACKAGE, isAcpAgentType } from '../shared/desktop.js';
import { ServiceManager } from './service-manager.js';
import { isLocalCoreNativeAcpProject, toLocalCoreProjectConfig } from '../services/local-ai-core/src/workspace-route-config.js';
import { createWorkspaceRouter } from '../services/local-ai-core/src/workspace-router.js';
import type { KnowledgeProvider } from '../packages/knowledge-api/src/index.js';

function withTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-workstation-localcore-'));
  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function buildConfigState(project: DesktopProjectConfig): ConfigFileState {
  return {
    path: '/tmp/ai-workstation-config.toml',
    exists: true,
    raw: '',
    warnings: [],
    parsed: {
      projects: [project],
    },
  };
}

function buildProject(overrides: Partial<DesktopProjectConfig> = {}): DesktopProjectConfig {
  return {
    name: 'workspace-a',
    agent: {
      type: 'claudecode',
      options: {
        work_dir: '.',
      },
    },
    platforms: [],
    ...overrides,
  };
}

test('claudecode is treated as an ACP-style streaming agent in the renderer', () => {
  assert.equal(isAcpAgentType('claudecode'), true);
});

test('claudecode workspace is routed as Local AI Core native ACP', () => {
  assert.equal(isLocalCoreNativeAcpProject(buildProject()), true);
});

test('claudecode Local AI Core config infers the claude ACP command', () => {
  const project = buildProject();
  const config = toLocalCoreProjectConfig(buildConfigState(project), project);

  assert.equal(config.agentType, 'claudecode');
  assert.equal(config.command, process.execPath);
  assert.match(config.args[0] || '', new RegExp(`${DESKTOP_CLAUDECODE_ACP_PACKAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.+dist[/\\\\]index\\.js$`));
});

test('claudecode Local AI Core config maps the workspace model to ANTHROPIC_MODEL', () => {
  const project = buildProject({
    agent: {
      type: 'claudecode',
      options: {
        work_dir: '.',
        model: 'claude-sonnet-4-20250514',
      },
    },
  });
  const config = toLocalCoreProjectConfig(buildConfigState(project), project);

  assert.equal(config.env.ANTHROPIC_MODEL, 'claude-sonnet-4-20250514');
});

test('workspace router resolves claudecode workspaces to the Local AI Core ACP route', async () => {
  const knowledgeProvider = {
    listThreadKnowledgeBaseIds: async () => [],
    updateThreadKnowledgeBaseIds: async (_threadId: string, knowledgeBaseIds: string[]) => knowledgeBaseIds,
    deleteThreadKnowledgeBaseLinks: async () => ({ deleted: true }),
  } as unknown as KnowledgeProvider;
  const router = createWorkspaceRouter({
    emitBridge: () => undefined,
    readConfigState: async () => buildConfigState(buildProject()),
    userDataPath: '/tmp',
    managementRequest: async () => {
      throw new Error('managementRequest should not be called for a localcore-acp probe');
    },
    bridgeSendMessage: async () => {
      throw new Error('bridgeSendMessage should not be called for a localcore-acp probe');
    },
    knowledgeProvider,
  });

  try {
    const route = await (router as unknown as {
      getWorkspaceRoute: (workspaceId: string) => Promise<{
        kind: string;
        agentType: string;
        config?: { command: string; args: string[] };
      }>;
    }).getWorkspaceRoute('workspace-a');
    assert.equal(route.kind, 'localcore-acp');
    assert.equal(route.agentType, 'claudecode');
    assert.equal(route.config?.command, process.execPath);
    assert.match(route.config?.args?.[0] || '', new RegExp(`${DESKTOP_CLAUDECODE_ACP_PACKAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.+dist[/\\\\]index\\.js$`));
  } finally {
    router.close();
  }
});

test('service manager omits claudecode local-only workspaces from generated cc-connect runtime config', async () => {
  const temp = withTempDir();
  try {
    const manager = new ServiceManager(temp.dir);
    const logicalConfig: DesktopConnectConfig = {
      projects: [buildProject()],
    };
    await manager.writeStructuredConfig(logicalConfig);
    const state = await manager.readConfigState();
    assert.ok(state.parsed);
    const derived = (manager as unknown as { deriveRuntimeConfig: (config: DesktopConnectConfig) => DesktopConnectConfig })
      .deriveRuntimeConfig(state.parsed);

    assert.deepEqual(derived.projects || [], []);
  } finally {
    temp.cleanup();
  }
});
