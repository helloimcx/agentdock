import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalCoreLarkGateway } from '../../services/local-ai-core/src/channel/lark/local-core-lark-gateway.js';
import {
  buildLarkPostContent,
  renderLarkTextMessage,
} from '../../services/local-ai-core/src/channel/lark/rendering/messages.js';

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
