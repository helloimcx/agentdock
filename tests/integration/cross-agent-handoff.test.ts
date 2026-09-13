import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { LocalCoreEventBus } from '../../services/local-ai-core/src/kernel/event-bus.js';
import { WorkspaceRouter } from '../../services/local-ai-core/src/router/workspace-router.js';
import { parseSessionHandoffDelimiter } from '@cc/superai-contracts/handoff';

test('cross-agent handoff end-to-end: switch agent creates pending handoff and next prompt injects it', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cross-agent-handoff-user-'));
  const workspaceDir = mkdtempSync(join(tmpdir(), 'cross-agent-handoff-ws-'));

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
      getCapabilities: () => ({ snapshot: { agents: [{ agentType: 'claude-code' }, { agentType: 'codex' }, { agentType: 'pi' }] } }) as any,
      knowledgeProvider: { listKnowledgeBases: async () => [] } as any,
      knowledgeAttachments: { listThreadKnowledgeBaseIds: async () => [] } as any,
    });

    const thread = store.createThread('fixture-ws', 'Handoff Test');
    // Set initial agent to claude-code
    store.updateThreadAgentType(thread.id, 'claude-code');

    // Simulate prior turn with an assistant response and trace span
    const runId = `run:${thread.id}:1001`;
    store.updateRun(runId, thread.id, 'completed');
    store.trace.insertSpan({
      id: 'span:101',
      runId,
      kind: 'tool_call',
      name: 'edit_file',
      status: 'completed',
      inputJson: { path: 'src/main.ts' },
    });
    store.appendMessage(
      thread.id,
      'assistant',
      '已确认采用微内核架构方案。注意待确认数据库迁移策略。\n\n下一步：\n- 运行回归测试',
      'final',
    );

    // 1. Switch agent via slash command: /agent use codex
    await router.sendThreadMessage(thread.id, '/agent use codex');

    // Check thread agent was switched
    const updatedThreadRow = store.getThreadRow(thread.id);
    assert.equal(updatedThreadRow?.agent_type, 'codex');

    // Check slash command response message mentions handoff distillation
    const detailAfterSwitch = store.getThread(thread.id, []);
    const switchNotice = detailAfterSwitch.messages[detailAfterSwitch.messages.length - 1];
    assert.match(switchNotice.content, /已将当前线程 Agent 切换为 codex/);
    assert.match(switchNotice.content, /已生成会话交接摘要/);


    // Check pending handoff record in store
    const pendingHandoff = store.sessionHandoffs.getPendingHandoff(thread.id);
    assert(pendingHandoff, 'Expected a pending handoff record in session_handoffs table');
    assert.equal(pendingHandoff.fromAgent, 'claudecode');
    assert.equal(pendingHandoff.toAgent, 'codex');
    assert.equal(pendingHandoff.status, 'pending');
    assert(pendingHandoff.decisions.some((d) => d.includes('微内核架构')));
    assert(pendingHandoff.artifacts.includes('src/main.ts'));


    // 2. Next user prompt: send a regular prompt
    await router.sendThreadMessage(thread.id, '请基于之前的讨论继续实现。');

    // Verify pending handoff was marked consumed
    const consumedHandoff = store.sessionHandoffs.getHandoff(pendingHandoff.id);
    assert.equal(consumedHandoff?.status, 'consumed');
    assert(consumedHandoff?.consumedAt);

    // Verify handoff delimiter was injected into the composed user message
    const detailAfterPrompt = store.getThread(thread.id, []);
    const promptMessage = detailAfterPrompt.messages.find(
      (m) => m.role === 'user' && m.content.includes('请基于之前的讨论继续实现。'),
    );
    assert(promptMessage, 'Expected prompt message in thread history');
    assert.match(promptMessage.content, /\[Session Handoff from claudecode to codex\]/);
    assert.match(promptMessage.content, /Key Decisions:/);
    assert.match(promptMessage.content, /Artifacts & Modified Files:/);
    assert.match(promptMessage.content, /\[\/Session Handoff\]/);

    // Test delimiter parser on the stored message
    const parsed = parseSessionHandoffDelimiter(promptMessage.content);
    assert(parsed);
    assert.equal(parsed.fromAgent, 'claudecode');
    assert.equal(parsed.toAgent, 'codex');
    assert.match(parsed.body, /微内核架构/);


    // 3. Subsequent user prompt should NOT have handoff injected again
    await router.sendThreadMessage(thread.id, '测试下一轮对话');
    const detailAfterSecondPrompt = store.getThread(thread.id, []);
    const secondPrompt = detailAfterSecondPrompt.messages.find(
      (m) => m.role === 'user' && m.content.includes('测试下一轮对话'),
    );
    assert(secondPrompt);
    assert.doesNotMatch(secondPrompt.content, /\[Session Handoff/);

    // 4. Consecutive switches supersede pending handoffs
    await router.sendThreadMessage(thread.id, '/agent use pi');
    const handoffForPi = store.sessionHandoffs.getPendingHandoff(thread.id);
    assert(handoffForPi);
    assert.equal(handoffForPi.toAgent, 'pi');
    assert.equal(handoffForPi.status, 'pending');

    // Switch again without sending prompt
    await router.sendThreadMessage(thread.id, '/agent use codex');
    const oldHandoff = store.sessionHandoffs.getHandoff(handoffForPi.id);
    assert.equal(oldHandoff?.status, 'superseded');

    const newHandoff = store.sessionHandoffs.getPendingHandoff(thread.id);
    assert(newHandoff);
    assert.equal(newHandoff.toAgent, 'codex');
    assert.equal(newHandoff.status, 'pending');
  } finally {
    router?.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

