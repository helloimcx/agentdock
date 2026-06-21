import assert from 'node:assert/strict';
import test from 'node:test';
import { hasMarkdownCodeBlock } from '../../src/components/chat/markdown-code-block.js';

test('markdown code block detection covers fenced and indented code blocks', () => {
  assert.equal(hasMarkdownCodeBlock('```ts\nconst value = 1;\n```'), true);
  assert.equal(hasMarkdownCodeBlock('~~~python\nprint("hi")\n~~~'), true);
  assert.equal(hasMarkdownCodeBlock('  ````ts\nconst value = 1;\n`````'), true);
  assert.equal(hasMarkdownCodeBlock('```ts\nconst unfinished = true;'), true);
  assert.equal(hasMarkdownCodeBlock('Paragraph\n\n    pnpm test'), true);
  assert.equal(hasMarkdownCodeBlock('Use `inline code` only'), false);
});
