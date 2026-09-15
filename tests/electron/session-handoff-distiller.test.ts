import test from 'node:test';
import assert from 'node:assert/strict';
import { distillSessionHandoff, SessionHandoffDistiller } from '../../services/local-ai-core/src/acp/session-handoff-distiller.js';
import type { RunSpan, ThreadMessage } from '@cc/superai-contracts';

test('SessionHandoffDistiller handles empty inputs safely and quickly (< 2ms)', () => {
  const start = performance.now();
  const result = distillSessionHandoff({
    threadId: 'thread:test::001',
    fromAgent: 'claude-code',
    toAgent: 'codex',
  });
  const elapsed = performance.now() - start;

  assert(elapsed < 10, `Distillation should be immediate (< 10ms), took ${elapsed}ms`);
  assert.equal(result.threadId, 'thread:test::001');
  assert.equal(result.fromAgent, 'claude-code');
  assert.equal(result.toAgent, 'codex');
  assert.equal(result.decisions.length, 0);
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.openQuestions.length, 0);
  assert.equal(result.nextSteps.length, 0);
  assert.match(result.summary, /Session handoff from claude-code/);
});

test('SessionHandoffDistiller extracts artifacts, decisions, open questions, and next steps', () => {
  const spans: RunSpan[] = [
    {
      id: 'span:1',
      runId: 'run:1',
      kind: 'tool_call',
      name: 'write_file',
      status: 'completed',
      startedAt: '2026-09-13T10:00:00Z',
      inputJson: JSON.stringify({ targetFile: 'src/index.ts' }),
    },
    {
      id: 'span:2',
      runId: 'run:1',
      kind: 'tool_call',
      name: 'edit_file',
      status: 'completed',
      startedAt: '2026-09-13T10:01:00Z',
      inputJson: { path: 'packages/contracts/src/handoff.ts' },
    },
    {
      id: 'span:3',
      runId: 'run:1',
      kind: 'thought',
      name: 'internal_step',
      status: 'completed',
      startedAt: '2026-09-13T10:02:00Z',
    },
  ];

  const messages: ThreadMessage[] = [
    {
      id: 'msg:1',
      role: 'user',
      content: 'Please refactor the memory module and fix database schemas.',
      timestamp: '2026-09-13T10:00:00Z',
    },
    {
      id: 'msg:2',
      role: 'assistant',
      content: `已确认采用 SQLite FTS5 方案进行全文索引。已修复数据库迁移中的语法问题。
注意待确认是否支持向量检索扩展。

下一步：
- 完成单元测试编写
- 验证端到端交付流程
`,
      timestamp: '2026-09-13T10:01:00Z',
    },
    {
      id: 'msg:3',
      role: 'assistant',
      content: `### 总结
本次任务重构了核心模块。
Decided to use node:sqlite instead of external drivers.

后续建议：
1. 提交 Pull Request
2. 触发 CI 测试
`,
      timestamp: '2026-09-13T10:02:00Z',
    },
  ];

  const distiller = new SessionHandoffDistiller();
  const payload = distiller.distill({
    threadId: 'thread:work::002',
    fromAgent: 'claude-code',
    toAgent: 'codex',
    lastRunId: 'run:test:123',
    spans,
    messages,
  });

  assert.equal(payload.threadId, 'thread:work::002');
  assert.equal(payload.runId, 'run:test:123');
  assert.equal(payload.fromAgent, 'claude-code');
  assert.equal(payload.toAgent, 'codex');

  // Artifacts extracted from tool calls
  assert.deepEqual(payload.artifacts.sort(), ['packages/contracts/src/handoff.ts', 'src/index.ts'].sort());

  // Tool summary computed
  assert.deepEqual(payload.toolSummary, {
    totalToolCalls: 2,
    tools: {
      write_file: 1,
      edit_file: 1,
    },
  });

  // Decisions extracted
  assert(payload.decisions.some((d) => d.includes('SQLite FTS5')));
  assert(payload.decisions.some((d) => d.includes('node:sqlite')));

  // Open questions extracted
  assert(payload.openQuestions.some((q) => q.includes('待确认') || q.includes('向量检索')));

  // Next steps extracted
  assert(payload.nextSteps.some((s) => s.includes('Pull Request') || s.includes('单元测试')));

  // Summary stripped of markdown
  assert(!payload.summary.includes('###'));
  assert.match(payload.summary, /总结/);
});
