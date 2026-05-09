import {
  countMarkdownTables,
  normalizeMarkdownTablesForLarkPost,
  sanitizeLarkMarkdown,
  shouldUseLarkMarkdownCard,
} from './markdown.js';

export type LarkRenderedTextMessage = {
  msgType: 'post' | 'interactive';
  content: Record<string, unknown>;
  renderKind: 'post_md' | 'markdown_card';
  reason: 'plain_markdown' | 'markdown_table' | 'table_limit_fallback';
  tableCount: number;
};

export function renderLarkTextMessage(markdown: string): LarkRenderedTextMessage {
  const tableCount = countMarkdownTables(markdown);
  if (shouldUseLarkMarkdownCard(markdown)) {
    return {
      msgType: 'interactive',
      content: buildLarkMarkdownCardContent(markdown),
      renderKind: 'markdown_card',
      reason: 'markdown_table',
      tableCount,
    };
  }

  return {
    msgType: 'post',
    content: buildLarkPostContent(markdown),
    renderKind: 'post_md',
    reason: tableCount > 0 ? 'table_limit_fallback' : 'plain_markdown',
    tableCount,
  };
}

export function buildLarkPostContent(markdown: string) {
  const normalized = normalizeMarkdownTablesForLarkPost(String(markdown || '').trim() || ' ');
  return {
    zh_cn: {
      content: [[{
        tag: 'md',
        text: sanitizeLarkMarkdown(normalized),
      }]],
    },
  };
}

export function buildLarkMarkdownCardContent(markdown: string) {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    body: {
      elements: [{
        tag: 'markdown',
        content: sanitizeLarkMarkdown(String(markdown || '').trim() || ' '),
      }],
    },
  };
}

export { normalizeMarkdownTablesForLarkPost, shouldUseLarkMarkdownCard };
