import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalCoreLarkGateway } from '../../apps/daemon/src/channel/lark/local-core-lark-gateway.js';
import {
  buildLarkPostContent,
  renderLarkTextMessage,
} from '../../apps/daemon/src/channel/lark/rendering/messages.js';
import { splitMarkdownForLark } from '../../apps/daemon/src/channel/lark/rendering/markdown.js';
import {
  createLarkTurnState,
  consumeLarkBridgeEvent,
  setLarkRenderedMessageId,
} from '../../apps/daemon/src/channel/lark/runtime-state.js';

function findLarkPostMdText(content: any) {
  for (const line of content.zh_cn?.content || []) {
    for (const item of Array.isArray(line) ? line : []) {
      if (item?.tag === 'md') {
        return String(item.text || '');
      }
    }
  }
  return '';
}

function tableMarkdown(index: number) {
  return [
    `| # | 标题 | 状态 | 一句话 |`,
    `|---|------|------|--------|`,
    `| ${index} | **标题 ${index}** | 待处理 | 摘要 ${index} |`,
  ].join('\n');
}

test('lark text renderer keeps plain markdown on post messages', () => {
  const rendered = renderLarkTextMessage('### 标题\n\n普通回复');

  assert.equal(rendered.msgType, 'post');
  assert.equal(rendered.renderKind, 'post_md');
  assert.equal(rendered.reason, 'plain_markdown');
  assert.equal(rendered.tableCount, 0);
  assert.equal(findLarkPostMdText(rendered.content), '### 标题\n\n普通回复');
});

test('lark text renderer sends markdown tables through schema 2.0 cards', () => {
  const markdown = [
    '### 各收件内容摘要',
    '',
    tableMarkdown(1),
  ].join('\n');
  const rendered = renderLarkTextMessage(markdown);

  assert.equal(rendered.msgType, 'interactive');
  assert.equal(rendered.renderKind, 'markdown_card');
  assert.equal(rendered.reason, 'markdown_table');
  assert.equal(rendered.tableCount, 1);
  assert.equal((rendered.content as any).schema, '2.0');
  assert.equal((rendered.content as any).body?.elements?.[0]?.tag, 'markdown');
  assert.match((rendered.content as any).body?.elements?.[0]?.content || '', /\| 1 \| \*\*标题 1\*\* \| 待处理 \|/);
});

test('lark post fallback renders markdown table rows as visible text', () => {
  const content = buildLarkPostContent([
    '### 各收件内容摘要',
    '',
    tableMarkdown(1),
    tableMarkdown(2),
    tableMarkdown(3),
    tableMarkdown(4),
    tableMarkdown(5),
    tableMarkdown(6),
    '',
    '需要我对哪个文件做进一步处理？',
  ].join('\n'));
  const text = findLarkPostMdText(content);

  assert.doesNotMatch(text, /\|---\|/);
  assert.match(text, /1\. 标题: \*\*标题 1\*\*；状态: 待处理；一句话: 摘要 1/);
  assert.match(text, /6\. 标题: \*\*标题 6\*\*；状态: 待处理；一句话: 摘要 6/);
  assert.match(text, /需要我对哪个文件做进一步处理？/);
});

test('lark text renderer falls back to post when card table count exceeds the platform limit', () => {
  const rendered = renderLarkTextMessage([
    tableMarkdown(1),
    tableMarkdown(2),
    tableMarkdown(3),
    tableMarkdown(4),
    tableMarkdown(5),
    tableMarkdown(6),
  ].join('\n\n'));

  assert.equal(rendered.msgType, 'post');
  assert.equal(rendered.renderKind, 'post_md');
  assert.equal(rendered.reason, 'table_limit_fallback');
  assert.equal(rendered.tableCount, 6);
  assert.match(findLarkPostMdText(rendered.content), /6\. 标题: \*\*标题 6\*\*/);
});

test('lark text renderer sanitizes non-http markdown links', () => {
  const rendered = renderLarkTextMessage('[本地文件](file:///tmp/a.md) 和 [官网](https://example.com)');
  const text = findLarkPostMdText(rendered.content);

  assert.match(text, /本地文件 \(file:\/\/\/tmp\/a\.md\)/);
  assert.match(text, /\[官网\]\(https:\/\/example\.com\)/);
});

test('lark gateway sends rendered text message payloads without owning render strategy', async () => {
  const requests: any[] = [];
  const logs: string[] = [];
  const gateway = new LocalCoreLarkGateway({
    store: {} as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
    log: (line) => logs.push(line),
  });
  const result = await (gateway as any).sendTextAsMessage({
    client: {
      im: {
        message: {
          create: async (request: any) => {
            requests.push(request);
            return { data: { message_id: 'lark-msg-1' } };
          },
        },
      },
    },
  }, 'chat-1', [
    '### 各收件内容摘要',
    '',
    tableMarkdown(1),
  ].join('\n'));

  const request = requests[0];
  const content = JSON.parse(String(request?.data?.content || '{}'));
  assert.equal(result.messageId, 'lark-msg-1');
  assert.equal(result.renderKind, 'markdown_card');
  assert.equal(request?.data?.msg_type, 'interactive');
  assert.equal(content.schema, '2.0');
  assert.match(logs.join('\n'), /msgType=interactive reason=markdown_table tableCount=1/);
});

test('splitMarkdownForLark returns single chunk when within byte limit', () => {
  const text = '### 简要报告\n\n内容正常。';
  const chunks = splitMarkdownForLark(text, 1024);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], text);
});

test('splitMarkdownForLark splits across paragraphs and preserves code block fence pairing', () => {
  const codeBlock = '```typescript\nconst a = 1;\nconst b = 2;\n```';
  const longText = [
    '## 模块一',
    '这里是详细描述。',
    '',
    codeBlock,
    '',
    '## 模块二',
    '这里是后续分析。',
  ].join('\n');

  // Set a small maxBytes to force split around the code block
  const chunks = splitMarkdownForLark(longText, 60);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    const fences = (chunk.match(/```/g) || []).length;
    // Fences must be balanced (even number of ```)
    assert.equal(fences % 2, 0, `Chunk code fences must be balanced: ${chunk}`);
  }
});

test('consumeLarkBridgeEvent preserves scheduled-status progressMessageIds across typing_start', () => {
  const turn = createLarkTurnState('session-scheduled-1');
  // Simulate initial scheduled notice
  setLarkRenderedMessageId(turn, {
    key: 'scheduled-status:auto-1',
    text: '⏳ 每日早报 (正在运行...)',
    buttonRows: [],
    isFinal: false,
  }, 'msg-status-card-123');

  // Also simulate normal progress card
  setLarkRenderedMessageId(turn, {
    key: 'call_abc',
    text: 'calling tool',
    buttonRows: [],
    isFinal: false,
  }, 'msg-tool-card-456');

  assert.equal(turn.progressMessageIds['scheduled-status:auto-1'], 'msg-status-card-123');
  assert.equal(turn.progressMessageIds['call_abc'], 'msg-tool-card-456');

  // ACP starts turn
  consumeLarkBridgeEvent(turn, {
    type: 'typing_start',
    sessionKey: 'session-scheduled-1',
  }, { mirrorPermissionStateInMainCard: true });

  // scheduled-status is preserved!
  assert.equal(turn.progressMessageIds['scheduled-status:auto-1'], 'msg-status-card-123');
  // normal tool calls are cleared
  assert.equal(turn.progressMessageIds['call_abc'], undefined);
});


