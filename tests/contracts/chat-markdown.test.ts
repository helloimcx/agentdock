import assert from 'node:assert/strict';
import test from 'node:test';
import { hasMarkdownCodeBlock } from '../../src/components/chat/markdown-code-block.js';
import { remarkCitationLinks } from '../../src/components/chat/remark-citation-links.js';

test('markdown code block detection covers fenced and indented code blocks', () => {
  assert.equal(hasMarkdownCodeBlock('```ts\nconst value = 1;\n```'), true);
  assert.equal(hasMarkdownCodeBlock('~~~python\nprint("hi")\n~~~'), true);
  assert.equal(hasMarkdownCodeBlock('  ````ts\nconst value = 1;\n`````'), true);
  assert.equal(hasMarkdownCodeBlock('```ts\nconst unfinished = true;'), true);
  assert.equal(hasMarkdownCodeBlock('Paragraph\n\n    pnpm test'), true);
  assert.equal(hasMarkdownCodeBlock('Use `inline code` only'), false);
});

test('markdown link targets exclude a bracket swallowed before an adjacent numeric citation', () => {
  const source = '[site](https://chatgpt.com/features/sites/[) [1]';
  const link = {
    type: 'link',
    url: 'https://chatgpt.com/features/sites/%5B',
    position: { start: { offset: 0 }, end: { offset: source.indexOf(' [1]') } },
  };

  remarkCitationLinks()(link, { value: source });

  assert.equal(link.url, 'https://chatgpt.com/features/sites/');
});

test('markdown link repair keeps balanced URL brackets and non-citation links unchanged', () => {
  const source = '[path](https://example.com/path[part]) [1]';
  const balancedLink = {
    type: 'link',
    url: 'https://example.com/path%5Bpart%5D',
    position: { start: { offset: 0 }, end: { offset: source.indexOf(' [1]') } },
  };
  const nonCitationSource = '[path](https://example.com/path[) ordinary text';
  const nonCitationLink = {
    type: 'link',
    url: 'https://example.com/path%5B',
    position: { start: { offset: 0 }, end: { offset: nonCitationSource.length - ' ordinary text'.length } },
  };

  remarkCitationLinks()(balancedLink, { value: source });
  remarkCitationLinks()(nonCitationLink, { value: nonCitationSource });

  assert.equal(balancedLink.url, 'https://example.com/path%5Bpart%5D');
  assert.equal(nonCitationLink.url, 'https://example.com/path%5B');
});
