import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { LocalCoreEventBus } from '../../services/local-ai-core/src/kernel/event-bus.js';
import { WorkspaceRouter } from '../../services/local-ai-core/src/router/workspace-router.js';

const OVERRIDE_MARKER = 'WORKSPACE-STOCK-OVERRIDE-MARKER';

test('sendThreadMessage composes skill blocks from workspace-scoped skill overrides', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ws-router-skill-user-'));
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ws-router-skill-ws-'));
  const skillDir = join(workspaceDir, '.agentdock', 'skills', 'stock-monitor');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), [
    '---',
    'name: stock-monitor',
    'description: workspace override',
    '---',
    '',
    OVERRIDE_MARKER,
    '',
  ].join('\n'), 'utf8');

  const store = new LocalCoreAcpStore(userData);
  const router = new WorkspaceRouter({
    store,
    eventBus: new LocalCoreEventBus(),
    readRuntimeConfig: async () => ({
      storage: 'sqlite',
      databasePath: join(userData, 'runtime.db'),
      baseDir: userData,
      config: {
        projects: [{
          name: 'fixture-ws',
          platforms: [],
          agent: {
            type: 'localcore-acp',
            options: { command: 'true', work_dir: workspaceDir },
          },
        }],
      },
    }),
    getCapabilities: () => ({ snapshot: { agents: [] } }) as any,
    knowledgeProvider: { listKnowledgeBases: async () => [] } as any,
    knowledgeAttachments: { listThreadKnowledgeBaseIds: async () => [] } as any,
  });

  try {
    const thread = store.createThread('fixture-ws', 'skill composition');
    await router.sendThreadMessage(thread.id, '帮我监控股票价格');

    const detail = store.getThread(thread.id, []);
    const userMessage = detail.messages.find((message) => message.role === 'user');
    assert(userMessage, 'expected a composed user message');
    assert.match(userMessage.content, /\[Stock Monitor Skill\]/);
    assert.match(userMessage.content, new RegExp(OVERRIDE_MARKER));
  } finally {
    router.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
