import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { renderLarkTextMessage } from '../../../services/local-ai-core/src/channel/lark/rendering/messages.js';
import type { BddWorld } from '../support/world.js';

function tableMarkdown(index: number) {
  return [
    '| # | 标题 | 状态 | 一句话 |',
    '|---|------|------|--------|',
    `| ${index} | **标题 ${index}** | 待处理 | 摘要 ${index} |`,
  ].join('\n');
}

function extractMdText(content: unknown): string {
  const lines = (content as { zh_cn?: { content?: unknown[] } })?.zh_cn?.content ?? [];
  for (const line of lines) {
    for (const item of Array.isArray(line) ? line : []) {
      if ((item as { tag?: string })?.tag === 'md') {
        return String((item as { text?: string }).text ?? '');
      }
    }
  }
  return '';
}

When<BddWorld>(/^the lark text renderer processes:$/, function (docstring: string) {
  this.rendered = renderLarkTextMessage(docstring) as Record<string, unknown>;
});

When<BddWorld>(/^the lark text renderer processes a markdown body with (\d+) tables?$/, function (count) {
  const markdown = Array.from({ length: Number(count) }, (_unused, index) => tableMarkdown(index + 1)).join('\n\n');
  this.rendered = renderLarkTextMessage(markdown) as Record<string, unknown>;
});

Then<BddWorld>(/^the message type is "([^"]+)"$/, function (msgType) {
  assert.equal(this.rendered?.msgType, msgType);
});

Then<BddWorld>(/^the render kind is "([^"]+)"$/, function (renderKind) {
  assert.equal(this.rendered?.renderKind, renderKind);
});

Then<BddWorld>(/^the render reason is "([^"]+)"$/, function (reason) {
  assert.equal(this.rendered?.reason, reason);
});

Then<BddWorld>(/^the table count is (\d+)$/, function (count) {
  assert.equal(this.rendered?.tableCount, Number(count));
});

Then<BddWorld>(/^the card schema is "([^"]+)"$/, function (schema) {
  assert.equal((this.rendered?.content as { schema?: unknown })?.schema, schema);
});

Then<BddWorld>(/^the rendered markdown contains "([^"]+)"$/, function (needle) {
  const text = extractMdText(this.rendered?.content);
  assert.ok(text.includes(needle), `rendered markdown missing "${needle}"`);
});
