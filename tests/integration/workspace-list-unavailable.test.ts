import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalCoreAcpStore } from '../../apps/daemon/src/acp/local-core-acp-store.js';
import { LocalCoreEventBus } from '../../apps/daemon/src/kernel/event-bus.js';
import { WorkspaceRouter } from '../../apps/daemon/src/router/workspace-router.js';

test('listWorkspaces marks a workspace with a missing provider instead of failing the list', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ws-router-unavail-user-'));
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ws-router-unavail-ws-'));
  mkdirSync(workspaceDir, { recursive: true });
  let router: WorkspaceRouter | undefined;
  try {
    const store = new LocalCoreAcpStore(userData);
    router = new WorkspaceRouter({
      store,
      eventBus: new LocalCoreEventBus(),
      readRuntimeConfig: async () => ({
        storage: 'sqlite',
        databasePath: join(userData, 'runtime.db'),
        baseDir: userData,
        config: {
          projects: [
            {
              name: 'workspace-butler-primary',
              platforms: [],
              agent: {
                type: 'localcore-acp',
                options: { command: 'true', work_dir: workspaceDir },
              },
            },
            {
              name: 'workspace-butler-orphan',
              platforms: [],
              agent: {
                type: 'localcore-acp',
                options: { provider_id: 'provider-deepseek-ghost', work_dir: workspaceDir },
              },
            },
          ],
        },
      }),
      getCapabilities: () => ({ snapshot: { agents: [] } }) as any,
      knowledgeProvider: { listKnowledgeBases: async () => [] } as any,
      knowledgeAttachments: { listThreadKnowledgeBaseIds: async () => [] } as any,
    });

    const summaries = await router.listWorkspaces();
    assert.equal(summaries.length, 2, 'both workspaces must stay visible in the list');
    const healthy = summaries.find((summary) => summary.name === 'workspace-butler-primary');
    assert.ok(healthy, 'healthy workspace must be listed');
    assert.ok(!healthy.unavailable, 'healthy workspace must not be marked unavailable');
    assert.equal(healthy.agentType, 'localcore-acp');

    const orphan = summaries.find((summary) => summary.name === 'workspace-butler-orphan');
    assert.ok(orphan, 'the broken workspace must still be listed instead of failing the request');
    assert.equal(orphan.unavailable, true, 'broken workspace must be marked unavailable');
    assert.match(orphan.unavailableReason || '', /workspace-butler-orphan/,
      'reason must identify the affected workspace');
    assert.match(orphan.unavailableReason || '', /provider-deepseek-ghost/,
      'reason must name the missing provider');
  } finally {
    router?.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
